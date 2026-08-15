import { BadRequestException, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { ERROR_CODES } from "@sales-platform/contracts";

/**
 * `@UsePipes(new ZodValidationPipe(schema))` at the method level runs this
 * pipe against EVERY handler parameter, not just @Body() — including
 * @CurrentUser(). Without the metadata.type check below, it would validate
 * the authenticated user object against the body schema instead of (or as
 * well as) the actual request body, and reject on fields the user object
 * doesn't have (e.g. "roleIds: Required").
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== "body") {
      return value;
    }

    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Request validation failed",
        details: { issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      });
    }
    return result.data;
  }
}
