import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, RawBodyRequest, Req, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { startCheckoutSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../shared/decorators/current-user.decorator";
import { Public } from "../../shared/decorators/public.decorator";
import { RequirePermissions } from "../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../shared/pipes/zod-validation.pipe";
import { PaymentsService } from "./payments.service";

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("checkout")
  @RequirePermissions("subscriptions.edit")
  @UsePipes(new ZodValidationPipe(startCheckoutSchema))
  startCheckout(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { subscriptionId } = body as { subscriptionId: string };
    return this.payments.startCheckout(user.organizationId, user.id, subscriptionId);
  }

  @Get("subscriptions/:subscriptionId")
  @RequirePermissions("subscriptions.view")
  listForSubscription(@CurrentUser() user: AuthenticatedUser, @Param("subscriptionId", ParseUUIDPipe) subscriptionId: string) {
    return this.payments.listForSubscription(user.organizationId, subscriptionId);
  }

  // ---- Mock provider's stand-in for an unauthenticated hosted checkout page ----

  @Get("mock/:paymentId")
  @Public()
  getMockView(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.getMockView(paymentId);
  }

  @Post("mock/:paymentId/complete")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async completeMock(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    await this.payments.completeMock(paymentId);
  }

  @Post("mock/:paymentId/fail")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async failMock(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    await this.payments.failMock(paymentId);
  }

  // ---- Stripe webhook (only meaningful when PAYMENT_PROVIDER=stripe) ----

  @Post("webhook")
  @Public()
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    if (!req.rawBody || !signature) throw new BadRequestException("Missing Stripe signature or raw body");
    await this.payments.handleStripeWebhook(req.rawBody, signature);
    return { received: true };
  }
}
