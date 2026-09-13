import { Injectable, Logger } from "@nestjs/common";
import type { InboundEmailWebhookInput } from "@sales-platform/contracts";
import { extractCommentBody, extractReplyToken } from "./inbound-email";
import { TicketsService } from "./tickets.service";

/**
 * Thin orchestration between the webhook payload and TicketsService — log
 * and move on for anything unprocessable, never throw, so the webhook
 * always acks 200 and a provider never retries a permanently-unmatchable
 * delivery. See docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(private readonly tickets: TicketsService) {}

  async handle(input: InboundEmailWebhookInput): Promise<void> {
    const replyToken = extractReplyToken(input.to);
    if (!replyToken) {
      this.logger.warn(`Inbound email discarded — no reply token found in "to": ${input.to}`);
      return;
    }

    const body = extractCommentBody(input);
    if (!body) {
      this.logger.warn(`Inbound email discarded — no usable body (token ${replyToken})`);
      return;
    }

    const result = await this.tickets.addInboundEmailComment(replyToken, { body, externalMessageId: input.messageId });
    if (result === null) {
      this.logger.warn(`Inbound email discarded — no ticket found for reply token ${replyToken}`);
    } else if (result === "duplicate") {
      this.logger.debug(`Inbound email skipped — messageId ${input.messageId} already recorded`);
    }
  }
}
