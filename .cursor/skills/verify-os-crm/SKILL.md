---
name: verify-os-crm
description: Drive the real 伴圆 CRM (os-crm / tb-crm, PartnerOS) from this checkout and prove behavior with evidence. The product is a React+antd web app (apps/web, served by scripts/serve-web.mjs) in front of a NestJS API (apps/api, /api/v1, MCP at /api/v1/mcp) on MySQL 8 with seeded four-role demo data. Use when you need to launch an isolated instance (own MySQL container, ports, secrets), log in as admin/manager/sales/boss, click through customers, pool, approvals or the MCP agent surface like a user, capture screenshots/API/DB proof, and keep that proof after teardown — e.g. before a PR that changes web pages, workspace/approval services, seed data or MCP tools.
---

# Verify 伴圆 CRM (os-crm)

B2B CRM demo (v0.2 本地演示版). Surfaces, in order of importance:

1. **Web UI** — `http://127.0.0.1:$WEB_PORT`. `scripts/serve-web.mjs` serves `apps/web/dist` and proxies `/api/*` to the API. Login page `/login`, then a left menu (`.ant-layout-sider`) with 经营工作台、客户经营、销售管理、合同与订单、项目交付、财务中心、站内通知、审批中心、AI与智能体; admin additionally sees 审批设计器、钉钉 / 飞书、系统管理. Routes are in `apps/web/src/App.tsx`.
2. **HTTP API** — NestJS, prefix `/api/v1` (`/health`, `/auth/login`, `/workspace/{schema,overview,<kind>,<kind>/<id>,<kind>/<id>/<action>}`, `/approvals/...`). Swagger at `http://127.0.0.1:$API_PORT/api/docs`.
3. **MCP (agent surface)** — Streamable HTTP `POST /api/v1/mcp` with the user's Bearer token; 7 read-only tools. Driven by the repo's own `examples/mcp-client.mjs`.

Not covered: real DingTalk/Feishu/DashScope/Yonyou/OSS calls (need enterprise credentials that do not exist here — never invent them), `pnpm demo:reset`/`demo:test` (they create extra databases through a root URL), the Docker delivery path `deploy/start.sh` (covered by CI workflow `deployment.yml`; see Gotchas), Windows/macOS launchers (`启动演示.command`, `deploy/start.ps1`), and finance writes (finance is read-only synthetic data by design).

**Hard rules.** Never point this skill at the developer's own demo database or the `.env` instance on :3000/:4000 — every run gets its own MySQL container and random ports, and the helper refuses to reuse a `RUN_ID`. Do not drive an instance you did not launch. Never write the seed password or a token into evidence or a PR.

Helpers (executable, in `scripts/`):

- `scripts/verify-os-crm.sh` — `build | launch | doctor | env | ui | api | db | acceptance | mcp | cleanup`. All state is keyed by `RUN_ID`.
- `scripts/crm-browser.mjs` — headless Chrome over CDP with real mouse/keyboard events; runs a JSON step list (`login`, `click`, `fill`, `press`, `waitText`, `expectUrl`, `shot`...) and writes PNG + innerText + accessibility-tree per `shot`. Called by `ui`.
- `journeys/*.json` — ready-made step lists referenced from `features/`.

Set once per run (repo root):

```bash
export RUN_ID=verify-$(date +%Y%m%d-%H%M%S)   # unique => parallel runs never share DB, ports, or scratch
V=.cursor/skills/verify-os-crm/scripts/verify-os-crm.sh
```

Prerequisites: **Node 24** first on `PATH` (`engines: >=24 <25`; the helper refuses others), pnpm 11.25 via corepack (helper sets `COREPACK_HOME=~/.cache/corepack` because `/usr/local/share/corepack` may be read-only), Docker (`docker` or passwordless `sudo -n docker`; override with `DOCKER=...`), image `mysql:8.4` (pulled on first launch), Chrome/Chromium for UI proof (`CHROME_BIN`), `curl`, `ss`, `git`. Redis, Elasticsearch and MailHog from the root `docker-compose.yml` are **not** needed: nothing in the API connects to them at runtime.

## Launch

```bash
$V build     # pnpm install --frozen-lockfile && prisma generate && pnpm build (~30s warm); records HEAD in apps/api/dist/.verify-build-rev
$V launch    # ~15s; prints: ready: web=http://127.0.0.1:<port> api=... db=127.0.0.1:<port> container=oscrm-verify-$RUN_ID evidence=<dir>
```

`launch` does, from an empty database:

