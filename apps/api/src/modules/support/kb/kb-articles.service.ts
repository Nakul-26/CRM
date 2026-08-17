import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ERROR_CODES, type CreateKbArticleInput, type UpdateKbArticleInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { kbArticles } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

type KbArticleRow = typeof kbArticles.$inferSelect;

function serialize(row: KbArticleRow) {
  return {
    ...row,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class KbArticlesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string, filters?: { isPublished?: boolean; category?: string }) {
    const conditions = [eq(kbArticles.organizationId, organizationId), isNull(kbArticles.deletedAt)];
    if (filters?.isPublished !== undefined) conditions.push(eq(kbArticles.isPublished, filters.isPublished));
    if (filters?.category) conditions.push(eq(kbArticles.category, filters.category));

    const rows = await this.db
      .select()
      .from(kbArticles)
      .where(and(...conditions))
      .orderBy(asc(kbArticles.title));
    return rows.map(serialize);
  }

  async findById(organizationId: string, articleId: string) {
    const [article] = await this.db
      .select()
      .from(kbArticles)
      .where(and(eq(kbArticles.organizationId, organizationId), eq(kbArticles.id, articleId), isNull(kbArticles.deletedAt)))
      .limit(1);
    if (!article) throw new NotFoundException(`KB article ${articleId} not found`);
    return serialize(article);
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const [existing] = await this.db.select({ id: kbArticles.id }).from(kbArticles).where(eq(kbArticles.slug, slug)).limit(1);
    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: `The slug "${slug}" is already in use` });
    }
  }

  async create(organizationId: string, actorId: string, input: CreateKbArticleInput) {
    await this.assertSlugAvailable(input.slug);

    const [article] = await this.db
      .insert(kbArticles)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "kb_article.created",
      organizationId,
      actorId,
      payload: { kbArticleId: article.id, slug: article.slug },
    });
    return serialize(article);
  }

  async update(organizationId: string, actorId: string, articleId: string, input: UpdateKbArticleInput) {
    await this.findById(organizationId, articleId);
    if (input.slug) await this.assertSlugAvailable(input.slug, articleId);

    const [article] = await this.db
      .update(kbArticles)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(kbArticles.organizationId, organizationId), eq(kbArticles.id, articleId)))
      .returning();

    this.events.publish({
      eventType: "kb_article.updated",
      organizationId,
      actorId,
      payload: { kbArticleId: articleId, changes: input },
    });
    return serialize(article);
  }

  async delete(organizationId: string, actorId: string, articleId: string) {
    await this.findById(organizationId, articleId);

    await this.db
      .update(kbArticles)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(kbArticles.organizationId, organizationId), eq(kbArticles.id, articleId)));

    this.events.publish({
      eventType: "kb_article.deleted",
      organizationId,
      actorId,
      payload: { kbArticleId: articleId },
    });
  }

  async setPublished(organizationId: string, actorId: string, articleId: string, isPublished: boolean) {
    await this.findById(organizationId, articleId);

    const [article] = await this.db
      .update(kbArticles)
      .set({ isPublished, publishedAt: isPublished ? new Date() : null, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(kbArticles.organizationId, organizationId), eq(kbArticles.id, articleId)))
      .returning();

    this.events.publish({
      eventType: "kb_article.published",
      organizationId,
      actorId,
      payload: { kbArticleId: articleId, isPublished },
    });
    return serialize(article);
  }
}
