# 钉钉与飞书企业应用接口（高级）

当前页面另有独立的“钉钉本机同步”页签，已通过已授权正式公司真实组织/人员导入，说明见[DINGTALK_SYNC.md](DINGTALK_SYNC.md)。下文仅针对AppKey/AppSecret企业应用高级接口，不代表本机DWS同步未实现。

当前实现：应用令牌获取与缓存、部门查询、成员分页预览、超时/限流处理、失败状态。请求使用固定的官方API域名，凭证只从服务器环境读取，并绑定单个CRM租户；返回结果不包含访问令牌或应用密钥。

官方参考：[钉钉企业应用令牌](https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app)、[钉钉部门列表](https://open.dingtalk.com/document/orgapp/obtain-the-department-list-v2)、[飞书应用令牌](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)、[飞书部门成员](https://open.feishu.cn/document/server-docs/contact-v3/user/find_by_department)。

在本机 `.env` 填写以下配置后重启API。值由企业应用管理员提供，不放入公开仓库：

```dotenv
DINGTALK_TENANT_ID=1
DINGTALK_APP_KEY=your-app-key
DINGTALK_APP_SECRET=your-app-secret
FEISHU_TENANT_ID=1
FEISHU_APP_ID=your-app-id
FEISHU_APP_SECRET=your-app-secret
```

平台应用需开通相应的通讯录读取权限和可见范围，钉钉按平台要求配置IP白名单。`TENANT_ID`必须与登录用户的CRM租户一致，其他租户无法借用这些凭证。

admin在“钉钉 / 飞书”页面操作：

1. 连接测试：实际请求应用令牌；成功仅证明鉴权通过，不等于通讯录权限通过。
2. 部门预览：可填写父部门编号；默认钉钉1、飞书0。
3. 成员预览：输入部门编号，查看平台返回的姓名和外部编号，不采集不必要的电话邮箱。

API：`GET /integrations`、`POST /integrations/{provider}/test`、`GET /integrations/{provider}/departments`、`GET /integrations/{provider}/directory`。provider仅允许dingtalk/feishu。预览返回`hasMore`与`nextCursor`，下一页传`cursor`；前端当前显示第一页并提示分页情况。

未配置或平台报错时返回明确失败，不返回伪造的已连接或同步成功。`POST /integrations/{provider}/sync`暂未开放，不导入用户、不发送消息、不回写审批。

验证边界：自动化测试覆盖配置缺失、跨租户凭证隔离、平台错误与令牌成功响应的模拟协议测试。因未配置真实企业凭证，实际企业鉴权、通讯录范围和分页结果尚待联调；不能把代码或模拟测试视为真实企业验收。
