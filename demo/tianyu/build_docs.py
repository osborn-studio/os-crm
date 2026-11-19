from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'demo/tianyu'; SHOTS=OUT/'screenshots'
manifest=json.loads((OUT/'manifest.json').read_text())
FONT='Noto Sans CJK SC'
def base(title,subtitle):
 d=Document();s=d.sections[0];s.page_width=Inches(8.5);s.page_height=Inches(11);s.top_margin=s.bottom_margin=Inches(.68);s.left_margin=s.right_margin=Inches(.75)
 for key in ['Normal','Title','Subtitle','Heading 1','Heading 2','Caption','Header','Footer']:
  st=d.styles[key];st.font.name=FONT;st._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),FONT);st.font.color.rgb=RGBColor.from_string('111827')
  
  for attr in ['asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme']:
   st._element.get_or_add_rPr().rFonts.attrib.pop(qn('w:'+attr),None)
  st.paragraph_format.space_after=Pt(6)
 
 for st in d.styles:
  for border in st._element.findall('.//' + qn('w:pBdr')):border.getparent().remove(border)
 d.styles['Caption'].font.color.rgb=RGBColor.from_string('526072')
 d.styles['Normal'].font.size=Pt(10.5);d.styles['Normal'].paragraph_format.line_spacing=Pt(15)
 d.styles['Title'].paragraph_format.line_spacing=Pt(33);d.styles['Heading 1'].paragraph_format.line_spacing=Pt(26);d.styles['Heading 2'].paragraph_format.line_spacing=Pt(17);d.styles['Subtitle'].paragraph_format.line_spacing=Pt(18);d.styles['Caption'].paragraph_format.line_spacing=Pt(11);d.styles['Title'].font.size=Pt(25);d.styles['Heading 1'].font.size=Pt(19);d.styles['Heading 2'].font.size=Pt(12)
 d.core_properties.title=title;d.core_properties.author='Osborn Studio';d.core_properties.subject='天雨阀门虚构行业场景';d.core_properties.comments=''
 h=s.header.paragraphs[0];h.text='伴圆 CRM  /  天雨阀门';h.style='Caption';h.runs[0].font.size=Pt(8)
 f=s.footer.paragraphs[0];f.alignment=2;f.add_run('2026.11  ·  ')
 fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');f._p.append(fld)
 d.add_paragraph(title,'Title');d.add_paragraph(subtitle,'Subtitle');return d

def p(d,t):return d.add_paragraph(t)
def h(d,t):return d.add_paragraph(t,'Heading 2')
def page(d,t):d.add_page_break();d.add_paragraph(t,'Heading 1')
def table(d,heads,rows,widths=None):
 t=d.add_table(rows=1,cols=len(heads));t.autofit=False
 if widths:
  for i,w in enumerate(widths):t.columns[i].width=Inches(w)
 for i,x in enumerate(heads):t.rows[0].cells[i].text=x
 for row in rows:
  for c,x in zip(t.add_row().cells,row):c.text=str(x)
 for row in t.rows:
  trPr=row._tr.get_or_add_trPr();cant=OxmlElement('w:cantSplit');trPr.append(cant)
  for i,c in enumerate(row.cells):
   if widths:c.width=Inches(widths[i])
   tcPr=c._tc.get_or_add_tcPr();b=OxmlElement('w:tcBorders')
   for side in ['top','left','bottom','right']:
    e=OxmlElement('w:'+side);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');b.append(e)
   tcPr.append(b);mar=OxmlElement('w:tcMar')
   for side in ['top','left','bottom','right']:
    e=OxmlElement('w:'+side);e.set(qn('w:w'),'80');e.set(qn('w:type'),'dxa');mar.append(e)
   tcPr.append(mar)
   for par in c.paragraphs:
    par.paragraph_format.space_after=Pt(2);par.paragraph_format.line_spacing=Pt(12)
    for r in par.runs:r.font.size=Pt(9)
 for c in t.rows[0].cells:
  sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'EAF1FA');c._tc.get_or_add_tcPr().append(sh)
  for r in c.paragraphs[0].runs:r.bold=True
 repeat=OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(repeat)
 return t

def shot(d,name,caption):
 path=SHOTS/name
 if path.exists():
  d.add_picture(str(path),width=Inches(6.95));d.paragraphs[-1].paragraph_format.line_spacing=1.0
  q=d.add_paragraph(caption,'Caption');q.runs[0].font.size=Pt(8)

