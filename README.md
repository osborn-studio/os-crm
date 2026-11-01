# tb-crm · 伴圆 CRM

面向 B2B 销售与交付的 CRM，沿用 PartnerOS 原型的业务设计。目标是让网页和智能体使用同一套可验证的业务能力。

**当前阶段：v0.2本地演示与数据测试版，尚未生产验收。**

继续建设以[商用验收清单与阻断项](docs/COMMERCIAL_ACCEPTANCE.md)为准；依赖修复和CI门槛见[依赖安全说明](docs/DEPENDENCY_SECURITY.md)。

2026-11-01 开始商用建设，按[分批计划与验收门槛](docs/COMMERCIAL_PLAN.md)推进。新增[正式安装与加密备份恢复基础候选](docs/PRODUCTION_INSTALL.md)，独立空企业初始化，不灌入演示业务；整套商用闭环尚未完成。每次较大改进验证后同步 `osborn-studio/os-crm` 的功能分支和 PR。

第二批新增[人员与会话管理](docs/IDENTITY_OPERATIONS.md)：组织/账号维护、四种预置角色、调岗/停用、密码修改/重置、服务端登出与刷新轮换、登录失败限制和审计。升级新增会话表后，旧令牌需要重新登录。

第三批新增[客户导入、销售整体交接、报价版本与合同变更审批](docs/CUSTOMER_CONTRACT_OPERATIONS.md)。首批只处理尚无下游执行的合同变更，复杂补偿仍在建设。

第四批新增[交付任务、里程碑、双人验收与拒收整改](docs/DELIVERY_ACCEPTANCE_OPERATIONS.md)。结果说明、累计工时及历次决定保留记录；附件、售后及复杂取消补偿仍在建设。

交付增量支持项目经理与未完成工作整体交接、任务转派、停用/调岗前交接检查，并补齐正式销售的订单/项目执行权限。

第五批新增[本地收款登记、核销及更正](docs/RECEIVABLE_LEDGER_OPERATIONS.md)：另一管理员复核、精确分摊、撤销及作废；更正生成同凭据的新待复核登记，保留原值和完整链路。银行、税务、会计、退款仍未开放。

第六批新增[审批转审与人员交接](docs/APPROVAL_TRANSFER_OPERATIONS.md)：当前审批人转交、管理员恢复后续节点、旧节点/原因及处理历史保留，转审后仍需实际审批。

第七批新增[独立智能体委托与受控行动](docs/AGENT_DELEGATION_OPERATIONS.md)：限时凭证、调用预算、预演、原委托人批准、共享服务执行、回执和未完成行动补偿。官方MCP客户端可实际调用；工作台摘要仍为规则生成，未接大模型。

交付后续新增[售后服务工单](docs/SERVICE_TICKET_OPERATIONS.md)：已验收项目提交、指派/转派、处理、解决方案、独立复核关闭、退回重办与历史；未交接工单阻止停用。附件与SLA/外发仍待建设。

继续新增[私有证据附件](docs/PRIVATE_ATTACHMENT_OPERATIONS.md)：项目/任务/售后受限上传下载、Hash、撤回留痕、审核冻结与验收快照，二进制随加密数据库备份恢复。首版单文件1MiB、企业保留16MiB，尚无病毒扫描、大文件或自动归档。

- admin、销售主管、销售、老板四角色及按人/团队/租户过滤的数据。
- 客户、联系人、公私海、线索转化、跟进、行动、商机报价、合同、订单、项目任务和验收主线。
- 通用审批设计器：表单、顺序节点、条件、版本、发布/预演；合同/订单/立项审批回调，驳回与撤回，站内通知。
- 财务前端区分本地收款台账与尚未开放的税务、会计等功能展示。
- 7个只读MCP工具、业务HTTP契约，关键写入事务/幂等/并发校验/审计。
- 钉钉、飞书真实鉴权和通讯录预览接口，企业凭证与实际联调待提供。

[演示操作手册](docs/DEMO_GUIDE.md) · [验证与限制](docs/PROGRESS.md) · [钉钉/飞书配置](docs/INTEGRATIONS.md)

接收方部署优先阅读[交付与Docker启动说明](docs/DELIVERY.md)。总包提供9张功能截图、Demo PPT和完整操作/演示/AI接入/部署手册。首次安装需要联网，不是通用离线首装包。

## 本地开发

需要 Node.js 24、pnpm 11.25.0、MySQL 8（可通过 Docker Compose 启动）。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# 设置随机 JWT_SECRET、ENCRYPTION_KEY、SEED_ADMIN_PASSWORD；填写 DATABASE_URL。
# 演示环境设置 DEMO_MODE=true；Docker还需设置MYSQL_ROOT_PASSWORD与MYSQL_PASSWORD。
docker compose up -d mysql redis
pnpm --filter @partneros/database generate
pnpm --filter @partneros/database migrate:deploy
pnpm demo:seed
pnpm build
pnpm demo:start
```

本机也可双击 `启动演示.command`。Web：`http://localhost:3000`；API文档：`http://localhost:4000/api/docs`。
演示账号：`admin`、`manager`、`sales`、`boss`，密码为本机配置的 `SEED_ADMIN_PASSWORD`；租户编码默认 `TINGMENG`。本机账号说明保存在Git忽略的 `.local/演示账号.md`。

```sh
pnpm check   # 类型检查、lint、测试、构建
```

真实数据库冒烟测试仅允许写入名称含 `test` 的临时数据库：完成 migration/seed/build 后，设置 `SMOKE_ALLOW_WRITES=true`，运行 `node --env-file=.env scripts/smoke.mjs`。

## 开发与接续

- [工程规则](AGENTS.md)
- [架构基线](docs/architecture.md)
- [当前进度与验证记录](docs/PROGRESS.md)
- [建设路线](docs/ROADMAP.md)

原始需求资料在本机 `docs/reference/`，由 Git 忽略。按用户明确授权，历史 Release 的完整公开归档另含原始设计、原型、本机演示配置和演示数据库；这些公开密钥不能用于正式安装。新正式安装配置、企业数据与备份默认不提交 Git，使用独立随机密钥。

## 开源许可

本项目采用 [MIT License](LICENSE)。工作区包的 `private: true` 用于防止误发布到 npm，不影响 GitHub 仓库的公开状态。