1. Writes random `MYSQL_*`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SEED_ADMIN_PASSWORD` (or `OSCRM_SEED_PASSWORD` if set) to `/tmp/os-crm-verify/$RUN_ID/run.env` (mode 600). Picks three free ports.
2. Starts `mysql:8.4` as container `oscrm-verify-$RUN_ID` (label `oscrm-verify-run=$RUN_ID`), host networking, mysqld bound to `127.0.0.1:$DB_PORT`. Ready = the log shows `ready for connections ... port: $DB_PORT` (the entrypoint's init server reports `port: 0` and is restarted — a plain `SELECT 1` passes too early) **and** user `crm` can query `tb_crm_demo`.
3. Same data steps as README/CI: `prisma migrate deploy`, `prisma/seed.ts`, `prisma/demo.ts` (= `pnpm demo:seed`), run in `packages/database` without `--env-file` so only the run's env applies. Logs: `migrate.log`, `seed.log` in evidence; seed ends with `演示数据初始化完成`.
4. Starts `node dist/main.js` (cwd `apps/api`, `HOST=127.0.0.1 PORT=$API_PORT DEMO_MODE=true NODE_ENV=production`) and `node scripts/serve-web.mjs` (`WEB_PORT`, proxy to `PORT`) under `setsid`, pids in scratch.
5. Returns only when **usable**: `/api/v1/health` 200 through the web proxy, `/` contains `伴圆 CRM`, `admin` logs in with the run's password, and `/workspace/overview` reports `customers > 0`.

Seed data (`docs/DEMO_GUIDE.md`): tenant `TINGMENG`; users `admin`、`manager`(销售主管)、`sales`(演示销售)、`boss`(老板) plus `sales01..05`, `demo-owner`; 40 customers (`星河1号演示企业`…), 60 contacts, 20 leads, 24 opportunities, 12 contracts, orders/projects, payment plans, published approval flows.

Shell access to the instance: `eval "$($V env)"` exports `CRM_URL`, `DEMO_URL`, `OSCRM_EVIDENCE`, `SEED_ADMIN_PASSWORD`/`CRM_PASSWORD` (the latter two only into your shell — do not echo them into files).

Teardown: `$V cleanup` (see Cleanup).

## Doctor

```bash
$V doctor
```

Read-only. Checks: api pid alive and its cmdline/cwd are this checkout's `apps/api` `dist/main.js`; web pid is this checkout's `scripts/serve-web.mjs`; both ports are owned by those pids (`ss -ltnp`); the MySQL container is running and carries this `RUN_ID` label; `/api/v1/health` = 200 via the proxy; `/` serves `伴圆 CRM`; `admin` login works. Warns if `dist/.verify-build-rev` ≠ `HEAD` or `apps/ packages/ scripts/` have uncommitted changes (the running build may not be the code under test → `build`, `cleanup`, `launch`). Ends with `doctor: healthy (...)` or `doctor: NOT healthy — do not drive` (exit 1). Run it first and whenever output looks odd.

## Drive

Per-feature recipes live in [`features/`](features/README.md). Shared mechanics:

- **Browser:** `$V ui <label> <steps.json>` runs `crm-browser.mjs` against this instance; artifacts go to `ui/<label>.<shot>.{png,text.txt,ax.txt}` + `ui/<label>.steps.log`; on failure a `fail-<n>` shot is written and the exit code is 1. Step language is documented at the top of `crm-browser.mjs`. Stable handles from this repo:
  - Login: `{"login":"sales"}` clicks the role tab (`admin`/`销售主管`/`销售`/`老板` in `.ant-segmented`), types the password into placeholder `密码`, clicks `登录`, waits for `/dashboard`.
  - Menu: always scope menu clicks with `"within": ".ant-layout-sider"` (dashboard cards reuse labels like `客户经营`). Parent groups (`客户经营`, `销售管理`, ...) must be clicked open before their children.
  - Workspace pages (`WorkspacePage.tsx`): primary button `新建<title>` (e.g. `新建客户`), search placeholder `搜索<title>`, pagination text `共 N 条`, row link = record name, row buttons `详情`/`编辑`/action names (`领取`, `退回公海`, `分配销售`, `提交审批`, `确认签约`, ...). Target one row with `"within": "tr[data-row-key=\"<id>\"]"`.
  - Modals: fields by Form label with `"within": ".ant-modal"`, confirm with `{"click":"确定","within":".ant-modal-footer"}` (antd renders `确 定`; matching strips whitespace). Success toasts: `已保存`, `操作已完成`, `审批已处理`, `申请已提交`.
  - Detail drawer title `<title>详情` (e.g. `客户详情`).
- **API:** `$V api <label> <user> <METHOD> </path> [json]` logs in as `<user>` and calls `/api/v1<path>` through the web proxy; writes `api/<label>.{req.txt,status,body.json}` (no token). Writes need `{"requestKey": "<uuid>", "data": {...}}`; updates/actions also need `expectedUpdatedAt` from the detail.
- **DB (side effects):** `$V db <label> "SELECT ..."` runs a read-only query as `crm` in this run's container; writes `db/<label>.{sql,out}`. Tables are snake_case `@@map` names (`customers`, `audit_logs`, `users`, `approvals`, `approval_nodes`, ...; see `packages/database/prisma/schema.prisma`).
- **Repo acceptance:** `$V acceptance` runs `deploy/verify.mjs` (read-only: UI title, health, 4-role login, overview/schema endpoints) against this instance → `cli/acceptance.*`.
- **MCP:** `$V mcp [user] [keyword]` runs `examples/mcp-client.mjs` (lists tools/resources, calls `customer.search`) → `cli/mcp.*`.

## Evidence

Location: `${OSCRM_VERIFY_EVIDENCE:-$HOME/os-crm-verify-evidence}/$RUN_ID/` — outside the repo and outside scratch, so cleanup never removes it and git never sees it.

```
migrate.log  seed.log  api-launch.log  api-final.log  web-final.log
ui/<label>.<shot>.png|.text.txt|.ax.txt   ui/<label>.steps.log
api/<label>.req.txt|.status|.body.json
db/<label>.sql|.out
cli/acceptance.*  cli/mcp.*  (.stdout .stderr .exit)
```

Proof standards:

- Exercise the real user path: the browser UI for web features, the MCP client for the agent surface. Do not call services, Prisma, or jest fixtures as proof; `api`/`db` are second views, not the action.
- Capture the action and the result: a `shot` before and after the action plus the steps log; then a read-only second view (API readback as the same role, and a `db` SELECT of the row and its `audit_logs` entry).
- Verify side effects: rows inserted/updated, audit rows, approval instances/notifications — not just the toast.
- Role scoping is a behavior: when a change touches visibility, prove it from at least two roles (e.g. `sales` vs `manager`).
- Name synthetic fixtures with the `RUN_ID` (e.g. `验证客户-$RUN_ID`) so assertions can't match seed data.
- Report a journey that cannot run with the exact command, exit code and unmet precondition (e.g. "needs DingTalk app secret"). Never weaken a journey to make it pass, and never report a skipped entry point as verified through another.

## Cleanup

```bash
$V cleanup
```

Stops only the pids recorded in `/tmp/os-crm-verify/$RUN_ID/{api,web}.pid` after confirming their cmdline and cwd are this checkout's (never kills by name), copies final logs into evidence, removes only the container whose `oscrm-verify-run` label equals `$RUN_ID` (with its anonymous volume — the DB is disposable), then deletes the scratch dir. Prints `evidence kept: <dir>`; confirm with `ls <dir>`. `crm-browser.mjs` kills its own Chrome and deletes its temp profile on exit. Run cleanup after every failed attempt too; `launch` refuses to start while scratch for that `RUN_ID` exists.

## Helpers

```bash
.cursor/skills/verify-os-crm/scripts/verify-os-crm.sh          # usage
RUN_ID=$RUN_ID CRM_URL=http://127.0.0.1:<web> SEED_ADMIN_PASSWORD=... \
  node .cursor/skills/verify-os-crm/scripts/crm-browser.mjs <steps.json> <out-prefix>
```

Env knobs: `RUN_ID` (default `default`), `OSCRM_VERIFY_SCRATCH` (default `/tmp/os-crm-verify`), `OSCRM_VERIFY_EVIDENCE` (default `$HOME/os-crm-verify-evidence`), `OSCRM_SEED_PASSWORD` (default random), `OSCRM_MYSQL_IMAGE` (default `mysql:8.4`), `OSCRM_DOCKER_NETWORK=host|publish` (default `host` on Linux, `publish` elsewhere), `DOCKER`, `CHROME_BIN`.

Known traps from the box this skill was proven on (Debian 13, Node 24.22, Docker via `sudo -n`):

- `docker run -p` was silently ignored (container up, no port published, Prisma `P1001`), hence host networking by default.
- antd modals animate in; the browser helper waits for the target to stop moving and asserts focus landed in the input before typing.
- Nest `ConfigModule` and Prisma also read the repo-root `.env` if one exists. Variables the helper sets win; it also forces third-party credentials (DingTalk/Feishu/DashScope/Yonyou/OSS) to empty so a developer `.env` cannot leak real keys into a run.

Maintenance: keep `features/` honest as the app changes with `/maintain-verification-skill`.