# Customer-facing application booklet: supported value and actual screens.
d=base('天雨阀门 · 业务应用全景','让客户、商机、合同、交付与回款形成一条经营主线')
p(d,'以标准阀门与定制阀门并行经营的制造企业为场景，将直销项目、渠道供货和长期客户协作纳入同一套客户经营体系。销售人员知道下一步做什么，管理者看得见管道和回款，跨部门协作有负责人、有节点、有记录。')
table(d,['客户资源','销售推进','过程记录','经营闭环'],[['60,000 客户','9,000 商机','30,000 跟进','1,200 合同'],['48 种产品','720 条线索','3,600 次审批','240 个协作项目']],[1.75]*4)
shot(d,'01-dashboard.jpg','图 1  按时间区间与公司权限查看经营驾驶舱。')
p(d,'从一笔询价开始，持续沉淀需求、报价、审批、供货安排和收款证据。每次推进都能回到客户与业务单据，经营分析也能回到明细。')
p(d,'天雨阀门为虚构行业场景，本文业务数据均为合成样本；画面来自实际运行系统。')
page(d,'01  客户经营：资源有人管，关系可沉淀')
p(d,'客户档案集中维护客户类型、行业、地区、负责人及联系人。通过公海与私海承接公共资源和个人经营，结合客户分配、人员权限和重复校验，让新增、领取和移交有序进行。')
h(d,'直销与渠道各有清晰的业务背景')
p(d,'终端业主、EPC、成套厂和经销商采用不同的客户标记与需求说明。海岚流控经销商对应渠道供货，终端背景、签约主体与付款安排在相关商机和合同中留痕，便于区分“谁带来机会、谁购买、谁付款”。')
shot(d,'03-customer.jpg','图 2  客户档案与联系人、商机、合同、项目及跟进关联。')
table(d,['销售人员','销售主管','经营负责人'],[['维护客户与沟通记录','分配客户、协调团队跟进','查看权限内公司资源'],['安排下一步行动','复盘项目与客户经营','识别关键客户与机会']],[2.33,2.33,2.34])
page(d,'02  销售推进：从需求到报价，过程看得见')
p(d,'展会、推荐、合作伙伴与网站询问形成线索，确认需求后推进客户与商机。标准件围绕产品、数量和交期报价；定制件在需求说明中沉淀口径、材质、连接方式、驱动及图纸版本，配合技术澄清和报价版本推进。')
shot(d,'02-pipeline.jpg','图 3  按月份和人员查看销售看板，阶段金额与具体机会对应。')
h(d,'一条商机留下完整推进依据')
p(d,'方案报价、商务谈判与签约阶段连接跟进记录、下一步计划和负责人。多版本报价保留金额与明细变化；成交进入合同协作，掉单保留原因和报价金额，供后续复盘。')
p(d,'桐澜设备用于展示新报价推进；沧海化工用于展示 240 万元定制件项目；海岚流控用于展示 96 万元渠道供货。')
page(d,'03  合同审批：版本清楚，责任明确')
p(d,'合同把客户、签约主体、供货明细、金额、付款条件与销售负责人连接起来。审批中心展示申请、处理节点及历史，支持驳回修订、撤回重提和或签等协作方式。通用审批设计器用于维护适配业务的流程。')
shot(d,'04-contract.jpg','图 4  合同台账与供货、开票、收款计划关联。')
h(d,'审批推进与业务单据保持关联')
p(d,'待审批、已通过、已签署和执行中的合同分开管理。审批人实际处理后形成记录；或签中一人通过后，同组其他人的免审状态仍被保留，便于事后查看决策过程。')
table(d,['示例合同','业务金额','展示重点'],[['云澜化工 TY-HT-00002','36 万元','主管待审批与历史版本'],['澄源水务 TY-HT-00005','12 万元','供货及四段回款'],['雁川冶金 TY-HT-00010','80 万元','已收32万元、未收48万元']],[2.8,1.1,3.1])
page(d,'04  交付回款：业务推进到结果')
p(d,'合同后的订单、项目、里程碑和任务承接供货协调与技术协作。需求图纸、供货方案、检验资料和现场验收分别有处理节点，销售、项目负责人和技术人员围绕同一客户协同。售后工单继续承接客户反馈和回访。')
shot(d,'05-project.jpg','图 5  项目里程碑与任务连接业务负责人和交付结果。')
h(d,'按付款节点管理应收与实收')
p(d,'示例合同按首付30%、发货款50%、验收款15%、质保款5%设置回款计划。开票、收款登记、复核及核销分别留痕，既看合同还差多少钱，也看哪一期到了跟进时间。')
p(d,'青屿水利合同 100 万元，已收 95 万元，剩余 5 万元为未来到期质保尾款；雁川冶金合同 80 万元，已收 32 万元，未收 48 万元。不同应收状态支持不同催收安排。')
page(d,'05  经营分析与 AI 原生协同')
p(d,'经营工作台、销售预测、漏斗和回款分析支持时间与人员范围。默认查看本人，有权限的管理者可选公司、部门或人员；汇总数字可下钻到具体机会与业务单据，便于会议中直接分配下一步行动。')
shot(d,'07-forecast.jpg','图 6  销售预测结合阶段、金额、预计成交时间和人员范围。')
h(d,'让业务能力成为智能体可调用的服务')
p(d,'客户查询、销售预测和回款分析通过受权限约束的能力接口提供。智能体使用明确授权的业务范围读取数据；行动先形成预演建议，由人员核对批准，再执行并保留回执。授权、人工决策和执行记录形成可追溯过程。')
p(d,'本地 B/S 部署，浏览器访问，支持手机 H5；每家公司使用独立 MySQL 数据库和连接账号。客户经营、组织权限、审批与智能体能力围绕统一业务对象协作。')
shot(d,'09-ai-actions.jpg','智能体建议经人员核对后形成业务行动，处理意见与执行结果可追溯。')
d.save(OUT/'天雨阀门CRM_业务应用全景.docx')

