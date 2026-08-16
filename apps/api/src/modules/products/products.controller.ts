import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createPriceTierSchema,
  createProductSchema,
  updatePriceTierSchema,
  updateProductSchema,
  type AuthenticatedUser,
} from "@sales-platform/contracts";
import { CurrentUser } from "../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../shared/pipes/zod-validation.pipe";
import { ProductsService } from "./products.service";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions("products.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query("category") category?: string, @Query("isActive") isActive?: string) {
    return this.products.list(user.organizationId, {
      category,
      isActive: isActive === undefined ? undefined : isActive === "true",
    });
  }

  @Get(":id")
  @RequirePermissions("products.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.findById(user.organizationId, id);
  }

  @Get(":id/price-tiers")
  @RequirePermissions("products.view")
  priceTiers(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.priceTiersFor(user.organizationId, id);
  }

  /** Suggested unit price for a quantity (best-matching volume tier, or the base price). Not enforced server-side on quotes — a rep can still override. */
  @Get(":id/price")
  @RequirePermissions("products.view")
  async priceFor(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Query("quantity") quantity = "1") {
    const unitPrice = await this.products.priceFor(user.organizationId, id, Number(quantity) || 1);
    return { unitPrice };
  }

  @Post()
  @RequirePermissions("products.create")
  @UsePipes(new ZodValidationPipe(createProductSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.products.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("products.edit")
  @UsePipes(new ZodValidationPipe(updateProductSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.products.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("products.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.products.delete(user.organizationId, user.id, id);
  }

  @Post(":id/price-tiers")
  @RequirePermissions("products.pricing.manage")
  @UsePipes(new ZodValidationPipe(createPriceTierSchema))
  createPriceTier(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.products.createPriceTier(user.organizationId, user.id, id, body as never);
  }

  @Patch(":id/price-tiers/:tierId")
  @RequirePermissions("products.pricing.manage")
  @UsePipes(new ZodValidationPipe(updatePriceTierSchema))
  updatePriceTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("tierId", ParseUUIDPipe) tierId: string,
    @Body() body: unknown,
  ) {
    return this.products.updatePriceTier(user.organizationId, user.id, id, tierId, body as never);
  }

  @Delete(":id/price-tiers/:tierId")
  @RequirePermissions("products.pricing.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePriceTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("tierId", ParseUUIDPipe) tierId: string,
  ) {
    await this.products.deletePriceTier(user.organizationId, user.id, id, tierId);
  }
}
