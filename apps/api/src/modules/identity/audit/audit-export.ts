import { BadRequestException } from "@nestjs/common";
import { AUDIT_LOG_EXPORT_MAX_ROWS, type AuditLogEntryDto } from "@sales-platform/contracts";
import { toCsv, type CsvColumn } from "../../../shared/csv/to-csv";

interface AuditCsvRow extends Omit<AuditLogEntryDto, "payload"> {
  payload: string;
}

const AUDIT_CSV_COLUMNS: CsvColumn<AuditCsvRow>[] = [
  { key: "id", label: "ID" },
  { key: "createdAt", label: "When" },
  { key: "eventType", label: "Event Type" },
  { key: "actorId", label: "Actor ID" },
  { key: "actorName", label: "Actor Name" },
  { key: "actorEmail", label: "Actor Email" },
  { key: "ip", label: "IP" },
  { key: "userAgent", label: "User Agent" },
  { key: "payload", label: "Payload" },
];

export function assertWithinAuditExportLimit(total: number): void {
  if (total > AUDIT_LOG_EXPORT_MAX_ROWS) {
    throw new BadRequestException(
      `${total} rows match these filters, which exceeds the ${AUDIT_LOG_EXPORT_MAX_ROWS}-row export limit. Narrow the date range, event type, or actor filter and try again.`,
    );
  }
}

export function toAuditCsv(items: AuditLogEntryDto[]): string {
  const rows: AuditCsvRow[] = items.map((item) => ({
    ...item,
    payload: item.payload ? JSON.stringify(item.payload) : "",
  }));
  return toCsv(rows, AUDIT_CSV_COLUMNS);
}
