import re,json,html,hashlib,shutil
from pathlib import Path
from docx import Document
from docx.shared import Inches,Pt,RGBColor,Cm
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path(__file__).resolve().parents[4]
BUILD=ROOT/'.artifacts/delivery-c11/build'
OUT=ROOT/'docs/releases/C11'
OUT.mkdir(parents=True,exist_ok=True)
BASE='0908c6b636b8e240a38ef7365b0a5c344d3a970c'
INTRO='C11 · 2026-11-01 工程候选。源码公开、可本地安装；演示与合成测试结果不等于客户验收或生产上线。应用包版本仍为0.2.0-demo.2，以本包源码提交及迁移记录识别工程版本。'
resources=json.loads((Path(__file__).parent/'resources.json').read_text())

def source(name,stop=None):
    t=(ROOT/'docs'/name).read_text()
    if stop: t=t.split(stop)[0]
    t=re.sub(r'!\[[^\]]*\]\([^)]*\)','',t)
    t=re.sub(r'```mermaid\n.*?```','状态流转请按本节操作顺序执行；详细状态图保留在随包源码对应说明中。',t,flags=re.S)
    return t

common='''## 如何阅读与操作
本手册对应当前前后端。按钮按角色、记录范围和状态出现，未出现按钮不代表账号故障。列表搜索后打开详情，核对客户、编号、状态和更新时间，再提交操作。金额以人民币及十进制表示；业务日期按界面日期输入，事件时间显示北京时间。

提交超时先刷新详情及历史，核对是否已成功；不要为了重试盲目创建第二条业务。API写入携带requestKey，修改或动作携带expectedUpdatedAt；版本冲突应重新读取、核对后再提交新请求。同一请求号不能更换输入。字段不接受调用者指定企业或操作人。

### 四种角色
|角色|演示账号|默认业务范围与责任|
|---|---|---|
|管理员|admin|本企业组织、账号、集成、审批设计及管理；财务台账写入|
|销售主管|manager|本部门销售数据、归属安排、项目管理；仅处理分配到的审批|
|销售|sales|本人销售与有明确职责的交付记录；公海受限摘要；发起业务|
|老板|boss|企业经营读取；可处理分配到本人的审批，业务编辑默认关闭|

四个公开演示账号密码均为12345，仅用于隔离演示企业。空企业正式安装不会创建这四个演示用户，管理员设置独立强密码并新建人员。老板不是通用超级管理员，审批权限也不等于财务或项目验收权限。

### 首页、通知与审计
经营驾驶舱按当前可见数据汇总，点击指标可下钻；合同额、计划应收、已收、剩余分别查看，不能等同营业收入、利润或银行余额。销售管道按商机阶段展示，与列表共享数据。
站内通知从右上入口读取并打开相关业务，详情仍重新检查权限；通知出现不代表钉钉、飞书或邮件已送达。业务审计保存操作及结果，不显示密码、令牌或附件正文。旧版本未记录的历史不会补造。
'''

