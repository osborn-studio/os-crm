# 伴圆 CRM · AI 操作型客户管理系统

让 AI 根据使用人明确授权的工作资料，整理客户历史、形成跟进记录，并安排未来行动和日程。

## 为什么开发

客户信息分散在沟通、听记、PPT、报价与合同中，反复手工录入容易遗漏。系统把这些资料与客户、商机、合同、交付和收款关联起来，让团队看清做过什么、目前到了哪一步、下一步由谁推进。

AI通过受控应用服务操作，沿用人员的数据权限，保留来源、版本和执行回执。审批决定、合同签署、验收和实际到账由真实人员与凭据确认。

## 功能

- 客户与联系人、公私海、去重、客户分配、整体交接和部门组织。
- 商机看板、报价版本、跟进、行动计划和业务日程。
- 通用审批设计器、顺序审批、或签、会签、驳回、撤回及转审。
- 合同、订单、项目任务、里程碑、验收整改及售后。
- 合同总额、已收、待收，开票总额、已收、待收，以及在建项目金额；日期、人员筛选、排序及穿透明细。
- 钉钉组织对照、本人日程待办和原生审批连接配置。真实连接按企业权限和授权联调。
- 本地B/S与手机H5，每家公司独立MySQL数据库和连接账号。

## 手册

- [完整操作手册](docs/manuals/USER_GUIDE.md)：按角色、入口、操作步骤及排查方法说明。
- [天雨演示手册](docs/manuals/DEMONSTRATION_GUIDE.md)：12个场景及5、20、45分钟讲解路线。
- [设计目的与系统边界](docs/SYSTEM_PURPOSE.md)。
- [安装、运维和专题操作索引](docs/INDEX.md)。
- [AI调用方式](docs/AI_OPERATED_CRM.md)、[工程架构](docs/architecture.md)。

## 安装

需要Node.js 24、pnpm 11.25.0、MySQL 8。首次安装需要联网。

```sh
pnpm install --frozen-lockfile
pnpm --filter @partneros/database generate
pnpm build
pnpm local:start
```

打开 http://localhost:3000 。先按[本地多公司安装](docs/LOCAL_COMPANY_INSTALL.md)创建独立公司。正式公司从空库开始；[Docker安装](docs/PRODUCTION_INSTALL.md)与[备份恢复](docs/operations/LOCAL_RECOVERY.md)另见操作说明。

## 测试数据与开发

公开业务样本仅有虚构的天雨阀门数据，账号密码12345仅用于隔离测试。不存在町萌网络的真实客户、合同、聊天、日程、数据库、备份或企业凭据。安装天雨样本见[数据说明](demo/tianyu/README.md)。

```sh
pnpm check
pnpm public:audit
```

仓库保留源码、迁移、构建测试、部署文件、操作文档和必要合成样本。宣传页面、模拟对话图片、旧规划与重复发布材料不再随源码分发。真实企业联调与生产验收应分别核验，采用[MIT许可](LICENSE)。
