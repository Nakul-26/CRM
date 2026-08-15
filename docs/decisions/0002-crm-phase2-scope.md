# ADR 0002: Defer Documents and Custom Fields out of CRM Phase 2

## Status

Accepted — 2026-08-15

## Context

Section 6 of the product brief lists "Documents" and "Custom fields" as
sub-features of Accounts, alongside Accounts, Contacts, Activities,
Customer timeline, Search, RBAC, and Audit — the actual Phase 2 checklist
in Section 36. Both are open-ended enough to be their own phase of work
rather than a checkbox inside this one:

- **Documents** (file uploads on accounts) needs file storage (local disk
  or S3-compatible), access control tied to the same org/permission model
  as everything else, and virus scanning per Section 27 of the brief.
  Nothing else in Phase 2 depends on it.
- **Custom fields** (organization-defined dynamic fields on accounts/
  contacts) needs a dynamic field storage design (EAV table or a
  jsonb schema-of-schemas), a field-builder UI, and per-field validation.
  Building a partial version now to check a box would need a rewrite once
  it's done properly.

## Decision

Defer both, same pattern as ADR 0001's deferred-tech table. Accounts and
Contacts ship in Phase 2 with a fixed, well-designed set of columns (see
`apps/api/src/database/schema/crm.schema.ts`) instead of a half-built
dynamic-fields mechanism.

| Deferred | Add it when... |
|---|---|
| Documents (file storage, virus scanning) | A concrete need for file attachments on CRM records appears, and file storage/malware scanning infrastructure is worth standing up. |
| Custom fields (dynamic schema) | An organization has a real, specific need for fields the fixed schema can't express, worth the field-builder UI and validation engine it requires. |

## Consequences

- Accounts/Contacts have a fixed column set today; adding new fixed
  columns later is a normal migration, same as any other schema change.
- No document-storage or dynamic-field code exists to secure, migrate, or
  maintain until one of the triggers above is actually hit.
