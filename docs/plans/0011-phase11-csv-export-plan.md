# Phase 11 — Audit Log CSV Export

## Context

The user asked to work through the items the README's "why not" section and
ADR 0010 deliberately deferred: payment processing, CSV export, real-time
streaming, RabbitMQ/Keycloak/Temporal/OpenSearch, and a microservices split.
These are wildly different in size — CSV export is hours of work; the
infra items each reverse a standing ADR decision and deserve their own
dedicated plan. The user picked CSV export to start with (`AskUserQuestion`).
Concretely, this is the "CSV/export" item ADR 0010 point 7 explicitly
deferred for the audit log ("none of these have any evidence of being needed
yet" — now there's a request). Scope is exactly that: exporting the audit
log to CSV, using the exact filters the existing `GET /audit-log` endpoint
already supports. No other list in the app gets export in this phase.

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **New `GET /audit-log/export` endpoint** on the existing `AuditController` (`apps/api/src/modules/identity/audit/audit.controller.ts`), reusing `AuditService.list()` as-is. No new service method. | Same filters (`eventType`, `actorId`, `dateFrom`, `dateTo`) as the list endpoint, just a different response format — no new query logic needed. |
| **Row cap of 10,000**, exported as `AUDIT_LOG_EXPORT_MAX_ROWS` from `packages/contracts/src/audit.ts` (shared by backend and frontend). If the filtered `total` exceeds it, the endpoint returns `400` with a message to narrow filters; frontend disables the Export button first so this is a fallback, not the normal path. | `audit_log` grows forever (ADR 0010's own reasoning for why it's the one paginated table) — an unbounded CSV export is the same problem the list endpoint's pagination already solved for reads. A hard cap keeps the response in-memory-buildable (no streaming writer needed) while staying honest about the unbounded-growth reality other lists don't have. |
| **Boundary/CSV-shaping logic pulled into a pure, unit-tested file** — `apps/api/src/modules/identity/audit/audit-export.ts` (`assertWithinAuditExportLimit(total)`, `toAuditCsv(items)`), tested in `audit-export.spec.ts` without touching the DB. | Mirrors the precedent in `apps/api/src/modules/quotes/quote-pdf.ts` — "a pure builder pulled out of the service, unit-tested standalone." Also pragmatic: generating 10,001 real audit rows through HTTP calls in an e2e test to exercise the cap boundary would be slow and not worth it; a plain Jest test with `total = 10_000` vs `10_001` covers it directly. |
| **New shared CSV encoder** — `apps/api/src/shared/csv/to-csv.ts` (`toCsv(rows, columns)`), RFC-4046-style quoting (wrap fields containing `,`/`"`/newline, double internal quotes), unit-tested in `to-csv.spec.ts` for the escaping edge cases. No new dependency (no `csv`/`fast-csv` package currently installed, and the encoding needed here is a handful of lines). | Matches the app's existing bias toward small hand-rolled utilities over new dependencies for simple, well-understood formats (same call `quote-pdf.ts` made with `pdfkit` only because PDF generation genuinely isn't a few lines). Generic `rows`/`columns` signature is the natural shape of a CSV encoder, not speculative generality — it's driven by the one real caller. |
| **Response via `@Res() res: Response`**, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="audit-log-<timestamp>.csv"`, matching `quotes.controller.ts`'s `pdf()`/`versionPdf()` pattern exactly (same `@Res()` style, same header-setting approach) rather than `StreamableFile`. | Establishes no new file-response pattern — reuses the one this app already has. `attachment` (not `inline`, which the PDF endpoints use) so the browser downloads rather than opens the CSV. |
| **No new permission.** Reuses `audit.log.view`, same as the list endpoint. | Matches the established precedent that every existing file/PDF download endpoint reuses its resource's `.view` permission rather than inventing an export-specific one (confirmed: no `export`-named permission exists anywhere in `packages/contracts/src/permissions.ts`). |
| **Frontend: plain `<a href>` download link**, not fetch+blob. | Matches the Quote PDF download exactly (`apps/web/src/app/(dashboard)/quotes/[id]/page.tsx`'s `<a href="/api/gateway/quotes/.../pdf">`) — the browser handles `Content-Disposition: attachment` natively; no blob-handling JS exists anywhere in the app today and this doesn't need to introduce it. The BFF gateway (`apps/web/src/app/api/gateway/[...path]/route.ts`) branches on response `content-type`, routing anything starting with `application/json` or `text/` through `.text()` and everything else through `.arrayBuffer()` (added for binary PDF bytes). `text/csv` matches the `text/` branch, so it passes through as lossless UTF-8 text with no gateway changes needed — verified by reading the route handler. |
| **Export button disabled when `total > AUDIT_LOG_EXPORT_MAX_ROWS`**, using the `total` already returned by the existing paginated list call (`useAuditLog`) that drives the page's pager — no extra request needed to know whether export is possible. | Free correctness: the page already fetches `total` for the Prev/Next pager; reusing it to gate the Export button avoids a wasted round trip and avoids ever hitting the 400 case in normal use. |
| **Not built:** export of any other list (tickets, accounts, etc.), streaming/chunked CSV generation, background/async export jobs, export history. | This phase is scoped to exactly what ADR 0010 deferred for the audit log. Extending export elsewhere is new, unevidenced scope — left for a future phase if requested. |

---

## 1. Contracts

`packages/contracts/src/audit.ts` — add:
```ts
export const AUDIT_LOG_EXPORT_MAX_ROWS = 10_000;
```
(alongside the existing `AuditLogEntryDto`/`AuditLogPageDto`). Already
barrel-exported via `packages/contracts/src/index.ts`'s `export * from "./audit"`.
Rebuild via `pnpm --filter @sales-platform/contracts build` (apps/api and
apps/web both consume `dist/`, not `src/`).

---

## 2. Backend

`apps/api/src/shared/csv/to-csv.ts` (new):
- `interface CsvColumn<T> { key: keyof T; label: string }`
- `toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string` — header row from
  `label`s, one line per row via `key` lookups, values passed through a
  private `escapeCsvField` (wrap in quotes + double internal quotes if the
  stringified value contains `,`, `"`, or a newline; `null`/`undefined` →
  `""`), lines joined with `\r\n` (RFC 4180).

