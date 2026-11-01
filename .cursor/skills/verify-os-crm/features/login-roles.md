# Login and role workbenches

A user picks one of four demo roles on the login card, signs in with the seeded password, and lands on a role-specific workbench; the left menu and data scope differ per role, and admin-only pages refuse other roles.

## Sub-features

- `login-ui` signs in from `/login` via the role tabs (`admin`, `销售主管`, `销售`, `老板`) and `登录`.
- `login-bad-password` keeps the user on `/login` with an error toast.
- `dashboard-role` shows heading `系统管理工作台` (admin), `团队经营工作台` (manager), `我的销售工作台` (sales) or `经营驾驶舱` (boss).
- `menu-admin-only` shows `审批设计器`, `钉钉 / 飞书`, `系统管理` only to admin; other roles get `无权访问` on those routes.
- `login-api` returns `data.accessToken` from `POST /api/v1/auth/login` for all four roles.

## How to get to it (user POV)

- Open `$CRM_URL/` (redirects to `/login` when signed out, `/dashboard` after login).
- Top-right avatar dropdown signs out.
- Scripts: `deploy/verify.mjs` logs in all four roles over HTTP.

## Driving it with verify-os-crm

Preconditions:

- Baseline state; `eval "$($V env)"` so `SEED_ADMIN_PASSWORD` is in the environment (the helper types it, never logs it).

- **Sales login.** Use step `{"login":"sales"}` (first step of `journeys/customers-create.json`). Path becomes `/dashboard`; shot `01-dashboard` shows `我的销售工作台` and role badge `销售`.
- **Other roles.** Write a steps file `[{"login":"boss"},{"waitText":"经营驾驶舱"},{"shot":"boss"}]` and run `$V ui login-boss <file>`; repeat for `admin` (`系统管理工作台`) and `manager` (`团队经营工作台`).
- **Admin-only route.** As sales, `{"goto":"/system"}` then `{"waitText":"无权访问"}`; as admin the same route shows 系统管理 with tabs including `组织部门` (人员与部门管理).
- **Bad password.** Steps `{"goto":"/login"}`, `{"fill":"密码","value":"wrong-${RUN_ID}"}`, `{"click":"登录"}`, `{"expectUrl":"/login"}`, `{"shot":"bad-password"}`. Still on `/login` with an error message.
- **HTTP all roles.** Run `$V acceptance`. `cli/acceptance.stdout` lists `admin|manager|sales|boss: login, overview and schemas OK` and `Deployment read-only acceptance passed.`

## Gotchas

- Auth lives in `sessionStorage`; each `$V ui` run is a fresh Chrome profile, so every steps file must start with a `login` step.
- The login card defaults to `admin`; a role tab click only changes the username field.
- The seeded password is random per launch (or `OSCRM_SEED_PASSWORD`); it is not `.local/演示账号.md`'s value.
- Login lockout/Redis blacklist are TODOs in `auth.service.ts`; do not expect lockout after repeated failures.
- Re-proven 2026-11-02: four role dashboards, sales forbidden on `/system`, admin system shows `组织部门`.
