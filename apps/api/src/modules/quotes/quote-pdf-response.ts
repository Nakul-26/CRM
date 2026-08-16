import type { Response } from "express";
import { buildQuotePdf, type QuotePdfData } from "./quote-pdf";

interface QuotePdfSnapshot {
  quote: {
    quoteNumber: string;
    status: string;
    currency: string;
    createdAt: string;
    validUntil: string | null;
    notes: string | null;
  };
  version: {
    lineItems: Array<{
      name: string;
      description: string | null;
      quantity: number;
      unitPrice: number;
      discountPercent: number;
      taxPercent: number;
      lineTotal: number;
    }>;
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    total: number;
  };
  organizationName: string;
  account?: { name: string };
  contact?: { firstName: string; lastName: string; email: string | null };
}

function toQuotePdfData(snapshot: QuotePdfSnapshot): QuotePdfData {
  return {
    quoteNumber: snapshot.quote.quoteNumber,
    status: snapshot.quote.status,
    currency: snapshot.quote.currency,
    createdAt: snapshot.quote.createdAt,
    validUntil: snapshot.quote.validUntil,
    organizationName: snapshot.organizationName,
    accountName: snapshot.account?.name ?? "",
    contactName: snapshot.contact ? `${snapshot.contact.firstName} ${snapshot.contact.lastName}` : undefined,
    contactEmail: snapshot.contact?.email ?? undefined,
    notes: snapshot.quote.notes,
    lineItems: snapshot.version.lineItems,
    subtotal: snapshot.version.subtotal,
    discountTotal: snapshot.version.discountTotal,
    taxTotal: snapshot.version.taxTotal,
    total: snapshot.version.total,
  };
}

/** Builds the PDF and pipes it directly to an Express response, ending the response. */
export function streamQuotePdf(res: Response, snapshot: QuotePdfSnapshot): void {
  const doc = buildQuotePdf(toQuotePdfData(snapshot));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${snapshot.quote.quoteNumber}.pdf"`);
  doc.pipe(res);
  doc.end();
}
