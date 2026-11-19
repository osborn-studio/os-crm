# tb-crm · 伴圆 CRM

面向 B2B 销售与交付的 CRM，沿用 PartnerOS 原型的业务设计。目标是让网页和智能体使用同一套可验证的业务能力。

**当前版本：0.3.0本地公司帐套与销售回款分析候选，完整商用验收尚未完成。**

新增[客户分配与功能/数据权限配置](docs/ACCESS_PERMISSIONS_AND_ALLOCATION.md)：人员有效权限、销售/主管业务矩阵和数据范围、批量分配预览、事务提交及历史；新增[个人日程与钉钉审批提醒](docs/DINGTALK_ACTIVITY_OPERATIONS.md)，提供本人配置、持久发送、自动扫描和失败对账。

新增[钉钉本机组织同步](docs/DINGTALK_SYNC.md)：公司专属授权、预览、对照表、事务导入与记录；日程及审批提醒见[操作说明](docs/DINGTALK_ACTIVITY_OPERATIONS.md)。

新增[销售预测与回款操作说明](docs/reporting/OPERATIONS.md)：精确到分的阶段预测、月度计划/实收、账龄和年度矩阵；签约须填写真实分期条款。新增[本地多公司安装与外网配置](docs/LOCAL_COMPANY_INSTALL.md)，公司独立MySQL库及账号，网页适配手机H5。

新增[组织与客户质量规则](docs/ORG_CUSTOMER_QUALITY.md)及[正式/测试帐套操作说明](docs/TEST_COMPANY_GUIDE.md)：部门树、人员角色、创建人归属、客户分配/整体交接、同名/证照查重和其他相似提示。正式业务与丰富测试资料使用独立数据库。

2026-11-15 新增[Salesforce销售CRM对齐设计与工程计划](docs/design/salesforce-alignment/README.md)：含完整功能待办、蓝白灰界面设计、操作便利性、分批建设和验收；大部分仍为设计待办；已实现范围以当前进度和操作说明为准。


继续建设以[商用验收清单与阻断项](docs/COMMERCIAL_ACCEPTANCE.md)为准；依赖修复和CI门槛见[依赖安全说明](docs/DEPENDENCY_SECURITY.md)。

2026-11-01 开始商用建设，按[分批计划与验收门槛](docs/COMMERCIAL_PLAN.md)推进。新增[正式安装与加密备份恢复基础候选](docs/PRODUCTION_INSTALL.md)，独立空企业初始化，不灌入演示业务；整套商用闭环尚未完成。每次较大改进验证后同步 `osborn-studio/os-crm` 的功能分支和 PR。

第二批新增[人员与会话管理](docs/IDENTITY_OPERATIONS.md)：组织/账号维护、四种预置角色、调岗/停用、密码修改/重置、服务端登出与刷新轮换、登录失败限制和审计。升级新增会话表后，旧令牌需要重新登录。

第三批新增[客户导入、销售整体交接、报价版本与合同变更审批](docs/CUSTOMER_CONTRACT_OPERATIONS.md)。首批只处理尚无下游执行的合同变更，复杂补偿仍在建设。

第四批新增[交付任务、里程碑、双人验收与拒收整改](docs/DELIVERY_ACCEPTANCE_OPERATIONS.md)。结果说明、累计工时及历次决定保留记录；附件和售后见后续增量，复杂取消补偿仍在建设。

交付增量支持项目经理与未完成工作整体交接、任务转派、停用/调岗前交接检查，并补齐正式销售的订单/项目执行权限。

第五批新增[本地收款登记、核销及更正](docs/RECEIVABLE_LEDGER_OPERATIONS.md)：另一管理员复核、精确分摊、撤销及作废；更正生成同凭据的新待复核登记，保留原值和完整链路。银行、税务、会计、退款仍未开放。

第六批新增[审批转审与人员交接](docs/APPROVAL_TRANSFER_OPERATIONS.md)：当前审批人转交、管理员恢复后续节点、旧节点/原因及处理历史保留，转审后仍需实际审批。

审批继续新增[指定人员会签](docs/APPROVAL_COUNTERSIGN_OPERATIONS.md)：同节点2—8位人员全员同意后流转，任一驳回终止，保留独立意见、转审、并发回执和最终业务回调；加签与超时/外发仍待建设。

第七批新增[独立智能体委托与受控行动](docs/AGENT_DELEGATION_OPERATIONS.md)：限时凭证、调用预算、预演、原委托人批准、共享服务执行、回执和未完成行动补偿。官方MCP客户端可实际调用；工作台摘要仍为规则生成，未接大模型。

交付后续新增[售后服务工单](docs/SERVICE_TICKET_OPERATIONS.md)：已验收项目提交、指派/转派、处理、解决方案、独立复核关闭、退回重办、站内通知与历史；未交接工单阻止停用。SLA/外发仍待建设。

