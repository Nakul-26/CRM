import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createSlaPolicySchema, updateSlaPolicySchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { SlaPoliciesService } from "./sla-policies.service";

@ApiTags("sla-policies")
@Controller("sla-policies")
export class SlaPoliciesController {
  constructor(private readonly slaPolicies: SlaPoliciesService) {}

  @Get()
  @RequirePermissions("support.sla_policies.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.slaPolicies.list(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions("support.sla_policies.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.slaPolicies.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("support.sla_policies.manage")
  @UsePipes(new ZodValidationPipe(createSlaPolicySchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.slaPolicies.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("support.sla_policies.manage")
  @UsePipes(new ZodValidationPipe(updateSlaPolicySchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.slaPolicies.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("support.sla_policies.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.slaPolicies.delete(user.organizationId, user.id, id);
  }
}
