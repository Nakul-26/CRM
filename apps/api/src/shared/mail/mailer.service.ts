import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";
import type { ApiEnv } from "@sales-platform/config";

export interface SendMailInput {
  to: string | null | undefined;
  subject: string;
  html: string;
  text: string;
}

/**
 * Thin wrapper around nodemailer, pointed at Mailpit in dev (no auth/TLS —
 * see docs/decisions/0006-support-phase6-scope.md). Real SMTP-provider auth
 * is a future need, not a current one.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.transporter = nodemailer.createTransport({
      host: config.get("SMTP_HOST", { infer: true }),
      port: config.get("SMTP_PORT", { infer: true }),
      secure: false,
    });
    this.from = config.get("SMTP_FROM", { infer: true });
  }

  async send(input: SendMailInput): Promise<void> {
    if (!input.to) {
      this.logger.debug(`Skipping email "${input.subject}" — no recipient address`);
      return;
    }

    await this.transporter.sendMail({ from: this.from, to: input.to, subject: input.subject, html: input.html, text: input.text });
  }
}