guides={
'customers':'客户经营 → 客户。新建填写名称；公海先领取或由主管分配，再维护本人客户。已有商机/合同等关联销售业务时，必须用整体归属交接，不能通过单独分配绕过。详情查看联系人、商机、合同、项目及跟进。',
'contacts':'客户经营 → 联系人。选择有权读取的客户并填写姓名；维护职务、电话、邮箱。联系人关联不授予其他客户访问权，不等同通讯录自动同步。',
'leads':'客户经营 → 线索。填写企业、来源和需求，核对后使用“转化”；转化采用同一客户名称查重规则。已转化线索不可重复转化或覆盖原业务。',
'opportunities':'销售经营 → 商机与报价。创建商机并推进当前阶段，填写下一步；无法继续时标记丢单并保留原因。报价选择产品、数量和单价，由服务端重算并生成版本；不是可覆盖的历史文本。',
'contracts':'销售经营 → 合同。填写草稿、提交已发布流程；通过后确认签约，再生成订单或项目。申请人不能审批自己；未批准不能签约。合同金额与选用报价版本保持一致，后续变更使用显式变更入口。',
'orders':'销售经营 → 订单。由已签合同生成或选择合同新建；提交审批、通过后确认、再交付。详情核对关联客户及合同；不提供分批发货、退货、已执行订单取消冲销。',
'projects':'项目交付 → 项目。关联客户及可选合同，起止日期合理；立项审批通过后启动，再创建任务和推进里程碑。100%进度不自动代表独立验收通过，最终提交与确认须由不同合格人员完成。',
'tasks':'项目交付 → 项目任务。只能选择已启动且允许编辑的项目；里程碑必须属于同一项目。开始、完成、整改和转派有不同说明字段；已完成不可直接覆盖，需要项目整改流程。',
'actions':'客户经营 → 行动计划。填写客户、标题和日期，完成后保留执行状态。AI建议只有经原委托人批准且代理执行成功才会创建这里的行动；撤销委托不自动删除已建行动。',
'followups':'客户经营 → 跟进记录。选择客户，记录事实、下一步和下次日期；文本按业务资料保存，不作为授权指令执行。保留作者，不因销售交接改写历史作者。',
'products':'销售经营 → 产品目录。维护名称、唯一编码、分类、单位、目录价格和税率。后续产品改名不覆盖此前报价中的产品快照；财税口径仍需人工核对。',
'payment-plans':'财务中心 → 回款计划。只读查看合同产生的计划、已收与剩余；本地台账的核销操作通过“收款登记与核销”，不要把计划生成理解为实际到账。',
'invoices':'财务中心 → 发票。当前展示历史或合成记录，开票、红冲、税务连接与会计处理未开放。页面显示演示功能边界，不能作为税务系统使用。',
'receipts':'财务中心 → 收款记录。此通用列表只读。当前可写本地台账另在“收款登记与核销”；历史演示或外部记录不会自动取得可写、可复核资格。'
}
types={'text':'文本','textarea':'多行文本','number':'数值','money':'金额','date':'日期','select':'选择','reference':'关联记录'}
catalog='# 基础模块逐项操作与字段\n\n必填标识来自当前工作区字段定义；动作还会检查实际状态和业务条件。下列字段为创建/编辑表单字段，不代表所有详情字段或可绕过状态守卫。\n'
for key,r in resources.items():
    catalog+=f"\n## {r['title']}（{key}）\n\n{guides[key]}\n\n"
    if r['fields']:
        catalog+='|字段|类型/必填|填写与约束|\n|---|---|---|\n'
        for f in r['fields']:
            constraint='可选填' if not f.get('required') else '必须填写'
            if f.get('options'):constraint='选项：'+'、'.join(f['options'])
            if f.get('reference'):constraint='选择当前有权限的'+resources[f['reference']]['title']
            catalog+=f"|{f['label']}|{types[f['type']]} / {'是' if f.get('required') else '否'}|{constraint}|\n"
    else: catalog+='本通用资源为只读，不提供创建/修改表单。\n'
    catalog+='\n完成后回读详情核对编号、状态及关联记录；看到版本变化提示时先刷新，再核对输入。\n'

