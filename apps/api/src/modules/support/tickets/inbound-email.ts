const REPLY_TOKEN_PATTERN = /ticket\+([a-zA-Z0-9-]+)@/;
const MAX_BODY_LENGTH = 10000;
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Pulls the ticket's replyToken out of an inbound webhook's `to` address
 * (`ticket+<token>@domain`, whether bare or in a `"Name <addr>"` form).
 * Returns null when nothing matches — the caller acks the webhook anyway
 * (see docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md).
 */
export function extractReplyToken(to: string): string | null {
  const match = REPLY_TOKEN_PATTERN.exec(to);
  return match ? match[1] : null;
}

function stripHtml(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  const withEntitiesDecoded = withoutTags.replace(/&[a-z]+;|&#\d+;/gi, (entity) => HTML_ENTITIES[entity] ?? entity);
  return withEntitiesDecoded.replace(/\s+/g, " ").trim();
}

/**
 * Prefers plain `text`; falls back to a crude tag-strip of `html` (good
 * enough for this scope, not a real sanitizer — the result is stored as
 * plain text like every other ticket comment body). Truncates to the same
 * max as createTicketCommentSchema. Returns null when there's nothing
 * usable left.
 */
export function extractCommentBody(payload: { text?: string; html?: string }): string | null {
  const raw = payload.text?.trim() || (payload.html ? stripHtml(payload.html) : "");
  if (!raw) return null;
  return raw.length > MAX_BODY_LENGTH ? raw.slice(0, MAX_BODY_LENGTH) : raw;
}
