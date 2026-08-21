# ADR 0011: Audit Log CSV Export Phase 11 scope — a bounded export over an existing endpoint

## Status

Accepted — 2026-08-18

## Context

[ADR 0010](0010-audit-log-ui-phase10-scope.md) point 7 explicitly deferred
"CSV/export" for the audit log, alongside payload search, retention policy,
and real-time streaming — "none of these have any evidence of being needed
yet." The user has now asked for it, as the first of several previously
deferred items (payment processing, real-time streaming, and a set of infra
migrations — RabbitMQ, Keycloak, Temporal, OpenSearch — being taken up one
at a time, starting with the smallest). Scope here is exactly the item that
was deferred: exporting the audit log to CSV, using the same filters
`GET /audit-log` already supports. No other list in the app gains export in
this phase.

## Decisions

**1. A new `GET /audit-log/export` endpoint** on the existing
`AuditController` (`apps/api/src/modules/identity/audit/audit.controller.ts`),
reusing `AuditService.list()` unmodified — same `eventType`/`actorId`/
`dateFrom`/`dateTo` filters as the list endpoint, just a different response
format. No new query logic, no changes to `audit.service.ts`.

**2. A row cap of 10,000**, exported as `AUDIT_LOG_EXPORT_MAX_ROWS` from
`packages/contracts/src/audit.ts` so both backend and frontend read the same
number. If the filtered total exceeds it, the endpoint returns `400` asking
the caller to narrow filters, rather than building an unbounded response.
`audit_log` grows forever — ADR 0010's own reasoning for why it's the one
paginated table in the app — so an unbounded export would reintroduce the
exact problem pagination already solved for reads. A hard cap keeps the
response buildable in memory without a streaming CSV writer, which nothing
else in the app needs yet either.

**3. Boundary and CSV-shaping logic pulled into a pure, unit-tested file** —
`apps/api/src/modules/identity/audit/audit-export.ts`
(`assertWithinAuditExportLimit(total)`, `toAuditCsv(items)`), tested in
`audit-export.spec.ts` without touching the database. This mirrors
`apps/api/src/modules/quotes/quote-pdf.ts` — Phase 5's "pure builder pulled
out of the service, unit-tested standalone." It's also the pragmatic choice
for the cap boundary specifically: generating 10,001 real audit rows through
HTTP calls in an e2e test would be slow and prove nothing a plain Jest test
with `total = 10_000` vs `10_001` doesn't already prove.

**4. A new shared CSV encoder**, `apps/api/src/shared/csv/to-csv.ts`
(`toCsv(rows, columns)`), hand-rolled rather than a new dependency —
RFC-4180-style quoting (wrap fields containing `,`/`"`/newline, double
internal quotes), unit-tested in `to-csv.spec.ts` for those escaping edge
cases. No `csv`/`fast-csv` package was already installed, and the encoding
needed is a handful of lines — the same call Phase 5 made the other way for
PDF generation, where `pdfkit` earned its place because PDF generation
genuinely isn't a few lines. The `rows`/`columns` generic signature is the
natural shape of a CSV encoder, driven by the one real caller, not built
ahead of need.

**5. Response via `@Res() res: Response`**, `Content-Type: text/csv;
charset=utf-8`, `Content-Disposition: attachment; filename="audit-log-
<timestamp>.csv"` — the same `@Res()` pattern `quotes.controller.ts` already
uses for PDF downloads (`pdf()`/`versionPdf()`), not `StreamableFile`. No new
file-response pattern is introduced. `attachment` (rather than `inline`,
which the PDF endpoints use) so the browser downloads the file instead of
opening it.

**6. No new permission.** Reuses `audit.log.view`, same as the list
endpoint — matching the established precedent that every file/PDF download
endpoint in the app reuses its resource's `.view` permission rather than
inventing an export-specific one.

**7. Frontend: a plain `<a href>` download link**, not fetch+blob — matching
the Quote PDF download exactly. The browser handles `Content-Disposition:
attachment` natively; no blob-handling JS exists anywhere in the app and
this doesn't introduce it. The BFF gateway
(`apps/web/src/app/api/gateway/[...path]/route.ts`) already routes any
`text/*` response through `.text()` rather than `.arrayBuffer()` (the branch
added for binary PDF bytes) — `text/csv` passes through as lossless UTF-8
text with no gateway changes needed.

**8. The Export CSV button disables itself when `total >
AUDIT_LOG_EXPORT_MAX_ROWS`**, reusing the `total` the page's `useAuditLog`
call already fetches for the Prev/Next pager — no extra request needed to
know export is possible, and the 400 path becomes a fallback rather than
something a normal user hits.

**9. Not built:** export of any other list (tickets, accounts, etc.),
streaming/chunked CSV generation, background/async export jobs, export
history. Scoped to exactly what ADR 0010 deferred for the audit log —
extending export elsewhere is new, unevidenced scope, left for a future
phase if requested.

## Consequences

- Anyone with `audit.log.view` can now download the org's (filtered) audit
  trail as a CSV, not just view it paginated on the dashboard.
- The app gained its first hand-rolled CSV encoder and its first
  request-size cap enforced by rejecting rather than truncating — a
  reusable precedent if another unbounded list ever needs export.
- The runner-up "CSV/export" deferral from ADR 0010 is now resolved; payload
  search, retention policy, and real-time streaming remain open deferrals
  there, unrelated to this change.