# Facilitator manual.
d=base('天雨阀门 · 演示账号与操作手册','按角色切换，按业务链路演示  /  2026.11')
p(d,'本机入口：http://localhost:3000/login?company=TIANYU。公司选择“天雨阀门”，下列账号密码统一为 12345，也可用对应人员编号登录。账号仅用于虚构的天雨行业场景。')
role={'super_admin':'管理员','gm':'老板','sales_manager':'主管','sales':'销售/协作'}
table(d,['岗位','用户名','人员编号','系统角色'],[(a['name'],a['username'],a['employeeNo'],role[a['roleCode']])for a in manifest['accounts']],[2.15,2.05,1.25,1.55])
p(d,'财务复核与管理员使用两个不同账号，便于展示登记和复核的责任分离。ty_channel 是公司内部渠道业务岗位。ty_pm 与 ty_engineer 用于项目管理和技术任务协作。')
h(d,'演示前准备')
p(d,'先核对页眉公司为天雨阀门。报表默认本人；老板查看经营全景时选择“全公司（当前帐套）”。总体分析可选 2025-01-01 至 2027-12-31；商机看板选本月及“华东销售1”，方便逐项查看。')
page(d,'01  主持人总流程：35 分钟看懂业务')
table(d,['时间','角色 / 页面','操作与讲解'],[['0—4分钟','ty_boss / 经营工作台','选择全公司和时间区间，查看客户、销售管道、签约、回款并打开明细。'],['4—9分钟','ty_sales01 / 客户、线索','搜索澄源水务，查看联系人、商机、合同和跟进；新建一条练习线索。'],['9—14分钟','ty_sales01 / 商机与报价','搜索桐澜设备或沧海化工，展示需求、报价版本、阶段和下一步行动。'],['14—19分钟','ty_mgr_east / 审批中心','处理云澜化工合同；再查看已验证的管理层或签结果及同组他人状态。'],['19—23分钟','ty_pm、ty_engineer / 项目任务','查看图纸、供货、检验资料与验收节点，按负责人处理任务。'],['23—29分钟','ty_finance / 本地收款台账','查看分期、实收和预收；核销一笔预收，再展示留痕及余额变化。'],['29—33分钟','ty_boss / 销售预测与回款分析','按时间、公司或人员切换；点击掉单阶段展开机会，解释原因。'],['33—35分钟','admin / AI与智能体','查询澄源水务，展示能力执行编号；展示授权、预演、人工批准和回执入口。']],[.8,2.05,4.15])
h(d,'开场讲稿')
p(d,'“天雨同时经营标准阀门、定制阀门和渠道业务。今天从一笔需求走到报价、合同、交付和回款，最后回到经营看板。每个阶段都能找到负责人、业务记录和下一步安排。”')
h(d,'演示数据全景')
p(d,'6万客户、2.4万联系人、9000商机、3万跟进、1200合同、800订单、3600审批、3200回款计划、2200开票记录、602收款登记、240项目、960里程碑、960任务、30售后工单、42日程。初始清单见 manifest.json；现场操作会追加记录。')
page(d,'02  客户、线索与报价操作')
h(d,'A. 客户资源与分配')
p(d,'用 ty_sales01 登录，进入客户档案，搜索“澄源水务”，点击详情，依次切换联系人、商机、合同、项目和跟进。用主管或管理员进入客户分配页面，选择目标客户、接收人员及分配依据，再提交。分配后切换接收账号查看客户归属。')
p(d,'公海示例从编号 TY-KH-012001 起。领取时按当前公海规则执行，领取后到私海检查；分配与领取演练使用新的练习客户，保留主讲案例归属。创建同名客户时先看重复提示，再判断复用已有档案。')
h(d,'B. 从线索推进商机')
p(d,'在线索管理点击新建，名称填写“天雨复演练习-水务询价-日期”，补齐联系人、来源、需求、负责人。保存后按页面的转化操作关联客户和商机，再到商机列表核对来源及负责人。操作前后均可搜索练习名称检查。')
h(d,'C. 标准与定制报价')
p(d,'搜索“沧海化工”或“桐澜设备”。查看需求说明中的产品口径、材质、驱动、图纸及交期；进入产品报价明细，选择产品、数量与价格并保存。报价版本在详情中查看，新增一版后比较金额及明细变化。主案例用于阅读，改价时另建练习商机。')
table(d,['检索名称','单据编号','场景'],[['澄源水务','TY-KH-000005 / TY-HT-00005','标准件直销与四段回款'],['沧海化工','TY-SJ-00006 / TY-HT-00006','240万元定制阀门项目'],['海岚流控经销商','TY-SJ-00007 / TY-HT-00007','96万元渠道供货'],['桐澜设备','TY-SJ-01201','在途方案报价与下一步计划']],[1.45,2.95,2.6])
p(d,'列表搜索优先使用客户名称或业务名称。单据编号用于在详情和关联列表中核对。')
page(d,'03  合同与审批操作')
h(d,'A. 先看待审批合同')
p(d,'用 ty_mgr_east 登录审批中心，搜索或找到云澜化工，对应合同 TY-HT-00002、审批编号 TY-SP-000006。打开申请，核对36万元金额、申请人和审批节点，输入意见后同意或驳回。处理后回到合同与审批历史查看结果。该操作会实际改变天雨帐套中的审批状态。')
h(d,'B. 或签结果')
p(d,'查看 TY-HT-00014 对应审批 TY-SP-000042。该申请初始由华东主管与老板同组或签；本机验证已由老板同意，申请通过，华东主管保留免审/未实际处理记录及空处理时间。演示时展开节点，说明业务可往下走，其他人的处理状态仍可追溯。')
h(d,'C. 发起新合同')
p(d,'用销售创建带“复演练习”前缀的合同，选择客户、供货明细、签约主体及金额，保存后提交审批。主管在审批中心处理，销售回到合同核对状态。签约、执行等动作按页面允许的当前状态依次推进，不跳过确认步骤。')
h(d,'D. 通用审批设计器')
p(d,'用 admin 登录审批设计器，查看“天雨供货合同审批”“天雨订单审批”“天雨项目立项审批”。查看业务类型、节点及审批人设置。需要展示编辑时，另建一条练习流程，预览后再发布，保留主流程供后续演示。')