`apps/api/src/shared/csv/to-csv.spec.ts` (new) — unit tests: plain fields,
a field containing a comma, a field containing a double-quote, a field
containing an embedded newline, `null`/`undefined` values, empty `rows`
array (header only).

`apps/api/src/modules/identity/audit/audit-export.ts` (new):
- `AUDIT_CSV_COLUMNS` — `id`, `createdAt`, `eventType`, `actorId`,
  `actorName`, `actorEmail`, `ip`, `userAgent`, `payload` (JSON-stringified
  inline via `JSON.stringify` since `payload` is an object).
- `assertWithinAuditExportLimit(total: number): void` — throws
  `BadRequestException` with a message naming the actual total and the cap,
  and suggesting narrowing filters, when `total > AUDIT_LOG_EXPORT_MAX_ROWS`.
- `toAuditCsv(items: AuditLogEntryDto[]): string` — maps `payload` to its
  JSON string, delegates to `toCsv`.

`apps/api/src/modules/identity/audit/audit-export.spec.ts` (new) — unit
tests: `assertWithinAuditExportLimit` at/under/over the cap boundary;
`toAuditCsv` produces the expected header + row shape for a couple of
sample `AuditLogEntryDto`s, including one with `payload: null` and one with
`actorName: null` (system event).

`apps/api/src/modules/identity/audit/audit.controller.ts` — add:
```ts
@Get("export")
@RequirePermissions("audit.log.view")
async export(
  @CurrentUser() user: AuthenticatedUser,
  @Res() res: Response,
  @Query("eventType") eventType?: string,
  @Query("actorId") actorId?: string,
  @Query("dateFrom") dateFrom?: string,
  @Query("dateTo") dateTo?: string,
) { ... }
```
Calls `this.audit.list(user.organizationId, { ...filters, limit: AUDIT_LOG_EXPORT_MAX_ROWS, offset: 0 })`,
then `assertWithinAuditExportLimit(total)`, then `toAuditCsv(items)`, sets
`Content-Type`/`Content-Disposition` headers, `res.send(csv)`. Match
`quotes.controller.ts`'s exact `@Res()`/`Response` import style.

No changes to `audit.service.ts` — `list()` is reused unmodified.

**Route table (new only):**

| Method | Path | Auth |
|---|---|---|
| GET | `/audit-log/export` | `audit.log.view` |

