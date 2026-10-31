# 正式安装与恢复基础候选

本入口从空库安装企业环境，区别于 `deploy/start.sh` 演示入口。它尚未完成商用验收，功能边界及后续批次见 [建设计划](COMMERCIAL_PLAN.md)。已发布的演示密钥和数据库快照继续作为公开演示资料保留，正式环境使用此入口生成全新独立配置。

## 首次安装

需要 Docker Engine/Desktop、Compose v2；首次需联网。备份恢复宿主机另需 Node.js 24。

macOS/Linux：

```sh
export TENANT_CODE=MYCOMPANY
export TENANT_NAME='我的企业'
# 自行设置唯一的管理员密码：12至72位，含大小写字母和数字。
# 支持的符号：! @ # % ^ * + _ . -
export SEED_ADMIN_PASSWORD='替换为自己的强密码'
sh deploy/start-production.sh
```

Windows PowerShell：

```powershell
$env:TENANT_CODE = 'MYCOMPANY'
$env:TENANT_NAME = '我的企业'
$env:SEED_ADMIN_PASSWORD = '替换为自己的强密码'
./deploy/start-production.ps1
```

示例中的中文提示不是合格密码，必须自行替换。配置写入被 Git/Docker 忽略的 `deploy/production.env`；已存在文件不覆盖。数据库口令、JWT、业务加密密钥和备份密钥分别随机生成。企业名称不支持引号、反斜线、美元符号或井号，防止跨平台环境文件解释不一致。

默认网页绑定 `127.0.0.1:3000`，数据库不映射宿主端口；与演示系统同时运行时先设置不同的 `WEB_PORT` 和 `APP_URL`。从本机打开地址，输入安装时的企业编码、管理员用户名（默认 `admin`）及自行设置的密码。初始化只创建企业、四种角色、管理部、管理员、公海和商机阶段，不创建演示客户、合同或财务记录。重启不修改用户、密码或业务数据。

```sh
node --env-file=deploy/production.env deploy/verify-production.mjs --expect-empty
```

这条验收命令只读取；`--expect-empty` 仅首次空安装使用。正式外部访问应通过 HTTPS 反向代理连接本机端口，并设置 HTTPS 的 `APP_URL`；本入口不会配置域名、证书或公网端口。人员管理完整闭环正在后续 C2 建设。

## 加密备份

```sh
node --env-file=deploy/production.env deploy/data.mjs backup backups/company-20261101.crmbackup
```

备份通过 MySQL 事务一致性导出，包含表结构、数据、迁移历史和应用恢复所需配置，再压缩并以独立 `BACKUP_KEY` 用 AES-256-GCM 加密认证。不会覆盖已有备份。文件与目录以仅当前用户访问权限创建；第一版 SQL 导出上限为 128 MiB。此方案需要保持备份时不运行数据库迁移等 DDL。

单独离线保管 `BACKUP_KEY` 和配置文件，至少将加密备份复制到另一台设备。备份文件本身不包含备份密钥。遗失密钥无法解密恢复。未实现的附件存储不在数据库备份范围，后续附件功能上线时需一起扩展备份。

## 恢复演练

```sh
node --env-file=deploy/production.env deploy/data.mjs restore backups/company-20261101.crmbackup tb_crm_restore_drill
```

恢复先完整验证密钥、认证标签、格式、SQL 校验值及 schema 指纹，再创建全新 `tb_crm_restore_*` 数据库并导入。已有目标库直接拒绝，不删除、不清空、不覆盖原库。导入失败时保留未推广的目标库，修复原因后使用另一个新库名重试。

成功时在备份旁生成 `.receipt.json` 和 `.env`，记录恢复时间、源与目标库、表数量及配置路径。恢复配置保留备份中的业务加密密钥，以读取原来加密的内容；使用当前服务器数据库口令，重新生成 JWT 签名密钥使旧会话失效。不自动切换运行中的系统。

请先在独立 Compose 项目和端口验收恢复库。正式切换前停止应用写入、保留当前配置和原库、另做一次备份，并核对用户、客户、合同、应收余额、审批和审计；切换时人工将验收通过的恢复配置作为新的配置文件运行相同 Compose 项目。恢复配置不含原卷，必须在实际恢复的 MySQL 服务器上使用。更换 Compose 项目会创建独立数据库卷，必须另外导入备份，不能只复制环境文件。

```sh
# 在当前数据库服务中切换到已经验收的恢复库；只有操作人员完成验收后执行。
# docker compose --env-file backups/company-20261101.crmbackup.tb_crm_restore_drill.env -f deploy/compose.production.yml up -d --wait
```

schema 指纹不一致时先用备份对应的源码版本恢复并验收，再运行经过测试的升级迁移。不要用旧数据库覆盖已升级中的正式库。未实现自动调度备份、附件备份、跨版本回滚或高可用；这些属于后续商用验收范围。
