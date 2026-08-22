import { DunningActionsService } from "./dunning-actions.service";
import type { PaymentsService } from "../payments.service";
import type { SubscriptionsService } from "../../subscriptions/subscriptions/subscriptions.service";

describe("DunningActionsService", () => {
  it("attemptCharge delegates to PaymentsService.startCheckout and returns the new paymentId", async () => {
    const payments = { startCheckout: jest.fn().mockResolvedValue({ paymentId: "pay_2", checkoutUrl: "https://x" }) } as unknown as PaymentsService;
    const subscriptions = { cancel: jest.fn() } as unknown as SubscriptionsService;
    const service = new DunningActionsService(payments, subscriptions);

    const result = await service.attemptCharge("org_1", "user_1", "sub_1");

    expect(payments.startCheckout).toHaveBeenCalledWith("org_1", "user_1", "sub_1");
    expect(result).toEqual({ paymentId: "pay_2" });
  });

  it("cancelSubscription delegates to SubscriptionsService.cancel", async () => {
    const payments = { startCheckout: jest.fn() } as unknown as PaymentsService;
    const subscriptions = { cancel: jest.fn().mockResolvedValue(undefined) } as unknown as SubscriptionsService;
    const service = new DunningActionsService(payments, subscriptions);

    await service.cancelSubscription("org_1", "user_1", "sub_1");

    expect(subscriptions.cancel).toHaveBeenCalledWith("org_1", "user_1", "sub_1");
  });
});
