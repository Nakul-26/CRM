import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import {
  ERROR_CODES,
  type AuthResponse,
  type AuthTokens,
  type AuthenticatedUser,
  type LoginInput,
  type RegisterOrganizationInput,
} from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { refreshTokens, userRoles } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { OrganizationsService } from "../organizations/organizations.service";
import { RolesService } from "../roles/roles.service";
import { UsersService } from "../users/users.service";
import { PasswordService } from "./password.service";

interface AccessTokenClaims {
  sub: string;
  organizationId: string;
  email: string;
  fullName: string;
  permissions: string[];
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly organizations: OrganizationsService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly events: DomainEventBus,
  ) {}

  async register(input: RegisterOrganizationInput): Promise<AuthResponse> {
    const passwordHash = await this.passwords.hash(input.password);

    const { user, permissions, organizationId } = await this.db.transaction(async (tx) => {
      const org = await this.organizations.create(input.organizationName, tx);
      const seeded = await this.roles.seedSystemRoles(org.id, tx);
      const created = await this.users.create(
        {
          organizationId: org.id,
          email: input.email,
          passwordHash,
          fullName: input.fullName,
        },
        tx,
      );
      await tx.insert(userRoles).values({
        userId: created.id,
        roleId: seeded.owner.id,
      });

      return { user: created, permissions: [...seeded.owner.permissions], organizationId: org.id };
    });

    this.events.publish({
      eventType: "organization.created",
      organizationId,
      actorId: user.id,
      payload: { organizationId, name: input.organizationName },
    });
    this.events.publish({
      eventType: "user.created",
      organizationId,
      actorId: user.id,
      payload: { userId: user.id, email: user.email },
    });

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      organizationId,
      email: user.email,
      fullName: user.fullName,
      permissions,
    };

    const { tokens } = await this.issueTokens(authenticatedUser);
    return { tokens, user: authenticatedUser };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const candidates = await this.users.findByEmailAcrossOrgs(input.email);
    const active = candidates.filter((c) => c.isActive);

    let matched = active;
    if (input.organizationSlug) {
      const org = await this.organizations.findBySlug(input.organizationSlug);
      matched = org ? active.filter((c) => c.organizationId === org.id) : [];
    }

    if (matched.length === 0) {
      this.recordFailedLogin(input.email);
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid email or password" });
    }

    if (matched.length > 1) {
      throw new ConflictException({
        code: ERROR_CODES.AMBIGUOUS_LOGIN,
        message: "This email is registered under multiple organizations. Pass organizationSlug to disambiguate.",
      });
    }

    const user = matched[0]!;
    const passwordOk = await this.passwords.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      this.recordFailedLogin(input.email, user.organizationId);
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid email or password" });
    }

    const permissions = await this.roles.permissionsForUser(user.id);
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
      permissions,
    };

    this.events.publish({
      eventType: "user.login_succeeded",
      organizationId: user.organizationId,
      actorId: user.id,
      payload: { userId: user.id },
    });

    const { tokens } = await this.issueTokens(authenticatedUser);
    return { tokens, user: authenticatedUser };
  }

  async refresh(presentedToken: string): Promise<AuthResponse> {
    const tokenHash = this.hashToken(presentedToken);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);

    if (!row) {
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_REFRESH_TOKEN, message: "Invalid refresh token" });
    }

    if (row.revokedAt) {
      // A previously-rotated token was presented again — possible theft.
      // Fail closed: kill every active session for this user.
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_REFRESH_TOKEN, message: "Refresh token reuse detected; all sessions revoked" });
    }

    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_REFRESH_TOKEN, message: "Refresh token expired" });
    }

    const user = await this.users.findByIdUnscoped(row.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_REFRESH_TOKEN, message: "User is no longer active" });
    }

    const permissions = await this.roles.permissionsForUser(user.id);
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
      permissions,
    };

    const { tokens, refreshTokenId } = await this.issueTokens(authenticatedUser);

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedByTokenId: refreshTokenId })
      .where(eq(refreshTokens.id, row.id));

    return { tokens, user: authenticatedUser };
  }

  async logout(presentedToken: string): Promise<void> {
    const tokenHash = this.hashToken(presentedToken);
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
  }

  /** Signs an access token AND persists a brand-new refresh token row — callers must not also call storeRefreshToken for the token returned here. */
  private async issueTokens(user: AuthenticatedUser): Promise<{ tokens: AuthTokens; refreshTokenId: string }> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
      permissions: user.permissions,
    };

    const accessTtl = this.config.get("JWT_ACCESS_TTL", { infer: true });
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      expiresIn: accessTtl,
    });

    const refreshToken = this.generateOpaqueToken();
    const row = await this.storeRefreshToken(user, refreshToken);

    return {
      tokens: { accessToken, refreshToken, expiresIn: this.ttlToSeconds(accessTtl) },
      refreshTokenId: row.id,
    };
  }

  private async storeRefreshToken(user: AuthenticatedUser, rawToken: string) {
    const [row] = await this.db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        organizationId: user.organizationId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      })
      .returning();
    return row;
  }

  private generateOpaqueToken(): string {
    return randomBytes(48).toString("hex");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const [, value, unit] = match;
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit as "s" | "m" | "h" | "d"];
    return Number(value) * multiplier;
  }

  private recordFailedLogin(email: string, organizationId?: string) {
    if (!organizationId) return; // no org context to attribute the event to
    this.events.publish({
      eventType: "user.login_failed",
      organizationId,
      payload: { email },
    });
  }
}
