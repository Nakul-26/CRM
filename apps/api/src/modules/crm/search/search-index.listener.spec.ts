import { ConfigService } from "@nestjs/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { SearchIndexListener } from "./search-index.listener";
import type { OpenSearchSearchProvider } from "./providers/opensearch-search.provider";

function makeConfig(provider: "postgres" | "opensearch") {
  return { get: () => provider } as unknown as ConfigService<never, true>;
}

function makeDb(row: Record<string, unknown> | undefined) {
  const limit = jest.fn().mockResolvedValue(row ? [row] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select } as never;
}

function makeEvent(eventType: string, payload: Record<string, unknown>): DomainEvent {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    eventType,
    timestamp: "2026-08-22T00:00:00.000Z",
    organizationId: "org_1",
    correlationId: "22222222-2222-2222-2222-222222222222",
    payload,
  };
}

function makeOpenSearch() {
  return { indexDocument: jest.fn().mockResolvedValue(undefined), deleteDocument: jest.fn().mockResolvedValue(undefined) } as unknown as OpenSearchSearchProvider;
}

describe("SearchIndexListener", () => {
  it("no-ops entirely when SEARCH_PROVIDER is postgres (default)", async () => {
    const db = makeDb({ id: "acc_1", name: "Acme" });
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("postgres"), opensearch);

    await listener.handle(makeEvent("account.created", { accountId: "acc_1", name: "Acme" }));

    expect(opensearch.indexDocument).not.toHaveBeenCalled();
    expect(opensearch.deleteDocument).not.toHaveBeenCalled();
  });

  it("indexes the freshly-read row on account.created/updated", async () => {
    const db = makeDb({ id: "acc_1", name: "Acme Renamed" });
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("account.updated", { accountId: "acc_1", changes: { name: "Acme Renamed" } }));

    expect(opensearch.indexDocument).toHaveBeenCalledWith({
      type: "account",
      entityId: "acc_1",
      organizationId: "org_1",
      label: "Acme Renamed",
    });
  });

  it("deletes on account.deleted without reading the row", async () => {
    const db = makeDb(undefined);
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("account.deleted", { accountId: "acc_1" }));

    expect(opensearch.deleteDocument).toHaveBeenCalledWith("account", "acc_1");
    expect(opensearch.indexDocument).not.toHaveBeenCalled();
  });

  it("indexes contacts with the combined name as label and email as subLabel", async () => {
    const db = makeDb({ id: "con_1", firstName: "Jane", lastName: "Doe", email: "jane@acme.com" });
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("contact.created", { contactId: "con_1", accountId: "acc_1", fullName: "Jane Doe" }));

    expect(opensearch.indexDocument).toHaveBeenCalledWith({
      type: "contact",
      entityId: "con_1",
      organizationId: "org_1",
      label: "Jane Doe",
      subLabel: "jane@acme.com",
    });
  });

  it("indexes leads with company as subLabel", async () => {
    const db = makeDb({ id: "lead_1", name: "Big Deal", company: "Big Co" });
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("lead.updated", { leadId: "lead_1", changes: {} }));

    expect(opensearch.indexDocument).toHaveBeenCalledWith({
      type: "lead",
      entityId: "lead_1",
      organizationId: "org_1",
      label: "Big Deal",
      subLabel: "Big Co",
    });
  });

  it("skips indexing if the row is gone (e.g. deleted between publish and handling)", async () => {
    const db = makeDb(undefined);
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("account.updated", { accountId: "acc_gone", changes: {} }));

    expect(opensearch.indexDocument).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types", async () => {
    const db = makeDb(undefined);
    const opensearch = makeOpenSearch();
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await listener.handle(makeEvent("payment.succeeded", { paymentId: "pay_1" }));

    expect(opensearch.indexDocument).not.toHaveBeenCalled();
    expect(opensearch.deleteDocument).not.toHaveBeenCalled();
  });

  it("swallows errors from the OpenSearch provider (never breaks the triggering write)", async () => {
    const db = makeDb({ id: "acc_1", name: "Acme" });
    const opensearch = makeOpenSearch();
    (opensearch.indexDocument as jest.Mock).mockRejectedValue(new Error("cluster unavailable"));
    const listener = new SearchIndexListener(db, makeConfig("opensearch"), opensearch);

    await expect(listener.handle(makeEvent("account.created", { accountId: "acc_1", name: "Acme" }))).resolves.toBeUndefined();
  });
});
