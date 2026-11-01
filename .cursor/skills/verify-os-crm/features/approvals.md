# Approvals

A salesperson submits a draft contract for approval with the published contract flow's form; the current approver (销售主管, then 老板 when amount ≥ 100000) sees it under 待我审批 in 审批中心 and approves or rejects it; the contract status and notifications follow.

## Sub-features

- `approval-submit` opens `提交审批` on a draft/rejected contract, shows the flow name + version, and submits.
- `approval-pending` lists items under tab `待我审批 (N)` with `查看申请`, `通过`, `驳回`.
- `approval-approve` advances the current node (`审批已处理`); ≥ 100000 routes to `boss` next.
- `approval-reject` requires a comment (`请填写驳回意见`) and returns the contract to `rejected`.
- `approval-mine` lists the submitter's requests under `我发起的` with `撤回`.
- `approval-general` starts a generic request via `发起通用申请` (field `申请事由`).
- `approval-designer` (admin) edits/publishes flows at `/approval-designer`.

## How to get to it (user POV)

- `合同与订单` → `合同管理` (`/contracts`), row button `提交审批`.
- Left menu `审批中心` (`/approvals`).
- Admin: `审批设计器` (`/approval-designer`).
- HTTP: `GET /api/v1/approvals/pending`, `/approvals/schema`; MCP tool `approval.pending`.

## Driving it with verify-os-crm

Preconditions:

- Fresh launch. Find a draft contract owned by sales: `$V api approvals.contracts sales GET "/workspace/contracts?pageSize=50"` and pick an item with `status` `draft` (= `<ID>`, `<NO>` its `contractNo`, note `amount`). If none exists, report the journey as blocked by seed data (do not create one through another path and call it this journey).

- **Submit.** Steps `{"login":"sales"}`, `{"click":"合同与订单","within":".ant-layout-sider"}`, `{"click":"合同管理","within":".ant-layout-sider"}`, `{"click":"提交审批","within":"tr[data-row-key=\"<ID>\"]"}`, `{"waitText":"v"}` (flow `name vN` alert), fill required form fields, `{"click":"确定","within":".ant-modal-footer"}`, `{"waitText":"操作已完成"}`, `{"shot":"submitted"}`.
- **Pending for manager.** New steps file: `{"login":"manager"}`, `{"click":"审批中心","within":".ant-layout-sider"}`, `{"waitText":"待我审批"}`, `{"waitText":"<NO>"}` (or the contract title), `{"shot":"pending"}`.
- **Approve.** `{"click":"通过"}`, `{"click":"确定","within":".ant-modal-footer"}`, `{"waitText":"审批已处理"}`, `{"shot":"approved"}`.
- **Second view.** `$V db approvals.state "SELECT a.id, a.status, n.node_name, n.status FROM approvals a JOIN approval_nodes n ON n.approval_id=a.id WHERE a.biz_id=<ID> ORDER BY n.id"` and `$V api approvals.contract sales GET /workspace/contracts/<ID>`; for amount ≥ 100000 the next node is pending for `boss`, else the contract is `approved` and sales sees `确认签约`.

## Gotchas

- Not yet driven end to end by this skill; verify the column names in the second-view SELECT against `schema.prisma` (`approvals`, `approval_nodes`) on first run and fix this file.
- The `通过` button exists once per pending card; with several pending items scope by the card containing `<NO>` or approve via the first card only after asserting it is the right one.
- A submitter cannot approve their own request; a flow without a resolvable approver blocks submission — report the server message.
- Approval changes the shared seed contract; relaunch before repeating.