继续新增[私有证据附件](docs/PRIVATE_ATTACHMENT_OPERATIONS.md)：项目/任务/售后受限上传下载、Hash、撤回留痕、审核冻结与验收快照，二进制随加密数据库备份恢复。首版单文件1MiB、企业保留16MiB，尚无病毒扫描、大文件或自动归档。

- admin、销售主管、销售、老板四角色及按人/团队/租户过滤的数据。
- 客户、联系人、公私海、线索转化、跟进、行动、商机报价、合同、订单、项目任务和验收主线。
- 通用审批设计器：表单、顺序节点、条件、版本、发布/预演；合同/订单/立项审批回调，驳回与撤回，站内通知。
- 财务前端区分本地收款台账与尚未开放的税务、会计等功能展示。
- 9个只读人工MCP工具及1个受控审批申请工具、按委托开放的受限工具、业务HTTP契约，关键写入事务/幂等/并发校验/审计。
- 钉钉本机DWS组织/人员预览、对照与真实导入已联调；企业应用高级接口与飞书仍待真实企业联调。

[验证与限制](docs/PROGRESS.md) · [钉钉/飞书配置](docs/INTEGRATIONS.md)

接收方部署优先阅读[交付与Docker启动说明](docs/DELIVERY.md)。[C11新版材料](docs/releases/C11/README.md)提供24页可编辑PPT和四套操作/演示/AI接入/部署手册；总包包含原九张总体截图及15张专题截图。首次安装需要联网，不是通用离线首装包。

新增[整套本机备份恢复与macOS服务守护](docs/operations/LOCAL_RECOVERY.md)：独立新库恢复、逐表及附件Hash核对、会话撤销、外发关闭、进程故障恢复。

新增[原生Excel与CSV导出](docs/operations/SPREADSHEET_EXPORT.md)：文本与金额明确类型，表头冻结筛选，当前权限与当前页范围。

新增[AI智能体读取预测与回款](docs/operations/AGENT_REPORT_READS.md)：独立限时/限预算委托、当前权限及跨公司隔离，HTTP/MCP共用业务报表，只有明确选择才能读取。

新增[局域网钉钉原生审批说明](docs/operations/DINGTALK_NATIVE_APPROVAL.md)：逐单预演确认发送、手机原生审批及本机主动读取；真实手机人工闭环待验收。

新增[日期筛选、渠道标记与通用或签操作说明](docs/operations/BUSINESS_WORKFLOW_DATES.md)。

新增[统计人员范围与数据权限](docs/operations/STATISTICS_DATA_SCOPE.md)：统计按角色默认本人、部门及下属团队或全公司，指定人员、部门、全公司由实时后端权限控制，钻取、导出及MCP保持相同范围。

新增[业务和统计正反序排序](docs/operations/BUSINESS_SORTING.md)：日期、金额、名称等排序，分页列表在服务端排序后分页，保留现有数据权限。

新增[合同、回款与渠道业绩口径](docs/operations/BUSINESS_CASH_METRICS.md)：五项实际金额、渠道甲方往来与单列软件返佣、保留原报价的我方金额拆分、透明规则回款安排及同权限智能体只读报表。

## 本地安装与访问

先阅读[公司帐套、手机H5及外网配置说明](docs/LOCAL_COMPANY_INSTALL.md)。需要Node.js 24、pnpm 11.25.0和本机MySQL 8。

```sh
pnpm install --frozen-lockfile
pnpm --filter @partneros/database generate
pnpm local:start
```

本机可双击`启动系统.command`。业务入口为`http://localhost:3000`，服务器本机管理入口为`http://localhost:3000/__accounts`。公司帐套独立数据库、独立连接用户和登录密钥。首次创建只初始化必要主数据与管理员，业务为空；员工通过公司编码登录。局域网地址由配置页面按当前网卡显示。

系统管理提供“公司帐套 / 外网配置”入口；支持保存HTTPS/VPN入口、生成代理配置及本机自检。当前没有外部入口，实际外网与手机网络联通待验证。保存域名不会自动部署VPN或证书。

## 开发与接续

- [工程规则](AGENTS.md)
- [架构基线](docs/architecture.md)
- [当前进度与验证记录](docs/PROGRESS.md)
- [建设路线](docs/ROADMAP.md)

原始需求资料在本机 `docs/reference/`，由 Git 忽略。按用户明确授权，历史 Release 的完整公开归档另含原始设计、原型、本机演示配置和演示数据库；这些公开密钥不能用于正式安装。新正式安装配置、企业数据与备份默认不提交 Git，使用独立随机密钥。

## 开源许可

本项目采用 [MIT License](LICENSE)。工作区包的 `private: true` 用于防止误发布到 npm，不影响 GitHub 仓库的公开状态。
