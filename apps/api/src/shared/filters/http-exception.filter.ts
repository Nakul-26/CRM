import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ERROR_CODES, type ApiErrorBody } from "@sales-platform/contracts";
import { RequestContextService } from "../context/request-context";

const STATUS_TO_CODE: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
};

/** Normalizes every error response to the Section 34 shape. Never leaks stack traces. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly context: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = this.context.getOrNull()?.requestId ?? "unknown";

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code: string = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;
    let message = "An unexpected error occurred";
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const b = body as Record<string, unknown>;
        message = typeof b.message === "string" ? b.message : Array.isArray(b.message) ? b.message.join("; ") : message;
        if (typeof b.code === "string") code = b.code;
        if (b.details && typeof b.details === "object") details = b.details as Record<string, unknown>;
      }
    } else {
      this.logger.error("Unhandled exception", exception as Error);
    }

    const errorBody: ApiErrorBody = {
      success: false,
      error: { code, message, details },
      requestId,
    };

    response.status(status).json(errorBody);
  }
}
