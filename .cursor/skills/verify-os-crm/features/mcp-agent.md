# Agent surface (MCP) and deployment acceptance

An agent authenticates as a CRM user and talks MCP (Streamable HTTP) to `/api/v1/mcp`: it lists 7 read-only tools and 2 resources and calls `customer.search`, seeing exactly what that user may see. The repo's read-only deployment acceptance checks the UI title, health and four-role login against the same instance.

## Sub-features

- `mcp-list` lists tools `customer.search, customer.get, workspace.list, workspace.get, workspace.overview, workspace.schema, approval.pending` and resources `crm://capabilities, crm://approval-capabilities`.
- `mcp-search` returns `{executionId, capabilityId: "customer.search", version, result: {items, meta}}` scoped to the caller.
- `mcp-readonly` exposes no write tools.
- `acceptance` runs `deploy/verify.mjs` (UI `伴圆 CRM`, `/api/v1/health`, 4 roles × `/workspace/overview|schema`, `/approvals/schema`).

## How to get to it (user POV)

- MCP client → `POST $CRM_URL/api/v1/mcp` with `Authorization: Bearer <token from /api/v1/auth/login>` (`examples/mcp-client.mjs`).
- Web `AI与智能体` page (`/ai`) shows the capability catalog and rule-based summaries (no LLM).
- `node deploy/verify.mjs` with `DEMO_URL` and `SEED_ADMIN_PASSWORD`.

## Driving it with verify-os-crm

Preconditions:

- Baseline state. For a scoped search, a customer only this user can see (e.g. the `customers-create` fixture `验证客户-$RUN_ID` created by `sales`).

- **List + search.** Run `$V mcp sales "$RUN_ID"`. Exit `0`; `cli/mcp.stdout` starts with `Tools: customer.search, customer.get, workspace.list, workspace.get, workspace.overview, workspace.schema, approval.pending` and `Resources: crm://capabilities, crm://approval-capabilities`, then one item named `验证客户-$RUN_ID`.
- **Seed search.** Run `$V mcp sales 星河`. Items are `星河N号演示企业` rows visible to sales.
- **Scope.** Run `$V mcp boss "$RUN_ID"` (sees it, full company) and compare with another salesperson if a seeded `sales0N` is used (should not see a private record of `sales`).
- **Acceptance.** Run `$V acceptance`. Exit `0`; `cli/acceptance.stdout` ends with `Deployment read-only acceptance passed.`

## Gotchas

- The MCP server validates the Host header against `localhost:$PORT`/`127.0.0.1:$PORT` of the API; going through `serve-web.mjs` works because the proxy rewrites Host. Calling the API port directly with another Host gets rejected.
- `examples/mcp-client.mjs` refuses non-local URLs by design.
- AI summaries are rule-generated; there is no DashScope call to verify (no key, and none should be invented).
- `/ai` also hosts `AgentControlPanel` (限时委托 / grant token / revoke). That write surface is **not** covered by `$V mcp` (JWT MCP stays the 7 read-only tools); list it under README candidates until mapped.
- Re-proven 2026-11-02: tool list unchanged; scoped search found `验证客户-$RUN_ID`.
- `$V mcp` overwrites `cli/mcp.*`; copy the files aside if you run it more than once per RUN_ID.
