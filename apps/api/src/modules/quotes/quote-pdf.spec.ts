import { buildQuotePdf, type QuotePdfData } from "./quote-pdf";

function sampleData(overrides: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    quoteNumber: "Q-00001",
    status: "sent",
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-02-01T00:00:00.000Z",
    organizationName: "Acme Corp",
    accountName: "Wonka Industries",
    contactName: "Willy Wonka",
    contactEmail: "willy@wonka.example",
    notes: "Thanks for your business",
    lineItems: [
      { name: "Golden Ticket", quantity: 5, unitPrice: 20, discountPercent: 10, taxPercent: 5, lineTotal: 94.5 },
    ],
    subtotal: 100,
    discountTotal: 10,
    taxTotal: 4.5,
    total: 94.5,
    ...overrides,
  };
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

describe("buildQuotePdf", () => {
  it("produces a well-formed PDF buffer starting with the PDF magic header", async () => {
    const buffer = await toBuffer(buildQuotePdf(sampleData()));
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("handles a quote with no notes and no contact without throwing", async () => {
    const buffer = await toBuffer(buildQuotePdf(sampleData({ notes: undefined, contactName: undefined, contactEmail: undefined, validUntil: null })));
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("handles multiple line items without throwing", async () => {
    const buffer = await toBuffer(
      buildQuotePdf(
        sampleData({
          lineItems: [
            { name: "Item A", quantity: 1, unitPrice: 10, discountPercent: 0, taxPercent: 0, lineTotal: 10 },
            { name: "Item B", quantity: 2, unitPrice: 15, discountPercent: 5, taxPercent: 8, lineTotal: 30.78 },
          ],
        }),
      ),
    );
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
