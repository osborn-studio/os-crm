# Approvals

A salesperson submits a draft contract for approval with the published contract flow's form; the current approver (销售主管, then 老板 when amount ≥ 100000) sees it under 待我审批 in 审批中心 and approves or rejects it; the contract status and notifications follow. Pending cards also offer 转审; published flows may use 多人会签（全同意）.

## Sub-features

- `approval-submit` opens `提交审批` on a draft/rejected contract, shows the flow name + version, and submits.
- `approval-pending` lists items under tab `待我审批 (N)` by **approval title** (contract name), with `查看申请`, `转审`, `通过`, `驳回`.
- `approval-approve` advances the current node via Modal.confirm `提交同意意见`; toast is `本步已完成，等待下一步` (more nodes) or `申请已通过` (final). ≥ 100000 routes to `boss` next.
- `approval-reject` requires a comment (`请填写驳回意见`); toast `申请已驳回`; contract returns to `rejected`.
- `approval-transfer` opens `转审` / `转审 / 管理员恢复流转`, picks a target and required `转审原因`; toast `转审已保存，原节点和原因保留`. Does not count as an approval vote.
- `approval-countersign` (designer + runtime) uses approver type `users_all`; same-step peers must all approve (`意见已保存，等待同组其他成员`); any reject ends the request.
- `approval-mine` lists the submitter's requests under `我发起的` with `撤回`.
- `approval-general` starts a generic request via `发起通用申请` (fields `申请标题`, `申请金额（用于条件匹配）`, and form `申请事由`).
- `approval-designer` (admin) edits/publishes flows at `/approval-designer` (顺序审批 / 多人会签 / 金额条件).

## How to get to it (user POV)

- `合同与订单` → `合同管理` (`/contracts`), row button `提交审批`.
- Left menu `审批中心` (`/approvals`).
- Admin: `审批设计器` (`/approval-designer`).
- HTTP: `GET /api/v1/approvals/pending`, `/approvals/schema`; MCP tool `approval.pending`.

## Driving it with verify-os-crm

Preconditions:

- Fresh launch. Find a draft contract owned by sales: `$V api approvals.contracts sales GET "/workspace/contracts?pageSize=50"` and pick an item with `status` `draft` (= `<ID>`, `<NO>` its `contractNo`, `<TITLE>` its `name`, note `amount`). If none exists, report the journey as blocked by seed data (do not create one through another path and call it this journey).

- **Submit.** Steps `{"login":"sales"}`, `{"click":"合同与订单","within":".ant-layout-sider"}` (this group is **not** in `defaultOpenKeys` — click to open), `{"waitText":"合同管理"}`, `{"click":"合同管理","within":".ant-layout-sider"}`, `{"click":"提交审批","within":"tr[data-row-key=\"<ID>\"]"}`, `{"waitText":"v","within":".ant-modal"}` (flow `name vN` alert; contract flow fields are empty), `{"click":"确定","within":".ant-modal-footer"}`, `{"waitText":"操作已完成"}`, `{"shot":"submitted"}`.
- **Pending for manager.** New steps: `{"login":"manager"}`, `{"click":"审批中心","within":".ant-layout-sider"}`, `{"waitText":"待我审批"}`, `{"waitText":"<TITLE>"}` (the card shows the contract **name**, not `contractNo`), `{"shot":"pending"}`.
- **Approve.** `{"click":"通过"}`, `{"waitText":"提交同意意见"}`, `{"click":"确定","within":".ant-modal-confirm"}` (antd `Modal.confirm`, **not** `.ant-modal-footer`), then `{"waitText":"本步已完成，等待下一步"}` when amount ≥ 100000, else `{"waitText":"申请已通过"}`, `{"shot":"approved"}`.
- **Boss step (amount ≥ 100000).** Repeat pending/approve as `boss`; final toast `申请已通过`.
- **Second view.** `$V db approvals.state "SELECT a.id, a.status, n.node_name, n.action, u.username FROM approvals a JOIN approval_nodes n ON n.approval_id=a.id JOIN users u ON u.id=n.approver_id WHERE a.biz_id=<ID> ORDER BY n.id"` — column is `approval_nodes.action` (not `status`). `$V api approvals.contract sales GET /workspace/contracts/<ID>`; after full approve the contract is `approved` and sales sees `确认签约`.

## Gotchas

- Proven end to end 2026-11-02 (`RUN_ID` `verify-maintain-20261102-005205`): submit → manager → boss on `DEMO-HT-10` (amount 120000).
- Do not wait for `DEMO-HT-*` on the pending list; the card title is the business title (`溪桥1号演示企业服务合同`).
- Toast `审批已处理` is obsolete; use the messages above (including countersign `意见已保存，等待同组其他成员`).
- Approve/reject confirm lives under `.ant-modal-confirm`; `.ant-modal-footer` is for ordinary Form modals (submit / 发起通用申请 / 转审).
- The `通过` button exists once per pending card; with several pending items scope by the card containing `<TITLE>` or approve via the first card only after asserting it is the right one.
- A submitter cannot approve their own request; a flow without a resolvable approver blocks submission — report the server message.
- Approval changes the shared seed contract; relaunch before repeating.
