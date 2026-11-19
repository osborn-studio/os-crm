# 当前交付与打包

当前交付统一为通用源码、部署入口、天雨2.0数据及生成器、AI资料工作流、审批场景和操作文档。旧版C11及v0.2重复包不作为当前入口。

## 接收方安装

先阅读[本地多公司安装](LOCAL_COMPANY_INSTALL.md)或[正式Docker安装](PRODUCTION_INSTALL.md)。正式企业初始化为空，使用独立随机密钥及强密码。天雨必须单独创建TIANYU测试帐套，按[演示说明](../demo/tianyu/README.md)初始化。手机通过浏览器/H5访问，外网需另配HTTPS或VPN。

## 打包当前版本

```sh
pnpm check
pnpm public:audit
# 提交已审核的通用代码与天雨资料后：
python3 scripts/package-candidate.py /absolute/new/output-directory
```

打包器只复制干净提交内经审核的文件及既有预构建产物，拒绝私有目录、环境文件、数据库备份和符号链接。包内保留源码提交、逐文件SHA、数据归属及明确的虚构演示标记，不复制本机公司连接、真实企业资料、依赖目录或Git历史。

首装需要联网准备Node24/pnpm11/MySQL8，或Docker及Compose。当前资料与测试通过不等同完整生产上线验收；正式企业接入、容量和外网按实际环境验证。
