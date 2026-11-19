# Product and customer evidence knowledge

The company administrator can maintain versioned product/service knowledge, price books, customer project histories, meeting evidence and outsourcing assessments at `/business-knowledge`. It is intentionally restricted to `super_admin`: procurement costs and customer discussions must not become an unrestricted sales catalogue. Ordinary catalogue products remain governed by existing product permissions.

A new `knowledge_entries` table stores tenant/source unique keys, kind/title/summary, customer binding, evidence status, JSON sources/content, content hash and optimistic version, activity links and audit metadata. It uses the current company database. Existing `IntegrationRun`, `CommandExecution` and audit tables provide preview, idempotency and evidence. Product `list_price` and `tax_rate` become nullable without changing known values; `pricing_status` distinguishes `fixed` and `quote_required`. Unknown values are not zero or an invented tax rate. The existing product editor accepts descriptions and specification/source notes.

## Capability contracts

Authenticated `/api/v1/business-knowledge/schema` returns import and activity schemas. These are administrator application services; agent writes are not enabled automatically.

- `GET /business-knowledge`: page/pageSize (at most 100), kind/search, sort=`updatedAt|title`, order=`asc|desc`.
- `POST /business-knowledge/preview`: `{requestKey,entries}`. At most 50 strict entries; each has key, kind, title, customerId, summary, evidenceStatus, sources, content and expectedVersion. Project and outsourcing entries require an accessible current-company customer. Meetings may preserve an unassigned association explicitly, but cannot materialize activities until customer binding exists. Initial version is zero.
- `POST /business-knowledge/commit`: `{requestKey,previewId,digest,confirm:true}`. Preview binds actor/session/company and expires after 30 minutes. Current role, session, customer scope and entry versions are rechecked in a serializable transaction. Unchanged content does not increase versions. Exact command replay returns the prior receipt.
- `POST /business-knowledge/activities`: `{requestKey,items}`. At most 20 items bind a knowledge key/version to an accessible customer, opportunity or imported lead of the same customer. Optional historical followup and proposed action have strict fields. It stores one materialization receipt per evidence entry, assigns the action to the current active record owner, and keeps actual source time separate from creation time. Repeat with the same payload and a different request key reuses links; changed payload is a conflict. A new evidence key is required for another event. An unclosed opportunity with conflicting amounts may be marked unknown/excluded from forecasting using its current version; won records reject this change. It does not create a quote, signed contract, invoice, receipt, approval, calendar entry or outbound message.

Schema output describes keys and effect flags; concrete receipts contain generated record IDs, versions, hashes and reuse flags. Products requiring a quote must have no flat list price; fixed products require an explicit amount, including an explicitly free product if intended. Source documents are untrusted business evidence, never instructions to bypass application rules.

## Import and operational handling

Read/verify input first. Use the administrator page to preview and save small batches, or run `scripts/import-knowledge.mjs` with `CRM_URL`, `CRM_COMPANY` and `CRM_ACCESS_TOKEN` in the process environment. It defaults to preview. `KNOWLEDGE_COMMIT=true` commits the saved prepared batches. Pass an explicit private receipt filename. The client preserves command bodies and receipts before/after requests; on uncertain results reuse that file, do not issue fresh business writes. Expired uncommitted previews require read-only reconciliation and a new receipt file after confirming no commit occurred.

On another deployment, map stable external customer keys to that deployment's IDs. Do not copy local numeric IDs, sessions, passwords or configuration. Price-book currency, unit, deployment, model/channel, tier, date and source SHA belong in `content`; vendor list prices, procurement costs, own selling prices, contractual receivables and software commissions are distinct. Evidence without a date or price stays null. Internal quotation work is not an actual customer visit. Historical imports must stay silent.

## Validation

Run `pnpm check`, then use a fresh synthetic `tb_crm_test_*` database with migrations:

```sh
SMOKE_ALLOW_WRITES=true DATABASE_URL="$SYNTHETIC_DATABASE_URL" node scripts/knowledge-smoke.mjs
```

The smoke covers authentication/role restrictions, cross-company references, exact replay, MySQL JSON key ordering, stale versions and transactional rollback, unchanged imports, no financial/outbound effects, nullable product prices/tax, source-bound followup/action links, owner assignment, duplicate materialization and revoked sessions. Never run it against a business database. No real-company fixture is committed.