approval='''# 审批设计、发起与日常处理
管理员进入审批设计器，创建流程并选择业务类型；业务单据用专属入口，通用事项可在审批中心发起。配置文本、数字、日期等字段及必填规则；保留字段不能冒用。按业务配置金额条件、节点名称及顺序，审批人可为指定人员、唯一可解析角色、部门负责人或多人会签。

先保存草稿并预演，检查匹配条件、每个节点实际人员、申请人是否冲突；确认后发布。已发布定义修改生成新版本，原申请保留发起时的表单、流程及人员快照。角色解析多人时须明确指定，系统不会随机选一个人；缺少合格人员时阻止发起。

申请人在业务详情提交或审批中心填写通用表单。审批人进入待我审批核对原始业务及字段，再填写意见通过或驳回；不能越过当前节点。申请人可按状态撤回待审申请。审批通过只触发该业务配置的回调，不代表银行到账、外部合同签章或客户签收。列表可以继续加载历史，处理记录保留原人员及意见。
'''
tr=source('APPROVAL_TRANSFER_OPERATIONS.md','## 验证范围').replace('本批支持顺序审批的转审及管理员恢复流转，不是会签、加签、钉钉或飞书外部审批。','当前支持顺序及C11会签待办的转审与管理员恢复；会签规则见下一节。尚不包括加签或第三方外部审批。')
ops=[('CUSTOMER_CONTRACT_OPERATIONS.md','## AI、安装与验证边界'),('DELIVERY_ACCEPTANCE_OPERATIONS.md','## 页面核对'),('RECEIVABLE_LEDGER_OPERATIONS.md','## 页面验证记录'),('SERVICE_TICKET_OPERATIONS.md','## 能力契约与边界'),('PRIVATE_ATTACHMENT_OPERATIONS.md','## 接口与验证'),('IDENTITY_OPERATIONS.md','## 升级与接口')]
manual=f'# 伴圆CRM 逐项功能操作手册\n\n{INTRO}\n\n{common}\n{catalog}\n'
for n,stop in ops[:3]: manual+='\n'+source(n,stop)
manual+='\n'+approval+'\n'+tr+'\n'+source('APPROVAL_COUNTERSIGN_OPERATIONS.md','## 安装与验证')
for n,stop in ops[3:]: manual+='\n'+source(n,stop)
manual+='''\n# AI工作台、平台集成与故障处理
AI规则摘要当前由确定性规则生成，未接大模型。客户查询按本人实际范围执行。独立委托、人工核对、代理执行、回执和补偿的完整步骤见同包《AI特点与智能体接入说明》。不得把一次人工批准扩大为后续任意业务授权。
钉钉/飞书由管理员在集成页进行连接测试、部门与成员预览。配置只放本机环境；没有企业凭证时会明确失败。令牌成功只证明鉴权，尚须核对通讯录权限与范围。当前不免登、不导入人员、不外发消息、不同步审批。真实企业尚未联调。

## 常见提示与处理
|提示|操作|
|---|---|
|登录或会话失效|重新登录；确认企业编码、账号状态与密码；刷新重放会撤销会话|
|无权限或未找到|检查当前企业、角色、归属和协作职责；不要修改请求中的企业编号|
|版本已变化|关闭旧详情，重新读取并核对其他人的改动，再提交|
|审批人不可用或不能自审|由管理员检查发布版本与节点人员；不可用通用表单绕过|
|职责未交接不能停用|分别交接客户、项目/任务、待审意见和未关闭工单|
|附件超限或文件头不符|检查1MiB、PDF/PNG/JPEG及历史容量；撤回不会释放历史容量|
|余额或凭据冲突|核对当前台账、更正链、有效核销和合同，不能覆盖旧账|
|请求超时|回读记录与历史确认结果，未确认前不重复建立业务|

## 覆盖范围及后续扩展
本手册覆盖当前可操作入口和14类基础资源；接口精确字段以随包源码的Schema、当前能力目录及各专题操作说明为准。历史列表存在100条、50条或200候选上限，具体以专题说明为准，不将第一页当全量。未开放电子签章、完整财务、客户门户、复杂审批、可靠外发Outbox、模型质量/费用监测、性能容量与最终安全验收。上线前按COMMERCIAL_ACCEPTANCE逐项由产品负责人验收。
'''

