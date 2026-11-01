# C11 本地演示与安装交付

当前交付为2026-11-01 C11工程候选，源码MIT开源，尚未生产验收。应用包版本仍是0.2.0-demo.2，工程版本以总包MANIFEST.json中的源码提交及迁移清单识别。历史v0.2.0-demo.2完整包继续保留，新包不覆盖历史资产。

## 内容与阅读顺序

[当前交付材料](releases/C11/README.md)包含24页可编辑PPT、22页逐项功能操作手册、2页演示手册、4页AI接入说明、4页部署手册，手册同时提供DOCX、HTML和Markdown。页数为本轮捆绑LibreOffice字体配置下的实际渲染结果，其他Office环境可能重新分页。

完整ZIP另包含干净提交的全部源码、冻结锁文件、15个迁移、种子、部署脚本和预构建API/网页；保留原九张总体截图，并加入15张C2—C11专题截图。截图来自演示或合成企业，早期截图中的功能限制须结合当前手册解读。

先读总包00_先读我.html，再按本地部署手册选择演示或空企业安装。首次安装需要联网；不内置Node、MySQL、Docker镜像或node_modules，不是离线首装包。

## 演示安装

安装Docker Engine/Desktop与Compose v2。macOS/Linux设置`SEED_ADMIN_PASSWORD=12345`后运行`sh deploy/start.sh`；Windows PowerShell设置同名环境变量，运行`./deploy/start.ps1`。完整包额外提供本地部署.command/.sh/.ps1入口。

脚本首次生成独立基础密钥到忽略文件deploy/.env，初始化四角色及演示业务；之后重启保留卷和账号。打开http://localhost:3000，admin、manager、sales、boss四个演示账号密码均为12345。不要用此公开密码安装正式企业。

只读检查：`node --env-file=deploy/.env deploy/verify.mjs`。停止使用`docker compose --env-file deploy/.env -f deploy/compose.yml down`，不添加删除卷选项。端口冲突时修改WEB_PORT；创建副本应使用独立Compose项目、端口与卷。

## 空企业安装及恢复

按[正式安装手册](PRODUCTION_INSTALL.md)使用start-production入口，设置企业编码、名称和独立强密码。只创建初始管理员和基础配置，不灌演示客户。新生成的正式配置、企业数据和备份不上传Git。

升级先备份、停止旧API、执行增量迁移，再启动同版API/网页并核对ready及角色读取；不对已有库重播种子。加密备份包含C10附件二进制，恢复到全新库、保留原库、轮换会话签名。新会签定义需要支持users_all的同版API，不能原地降级覆盖。

## AI能力与边界

规则摘要未接大模型。人工MCP入口保留7个只读工具；独立委托入口提供customer.search/get、action.propose/execute和同委托回执读取。代理提交建议后，原委托人核对批准，代理再执行共享业务事务；不提供代理审批、财务、银行税务或外发操作。详见[AI操作说明](AGENT_DELEGATION_OPERATIONS.md)。

本地收款台账已可人工登记、独立复核、核销撤销和同凭据更正；税务、会计、银行与退款仍未开放。钉钉飞书真实接口已有代码，尚未取得测试企业凭证和完成真实联调。

## 校验与验证范围

包内SHA256SUMS.txt覆盖逐文件内容，包外.sha256核对整个ZIP；[本轮验收记录](releases/C11/VALIDATION.md)标明实际源码和检查链接。打包脚本拒绝脏工作树、私有目录和符号链接；不复制.env、数据库、令牌、原机备份、node_modules或.git。

已验证macOS原生Node24/MySQL8.4及Linux Docker正式/演示构建、初始化、重启与恢复；Windows/macOS Docker未实机验收。容量、渗透、完整运维告警、外部企业接入和产品负责人最终验收仍待完成。
