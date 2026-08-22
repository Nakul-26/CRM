import { ConfigService } from "@nestjs/config";
import { MockPaymentProvider } from "./mock-payment.provider";

function makeConfig(webAppUrl = "http://localhost:3000") {
  return { get: () => webAppUrl } as unknown as ConfigService<never, true>;
}

describe("MockPaymentProvider", () => {
  it("returns an in-app checkout URL and a providerRef, with no network call", async () => {
    const provider = new MockPaymentProvider(makeConfig());

    const result = await provider.createCheckoutSession({
      paymentId: "11111111-1111-1111-1111-111111111111",
      amount: 49,
      currency: "usd",
      description: "Renewal — Pro",
    });

    expect(result.checkoutUrl).toBe("http://localhost:3000/pay/mock/11111111-1111-1111-1111-111111111111");
    expect(result.providerRef).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reports its kind as mock", () => {
    expect(new MockPaymentProvider(makeConfig()).kind).toBe("mock");
  });
});
