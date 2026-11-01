# Public / private pool

Sales users see public-pool (公海) customers as restricted summaries and can claim one into their private pool (私海); they can return a private customer to the public pool. Managers can assign customers to a salesperson.

## Sub-features

- `pool-public-list` lists public customers at `/pool/public` with row action `领取`.
- `pool-claim` moves a public customer to the claimer's private pool (`操作已完成`).
- `pool-private-list` lists the user's private customers at `/pool/private` with `退回公海`.
- `pool-return` moves a private customer back to the public pool.
- `pool-assign` (manager) assigns a customer to a selected `目标销售` via `分配销售`.

## How to get to it (user POV)

- Left menu `客户经营` → `公海客户` (`/pool/public`) or `私海客户` (`/pool/private`).
- Row buttons on `客户档案` (`/customers`) show the same actions depending on the row's pool.

## Driving it with verify-os-crm

Preconditions:

- Fresh launch (claims change seed rows). Pick a public customer id first: `$V api pool.before sales GET "/workspace/customers?poolType=public&pageSize=5"` and note `data.items[0].id` (= `<ID>`) and its `name` (= `<NAME>`).

- **Open public pool.** Steps `{"login":"sales"}`, `{"click":"客户经营","within":".ant-layout-sider"}`, `{"click":"公海客户","within":".ant-layout-sider"}`, `{"expectUrl":"/pool/public"}`, `{"shot":"public-before"}`. Heading `公海客户`, rows with `领取`.
- **Claim.** `{"click":"领取","within":"tr[data-row-key=\"<ID>\"]"}`, `{"click":"确定","within":".ant-modal-footer"}`, `{"waitText":"操作已完成"}`, `{"shot":"claimed"}`. The row leaves the public list.
- **Private view.** `{"click":"私海客户","within":".ant-layout-sider"}`, `{"waitText":"<NAME>"}`, `{"shot":"private-after"}`. The row shows `退回公海`.
- **Second view.** `$V db pool.row "SELECT c.id, c.pool_type, u.username FROM customers c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=<ID>"` → `private`, `sales`.
- **Return.** On `/pool/private`, `{"click":"退回公海","within":"tr[data-row-key=\"<ID>\"]"}`, `{"click":"确定","within":".ant-modal-footer"}`, `{"waitText":"操作已完成"}`; DB shows `public` again.

## Gotchas

- Not yet driven end to end by this skill; first run should record the exact toasts and any confirmation text and update this file.
- Seed data mixes public and private rows on `/customers` too; use `tr[data-row-key]` so the click hits the intended row, because unscoped `领取` picks the last visible one.
- Claim limits or protection rules may reject a claim with a server message; report it with the message, do not switch customers silently.
- `boss` cannot claim (read-only role); `admin`/`boss` see full public rows while sales see restricted summaries.
