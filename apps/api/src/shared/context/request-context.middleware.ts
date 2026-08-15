import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { RequestContextService } from "./request-context";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    const correlationId = (req.headers["x-correlation-id"] as string | undefined) || randomUUID();

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-correlation-id", correlationId);

    this.context.run(
      {
        requestId,
        correlationId,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
      () => next(),
    );
  }
}
