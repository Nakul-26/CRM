import { Controller, Get, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../shared/decorators/public.decorator";
import { QuotesService } from "./quotes.service";
import { streamQuotePdf } from "./quote-pdf-response";

/**
 * Unauthenticated, customer-facing surface — a prospect accepting/rejecting
 * a quote via its share link, no login. The `shareToken` in the URL *is*
 * the credential (same trust model as a password-reset link), not a
 * shortcut around auth — see docs/decisions/0005-quotations-phase5-scope.md.
 */
@ApiTags("public-quotes")
@Controller("public/quotes")
export class PublicQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get(":token")
  @Public()
  view(@Param("token", ParseUUIDPipe) token: string) {
    return this.quotes.findByToken(token);
  }

  @Post(":token/accept")
  @Public()
  accept(@Param("token", ParseUUIDPipe) token: string) {
    return this.quotes.acceptByToken(token);
  }

  @Post(":token/reject")
  @Public()
  reject(@Param("token", ParseUUIDPipe) token: string) {
    return this.quotes.rejectByToken(token);
  }

  @Get(":token/pdf")
  @Public()
  async pdf(@Param("token", ParseUUIDPipe) token: string, @Res() res: Response) {
    const snapshot = await this.quotes.pdfSnapshotByToken(token);
    streamQuotePdf(res, snapshot);
  }
}
