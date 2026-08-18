import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../shared/decorators/require-permissions.decorator";
import { AnalyticsService } from "./analytics.service";

@ApiTags("analytics")
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("dashboard")
  @RequirePermissions("analytics.view")
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.dashboard(user.organizationId);
  }
}