---

## 3. e2e testing

Extend `apps/api/test/audit-log.e2e-spec.ts` (reusing its existing
`registerOrg`/`createAccount`/etc. helpers) with a new `describe("CSV
export")` block:
- Exports a CSV with `Content-Type: text/csv...` and a `Content-Disposition:
  attachment` header; body's first line matches the expected column headers;
  a row for a known created event (e.g. `account.created`) is present with
  the right `eventType`.
- `eventType` filter narrows the exported rows the same way it narrows the
  list endpoint.
- Permission gate: 403 without `audit.log.view`, 401 unauthenticated (same
  pattern as the existing list-endpoint permission test).

(The cap-exceeded 400 path is covered by the `audit-export.spec.ts` unit
test, not e2e — generating 10,001 real rows via HTTP in a test is
impractical and adds nothing the unit test doesn't already prove.)

Re-run the full e2e suite after, to confirm no regressions.

---

## 4. Frontend

`apps/web/src/app/(dashboard)/administration/audit/page.tsx` — add an
"Export CSV" control in the `CardHeader`, next to the existing filters:
- Build the export URL from current filter state (`eventType`, `actorId`,
  `dateFrom`, `dateTo` — same values already passed to `useAuditLog`, minus
  `limit`/`offset`) via `URLSearchParams`, pointing at
  `/api/gateway/audit-log/export?...`.
- When `total > 0 && total <= AUDIT_LOG_EXPORT_MAX_ROWS` (both imported from
  `@sales-platform/contracts`): render `<a href={exportHref}><Button
  variant="outline" size="sm">Export CSV</Button></a>`, matching the Quote
  PDF anchor pattern exactly.
- Otherwise: render the same `Button` `disabled`, with a `title` explaining
  why when `total` exceeds the cap ("narrow filters — N rows match, limit is
  10,000").

No new hook needed — reuses the `total` already returned by the existing
`useAuditLog` call in this page.

---

## 5. Sequencing checkpoints (system stays runnable + tested after each)

**A — Backend.** Contracts constant + rebuild; `shared/csv/to-csv.ts` +
spec; `audit-export.ts` + spec; controller `export` endpoint; e2e test
additions.
*Verify: `pnpm --filter @sales-platform/api test` (new unit specs green);
`pnpm --filter @sales-platform/api test:e2e` (new + full suite green).*

**B — Frontend.** Export CSV button wired into the audit page.
*Verify manually via isolated dev instances (alternate ports, same
convention as Phases 9/10 — existing foreign/stale processes on
3000/3004/4000 left untouched): unlike prior phases' UI-only checks, a CSV
download can be **fully** verified via `curl` — apply filters, hit
`/api/v1/audit-log/export` and `/api/gateway/audit-log/export` directly,
confirm real CSV bytes with correct headers/rows come back, not just a 200.*

**C — Docs.** `docs/decisions/0011-audit-log-csv-export-phase11-scope.md`
(new ADR, codifying every §0 row, referencing ADR 0010 point 7 as the
decision being picked up); `docs/plans/0011-phase11-csv-export-plan.md`
(this plan, persisted); `docs/architecture/overview.md` (phase-link list
entry + new "Phase 11 scope" section); `README.md` (Phase 11 marked
current, Phase 10 loses "(current)"). Full unit + e2e suite, both builds —
final gate.

---

## Verification

- After A: new unit specs (`to-csv.spec.ts`, `audit-export.spec.ts`) green;
  new e2e tests green; full existing suite unaffected.
- After B: manual `curl` smoke test — both direct-API and through-the-BFF
  CSV downloads inspected byte-for-byte, not just status-code checked.
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/shared/csv/to-csv.ts` (new) — generic CSV encoder
- `apps/api/src/modules/identity/audit/audit-export.ts` (new) — cap check + audit-specific CSV shaping
- `apps/api/src/modules/identity/audit/audit.controller.ts` (existing) — new `GET /audit-log/export` route
- `apps/api/src/modules/identity/audit/audit.service.ts` (existing, read-only) — `list()` reused unmodified
- `apps/web/src/app/(dashboard)/administration/audit/page.tsx` (existing) — Export CSV button
- `packages/contracts/src/audit.ts` (existing) — `AUDIT_LOG_EXPORT_MAX_ROWS`
