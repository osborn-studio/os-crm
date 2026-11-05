# 伴圆 CRM verification map

This directory is the maintained source for verifying the user-facing behavior of 伴圆 CRM (os-crm). Read the index before driving the app, then use the matching feature file as the recipe. Mechanics (helper commands, step language, evidence layout) are in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- `RUN_ID` is set and unique; `V=.cursor/skills/verify-os-crm/scripts/verify-os-crm.sh`.
- `$V build` ran on the commit under test, then `$V launch` printed `ready:` for this `RUN_ID`.
- `$V doctor` prints `doctor: healthy` with no build-rev warning.
- `eval "$($V env)"` in the driving shell (exports `CRM_URL`, `SEED_ADMIN_PASSWORD`, `OSCRM_EVIDENCE`).
- Seed data is the fresh `demo:seed` state from this launch (tenant `TINGMENG`, users `admin`/`manager`/`sales`/`boss`, 40 customers named `<地名>N号演示企业`).
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise; one journey per fresh launch when it mutates shared seed rows (pool claims, approvals).
- Browser actions go through `$V ui <label> <steps.json>`; prefer the checked-in `../journeys/*.json`. Locate by visible text, Form labels, placeholders and `tr[data-row-key="<id>"]`, never by coordinates.
- Scope menu clicks with `"within": ".ant-layout-sider"` and modal fields with `"within": ".ant-modal"`. For antd `Modal.confirm` (审批通过/驳回), use `"within": ".ant-modal-confirm"`.
- `BasicLayout` `defaultOpenKeys` already expands `客户经营` and `销售管理`. Clicking those parent titles toggles them **closed** — wait for the leaf label and click the leaf (or open a closed group such as `合同与订单` / `项目交付` / `财务中心` only when needed).
- Name synthetic records with `${RUN_ID}` so assertions cannot match seed data.
- Second views: `$V api` as the same role, then `$V db` SELECTs on the affected table and `audit_logs`.

## Proof and skip reporting

- Capture the user action and the resulting state: `shot` before and after, plus `ui/<label>.steps.log`.
- UI proof includes the PNG, innerText and accessibility tree of each `shot`, with `伴圆 CRM` and the role badge visible.
- Mutation proof includes a read-only API readback and a DB row (plus its audit row).
- Record the feature ID and entry point used with every artifact (the `<label>`).
- Report an unreachable path with the attempted command and the unmet precondition (missing seed row, missing third-party credential).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-os-crm` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Login and role workbenches](./login-roles.md) covers four-role UI login, role-specific dashboards and admin-only menus. *Proven 2026-11-06 (`verify-maintain-20261106-005900`); also 2026-11-02.*
- [Customer records](./customers.md) covers creating, searching and opening a customer from 客户档案. *Proven end to end 2026-11-06 (`verify-maintain-20261106-005900`); also 2026-11-02 / 2026-11-01.*
- [Public / private pool](./customer-pool.md) covers claiming a public-pool customer and returning it. *Proven end to end 2026-11-06 (`verify-maintain-20261106-005900`); also 2026-11-02.*
- [Approvals](./approvals.md) covers submitting a contract for approval and deciding it in 审批中心 (incl. transfer/countersign notes). *Proven end to end 2026-11-06 (`verify-maintain-20261106-005900`); also 2026-11-02.*
- [Agent surface (MCP) and deployment acceptance](./mcp-agent.md) covers the read-only MCP tools and the repo's `deploy/verify.mjs`. *Proven 2026-11-06 (`verify-maintain-20261106-005900`); also 2026-11-02.*

## Not yet mapped (candidates)

Leave these as candidates until a dedicated feature file has a concrete live recipe. Source paths are current as of `main` @ f157410:

- **Identity / 人员与部门** — admin `系统管理` tabs for users, departments, password reset + session revoke (`apps/web/src/pages/workspace/SystemPage.tsx`, `docs/IDENTITY_OPERATIONS.md`).
- **Finance ledger 收款登记与核销** — real local receipt register / review / allocate / reverse / void / correct (`apps/web/src/pages/workspace/FinanceLedgerPage.tsx`, `docs/RECEIVABLE_LEDGER_OPERATIONS.md`). Not the old read-only synthetic demo rows.
- **Service tickets 售后服务工单** — `/service-tickets` (`apps/web/src/pages/workspace/ServiceTicketsPage.tsx`, `docs/SERVICE_TICKET_OPERATIONS.md`).
- **Customer import / sales handover** — supervisor `客户导入 / 销售交接` (`apps/web/src/pages/workspace/CustomerOperationsPage.tsx`, `docs/CUSTOMER_CONTRACT_OPERATIONS.md`).
- **Private evidence attachments** — drawer `AttachmentPanel` (`apps/web/src/pages/workspace/AttachmentPanel.tsx`, `docs/PRIVATE_ATTACHMENT_OPERATIONS.md`).
- **Opportunity board / closure** — `/opportunities/board` and row action `标记输单` (`apps/web/src/pages/workspace/BoardPage.tsx`, `lose` in `WorkspacePage.tsx`).
- **Delivery handover** — project actions `交接项目经理` / task reassign (`handover_pm`, `assign_task` in `apps/web/src/services/workspace.ts`).
- **Agent delegation control** — `/ai` `AgentControlPanel` grants (`apps/web/src/pages/workspace/AgentControlPanel.tsx`, `examples/delegated-agent-client.mjs`); distinct from JWT MCP.
- **System principal commands** — server-only `runSystemCommand` (`docs/SYSTEM_COMMANDS.md`); not a browser journey.
