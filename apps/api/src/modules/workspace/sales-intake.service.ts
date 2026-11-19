import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { runCommand, validateActor, checkVersion, json, type Tx } from './command-runner';
import { WorkspaceService } from './workspace.service';
import { hasPermission } from './access';
import { uniqueCustomerIdentity } from './customer-identity';
import {
  intakeHash,
  parseSalesManifest,
  salesManifestSchema,
  knownSalesAmount,
  type SalesManifest,
} from './sales-intake-policy';
import { salesIntakeMeta, salesForecastEligible } from './sales-intake-policy';
import { reportQuery } from './analytics-policy';
import { statisticsScope } from './statistics-scope';
import { salesActivityBody, contractPlanBody, actionCalendarBody, followupTime } from './sales-activity-policy';
import {ownTradeAmount,currentTrade} from './trade-policy';
import { pendingCustomerName } from './pending-customer';
const provider = 'crm-sales-intake';
const identifier = z.string().uuid();
const requestKey = z.string().min(1).max(80);
const previewBody = z.object({ requestKey, manifest: salesManifestSchema }).strict();
const commitBody = z
  .object({ requestKey, previewId: identifier, digest: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) })
  .strict();
const archiveBody = z
  .object({
    requestKey,
    filename: z.string().min(1).max(200),
    contentBase64: z.string().min(4).max(1400000),
    description: z.string().max(3000),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success) throw new BadRequestException(p.error.issues[0]?.message ?? '参数无效');
  return p.data;
}
function admin(a: Actor) {
  if (!a.roles.includes('super_admin')) throw new ForbiddenException('历史销售资料导入仅限当前公司管理员');
}
const date = (value: string | null | undefined) => (value ? new Date(value + 'T00:00:00Z') : null);
const code = (prefix: string) => prefix + randomUUID().replaceAll('-', '').slice(0, 16);
interface Ids {
  customers: Record<string, number>;
  leads: Record<string, number>;
  opportunities: Record<string, number>;
  contracts: Record<string, number>;
  followups: Record<string, number>;
  actions: Record<string, number>;
}
@Injectable()
export class SalesIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  schema() {
    return [
      {
        id:'sales.action.calendar',version:'1.0',route:'POST /sales-intake/action-calendar',permission:'super_admin',effect:'local-business-calendar-write',agentWritesEnabled:false,
        inputSchema:z.toJSONSchema(actionCalendarBody),outputSchema:{type:'object',required:['entries','externalEffects']},
        guards:['current company administrator','active action owner and current action version','future work slot without overlap','one local proposal per action','business calendar origin excluded from external sync'],evidence:['action/customer links','planned work slot','idempotent receipt and audit'],
      },
      {
        id:'sales.contract.plan',version:'1.0',route:'POST /sales-intake/contract-plans',permission:'super_admin',effect:'local-action-write',agentWritesEnabled:false,
        inputSchema:z.toJSONSchema(contractPlanBody),outputSchema:{type:'object',required:['actions','externalEffects']},
        guards:['current company administrator','signed contract current version','contract owner assignment','one lifecycle form per contract','planned dates are not actual business facts','no financial or external effects'],evidence:['contract and financial record references','planned milestones','idempotent command and audit'],
      },
      {
        id: 'sales.intake.activities', version: '1.0', route: 'POST /sales-intake/activities', permission: 'super_admin', effect: 'local-business-write', agentWritesEnabled: false,
        inputSchema: z.toJSONSchema(salesActivityBody), outputSchema: { type: 'object', required: ['updated', 'followups', 'externalEffects'] },
        guards: ['current company administrator', 'existing reviewed case and source IDs', 'live object and action versions', 'atomic idempotent command', 'estimated dates explicitly retained', 'no financial, approval or external effects'],
        evidence: ['date basis and estimates', 'existing action IDs', 'source followup IDs', 'command audit'],
      },
      {
        id: 'sales.intake.preview',
        version: '1.0',
        route: 'POST /sales-intake/preview',
        permission: 'super_admin',
        effect: 'local-preview-write',
        agentWritesEnabled: false,
        inputSchema: z.toJSONSchema(previewBody),
        outputSchema: { type: 'object', required: ['previewId', 'digest', 'counts'] },
        guards: [
          'live company administrator',
          'bounded typed manifest',
          'source versions',
          'no external notifications',
        ],
        evidence: ['immutable manifest hash', 'preview actor and expiry'],
      },
      {
        id: 'sales.intake.commit',
        version: '1.0',
        route: 'POST /sales-intake/commit',
        permission: 'super_admin',
        effect: 'local-business-write',
        agentWritesEnabled: false,
        inputSchema: z.toJSONSchema(commitBody),
        outputSchema: { type: 'object', required: ['runId', 'ids', 'counts'] },
        guards: [
          'same administrator and unexpired preview',
          'digest and live source versions',
          'serializable idempotent command',
          'no financial facts from drafts',
          'historical imports suppress external effects',
        ],
        evidence: ['source IDs', 'import mapping', 'command receipt and audit'],
      },
      {
        id: 'sales.intake.archive',
        version: '1.0',
        route: 'POST /sales-intake/archives',
        permission: 'super_admin',
        effect: 'local-source-write',
        agentWritesEnabled: false,
        inputSchema: z.toJSONSchema(archiveBody),
        outputSchema: { type: 'object', required: ['id', 'sha256'] },
        guards: ['1MiB source limit', 'SHA256 deduplication', 'private administrator download only'],
        evidence: ['original bytes and hash'],
      },
      {
        id: 'sales.funnel.list',
        version: '1.0',
        route: 'GET /analytics/funnel',
        permission: 'customer:read and per-object permission',
        effect: 'read',
        agentWritesEnabled: false,
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            personRange: { enum: ['self', 'person', 'company', 'department'] },
            ownerId: { type: 'integer' },
            deptId: { type: 'integer' },
            includeUndated: { enum: ['true', 'false'] },
          },
        },
        outputSchema: { type: 'object', required: ['items', 'summary', 'audience'] },
        guards: ['defaults to current authorized role scope', 'live current object scopes', 'source-date range with explicit undated pool'],
        evidence: ['current formal business object IDs'],
      },
    ];
  }
  async actionCalendar(a:Actor,body:unknown){
    admin(a);const b=parse(actionCalendarBody,body);
    return runCommand(this.prisma,a,'sales.action.calendar@1.0',b,async tx=>{
      const entries:{actionId:number;id:number;reused:boolean}[]=[];
      for(const x of b.items){
        const action=await tx.actionPlan.findFirst({where:{...(await this.workspace.scope(tx,a,'actions')),id:x.id}});
        if(!action||!['pending','in_progress','overdue'].includes(action.status))throw new ConflictException('行动不可排期');
        checkVersion(action,x.expectedUpdatedAt);
        const owner=await tx.user.findFirst({where:{tenantId:a.tenantId,id:action.assigneeId,deletedAt:null,status:'active'}});
        if(!owner)throw new ConflictException('行动负责人不可用');
        const externalId='crm-action-plan:'+action.id;
        const old=await tx.calendarEntry.findUnique({where:{tenantId_ownerId_externalId:{tenantId:a.tenantId,ownerId:owner.id,externalId}}});
        if(old){entries.push({actionId:action.id,id:old.id,reused:true});continue;}
        const startsAt=new Date(x.startsAt),endsAt=new Date(startsAt.getTime()+30*60000);
        if(startsAt<=new Date()||startsAt.getUTCFullYear()>2060)throw new BadRequestException('日程须为今后至2060年的拟定工作时段');
        if(await tx.calendarEntry.count({where:{tenantId:a.tenantId,ownerId:owner.id,status:'scheduled',freeBusy:'busy',startsAt:{lt:endsAt},endsAt:{gt:startsAt}}}))throw new ConflictException('工作时段冲突，请重新排期');
        const row=await tx.calendarEntry.create({data:{tenantId:a.tenantId,ownerId:owner.id,title:action.title,description:('【拟定业务推进时段】\n行动#'+action.id+'；本时段不是客户确认的会议或付款承诺。\n'+(action.content??'')).slice(0,2000),location:'业务推进安排',startsAt,endsAt,freeBusy:'busy',status:'scheduled',origin:'crm_plan',externalId,externalSnapshot:json({actionId:action.id,customerId:action.targetType==='customer'?action.targetId:null,proposed:true,source:'sales.action.calendar@1.0'})}});
        entries.push({actionId:action.id,id:row.id,reused:false});
      }
      return {entries,externalEffects:0};
    });
  }
  async contractPlans(a: Actor, body: unknown) {
    admin(a);
    const b=parse(contractPlanBody,body);
    return runCommand(this.prisma,a,'sales.contract.plan@1.0',b,async tx=>{
      const actions:{contractId:number;id:number;reused:boolean}[]=[];
      for(const x of b.contracts){
        const c=await tx.contract.findFirst({where:{...(await this.workspace.scope(tx,a,'contracts')),id:x.id}});
        if(!c||!['signed','executing','completed'].includes(c.status))throw new ConflictException('仅整理本帐套已签合同');
        checkVersion(c,x.expectedUpdatedAt);
        if(x.sourceIds && !x.sourceIds.includes('crm:contract:'+c.id))throw new ConflictException('行动依据缺少对应合同引用');
        const owner=await tx.user.findFirst({where:{tenantId:a.tenantId,id:c.ownerId,status:'active',deletedAt:null}});
        if(!owner)throw new ConflictException('合同负责人已停用，请先完成交接');
        const title=('成交路径｜'+c.contractNo+'｜'+c.name).slice(0,200);
        const old=await tx.actionPlan.findFirst({where:{tenantId:a.tenantId,deletedAt:null,targetType:'customer',targetId:c.customerId,actionType:'contract_lifecycle',title}});
        if(old){actions.push({contractId:c.id,id:old.id,reused:true});continue;}
        const plans=await tx.paymentPlan.findMany({where:{tenantId:a.tenantId,contractId:c.id},select:{id:true,planNo:true,amount:true,outstandingAmount:true,dueDate:true,status:true},take:501});
        const invoices=await tx.invoice.findMany({where:{tenantId:a.tenantId,contractId:c.id,deletedAt:null},select:{id:true,invoiceNo:true},take:501});
        const receipts=await tx.receipt.findMany({where:{tenantId:a.tenantId,contractId:c.id,deletedAt:null},select:{id:true,receiptNo:true,status:true},take:501});
        if([plans,invoices,receipts].some(r=>r.length>500))throw new BadRequestException('单合同关联单据超过整理预算');
        const due=new Date(x.dueDate+'T00:00:00Z');
        const open=c.totalOutstanding.gt(0);
        const content=[
          '【成交项目行动路径表单】',
          '合同ID：'+c.id+'；版本：'+c.updatedAt.toISOString(),
          '签约主体：'+(c.signingCompany??'待核对')+'；负责人：'+owner.name,
          '合同金额：'+c.amount.toFixed(2)+'；台账已开票：'+c.totalInvoiced.toFixed(2)+'；台账已回款：'+c.totalReceived.toFixed(2)+'；合同未收：'+c.totalOutstanding.toFixed(2),
          '【已知事实】合同状态：'+c.status+'；签约日期：'+(c.signDate?.toISOString().slice(0,10)??'原始日期待确认'),
          '关联回款计划：'+plans.map(p=>p.planNo+'（未收'+p.outstandingAmount.toFixed(2)+'；约定日期'+(p.dueDate?.toISOString().slice(0,10)??'待核')+'）').join('；'),
          '关联开票：'+invoices.map(i=>i.invoiceNo+'#'+i.id).join('；'),
          '关联回款：'+receipts.map(r=>r.receiptNo+'#'+r.id+'('+r.status+')').join('；'),
          '【拟定行动路径，非已发生事实】',
          ...(x.nextAction?['【具体下一步】'+x.nextAction,'【行动依据】'+x.sourceIds!.join('；')]:[]),
          '1. 核对原合同、范围、签约主体及付款条件；附件和历史来源齐备后留痕。',
          '2. 核对实施/供货进度、交付及验收凭证；缺少证明标待核，不代填已验收。',
          '3. 对齐合同分期、已开票及已收单据；合同未收和开票未收为同一债权的不同视角，不相加。',
          open?'4. 按未收分期逐项确认付款触发条件、联系人及预计付款日；未明确到期日不擅自判逾期。':'4. 核对已收与核销结果，金额一致后办理结案；复核质保或续约义务。',
          '5. 记录实际联系及反馈，更新行动；需审批的变更另发申请，不由此表单自动批准。',
          '6. 留存实际到账/验收证据后再完成相关行动；续约、增购或质保事项另行跟进。',
          '【计划安排】'+x.dueDate+'进行第一轮资料/进度及'+(open?'回款条件':'结案续约')+'核对；后续步骤按核对结果排期。本日期为拟定工作日期，不是客户承诺、交付或收款事实。',
        ].join('\n');
        const row=await tx.actionPlan.create({data:{tenantId:a.tenantId,targetType:'customer',targetId:c.customerId,title,content,actionType:'contract_lifecycle',assigneeId:owner.id,priority:open?'high':'medium',dueDate:due,source:'system',status:'pending',createdBy:a.userId}});
        actions.push({contractId:c.id,id:row.id,reused:false});
      }
      return {actions,externalEffects:0};
    });
  }
  async activities(a: Actor, body: unknown) {
    admin(a);
    const b = parse(salesActivityBody, body);
    return runCommand(this.prisma, a, 'sales.intake.activities@1.0', b, async tx => {
      const updated: { kind: string; id: number; actionId: number; followCount: number }[] = [], followups: number[] = [];
      for (const x of b.items) {
        const row = x.kind === 'opportunities'
          ? await tx.opportunity.findFirst({ where: { ...(await this.workspace.scope(tx,a,x.kind)), id:x.id } })
          : await tx.lead.findFirst({ where: { ...(await this.workspace.scope(tx,a,x.kind)), id:x.id } });
        if (!row) throw new ForbiddenException('历史事项不存在或不可见');
        checkVersion(row, x.expectedUpdatedAt);
        const metadata = 'healthFactors' in row ? row.healthFactors : row.aiEnrichment;
        const meta = salesIntakeMeta(metadata);
        if (meta.caseKey !== x.caseKey) throw new ConflictException('历史事项来源不匹配');
        const customerId = 'customerId' in row ? row.customerId : Number(meta.customerId);
        if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new ConflictException('历史事项缺少客户关联');
        if(x.identityStage){
          const customer=await tx.customer.findFirst({where:{tenantId:a.tenantId,id:customerId,deletedAt:null},select:{name:true}});
          if(x.kind!=='opportunities'||row.status==='won'||!pendingCustomerName(customer?.name))throw new ConflictException('仅身份待核的非成交商机可回归发现阶段');
          if(!await tx.opportunityStage.findFirst({where:{tenantId:a.tenantId,code:x.identityStage,isActive:true}}))throw new ConflictException('发现阶段未启用');
          await tx.opportunity.update({where:{id:x.id},data:{stage:x.identityStage,stageHistory:json([...('stageHistory'in row&&Array.isArray(row.stageHistory)?row.stageHistory:[]),{stage:x.identityStage,previousStage:'stage'in row?row.stage:null,changedAt:new Date().toISOString(),reason:'客户名字待核实，当前管理阶段回归发现/需求确认；原商务历史、报价及掉单结果保留'}])}});
        }
        const action = await tx.actionPlan.findFirst({ where:{tenantId:a.tenantId,id:x.actionId,deletedAt:null,targetType:'customer',targetId:customerId} });
        if (!action || !['pending','in_progress','overdue'].includes(action.status)) throw new ConflictException('行动已结束或客户不匹配');
        checkVersion(action,x.actionVersion);
        if (x.followup) {
          const sourceIds = Array.isArray(meta.sourceIds) ? meta.sourceIds : [];
          if (x.followup.sourceIds.some(s=>!sourceIds.includes(s))) throw new ConflictException('跟进来源不属于该事项');
          const f = await tx.followUp.create({data:{tenantId:a.tenantId,targetType:x.kind==='opportunities'?'opportunity':'lead',targetId:x.id,customerId,method:'other',content:x.followup.content,result:'历史资料整理',nextAction:x.nextAction,nextFollowAt:date(x.nextActionDate),createdBy:a.userId,aiStructured:json({salesIntake:{caseKey:x.caseKey,sourceIds:x.followup.sourceIds,occurredAt:x.followup.occurredAt,dateEstimated:x.followup.estimated,activityType:'evidence_review',note:'历史资料整理，不代表新增客户联系'}})}});
          followups.push(f.id);
        }
        const history = await tx.followUp.findMany({where:{tenantId:a.tenantId,deletedAt:null,customerId,OR:[{targetType:x.kind==='opportunities'?'opportunity':'lead',targetId:x.id},{aiStructured:{path:'$.salesIntake.caseKey',equals:x.caseKey}}]},take:1001});
        if (history.length>1000) throw new BadRequestException('单事项跟进超过整理预算');
        const times=history.flatMap(f=>{const t=followupTime(f);return t?[t]:[];});
        const lastFollowAt=times.length?new Date(Math.max(...times.map(t=>t.getTime()))):null;
        // A signed source contract establishes a won business day, never an invented event time.
        const signedSource='status' in row && row.status==='won' && 'contractId' in row && row.contractId
          ? await tx.contract.findFirst({where:{tenantId:a.tenantId,id:row.contractId,status:{in:['signed','executing','completed']},deletedAt:null},select:{signDate:true}}) : null;
        const wonDay=signedSource?.signDate??null;
        const plan={dateBasis:x.dateBasis,expectedCloseDate:x.expectedCloseDate??null,closeDateEstimated:x.closeDateEstimated??null,nextActionDate:x.nextActionDate,plannedBy:a.userId,plannedAt:new Date().toISOString()};
        const remark=(row.remark??'')+'\n[日期'+(x.closeDateEstimated?'估算':'计划')+'] '+x.dateBasis+'；下一步拟定 '+x.nextActionDate;
        if(x.kind==='opportunities') await tx.opportunity.update({where:{id:x.id},data:{...(x.expectedCloseDate?{expectedCloseDate:date(x.expectedCloseDate)}:{}),...('closedAt' in row && !row.closedAt && wonDay?{closedAt:wonDay,winDate:wonDay}:{}),nextAction:x.nextAction,nextActionDate:date(x.nextActionDate),lastFollowAt,followCount:history.length,healthFactors:json({...('healthFactors' in row && row.healthFactors && typeof row.healthFactors==='object'?row.healthFactors:{}),activityPlan:{...plan,...(wonDay?{wonBusinessDayBasis:'source_contract_sign_date',wonBusinessDay:wonDay.toISOString().slice(0,10),eventTimeKnown:false}:{})}}),remark,updatedBy:a.userId}});
        else await tx.lead.update({where:{id:x.id},data:{lastFollowAt,followCount:history.length,aiEnrichment:json({...('aiEnrichment' in row && row.aiEnrichment && typeof row.aiEnrichment==='object'?row.aiEnrichment:{}),activityPlan:plan}),remark,updatedBy:a.userId}});
        if (!action.dueDate) await tx.actionPlan.update({where:{id:action.id},data:{dueDate:date(x.nextActionDate),content:(action.content??'')+'\n[拟定计划日期] '+x.nextActionDate+'；'+x.dateBasis}});
        updated.push({kind:x.kind,id:x.id,actionId:action.id,followCount:history.length});
      }
      return {updated,followups,externalEffects:0};
    });
  }
  async archive(a: Actor, body: unknown) {
    admin(a);
    const b = parse(archiveBody, body);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.contentBase64) || b.contentBase64.length % 4 !== 0)
      throw new BadRequestException('原件编码无效');
    const bytes = Buffer.from(b.contentBase64, 'base64');
    if (bytes.length > 1024 * 1024 || !bytes.length)
      throw new BadRequestException('每份资料上限1MiB，请保留大文件原件并分批归档摘要');
    const sha256 = intakeHashBytes(bytes);
    return runCommand(
      this.prisma,
      a,
      'sales.intake.archive@1.0',
      { requestKey: b.requestKey, filename: b.filename, sha256, description: b.description },
      async (tx) => {
        const old = await tx.sourceArchive.findUnique({ where: { tenantId_sha256: { tenantId: a.tenantId, sha256 } } });
        if (old) return { id: old.id, sha256, reused: true };
        if ((await tx.sourceArchive.count({ where: { tenantId: a.tenantId } })) >= 100)
          throw new BadRequestException('原件资料已到100份上限');
        const id = randomUUID();
        await tx.sourceArchive.create({
          data: {
            id,
            tenantId: a.tenantId,
            filename: b.filename,
            sha256,
            size: bytes.length,
            contentBytes: bytes,
            sheets: json([
              {
                name: '归档说明',
                headers: ['文件', '说明', 'SHA256'],
                rows: [{ sourceRow: 1, cells: [b.filename, b.description, sha256] }],
              },
            ]),
            rowCount: 1,
            summary: json({ kind: 'sales-intake-source', description: b.description }),
            createdBy: a.userId,
          },
        });
        return { id, sha256, reused: false };
      },
    );
  }
  private async validate(tx: Tx, a: Actor, m: SalesManifest) {
    const sourceContracts = await tx.contract.findMany({
      where: {
        tenantId: a.tenantId,
        deletedAt: null,
        id: { in: [...new Set([...m.cases, ...m.actions].flatMap((c) => (c.contractId ? [c.contractId] : [])))] },
      },
      select: { id: true, ownerId: true },
    });
    const preservedOwners = new Set(sourceContracts.map((c) => c.ownerId));
    const newOwners = new Set([
      a.userId,
      ...m.cases.flatMap((c) =>
        c.ownerId && !(c.contractId && sourceContracts.some((s) => s.id === c.contractId && s.ownerId === c.ownerId))
          ? [c.ownerId]
          : [],
      ),
      ...m.actions.flatMap((c) => (!c.contractId && c.ownerId ? [c.ownerId] : [])),
    ]);
    const ownerIds = [
      ...new Set([...newOwners, ...preservedOwners, ...m.cases.flatMap((c) => (c.ownerId ? [c.ownerId] : []))]),
    ];
    const owners = await tx.user.findMany({
      where: { tenantId: a.tenantId, id: { in: ownerIds }, deletedAt: null, status: 'active' },
      select: { id: true, department: { select: { status: true, deletedAt: true } } },
    });
    if (owners.length !== ownerIds.length) throw new ConflictException('负责人已失效');
    // Preserve a live legacy contract owner without fabricating a department or reassigning debt.
    // New assignments still require an active department, even if that user owns another old contract.
    if (
      owners.some((o) => newOwners.has(o.id) && (!o.department || o.department.status !== 1 || o.department.deletedAt))
    )
      throw new ConflictException('新分配负责人部门不可用');
    for (const c of m.customers) {
      if (c.existingId) {
        const row = await tx.customer.findFirst({ where: { tenantId: a.tenantId, id: c.existingId, deletedAt: null } });
        if (!row) throw new ConflictException('沿用客户不在当前公司');
        checkVersion(row, c.expectedUpdatedAt);
      } else {
        const fp = await uniqueCustomerIdentity(tx, a.tenantId, { name: c.name });
        void fp;
      }
    }
    for (const c of m.cases) {
      if (
        await tx.integrationMapping.findFirst({
          where: { tenantId: a.tenantId, provider, kind: 'case', externalId: c.key },
        })
      )
        throw new ConflictException('事项来源已导入，请沿用原记录或准备明确更新批次');
      if (c.contractId) {
        const r = await tx.contract.findFirst({ where: { tenantId: a.tenantId, id: c.contractId, deletedAt: null } });
        if (!r) throw new ConflictException('合同不在当前公司');
        checkVersion(r, c.contractVersion);
        if (
          c.outcome === 'won' &&
          (!['signed', 'executing', 'completed'].includes(r.status) || c.amount === null || !r.amount.eq(c.amount))
        )
          throw new ConflictException('成交依据与有效合同状态或金额不一致');
        const source = m.customers.find((s) => s.key === c.customerKey)!;
        if (source.existingId !== r.customerId && !(source.channel === '用友' && c.payerCustomerId === r.customerId))
          throw new ConflictException('终端客户与合同付款方不匹配，渠道项目须明确原付款方');
      }
    }
    for (const action of m.actions)
      if (action.contractId) {
        const row = await tx.contract.findFirst({
          where: { tenantId: a.tenantId, id: action.contractId, deletedAt: null },
        });
        if (!row) throw new ConflictException('行动合同不存在');
        checkVersion(row, action.contractVersion);
      }
    if (
      m.archiveIds.length !==
      (await tx.sourceArchive.count({ where: { tenantId: a.tenantId, id: { in: m.archiveIds } } }))
    )
      throw new ConflictException('资料原件不在当前公司或编号重复');
  }
  async preview(a: Actor, body: unknown) {
    admin(a);
    const b = parse(previewBody, body),
      m = parseSalesManifest(b.manifest),
      digest = intakeHash(m);
    return runCommand(
      this.prisma,
      a,
      'sales.intake.preview@1.0',
      { requestKey: b.requestKey, manifest: m },
      async (tx) => {
        const prior = await tx.integrationRun.findFirst({
          where: { tenantId: a.tenantId, provider, kind: 'apply', bindingHash: intakeHash(m.batchKey) },
        });
        if (prior) {
          const snap = prior.snapshot as { digest?: string };
          if (snap.digest !== digest) throw new ConflictException('批次已导入且内容不同，禁止静默覆盖');
          return { alreadyImported: true, receipt: prior.summary };
        }
        await this.validate(tx, a, m);
        const previewId = randomUUID(),
          expiresAt = new Date(Date.now() + 30 * 60000).toISOString(),
          counts = this.counts(m);
        await tx.integrationRun.create({
          data: {
            id: previewId,
            tenantId: a.tenantId,
            provider,
            kind: 'preview',
            status: 'prepared',
            actorId: a.userId,
            bindingHash: intakeHash(m.batchKey),
            snapshot: json({ manifest: m, digest, expiresAt }),
            summary: json(counts),
          },
        });
        return { previewId, digest, expiresAt, counts };
      },
    );
  }
  private counts(m: SalesManifest) {
    return {
      customerCandidates: m.customers.length,
      existingCustomers: m.customers.filter((c) => c.existingId).length,
      leads: m.cases.length,
      opportunities: m.cases.filter((c) => c.kind !== 'lead').length,
      followups: m.followups.length,
      actions: m.actions.length,
      newDraftContracts: m.cases.filter((c) => c.draft).length,
      existingContracts: m.cases.filter((c) => c.contractId).length,
      externalEffects: 0,
      newInvoices: 0,
      newReceipts: 0,
    };
  }
  async commit(a: Actor, body: unknown) {
    admin(a);
    const b = parse(commitBody, body);
    return runCommand(this.prisma, a, 'sales.intake.commit@1.0', b, async (tx) => {
      const p = await tx.integrationRun.findFirst({
        where: { tenantId: a.tenantId, provider, id: b.previewId, kind: 'preview', actorId: a.userId },
      });
      if (!p) throw new ForbiddenException('预览不属于当前本人和公司');
      const snapshot = p.snapshot as { manifest: unknown; digest: string; expiresAt: string };
      const m = parseSalesManifest(snapshot.manifest);
      if (b.digest !== snapshot.digest || intakeHash(m) !== b.digest) throw new ConflictException('导入内容已改变');
      const prior = await tx.integrationRun.findFirst({
        where: { tenantId: a.tenantId, provider, kind: 'apply', bindingHash: intakeHash(m.batchKey) },
      });
      if (prior) {
        if ((prior.snapshot as { digest?: string }).digest !== b.digest) throw new ConflictException('同批次内容不同');
        return prior.summary;
      }
      if (p.status !== 'prepared' || Date.parse(snapshot.expiresAt) < Date.now())
        throw new ConflictException('预览已过期');
      await this.validate(tx, a, m);
      const ids: Ids = { customers: {}, leads: {}, opportunities: {}, contracts: {}, followups: {}, actions: {} };
      for (const c of m.customers) {
        if (c.existingId) {
          ids.customers[c.key] = c.existingId;
          continue;
        }
        const identity = await uniqueCustomerIdentity(tx, a.tenantId, { name: c.name });
        const row = await tx.customer.create({
          data: {
            tenantId: a.tenantId,
            code: code('KH'),
            name: c.name,
            ...identity,
            customerCategory: c.customerCategory??'direct',
            channelBrand: c.customerCategory==='sales_channel'&&c.channel!=='direct'?c.channel:null,
            source: 'historical_intake',
            ownerId: a.userId,
            ownerDeptId: a.deptId,
            poolType: 'private',
            protectUntil: new Date(Date.now() + 30 * 86400000),
            createdBy: a.userId,
            remark: c.notes,
            tags: json({ salesIntake: { identityStatus: c.identityStatus, batchKey: m.batchKey,sourceChannel:c.channel } }),
          },
        });
        ids.customers[c.key] = row.id;
        await tx.privateHolding.create({
          data: {
            tenantId: a.tenantId,
            userId: a.userId,
            customerId: row.id,
            claimedAt: new Date(),
            protectUntil: row.protectUntil!,
          },
        });
      }
      for (const c of m.cases) {
        const customerId = ids.customers[c.customerKey],
          ownerId = c.ownerId ?? a.userId,
          customer = m.customers.find((s) => s.key === c.customerKey)!;
        const lead = await tx.lead.create({
          data: {
            tenantId: a.tenantId,
            code: code('XS'),
            companyName: customer.name,
            source: customer.channel === '用友' || customer.channel === '钉钉' ? 'partner' : 'import',
            sourceDetail: customer.channel === 'direct' ? '历史客户项目' : customer.channel,
            demand: c.name + '\n' + c.notes,
            status: c.kind === 'lead' ? 'assigned' : 'converted',
            assigneeId: ownerId,
            convertedCustomerId: c.kind === 'lead' ? null : customerId,
            createdBy: a.userId,
            aiEnrichment: json({
              salesIntake: {
                caseKey: c.key,
                customerId,
                sourceIds: c.sourceIds,
                sourceDate: c.sourceDate,
                nextAction: c.nextAction,
                channel: customer.channel,
                amount: c.amount,
                amountBasis: c.amountBasis,
              },
            }),
          },
        });
        ids.leads[c.key] = lead.id;
        if (c.kind !== 'lead') {
          const meta = {
            caseKey: c.key,
            sourceIds: c.sourceIds,
            sourceDate: c.sourceDate,
            amountKnown: c.amount !== null,
            forecastEligible: c.forecastEligible,
            amountBasis: c.amountBasis,
            channel: customer.channel,
            lossGroup: c.lossGroup ?? null,
            lossConfirmedAt: c.lossConfirmedAt ?? null,
            batchKey: m.batchKey,
            identityStatus: customer.identityStatus,
          };
          const stage = pendingCustomerName(customer.name)&&c.outcome!=='won'?'qualified':c.outcome === 'lost' ? 'negotiation' : c.kind === 'contract' ? 'signing' : 'proposal';
          if (!(await tx.opportunityStage.findFirst({ where: { tenantId: a.tenantId, code: stage, isActive: true } })))
            throw new ConflictException('所需商机阶段未启用');
          const row = await tx.opportunity.create({
            data: {
              tenantId: a.tenantId,
              code: code('SJ'),
              name: c.name,
              customerId,
              leadId: lead.id,
              ownerId,
              stage,
              status: c.outcome,
              amount: c.amount ?? '0',
              weightedAmount: '0',
              expectedCloseDate: null,
              closedAt: null,
              winDate: null,
              source: customer.channel,
              contractId: c.contractId ?? null,
              lossReason: c.outcome === 'lost' ? 'internal_capacity_shortage' : null,
              lossDetail: c.lossReason ?? null,
              demandSummary: c.notes,
              remark: '历史资料补录；金额口径：' + c.amountBasis,
              healthFactors: json({ salesIntake: meta }),
              stageHistory: json([
                {
                  stage,
                  evidenceSourceDate: c.sourceDate,
                  importedAt: new Date().toISOString(),
                  note: '历史最后到达阶段；未知关闭/成交日期留空',
                },
              ]),
              nextAction: c.nextAction,
              createdBy: a.userId,
            },
          });
          ids.opportunities[c.key] = row.id;
          for (const [index, q] of (c.quoteVersions ?? []).entries())
            await tx.opportunityQuote.create({
              data: {
                tenantId: a.tenantId,
                opportunityId: row.id,
                version: index + 1,
                total: q.amount,
                items: json([
                  {
                    productName: '历史报价汇总（具体范围见原件）',
                    quantity: 1,
                    estimatedPrice: q.amount,
                    estimatedAmount: q.amount,
                    salesIntake: { sourceId: q.sourceId, sourceDate: q.sourceDate, basis: q.basis },
                  },
                ]),
                createdBy: a.userId,
              },
            });
          await tx.lead.update({ where: { id: lead.id }, data: { convertedOpportunityId: row.id } });
        }
        if (c.contractId) ids.contracts[c.key] = c.contractId;
        if (c.draft) {
          const amount = new Prisma.Decimal(c.amount!),
            tax = amount.sub(amount.div(new Prisma.Decimal(c.draft.taxRate).div(100).add(1)).toDecimalPlaces(2));
          const contract = await tx.contract.create({
            data: {
              tenantId: a.tenantId,
              contractNo: code('HT'),
              name: c.draft.name,
              signingCompany: c.draft.signingCompany,
              customerId,
              opportunityId: ids.opportunities[c.key],
              contractType: c.draft.type,
              status: 'draft',
              amount,
              taxRate: c.draft.taxRate,
              taxAmount: tax,
              amountExclTax: amount.sub(tax),
              totalOutstanding: '0',
              paymentTerms: c.draft.paymentTerms,
              remark: c.draft.remark,
              ownerId,
              createdBy: a.userId,
            },
          });
          ids.contracts[c.key] = contract.id;
          for (const [index, item] of c.draft.items.entries())
            await tx.contractItem.create({
              data: {
                tenantId: a.tenantId,
                contractId: contract.id,
                itemName: item.name,
                itemType: 'service',
                quantity: item.manDays,
                unit: '人天',
                manDays: item.manDays,
                unitPrice: item.unitPrice,
                amount: item.amount,
                taxRate: c.draft.taxRate,
                sortOrder: index,
              },
            });
          await tx.opportunity.update({ where: { id: ids.opportunities[c.key] }, data: { contractId: contract.id } });
        }
        await tx.integrationMapping.create({
          data: {
            tenantId: a.tenantId,
            provider,
            kind: 'case',
            bindingHash: b.digest,
            externalId: c.key,
            localId: lead.id,
            externalName: c.name.slice(0, 100),
          },
        });
      }
      for (const f of m.followups) {
        const c = m.cases.find((c) => c.key === f.caseKey)!;
        const row = await tx.followUp.create({
          data: {
            tenantId: a.tenantId,
            targetType: ids.opportunities[c.key] ? 'opportunity' : 'customer',
            targetId: ids.opportunities[c.key] ?? ids.customers[c.customerKey],
            customerId: ids.customers[c.customerKey],
            method: 'other',
            content: f.content,
            result: f.kind === 'revision' ? '内部报价修订' : '历史实际沟通',
            createdBy: c.ownerId ?? a.userId,
            aiStructured: json({
              salesIntake: { sourceId: f.sourceId, occurredAt: f.occurredAt, activityType: f.kind, caseKey: c.key },
            }),
          },
        });
        ids.followups[f.key] = row.id;
        if (ids.opportunities[c.key])
          await tx.opportunity.update({
            where: { id: ids.opportunities[c.key] },
            data: { followCount: { increment: 1 } },
          });
      }
      for (const x of m.actions) {
        const c = x.caseKey ? m.cases.find((c) => c.key === x.caseKey) : undefined;
        const contract = x.contractId
          ? await tx.contract.findFirstOrThrow({ where: { tenantId: a.tenantId, id: x.contractId } })
          : null;
        const customerId = contract?.customerId ?? ids.customers[x.customerKey ?? c!.customerKey];
        const row = await tx.actionPlan.create({
          data: {
            tenantId: a.tenantId,
            targetType: 'customer',
            targetId: customerId,
            title: x.title,
            content: x.content + '\n来源：' + x.sourceIds.join('；'),
            assigneeId: contract?.ownerId ?? x.ownerId ?? c?.ownerId ?? a.userId,
            priority: x.priority,
            dueDate: date(x.dueDate),
            source: 'manual',
            status: 'pending',
            createdBy: a.userId,
          },
        });
        ids.actions[x.key] = row.id;
      }
      const runId = randomUUID(),
        receipt = {
          runId,
          batchKey: m.batchKey,
          digest: b.digest,
          counts: this.counts(m),
          ids,
          appliedAt: new Date().toISOString(),
        };
      await tx.integrationRun.create({
        data: {
          id: runId,
          tenantId: a.tenantId,
          provider,
          kind: 'apply',
          status: 'completed',
          actorId: a.userId,
          bindingHash: intakeHash(m.batchKey),
          snapshot: json({ manifest: m, digest: b.digest }),
          summary: json(receipt),
        },
      });
      await tx.integrationRun.update({ where: { id: p.id }, data: { status: 'completed' } });
      return receipt;
    });
  }
  async list(a: Actor, q: Record<string, string>) {
    const { includeUndated = 'true', keyword = '', ...period } = q;
    if (!['true', 'false'].includes(includeUndated) || keyword.length > 100) throw new BadRequestException('筛选无效');
    const range = reportQuery(period);
    if (!hasPermission(a, 'customer:read')) throw new ForbiddenException('没有客户读取权限');
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const audience = await statisticsScope(tx, a, period);
        const customers = await tx.customer.findMany({
          where: await this.workspace.scope(tx, a, 'customers'),
          select: { id: true, name: true },
        });
        const customerMap = new Map(customers.map((c) => [c.id, c.name]));
        const owner = audience.ownerIds ? { ownerId: { in: audience.ownerIds } } : {};
        const opps = hasPermission(a, 'opportunity:read')
          ? await tx.opportunity.findMany({
              where: { AND: [await this.workspace.scope(tx, a, 'opportunities'), owner] },
              take: 10001,
            })
          : [];
        const leads = hasPermission(a, 'lead:read')
          ? await tx.lead.findMany({
              where: {
                AND: [
                  await this.workspace.scope(tx, a, 'leads'),
                  { status: { notIn: ['converted', 'unqualified', 'rejected', 'expired'] } },
                  ...(audience.ownerIds ? [{ assigneeId: { in: audience.ownerIds } }] : []),
                ],
              },
              take: 10001,
            })
          : [];
        if (opps.length + leads.length > 10000)
          throw new BadRequestException('漏斗超过10000条查询预算，请缩小人员范围');
        const users = await tx.user.findMany({ where: { tenantId: a.tenantId }, select: { id: true, name: true } }),
          names = new Map(users.map((u) => [u.id, u.name]));
        const contracts = hasPermission(a, 'contract:read')
          ? await tx.contract.findMany({ where: await this.workspace.scope(tx, a, 'contracts'), select: { id: true } })
          : [];
        const contractIds = new Set(contracts.map((c) => c.id));
        const stageNames = Object.fromEntries(
          (
            await tx.opportunityStage.findMany({ where: { tenantId: a.tenantId }, select: { code: true, name: true } })
          ).map((s) => [s.code, s.name]),
        );
        type Item = {
          caseKey: string;
          customerId: number | null;
          customerName: string;
          leadId: number | null;
          opportunityId: number | null;
          contractId: number | null;
          name: string;
          stage: string;
          outcome: string;
          amount: string | null;
          forecastEligible: boolean;
          amountBasis: string;
          sourceDate: string | null;
          channel: string;
          ownerId: number;
          ownerName: string | undefined;
          lossReason: string | null;
          lossGroup: string | null;
          lossConfirmedAt: string | null;
          nextAction: string | null;
          notes: string;
        };
        const items: Item[] = [];
        const include = (sourceDate: string | null) =>
          sourceDate ? date(sourceDate)! >= range.start && date(sourceDate)! < range.end : includeUndated === 'true';
        for (const o of opps) {
          if (!customerMap.has(o.customerId)) continue;
          const m = salesIntakeMeta(o.healthFactors),
            sourceDate =
              typeof m.caseKey === 'string'
                ? typeof m.sourceDate === 'string'
                  ? m.sourceDate
                  : null
                : new Date(o.createdAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
          if (!include(sourceDate)) continue;
          items.push({
            caseKey: typeof m.caseKey === 'string' ? m.caseKey : 'opportunity:' + o.id,
            customerId: o.customerId,
            customerName: customerMap.get(o.customerId)!,
            leadId: o.leadId,
            opportunityId: o.id,
            contractId: o.contractId && contractIds.has(o.contractId) ? o.contractId : null,
            name: o.name,
            stage: o.stage,
            outcome: o.status,
            amount: knownSalesAmount(o) ? ownTradeAmount(o)?.toFixed(2)??null : null,
            forecastEligible: salesForecastEligible(o),
            amountBasis: currentTrade(o).reason??(typeof m.amountBasis === 'string' ? m.amountBasis : '当前商机金额'),
            sourceDate,
            channel: typeof m.channel === 'string' ? m.channel : (o.source ?? 'direct'),
            ownerId: o.ownerId,
            ownerName: names.get(o.ownerId),
            lossReason: o.lossDetail ?? o.lossReason,
            lossGroup: typeof m.lossGroup === 'string' ? m.lossGroup : null,
            lossConfirmedAt: typeof m.lossConfirmedAt === 'string' ? m.lossConfirmedAt : null,
            nextAction: o.nextAction,
            notes: o.demandSummary ?? o.remark ?? '',
          });
        }
        for (const l of leads) {
          const m = salesIntakeMeta(l.aiEnrichment),
            customerId = typeof m.customerId === 'number' ? m.customerId : null;
          if (customerId && !customerMap.has(customerId)) continue;
          const sourceDate =
            typeof m.caseKey === 'string'
              ? typeof m.sourceDate === 'string'
                ? m.sourceDate
                : null
              : new Date(l.createdAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
          if (!include(sourceDate)) continue;
          items.push({
            caseKey: typeof m.caseKey === 'string' ? m.caseKey : 'lead:' + l.id,
            customerId,
            customerName: customerId ? customerMap.get(customerId)! : (l.companyName ?? '客户待确认'),
            leadId: l.id,
            opportunityId: null,
            contractId: null,
            name: (l.demand ?? l.companyName ?? '线索').split('\n')[0].slice(0, 200),
            stage: 'lead',
            outcome: 'lead',
            amount: null,
            forecastEligible: false,
            amountBasis: '尚未形成有效报价',
            sourceDate,
            channel: typeof m.channel === 'string' ? m.channel : (l.sourceDetail ?? l.source),
            ownerId: l.assigneeId ?? 0,
            ownerName: l.assigneeId ? names.get(l.assigneeId) : '未分配',
            lossReason: null,
            lossGroup: null,
            lossConfirmedAt: null,
            nextAction: typeof m.nextAction === 'string' ? m.nextAction : null,
            notes: l.demand ?? '',
          });
        }
        const filtered = items.filter(
          (i) =>
            !keyword ||
            [i.customerName, i.name, i.notes, i.lossReason]
              .join(' ')
              .toLocaleLowerCase()
              .includes(keyword.toLocaleLowerCase()),
        );
        const lost = filtered.filter((i) => i.outcome === 'lost' && i.lossGroup === 'confirmed'),
          pending = filtered.filter((i) => i.outcome === 'lost' && i.lossGroup === 'identity_pending');
        const total = (rows: Item[]) =>
          rows.reduce((s, r) => (r.amount === null ? s : s.add(r.amount)), new Prisma.Decimal(0)).toFixed(2);
        return {
          audience,
          stageNames,
          period: {
            from: range.start.toISOString().slice(0, 10),
            to: new Date(range.end.getTime() - 1).toISOString().slice(0, 10),
            dateBasis: '历史补录按来源日期；日常新建按创建日期；不是成交或丢单日期',
            includeUndated: includeUndated === 'true',
          },
          items: filtered,
          summary: {
            count: filtered.length,
            confirmedLostCount: lost.length,
            confirmedLostAmount: total(lost),
            pendingIdentityLostCount: pending.length,
            pendingIdentityLostAmount: total(pending),
            undatedCount: filtered.filter((i) => !i.sourceDate).length,
          },
          notices: [
            '具名与主体待核丢单分开汇总；金额为未成交机会，不是债权。',
            '未知总价、月费或单位报价不与固定总价混加。',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
}
const intakeHashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
