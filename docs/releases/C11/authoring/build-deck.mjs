import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
const ROOT=process.cwd(),BUILD=ROOT+'/.artifacts/delivery-c11/build',OUT=ROOT+'/docs/releases/C11';
const SKILL=process.env.CRM_PRESENTATION_SKILL;
const p=Presentation.create({slideSize:{width:1600,height:900}}),F='Noto Sans CJK SC',NAVY='#142540',BLUE='#1658AE',GRAY='#5A6575';
p.theme.defaultFont=F;
const slides=[];
function text(s,t,x,y,w,h,size=32,color=NAVY,bold=false){const q=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});q.text=t;q.text.style={typeface:F,fontSize:size,color,bold};return q;}
function slide(title,subtitle){let s=p.slides.add();s.background.fill='#F7F8FC';slides.push(s);text(s,title,64,40,1472,76,48,NAVY,true);if(subtitle)text(s,subtitle,66,123,1460,70,27,GRAY);text(s,'伴圆 CRM  ·  C11 工程候选  ·  演示/合成资料，非生产验收',66,842,1350,36,21,GRAY);text(s,String(slides.length).padStart(2,'0'),1460,842,70,36,21,GRAY);return s;}
function notes(s,t){s.speakerNotes.text=t+'\n基准源码0908c6b636b8e240a38ef7365b0a5c344d3a970c。以同包专题操作说明、MANIFEST和验收记录为准。';}
async function imageSlide(title,file,bullets,source){const s=slide(title,'实际系统界面 · 请结合当前手册解读历史截图');const b=await fs.readFile(file);s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:file.endsWith('.png')?'image/png':'image/jpeg',alt:title+'；演示或合成企业界面',fit:'contain',position:{left:64,top:207,width:1090,height:610}});bullets.forEach((t,i)=>text(s,t,1190,225+i*185,345,168,29,i===0?BLUE:NAVY,i===0));notes(s,source+'。截图来自隔离演示或合成企业；不代表真实交易或客户签收。');}
function words(title,subtitle,items){const s=slide(title,subtitle);items.forEach((it,i)=>{text(s,it[0],75,220+i*142,390,100,34,BLUE,true);text(s,it[1],485,220+i*142,1035,115,32);});notes(s,items.map(x=>x.join('：')).join('\n'));return s;}
const tableOwners=[];
function tableSlide(title,subtitle,values,widths){const s=slide(title,subtitle);tableOwners.push(slides.length);const t=s.tables.add({rows:values.length,columns:values[0].length,left:66,top:220,width:1468,height:555,columnWidths:widths,values});t.borders.assign({style:'solid',fill:'#D7DEE8',width:1});for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){const cell=t.getCell(r,c);cell.fill=r===0?'#E7EDF6':'#FFFFFF';cell.text.style={typeface:F,fontSize:29,color:NAVY,bold:r===0};}notes(s,'表格为原生可编辑表格。'+values.map(x=>x.join(' / ')).join('\n'));return s;}
let s=slide('伴圆 CRM','AI可调用的客户经营与交付系统');text(s,'从客户、销售到交付、收款台账与售后',70,270,1440,120,56,NAVY,true);text(s,'源码公开  /  本地安装  /  人工授权  /  业务留痕',75,438,1420,85,36,BLUE);text(s,'C11 · 2026-11-01 工程候选\n应用包版本0.2.0-demo.2；以源码提交和迁移识别当前版本',75,600,1420,118,30,GRAY);notes(s,'介绍当前实现和边界。尚未完成客户生产验收；首次安装需要联网。');
tableSlide('一条销售到服务的业务主线','每一步都受身份、归属、状态与版本约束',[['阶段','操作与证据','当前边界'],['客户与销售','导入预检、线索转化、报价版本、合同审批','复杂主体合并与已执行合同冲销待建设'],['订单与交付','立项、任务、工时、里程碑、独立验收','不含分批发货、客户电子签章'],['收款与服务','人工台账、独立复核、核销更正、售后工单','不连接银行税务；无客户门户和SLA自动升级']],[290,640,538]);
tableSlide('四个角色，各自承担责任','公开演示密码均为12345；正式安装使用独立强密码',[['角色 / 账号','默认读取范围','典型责任'],['管理员 / admin','本企业','人员、流程、集成；本地台账写入'],['销售主管 / manager','本部门与明确职责','销售安排、交付管理、分配到的审批'],['销售 / sales','本人及明确协作记录','客户跟进、商机、合同与交付任务'],['老板 / boss','企业经营读取','经营下钻、分配到的审批；业务默认只读']],[350,470,648]);
const shot=n=>ROOT+'/docs/screenshots/'+n,old=n=>ROOT+'/docs/releases/C11/overview-screenshots/'+n;
await imageSlide('先预检，再导入客户',shot('c3-import.png'),['200条 / 1MiB','名称规范化查重\n重复明确跳过','确认时再检查\n整批事务提交'],'docs/CUSTOMER_CONTRACT_OPERATIONS.md');
await imageSlide('销售归属按关联业务整体交接',shot('c3-handover.png'),['先看影响，再确认','商机、合同、订单\n项目销售归属联动','交付与审批分别交接\n历史作者保持不变'],'docs/CUSTOMER_CONTRACT_OPERATIONS.md');
await imageSlide('商机报价保留不可变版本',old('03_商机阶段与销售管道.jpg'),['商机看板与列表一致','数量×单价由服务端重算\n产品名称和价格留快照','合同引用明确版本\n后续报价不漂移原合同'],'docs/CUSTOMER_CONTRACT_OPERATIONS.md；历史总体截图');
await imageSlide('合同变更先核对前后影响',shot('c3-contract-change.png'),['审批前不提前改合同','前后值与业务依据\n由服务端固定','仅允许无已执行下游的路径\n复杂冲销仍待建设'],'docs/CUSTOMER_CONTRACT_OPERATIONS.md');
await imageSlide('交付完成需要独立验收',shot('c4-delivery-history.png'),['任务 → 里程碑 → 验收','结果、累计工时、拒收\n整改和再次提交都保留','项目经理与提交人不能自验\n进度100%不自动结项'],'docs/DELIVERY_ACCEPTANCE_OPERATIONS.md');
await imageSlide('人员交接保留原执行证据',shot('c41-handover-people.png'),['项目经理与任务分别交接','接收人实时检查\n账号、部门和执行资格','未完职责阻止停用\n紧急撤销可先重置密码'],'docs/DELIVERY_ACCEPTANCE_OPERATIONS.md；docs/IDENTITY_OPERATIONS.md');
await imageSlide('本地收款登记与核销形成台账',shot('c5-ledger-history.png'),['人工登记，另一管理员复核','同客户合同计划间分摊\n余额与有效明细共同校验','撤销核销保留原记录\n不会向银行发出退款'],'docs/RECEIVABLE_LEDGER_OPERATIONS.md');
await imageSlide('登记更正形成同凭据历史链',shot('c51-receipt-correction.png'),['不覆盖旧金额和复核人','先撤销有效核销\n旧登记作废，新登记待复核','原凭据编号保持占用\n并发更正不能分叉'],'docs/RECEIVABLE_LEDGER_OPERATIONS.md');
await imageSlide('通用审批设计器支持多人会签',shot('c11-countersign-designer.jpg'),['同一步2—8人全同意','可与单人节点混用\n最多12个逻辑节点','保存、预演、发布版本\n旧申请快照保持不变'],'docs/APPROVAL_COUNTERSIGN_OPERATIONS.md');
await imageSlide('每个成员独立处理一份意见',shot('c11-countersign-review.jpg'),['部分同意仍停在本组','任一人驳回结束申请\n最后一票才触发业务回调','可转交未处理意见\n防止一人重复承担组内两票'],'docs/APPROVAL_COUNTERSIGN_OPERATIONS.md；docs/APPROVAL_TRANSFER_OPERATIONS.md');
await imageSlide('已验收项目进入独立售后工单',shot('c8-service-ticket.jpg'),['提交 → 指派 → 处理 → 复核','解决人与关闭人不同\n退回或重开保留原方案','工单协作只授予本工单\n不改原项目验收或财务余额'],'docs/SERVICE_TICKET_OPERATIONS.md');
await imageSlide('私有证据附件与验收快照关联',shot('c10-private-evidence.jpg'),['登录后按业务范围下载','PDF / PNG / JPEG\n文件Hash校验，无公开链接','冻结时不能补改；撤回保留原件\n数据库备份包含附件'],'docs/PRIVATE_ATTACHMENT_OPERATIONS.md；1MiB/文件，16MiB企业历史容量，每对象100条历史；无病毒扫描');
tableSlide('AI特点：可调用、可约束、可追溯','当前摘要为规则生成，未接大模型；外部Agent调用确定性业务服务',[['层次','当前实现','含义与边界'],['AI辅助开发','AI参与编码、测试和交付','不等于运行时模型已接入'],['能力契约','稳定ID、版本、输入输出Schema、权限和证据','网页与Agent复用业务服务；不开放任意SQL'],['受控委托','独立凭证、限时范围、人工核对、执行回执','仅4种运行能力；不提供代理审批/财务写入']],[300,630,538]);
words('两类MCP身份，权限边界清楚','人工会话只读入口与独立委托入口分开使用',[['人工身份只读','客户搜索/详情；工作区列表/详情/概览/Schema\n审批待办读取。共7个只读工具。'],['独立委托身份','customer.search、customer.get、action.propose、action.execute；另查同委托回执。'],['共享业务服务','身份与企业来自认证上下文；当前归属、角色、状态、版本在服务端重检。'],['凭证管理','一次展示的不透明凭证；数据库只存HMAC。退出、撤销、过期或授权变化会阻断调用。']]);
await imageSlide('建议、人工批准和执行是三步',shot('c7-delegated-action.jpg'),['先预演，不提前建行动','原委托人核对客户与版本\n批准后仍需代理执行','事务保存行动、预算和回执\n同建议不会重复创建'],'docs/AGENT_DELEGATION_OPERATIONS.md');
words('委托有期限、有预算，也有停止方式','授权不能从一条模型文本自动扩大为后续任意业务',[['期限与预算','最长24小时且不超过父会话；每人最多10个委托；预算为1至1000次。'],['不可越权','代理不能自批建议、代批合同、变更金额、操作银行税务或对外发送。'],['失败与重试','共享事务、持久幂等、客户版本检查；晚期故障回滚，不能以请求发出当成功。'],['撤销与补偿','撤销停止后续调用；已提交行动保留。原委托人可取消仍未完成且符合当前权限的AI行动。']]);
words('源码和数据可部署在自己的环境','Docker首次安装需要联网；不包含运行时、数据库镜像或离线依赖',[['演示安装','四角色、公开演示密码12345和合成业务；与真实企业数据隔离。'],['空企业安装','只初始化企业、四角色、管理员与基础配置；使用独立强密码和随机密钥。'],['升级方式','备份 → 停旧API → 增量迁移 → 同版API/网页 → ready与角色回读。'],['恢复方式','AES-256-GCM备份恢复到全新库；保留原库，轮换会话签名，不自动切生产。']]);
tableSlide('验证证据与适用范围','以下是本轮C11代码检查，不是项目总测试累计或客户验收',[['证据','本轮结果','实际范围'],['工程检查','186项API + 4项安装/加密检查','类型、lint、测试和构建'],['真实MySQL分组','171 + 177 + 227 + 365 = 940项','会签、转审、客户合同、业务回归'],['Linux Docker云端','正式与演示工作流通过','构建、安装、重启和恢复；Windows/macOS未实机验收'],['原演示升级','旧71表计数及审批数据校验保留','15迁移、四角色登录；登录增加会话与审计记录']],[320,540,608]);
words('钉钉、飞书接口需要真实企业联调','用户尚未提供测试企业凭证，不将模拟协议测试当成接通',[['已有代码','应用令牌获取与缓存、部门与成员分页预览、超时和失败处理。'],['配置位置','管理员只在本机环境填写密钥，按CRM租户绑定，核对通讯录权限和可见范围。'],['当前未开放','免登、自动导入人员、外发消息、双向审批及可靠外发Outbox。'],['联调验收','测试企业、可读部门、测试账号与回调权限确定后，再验证真实鉴权和结果。']]);
words('用20分钟演示完整业务脉络','新增功能先在独立演示副本准备合成记录及合格复核人员',[['经营与销售 · 0—8分','老板看板 → 销售客户全景 → 商机报价 → 合同提交与不同人员审批。'],['交付与台账 · 8—15分','任务与里程碑 → 独立验收 → 会签设计 → 双人收款复核与更正链。'],['服务与AI · 15—20分','工单独立关闭 → 私有附件Hash → 委托建议、原人核对、代理回执。'],['准备与口径','默认种子未必包含新增C7—C11实例；截图可稳定讲解，不伪造现场操作或银行结果。']]);
tableSlide('下一步按商业验收清单逐项签收','本包交付可运行的工程候选，尚未宣称全部商用闭环完成',[['状态','内容','验收要求'],['当前可演示','销售、审批/会签、交付/整改、台账、售后、附件、受控AI行动','产品负责人按角色和业务样本核对'],['需要真实环境','钉钉飞书、HTTPS、权限范围、备份运维与恢复演练','企业管理员及部署负责人共同验收'],['仍需开发/治理','复杂冲销、完整财务、客户门户、SLA、可靠外发、模型质量与费用','排定范围后实现、测试并形成新版本'],['商用前专项','容量/性能、渗透、安全与告警、平台实机及运维职责','不得以演示或自动化通过替代签收']],[300,650,518]);
await fs.mkdir(BUILD+'/deck-render',{recursive:true});
const candidate=BUILD+'/candidate-v5.pptx';await(await PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(SKILL+'/container_tools/artifact_tool_utils.mjs').href);
const finalPath=OUT+'/伴圆CRM_Demo介绍_C11_v5.pptx';
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath,pythonExecutable:process.env.CRM_AUTHORING_PYTHON,integrityValidatorPath:SKILL+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SKILL+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],requiredNativeTableOwnerSlides:tableOwners,fontPolicy:{basis:'design',families:[F]},verifyArtifactToolImport:true,receiptPath:BUILD+'/deck-validation-v5.json'});
console.log(JSON.stringify({slides:slides.length,finalPath,result}));
const final=await PresentationFile.importPptx(await FileBlob.load(finalPath));for(let i=0;i<final.slides.items.length;i++){const b=await final.export({slide:final.slides.items[i],format:'png',scale:1});await fs.writeFile(BUILD+'/deck-render/slide-'+String(i+1).padStart(2,'0')+'.png',new Uint8Array(await b.arrayBuffer()));console.log('render',i+1);}