demo=f'''# 伴圆CRM 演示手册\n\n{INTRO}
## 准备与账号
打开http://localhost:3000。四个演示账号admin、manager、sales、boss，密码均为12345。先确认隔离的演示企业和备份，不在真实企业数据上复演。本包截图为实际界面的演示或合成记录，不代表客户业务发生。
演示Docker入口：设置SEED_ADMIN_PASSWORD=12345后运行sh deploy/start.sh；Windows使用deploy/start.ps1。首次联网构建并初始化。正式安装入口另见部署手册，不使用此公开密码。
{common.split('### 四种角色')[1].split('### 首页')[0]}
## 20分钟演示顺序
|时间|账号与页面|讲解及观察|
|---|---|---|
|0—2分钟|boss / 经营驾驶舱|指标下钻、企业读取；合同、应收、到账、利润口径不同|
|2—5分钟|sales / 客户、线索、商机|本人范围、公海摘要、客户全景；新线索转化；报价版本|
|5—8分钟|sales→manager→boss / 合同审批|原申请不能自审；处理当前节点，通过后签约并衔接订单/项目|
|8—11分钟|manager / 项目与任务|任务结果、累计工时、里程碑；拒收整改与另一人员独立验收|
|11—13分钟|admin / 审批设计器|字段、条件、版本、多人会签；部分同意不进入下一节点|
|13—15分钟|admin及第二管理员 / 本地收款台账|登记和独立复核、核销撤销、更正链；不连接银行、不执行退款|
|15—17分钟|manager / 售后与附件|已验收项目工单、独立关闭；文件Hash、冻结与撤回保留|
|17—20分钟|sales / AI工作台|规则摘要；限时委托→建议→原人核对→代理执行→回执/取消|

标准种子不保证包含所有新增C7—C11状态。新功能演示先按操作手册在独立演示副本建立合成记录，准备第二管理员与其他合格审批人；不能直接把历史完成项目当新版已验收项目。截图提供稳定讲解路径，不伪造演示时的业务结果。
## 关键演示前置
审批：先发布匹配流程，申请人不在节点；会签2—8位有效人员且具完整处理权限，角色同名多候选须指定人员。若只有四个默认账号，不保证任意业务都有足够独立复核人。
交付：合同签约、立项通过、项目启动、任务及里程碑完成后才提交验收；项目经理与提交人不能自验收。售后：只选已有新版独立验收的完成项目；解决人与关闭人不同。
台账：至少两位有效管理员，使用明确标记的合成凭据编号和小额测试数；不代表银行到账。AI：凭证只显示一次，不在投屏、截图或PPT显示；委托人核对后还要客户端执行。
## 截图讲解
04_功能截图保留原九张总体功能截图，并加入C2—C11专题截图。原九张反映早期演示界面：其中“财务仅展示”和旧AI能力说明须结合当前台账与委托专题解读，不能当成当前全部能力结论。
当前重点：c7-delegated-action显示待核对及回执；c8-service-ticket显示解决和独立关闭；c10-private-evidence显示有效/撤回文件；c11-countersign-designer与review显示同组独立意见。
## 复演与收尾
pnpm demo:reset仅供有本机建库权限的原生环境：创建新演示副本并切换本机.env，保留旧库。不要在正式企业运行演示种子。pnpm demo:test使用独立测试库；pnpm check执行工程检查。
复演后核对写入记录、登出账号、撤销临时委托，妥善保管或删除私有凭证。浏览器页面操作和真实数据库自动化是两种证据，讲解时明确区分。
## 现场问答口径
AI是否已接模型：未接；摘要是规则生成，外部Agent可调用确定性业务服务。能否自主批合同：不提供代理审批写入。是否银行/税务系统：仅本地台账与未开放财务展示。是否真实钉钉飞书联通：接口代码和模拟协议已有，尚无测试企业凭证和真实联调。是否已商用验收：尚未，当前为工程候选。
'''
ai=f'# 伴圆CRM AI特点与智能体接入说明\n\n{INTRO}\n\n'
ai+='''## AI原生的当前含义
软件由AI辅助持续开发，核心对象和动作提供机读能力契约；网页与智能体适配器调用同一确定性业务服务，遵守同样的身份、企业范围、状态和事务约束。AI辅助开发不代表模型在运行时自动决策，也不证明模型质量或客户采用效果。
当前规则摘要未接大模型；外部模型由调用方提供和管理自己的密钥。CRM不会因为一段客户备注或模型文字就授权写入；授权来自当前人工会话和显式业务流程。

## 两类接入入口
人工身份只读MCP：POST /api/v1/mcp。7个工具为customer.search、customer.get、workspace.list、workspace.get、workspace.overview、workspace.schema、approval.pending。身份为当前人工会话，范围同网页；不得把人工JWT直接交给不可信代理。示例examples/mcp-client.mjs。
独立委托MCP：POST /api/v1/agent-runtime/mcp。使用单独的不透明凭证；可授予4种能力及同委托回执查询。它不沿用人工JWT作为代理凭证，也不是OAuth发现或无人长期服务账号。下面为实际操作与限制。
'''+source('AGENT_DELEGATION_OPERATIONS.md','## 本批验证与限制')
ai+='''\n## 质量、费用与尚待建设
已验证结构化授权、权限边界、幂等、回滚及回执，不据此宣称模型回答准确、自动成交或自动完成所有CRM业务。调用预算是受理次数，不是模型Token或人民币额度；模型质量、证据检索、费用统计、任务循环、超时人工介入、更多对象写能力仍待建设。
审批决定、财务变更、银行税务、对外发送、人员管理、售后及附件写入未向独立代理开放。业务资料中的任何“忽略规则”“代我批准”等文字仍只是输入数据。管理员也不能替另一位原委托人批准建议。
'''
deploy=f'# 伴圆CRM 本地部署与升级恢复手册\n\n{INTRO}\n\n'
deploy+='''## 总包与环境
解压完整包后先核对MANIFEST.json的sourceCommit和SHA256SUMS.txt。01_安装源码/tb-crm含源码、冻结锁文件、15个迁移、种子、部署脚本及预构建API/网页；不含Node、MySQL、Docker镜像、node_modules或本机.env，因此不是离线安装包。首次联网下载工具、镜像及依赖。
推荐独立测试机或测试虚拟机。Docker入口需要Docker Engine/Desktop与Compose v2；本机原生模式需要Node24、pnpm11.25.0和MySQL8.4，不能把旧本机数据库地址直接复制给别人。包内预构建内容用于便捷核对，Docker仍从源码冻结依赖构建。
## 演示Docker安装
macOS/Linux终端设置export SEED_ADMIN_PASSWORD=12345，运行sh deploy/start.sh；Windows PowerShell设置$env:SEED_ADMIN_PASSWORD='12345'并运行./deploy/start.ps1。脚本生成独立随机基础密钥到deploy/.env，首次初始化四角色与演示数据；后续重启保留业务和密码。
打开http://localhost:3000，四账号admin、manager、sales、boss。端口占用时调整本机配置WEB_PORT；默认只绑定127.0.0.1，数据库不映射公网。只读检查node --env-file=deploy/.env deploy/verify.mjs。
停止用docker compose --env-file deploy/.env -f deploy/compose.yml down，不添加删除卷选项。新副本使用独立Compose项目、端口与数据卷，不删除旧卷。
## 原生演示安装
安装Node24与pnpm11后执行pnpm install --frozen-lockfile。参照.env.example在本机生成独立配置并创建专用空库，设置SEED_ADMIN_PASSWORD=12345；不要将.env提交Git。依次pnpm db:migrate、pnpm demo:seed、pnpm build、pnpm demo:start，默认网页3000、API4000。迁移或种子失败时先检查本机数据库账号权限，不将已有正式库用作演示库。
本机启动演示.command是原生启动便捷入口，不负责为陌生电脑安装Node/MySQL。首次配置后才可双击。macOS本机Node24/MySQL8.4路径有实际验证，其他操作系统原生路径仍需实机验收。
'''+source('PRODUCTION_INSTALL.md')
deploy+='''\n## 已有库升级检查单
记录当前源码、迁移和配置，停止写入并创建可恢复备份；在独立副本验证后，停止旧API，应用随包增量迁移，再启动同版API和网页。不要对已有企业重放演示种子。先检查ready，再重新登录四种适用角色，核对客户/合同/余额、旧审批、会签、附件及历史。
C11仅向枚举末尾追加users_all，旧审批不回填或改写。新定义不能交给不支持会签的旧API；退回旧代码时从旧版本备份恢复新库验证，不能原地降级覆盖当前库。C10附件随SQL备份保留原件与摘要；恢复后抽查下载Hash。保留原库，不自动提升恢复库为生产。
## 当前验证与实际限制
C11代码工程检查186项API加4项安装/加密检查通过；本轮真实MySQL分组检查940项通过，含会签171、转审177、客户合同227、业务365。这不是所有项目测试数的累加，也不是客户签收。Linux Docker正式/演示构建、初始化、重启及恢复云端检查通过，具体源码与链接见05_版本与验收。Windows/macOS Docker未实机验收。
已知依赖公告以2026-11-01当前锁文件检查为准：生产依赖0，全工作区高危/严重0，开发工具仍有2中1低。尚无容量压测、渗透验收、镜像全栈扫描、完整告警或高可用；ready只证明数据库可达。
钉钉飞书密钥由管理员只在本机配置，默认不联通；没有真实凭证时不可宣称免登或审批回调已验收。正式公网访问的域名、HTTPS、备份调度和运维职责另行落实；本包不会自动发布公网服务。
'''

