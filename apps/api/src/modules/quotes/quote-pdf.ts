import PDFDocument from "pdfkit";

export interface QuotePdfLineItem {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  lineTotal: number;
}

export interface QuotePdfData {
  quoteNumber: string;
  status: string;
  currency: string;
  createdAt: string;
  validUntil: string | null;
  organizationName: string;
  accountName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  lineItems: QuotePdfLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

const COLS = { name: 50, qty: 300, price: 350, disc: 410, total: 470 };

/**
 * Pure(ish) builder: takes a plain data snapshot, returns a streamable
 * PDFKit document — no DB/service access, so it's directly unit-testable,
 * same "pure function pulled out of the service" precedent as
 * evaluate-lead-score.ts. Caller is responsible for piping the result to a
 * response (or a buffer) and calling `.end()`.
 */
export function buildQuotePdf(data: QuotePdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  doc.fontSize(20).fillColor("#111").text(data.organizationName || "Quote");
  doc.fontSize(10).fillColor("#666").text(`Quote ${data.quoteNumber}`);
  doc.moveDown();

  doc.fillColor("#000").fontSize(11);
  doc.text(`Status: ${data.status.toUpperCase()}`);
  doc.text(`Date: ${new Date(data.createdAt).toLocaleDateString()}`);
  if (data.validUntil) doc.text(`Valid until: ${new Date(data.validUntil).toLocaleDateString()}`);
  doc.moveDown();

  doc.fontSize(12).text("Bill To:", { underline: true });
  doc.fontSize(11).text(data.accountName);
  if (data.contactName) doc.text(data.contactName);
  if (data.contactEmail) doc.text(data.contactEmail);
  doc.moveDown();

  const tableTop = doc.y;
  doc.fontSize(10).fillColor("#111");
  doc.text("Item", COLS.name, tableTop, { width: 240 });
  doc.text("Qty", COLS.qty, tableTop, { width: 40, align: "right" });
  doc.text("Unit Price", COLS.price, tableTop, { width: 50, align: "right" });
  doc.text("Disc %", COLS.disc, tableTop, { width: 50, align: "right" });
  doc.text("Line Total", COLS.total, tableTop, { width: 80, align: "right" });

  let y = doc.y + 5;
  doc.moveTo(50, y).lineTo(550, y).strokeColor("#ccc").stroke();
  y += 8;

  doc.fillColor("#000");
  for (const item of data.lineItems) {
    doc.fontSize(10).text(item.name, COLS.name, y, { width: 240 });
    doc.text(String(item.quantity), COLS.qty, y, { width: 40, align: "right" });
    doc.text(money(item.unitPrice, data.currency), COLS.price, y, { width: 50, align: "right" });
    doc.text(`${item.discountPercent}%`, COLS.disc, y, { width: 50, align: "right" });
    doc.text(money(item.lineTotal, data.currency), COLS.total, y, { width: 80, align: "right" });
    y = doc.y + 8;
  }

  doc.moveTo(50, y).lineTo(550, y).strokeColor("#ccc").stroke();
  y += 10;

  doc.fontSize(11);
  doc.text(`Subtotal: ${money(data.subtotal, data.currency)}`, COLS.disc - 60, y, { width: 200, align: "right" });
  y = doc.y + 2;
  doc.text(`Discount: -${money(data.discountTotal, data.currency)}`, COLS.disc - 60, y, { width: 200, align: "right" });
  y = doc.y + 2;
  doc.text(`Tax: ${money(data.taxTotal, data.currency)}`, COLS.disc - 60, y, { width: 200, align: "right" });
  y = doc.y + 4;
  doc.fontSize(13).text(`Total: ${money(data.total, data.currency)}`, COLS.disc - 60, y, { width: 200, align: "right" });

  if (data.notes) {
    doc.moveDown(3);
    doc.fontSize(11).fillColor("#111").text("Notes:", { underline: true });
    doc.fontSize(10).fillColor("#333").text(data.notes);
  }

  return doc;
}