page(d,'04  项目、任务与售后协作')
h(d,'A. 项目负责人查看全链路')
p(d,'用 ty_pm 登录项目管理，搜索“澄源水务”，打开关联项目。展示销售负责人、项目负责人、团队、计划时间、预算和当前阶段。切换里程碑、任务及验收相关信息，依次说明需求图纸、供货方案、检验资料、现场验收四个协作节点。')
h(d,'B. 技术人员处理任务')
p(d,'用 ty_engineer 登录任务页面，找到分配给自己的待办，打开任务核对所属项目及里程碑。开始处理，填写处理结果；完成后切换项目负责人检查任务状态。首次练习使用一条独立任务，后续可继续查看历史记录。')
h(d,'C. 售后延续客户经营')
p(d,'售后工单搜索对应客户，展示执行器调试协助、密封件检查或交付资料补充等样例。工单包括负责人、处理状态和解决结果，处理后将结果带回客户回访。')

p(d,'讲解重点：销售跟踪客户承诺，项目负责人管理节点，技术人员处理具体任务；客户及合同把各环节关联起来。')
page(d,'05  分期应收、收款与核销')
table(d,['业务案例','合同 / 已收 / 未收','现场展示'],[['澄源水务','12万元 / 0 / 12万元','四段计划、5万元待核销预收、6万元待复核登记'],['雁川冶金','80万元 / 32万元 / 48万元','分期催收、实际开票24万元与到账分别记录'],['青屿水利','100万元 / 95万元 / 5万元','未来到期的质保尾款，区分未收与逾期']],[1.2,2.3,3.5])
h(d,'A. 复核收款')
p(d,'在本地收款台账找到 TY-SK-DRAFT（澄源水务，6万元）。它由 admin 登记；用 ty_finance 打开详情，核对客户、合同、金额、到账日期和依据后复核。登记人本人不能复核自己的收款。复核会改变该笔样例状态，演示结束可保留处理历史。')
h(d,'B. 预收核销')
p(d,'找到 TY-YS-001（澄源水务，5万元预收）。打开详情，选择 TY-HT-00005 下未收的首付款计划，核销1000元并填写依据。核对收款已核销金额、剩余预收、计划已收与未收同步变化。再按实际需要撤销本次核销并填写原因，可回到初始余额继续演示。')
p(d,'本机已验证上述1000元核销及撤销，预收余额恢复为5万元。重复请求不会重复扣减；审批、核销和撤销均保留审计过程。')
h(d,'C. 回款分析')
p(d,'用老板打开销售预测与回款分析，选择时间和全公司。区分实际开票日期、实际到账日期、计划到期日期三个统计角度；点击明细定位合同，形成负责人及下一步回款安排。')