demo=re.sub(r'四个公开演示账号密码均为12345.*?\n\n## 20分钟演示顺序','正式安装只创建初始管理员，使用独立强密码；角色权限不等于超级管理权限。\n\n## 20分钟演示顺序',demo,flags=re.S)
documents=[('伴圆CRM_逐项功能操作手册_C11',manual),('伴圆CRM_演示手册_C11',demo),('伴圆CRM_AI特点与智能体接入说明_C11',ai),('伴圆CRM_本地部署手册_C11',deploy)]

def clean(t):
    return re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',t).replace('**','').replace('`','')
def render_doc(name,md):
    (OUT/(name+'.md')).write_text(md)
    d=Document();sec=d.sections[0];sec.page_width=Cm(21);sec.page_height=Cm(29.7)
    sec.top_margin=Cm(1.9);sec.bottom_margin=Cm(1.8);sec.left_margin=Cm(2);sec.right_margin=Cm(2)
    for sty in ['Normal','Title','Heading 1','Heading 2','Heading 3','Header','Footer']:
        st=d.styles[sty];st.font.name='Arial Unicode MS';st._element.rPr.rFonts.set(qn('w:eastAsia'),'Arial Unicode MS');st.font.color.rgb=RGBColor(0,0,0)
        for border in list(st._element.iter(qn('w:pBdr'))):border.getparent().remove(border)
    d.styles['Normal'].font.size=Pt(10.5);d.styles['Normal'].paragraph_format.space_after=Pt(6);d.styles['Normal'].paragraph_format.line_spacing=1.15
    for sty,size in [('Title',22),('Heading 1',17),('Heading 2',13),('Heading 3',11)]:
        d.styles[sty].font.size=Pt(size);d.styles[sty].paragraph_format.space_before=Pt(12);d.styles[sty].paragraph_format.space_after=Pt(7)
    d.core_properties.title=name;d.core_properties.author='伴圆 CRM 项目';d.core_properties.subject='C11 工程候选 · 非生产验收'
    sec.header.paragraphs[0].text='伴圆 CRM  /  C11 工程候选'
    footer=sec.footer.paragraphs[0];footer.alignment=2;footer.add_run('第 ')
    fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld);footer.add_run(' 页')
    lines=md.splitlines(); i=0; htmlparts=[]; code=False; buf=[]
    while i<len(lines):
        line=lines[i].strip();i+=1
        if line.startswith('```'):
            code=not code
            if not code:
                text='\n'.join(buf);p=d.add_paragraph(text);p.paragraph_format.left_indent=Cm(.3)
                for run in p.runs:run.font.size=Pt(9)
                htmlparts.append('<pre>'+html.escape(text)+'</pre>');buf=[]
            continue
        if code:buf.append(line);continue
        if not line:continue
        if line.startswith('|') and i<len(lines) and re.match(r'^\|[- :|]+\|$',lines[i].strip()):
            headers=[clean(x.strip()) for x in line.strip('|').split('|')];i+=1;rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                rows.append([clean(x.strip()) for x in lines[i].strip().strip('|').split('|')]);i+=1
            table=d.add_table(rows=1, cols=len(headers));table.autofit=False
            widths=([2.2,4.5,10.3] if headers[0]=='时间' else [3.7,3.1,10.2]) if len(headers)==3 else [5,12]
            if len(widths)!=len(headers):widths=[17/len(headers)]*len(headers)
            for col,w in zip(table.columns,widths):col.width=Cm(w)
            for rowvals in [headers]+rows:
                cells=table.rows[0].cells if rowvals is headers else table.add_row().cells
                for c,text,w in zip(cells,rowvals,widths):
                    c.width=Cm(w);c.text=text
                    pr=c._tc.get_or_add_tcPr();mar=OxmlElement('w:tcMar')
                    for edge in ['top','left','bottom','right']:
                        e=OxmlElement('w:'+edge);e.set(qn('w:w'),'85');e.set(qn('w:type'),'dxa');mar.append(e)
                    pr.append(mar)
                    if rowvals is headers:
                        shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'EEF0F3');pr.append(shade)
                    for p in c.paragraphs:
                        p.paragraph_format.space_after=Pt(3);p.paragraph_format.line_spacing=1.1
                        for r in p.runs:r.font.size=Pt(9.5);r.bold=rowvals is headers
            headpr=table.rows[0]._tr.get_or_add_trPr();headpr.append(OxmlElement('w:tblHeader'))
            if '演示手册' in name or 'AI特点' in name:
                for row in table.rows:row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
            borders=OxmlElement('w:tblBorders')
            for edge in ['top','left','bottom','right','insideH']:
                b=OxmlElement('w:'+edge);b.set(qn('w:val'),'single');b.set(qn('w:sz'),'4');b.set(qn('w:color'),'D7DBE0');borders.append(b)
            table._tbl.tblPr.append(borders)
            htmlparts.append('<table><tr>'+''.join('<th>'+html.escape(v)+'</th>' for v in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+html.escape(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</table>')
        elif line.startswith('#'):
            depth=len(line)-len(line.lstrip('#'));text=clean(line[depth:].strip())
            d.add_paragraph(text,'Title' if not htmlparts else 'Heading '+str(min(depth,3)))
            htmlparts.append(f'<h{min(depth,3)}>'+html.escape(text)+f'</h{min(depth,3)}>')
        else:
            text=clean(line);d.add_paragraph(text);htmlparts.append('<p>'+html.escape(text)+'</p>')
    d.save(OUT/(name+'.docx'))
    css='body{max-width:1000px;margin:40px auto;padding:0 24px;font:17px/1.8 system-ui;color:#17202e}h1,h2,h3{color:#000}table{border-collapse:collapse;width:100%;font-size:15px}td,th{border:1px solid #d7dbe0;padding:8px;text-align:left}th{background:#eef0f3}pre{white-space:pre-wrap;background:#f4f5f7;padding:18px}a{color:#1554a3}'
    (OUT/(name+'.html')).write_text('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>'+name+'</title><style>'+css+'</style><body>'+''.join(htmlparts)+'</body></html>')
    print(name, len(md),flush=True)
for name,md in documents:render_doc(name,md)
(OUT/'README.md').write_text(f'# C11 本地交付材料\n\n{INTRO}\n\n基准源码：`{BASE}`。PPT文字和表格可编辑，截图为嵌入的历史演示/合成界面。四份手册同时提供DOCX、HTML和Markdown版本。各专题精确契约与限制以源码docs目录为准。\n\n完整安装总包及校验清单作为GitHub预发布资产提供；此目录不包含本机配置或数据库。\n')
