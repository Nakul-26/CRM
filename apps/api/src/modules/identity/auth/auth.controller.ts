import { Body, Controller, Get, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  loginSchema,
  oidcTokenSchema,
  refreshTokenSchema,
  registerOrganizationSchema,
  type AuthResponse,
  type AuthenticatedUser,
  type OidcTokenInput,
} from "@sales-platform/contracts";
import { Public } from "../../../shared/decorators/public.decorator";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { OidcService } from "./oidc.service";
import { RolesService } from "../roles/roles.service";
import { UsersService } from "../users/users.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
  ) {}

  @Public()
  @Post("register")
  @UsePipes(new ZodValidationPipe(registerOrganizationSchema))
  register(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.register(body as never);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.login(body as never);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  refresh(@Body() body: { refreshToken: string }): Promise<AuthResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  async logout(@Body() body: { refreshToken: string }): Promise<void> {
    // Possession of the (single-use, hashed-at-rest) refresh token is the
    // proof of session ownership here — same trust model as /auth/refresh.
    // Requiring a *also-valid* access token would mean an idle/expired
    // session could never revoke its refresh token, defeating the point.
    await this.auth.logout(body.refreshToken);
  }

  /**
   * The BFF-side code exchange for the "Sign in with SSO" flow — apps/web's
   * /api/auth/oidc/callback route calls this with the authorization code it
   * received from Keycloak. Rejects with the same INVALID_CREDENTIALS shape
   * as a bad password if OIDC is disabled, the code is invalid, or no local
   * user matches the token's verified email — see
   * docs/decisions/0017-keycloak-oidc-phase17-scope.md.
   */
  @Public()
  @Post("oidc/token")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(oidcTokenSchema))
  async oidcToken(@Body() body: OidcTokenInput): Promise<AuthResponse> {
    const idToken = await this.oidc.exchangeCodeForIdToken(body.code, body.redirectUri);
    const claims = await this.oidc.verifyIdToken(idToken);
    return this.auth.loginWithOidc(claims, body.organizationSlug);
  }

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUser> {
    // Re-fetch permissions rather than trusting the token's snapshot, so a
    // just-revoked role takes effect without waiting for token expiry.
    const permissions = await this.roles.permissionsForUser(user.id);
    return { ...user, permissions };
  }
}