page(d,'06  销售预测、漏斗与经营复盘')
p(d,'老板进入“销售预测与回款分析”。先选择2025-01-01至2027-12-31及全公司，再按现场主题切换本月、本年、部门或个人。销售账号默认本人，主管只能选权限范围内人员，老板可查看全公司。')
h(d,'销售预测')
p(d,'从开放商机金额、加权金额、赢单和阶段分布说明当前管道。预计成交时间决定预测归期；点击阶段或明细查看客户、金额、负责人和下一步。总体统计与业务明细使用相同人员范围。')
h(d,'漏斗下钻与掉单')
p(d,'打开销售漏斗，点击掉单阶段查看明细，搜索“石化改造项目”或“紧急交期项目”。TY-SJ-01209为180万元竞品因素掉单；TY-SJ-01210为90万元资源窗口因素掉单。查看原因和跟进依据，说明损失机会金额与真实应收是不同经营指标。')
h(d,'现场查看商机看板')
p(d,'看板选择本月、华东销售1，可看到各阶段卡片；演示过程中打开一条卡片，再回到商机详情查看报价和行动。按具体人员与月份讲解，方便逐项展示推进细节。')

page(d,'07  AI 能力、日程与演示收尾')
h(d,'A. 实际调用客户能力')
p(d,'用 admin 或有客户读取权限的账号打开 AI与智能体，在“真实能力接口调用”输入“澄源水务”，点击调用能力。结果包含权限内的客户及执行编号。讲解时展示实际结果与回执，说明智能体调用的是当前账号可访问的业务能力。')
h(d,'B. 授权与行动预演')
p(d,'在智能体控制面板新建一项天雨场景授权，选择用途、能力、有效期和调用上限。保存后按界面说明使用对应能力；行动先预演，人员核对客户、内容、负责人和时间后批准，再执行并查看回执。展示需要时再创建授权，令牌不放入讲稿或截图。')
p(d,'可讲解的AI特点：业务对象与能力接口统一；查询沿用账号数据权限；写动作由服务校验；建议与执行分开；人工批准及执行编号可追踪。')
h(d,'C. 我的日程')
p(d,'进入我的日程查看本人后续安排。查看报价反馈、技术资料确认、交付协调和回款核对等后续安排，结合行动计划明确负责人及推进时间。')
h(d,'D. 再次演示与移交')
p(d,'新增业务统一以“天雨复演练习-日期”命名，保留处理历史。基础数据生成器是确定性的，安装器只初始化独立空帐套，同版本重跑不会覆盖现场数据。另一台机器按公开README完成本地安装，再创建TIANYU测试帐套并执行固定安装命令。')
table(d,['移交内容','使用方式'],[['业务应用全景.docx','对外介绍业务价值与实际画面'],['演示账号与操作手册.docx','现场登录、讲解、操作和案例索引'],['manifest.json / data.jsonl.gz','账号与初始数据清单、压缩数据及校验值'],['generate.mjs / scripts/tianyu-demo.mjs','确定性数据生成与受保护的空帐套初始化'],['screenshots/','实际天雨帐套业务画面']],[2.7,4.3])

d.save(OUT/'天雨阀门CRM_演示账号与操作手册.docx')
print('Created 2 Word files')

# Apply current feature text while retaining the established document design.
from update_delivery_docs import enhance_existing
enhance_existing(OUT, OUT)
