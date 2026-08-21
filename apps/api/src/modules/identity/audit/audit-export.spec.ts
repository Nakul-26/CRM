import { BadRequestException } from "@nestjs/common";
import { AUDIT_LOG_EXPORT_MAX_ROWS, type AuditLogEntryDto } from "@sales-platform/contracts";
import { assertWithinAuditExportLimit, toAuditCsv } from "./audit-export";

function sampleEntry(overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: "entry-1",
    eventType: "account.created",
    actorId: "user-1",
    actorName: "Ada Lovelace",
    actorEmail: "ada@example.com",
    payload: { name: "Acme Corp" },
    ip: "127.0.0.1",
    userAgent: "curl/8.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("assertWithinAuditExportLimit", () => {
  it("allows a total exactly at the cap", () => {
    expect(() => assertWithinAuditExportLimit(AUDIT_LOG_EXPORT_MAX_ROWS)).not.toThrow();
  });

  it("allows a total under the cap", () => {
    expect(() => assertWithinAuditExportLimit(AUDIT_LOG_EXPORT_MAX_ROWS - 1)).not.toThrow();
  });

  it("throws BadRequestException for a total over the cap", () => {
    expect(() => assertWithinAuditExportLimit(AUDIT_LOG_EXPORT_MAX_ROWS + 1)).toThrow(BadRequestException);
  });
});

describe("toAuditCsv", () => {
  it("includes a header row and JSON-stringifies the payload inline", () => {
    const csv = toAuditCsv([sampleEntry()]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("ID,When,Event Type,Actor ID,Actor Name,Actor Email,IP,User Agent,Payload");
    expect(row).toContain("account.created");
    expect(row).toContain('"{""name"":""Acme Corp""}"');
  });

  it("renders a null payload as an empty field", () => {
    const csv = toAuditCsv([sampleEntry({ payload: null })]);
    const [, row] = csv.split("\r\n");
    expect(row?.endsWith(",")).toBe(true);
  });

  it("renders a system-triggered event (no actor) with empty actor fields", () => {
    const csv = toAuditCsv([sampleEntry({ actorId: null, actorName: null, actorEmail: null })]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe('entry-1,2026-01-01T00:00:00.000Z,account.created,,,,127.0.0.1,curl/8.0,"{""name"":""Acme Corp""}"');
  });
});
