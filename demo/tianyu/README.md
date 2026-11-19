# 天雨阀门 · AI操作型CRM公开场景 v2

公司、人员、联系方式、材料、交易和审批全部虚构，用于产品演示与测试，不是真实企业的脱敏副本。基准日期2026-11-16。

## 精简规模

| 对象 | 基础数量 |
| --- | ---: |
| 客户 / 私海客户 / 联系人 | 15,000 / 3,000 / 6,000 |
| 线索 / 商机 / 跟进 | 240 / 2,400 / 9,000 |
| 产品 / 合同 / 订单 | 48 / 360 / 240 |
| 基础审批 / 回款计划 / 开票 / 收款 | 1,080 / 960 / 660 / 182 |
| 项目 / 里程碑 / 项目任务 | 84 / 336 / 336 |
| 基础行动 / 日程 | 120 / 42 |
| 角色账号 / 部门（含管理部） | 14 / 5 |

客户减少75%，商机减少73%，合同减少70%。保留标准件、定制件、长周期交付、渠道甲方、分期款、质保款和资源掉单等链路。追加包另含12个业务故事、58份虚构源材料、82条知识、34条历史跟进、36项AI行动及对应36项本地日程；8个新案例只生成6个新商机和1份未签草稿，不重复已有成交收入。

## 账号与权限

本机入口：<http://localhost:3000/login?company=TIANYU>。老板`ty_boss`、华东主管`ty_mgr_east`、销售`ty_sales01`至`ty_sales06`、渠道`ty_channel`、项目`ty_pm`、技术`ty_engineer`、财务`ty_finance`、管理员`admin`。全部公开演示密码`12345`，仅供测试帐套。完整账号见manifest.json。

老板与管理员默认全公司；主管默认部门和下属；销售默认本人。筛选、穿透和导出沿用同一权限范围。

## 首次安装顺序

先按[本地多公司安装](../../docs/LOCAL_COMPANY_INSTALL.md)创建独立数据库、独立账号、编码TIANYU、用途test的空帐套，再执行：

```sh
node scripts/tianyu-demo.mjs --apply --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
# 启动网站后，追加经应用服务校验的历史、计划和审批
node scripts/tianyu-ai-workflow.mjs --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
node scripts/tianyu-approval-scenarios.mjs --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
```

两项追加命令默认连接本机3000端口，可用`--base-url http://127.0.0.1:端口`指定本地服务。配置、密钥和执行回执仅在本机保存。脚本拒绝业务用途、其他公司和远程数据库。基础v2只能装入空帐套；旧v1应备份后另建数据库切换，不能覆盖真实业务或已有操作。回执实现断点继续及重放去重，请保留本机回执文件。

## 展示路径

1. 产品介绍（历史资料已归档）：AI输入、历史过程、未来计划、经营闭环。
2. [AI场景与资料](ai-workflow/README.md)：12个完整故事及来源证据。
3. [审批操作说明](APPROVAL_GUIDE.md)：36类流程、246张申请、16项表单。
4. 看板进入客户与商机，查看历史报价、跟进和下一步；未知金额不填零，不进入确定收入。
5. 合同应收、开票应收、已回款分别查看，再进入计划和核销单据。
6. 智能体通过授权接口操作，流程决定由实际审批角色作出；本演示无任何外部消息、钉钉待办或会议邀请。

## 重新生成与验证

```sh
pnpm demo:tianyu:export
pnpm public:audit
node --test demo/tianyu/generate.test.mjs demo/tianyu/ai-workflow/generate.test.mjs
# 仅在独立、空的 tb_crm_test_tianyu_* MySQL库中执行
SMOKE_ALLOW_WRITES=true node scripts/tianyu-workflow-smoke.mjs
```

数据生成器只读公开合成源，不读取任何实际公司数据库、聊天或文件。数据哈希见manifest.json；实际MySQL及HTTP验证摘要见verification.json。

## 可选：为全部基础业务补足下一步

以下命令只处理固定天雨基础编号，新增AI故事保留自己的来源和计划。先运行基础商机行动，再运行合同路径，最后确认已签阀门业务分类；已存在的计划及分类复用，不外发。

```sh
node scripts/tianyu-opportunity-actions.mjs --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
node scripts/tianyu-business-plans.mjs --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
node scripts/tianyu-trade-classification.mjs --company-config .local/accounts/TIANYU.json --confirm-fictional-tianyu
```

新增计划日期为安装当日之后的拟定时段，不是实际客户承诺。未签的AI整理草稿不确认为已签业务。
