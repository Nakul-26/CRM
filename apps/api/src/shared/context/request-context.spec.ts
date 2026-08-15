import { RequestContextService } from "./request-context";

describe("RequestContextService (tenant isolation)", () => {
  it("throws instead of returning stale/default context when called outside a request", () => {
    const service = new RequestContextService();
    expect(() => service.get()).toThrow();
    expect(service.getOrNull()).toBeUndefined();
  });

  it("never leaks one organization's context into a concurrently-running request for another", async () => {
    const service = new RequestContextService();

    const runAsOrg = (organizationId: string, delayMs: number) =>
      service.run({ requestId: `req-${organizationId}`, correlationId: `corr-${organizationId}` }, async () => {
        service.setAuth({ organizationId, userId: `user-${organizationId}`, permissions: [] });
        // Simulate async work (DB round-trip) interleaving with the other "request".
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // If AsyncLocalStorage leaked, this would now read the other request's org.
        return service.requireOrganizationId();
      });

    const [orgAResult, orgBResult] = await Promise.all([runAsOrg("org-a", 15), runAsOrg("org-b", 5)]);

    expect(orgAResult).toBe("org-a");
    expect(orgBResult).toBe("org-b");
  });

  it("requireOrganizationId/requireUserId fail closed when auth was never set on the request", () => {
    const service = new RequestContextService();
    service.run({ requestId: "req-1", correlationId: "corr-1" }, () => {
      expect(() => service.requireOrganizationId()).toThrow();
      expect(() => service.requireUserId()).toThrow();
    });
  });
});
