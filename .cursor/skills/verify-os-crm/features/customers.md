# Customer records

A signed-in sales user opens 客户档案, creates a customer through the 新建客户 dialog, finds it with the search box, and opens its detail drawer; the record is stored as a private-pool customer owned by that user and audited.

## Sub-features

- `customers-list` lists the customers visible to the role with `共 N 条` pagination.
- `customers-create` saves a new customer from the `新建客户` modal (`客户名称` required; `行业`, `级别`, `地区`, `地址`, `官网`, `备注` optional).
- `customers-search` filters the list by keyword from the `搜索客户` box.
- `customers-detail` opens the `客户详情` drawer with fields and related tabs (联系人、商机、合同、项目、跟进).
- `customers-edit` saves changes from the row `编辑` button (optimistic concurrency via `expectedUpdatedAt`).
- `customers-export` downloads `customers-当前页.csv` from `导出当前页`.

## How to get to it (user POV)

- Left menu `客户经营` → `客户档案` (route `/customers`).
- Customer names in other pages' detail tabs link back here only by search; there is no deep link per id.
- Agents: `customer.search` / `customer.get` MCP tools (read-only; see `mcp-agent.md`).

## Driving it with verify-os-crm

Preconditions:

- Baseline state; no customer named `验证客户-$RUN_ID` exists.
- `sales` can log in (`$V doctor` healthy).

- **Whole journey.** Run `$V ui customers-create .cursor/skills/verify-os-crm/journeys/customers-create.json`. Exit `0`, `ui/customers-create.steps.log` ends with `all steps passed`.
- **Open list.** Steps `login sales` → `{"waitText":"客户档案"}` then click `客户档案` within `.ant-layout-sider` (do **not** click the already-open `客户经营` parent — that toggles it closed). Path is `/customers`, text `共 ` appears; shot `02-customer-list` shows seed rows such as `星河1号演示企业`.
- **Create.** Click `新建客户`; fill `客户名称` = `验证客户-${RUN_ID}`, `行业` = `智能制造`, `备注` = `verify-os-crm synthetic fixture` within `.ant-modal`; click `确定` within `.ant-modal-footer`. Toast `已保存`; shot `03-create-form` shows the filled dialog.
- **Search.** Fill `搜索客户` with the same name and press `Enter`. Text `共 1 条`; shot `04-search-result` has exactly that row.
- **Detail.** Click the row link. Drawer `客户详情` shows `verify-os-crm synthetic fixture`, 客户池 `私海`; shot `05-detail-drawer`.
- **API readback.** Run `$V api customers-create.readback sales GET "/workspace/customers?keyword=$(node -p 'encodeURIComponent("验证客户-"+process.env.RUN_ID)')"`. HTTP 200, one item with `industry` `智能制造`, `poolType` `private`.
- **DB side effect.** Run `$V db customers-create.row "SELECT c.id, c.name, c.industry, c.pool_type, u.username AS owner, c.remark, c.created_at FROM customers c LEFT JOIN users u ON u.id = c.owner_id WHERE c.name LIKE '%$RUN_ID'"`. One row, owner `sales`, pool `private`.
- **Audit.** Run `$V db customers-create.audit "SELECT a.id, u.username, a.action, a.object_type, a.object_id, a.created_at FROM audit_logs a JOIN users u ON u.id = a.user_id WHERE a.action = 'customers.create' ORDER BY a.id"`. One row by `sales`.

## Gotchas

- On the first proven run the `customers.create` audit row had `object_id = NULL`; match audit rows by `action` and user, not by object id. (Observed behavior, not fixed here.)
- Sales-created customers are private (`私海`) with a 30-day `protectUntil`; they do not appear in `/pool/public`.
- The search box only applies on `Enter` or the search icon; typing alone does not filter.
- Dashboard cards repeat menu labels; an unscoped `click 客户经营` hits a dashboard button instead of the menu. Inside the sider, `客户经营` is already open via `defaultOpenKeys` — clicking the parent closes the leaf items.
- Detail drawer may also show an attachments panel (`AttachmentPanel`); private evidence upload is not mapped in this feature (see README candidates).
- Re-proven 2026-11-02 (`RUN_ID` `verify-maintain-20261102-005205`); `customers.create` audit `object_id` still NULL.
- antd modal fields animate in; the helper waits for a still target and fails with `focus did not land` instead of typing into nothing.
- `boss` has read-only business access (`当前角色无业务编辑权限`); use `sales` or `manager` for create/edit.
