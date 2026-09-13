import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UnauthorizedException, UsePipes } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { inboundEmailWebhookSchema, type InboundEmailWebhookInput } from "@sales-platform/contracts";
import type { ApiEnv } from "@sales-platform/config";
import { Public } from "../../../shared/decorators/public.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { InboundEmailService } from "./inbound-email.service";

/**
 * A real inbound-email-parsing provider (e.g. a Postmark/Mailgun inbound
 * route) would forward a parsed customer reply here. Unauthenticated by
 * necessity (no logged-in user context exists for a webhook call), so it's
 * gated on its own shared secret instead — see
 * docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md.
 */
@ApiTags("support")
@Controller("support/inbound-email")
export class InboundEmailController {
  constructor(
    private readonly inboundEmail: InboundEmailService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(inboundEmailWebhookSchema))
  async receive(@Headers("x-inbound-email-secret") secret: string | undefined, @Body() body: InboundEmailWebhookInput) {
    const expected = this.config.get("INBOUND_EMAIL_WEBHOOK_SECRET", { infer: true });
    if (!expected || secret !== expected) {
      throw new UnauthorizedException("Missing or invalid inbound-email webhook secret");
    }

    await this.inboundEmail.handle(body);
    return { received: true };
  }
}
