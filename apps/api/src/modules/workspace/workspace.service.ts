import { permits, strings } from '../system/roles/access-policy';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { ApprovalService } from '../approval/approval.service';
import {
  admin,
  companyWide,
  boss,
  manager,
  allowWrite,
  teamIds,
  ownerScope,
  customerScope,
  hasPermission,
  resourcePermission,
  requirePermission,
} from './access';
import { cleanInput, resource, resources } from './registry';
import { uniqueCustomerIdentity } from './customer-identity';
import { creditCode, identityMatch, type IdentityInput } from './customer-matching';
import { statisticsResourceFilter, statisticsOptions, statisticsScope, statisticsProperties } from './statistics-scope';
import { businessDay, reportQuery } from './analytics-policy';
import { businessPolicy, notifyOpportunity } from './business-policy';
import { recalculateCustomerContracts } from './contract-change-policy';
import {businessReport} from './business-report-policy';
import {contractTrades} from './trade-store';
import {ownTradeAmount} from './trade-policy';
import { salesAmountProjection, salesIntakeMeta, salesForecastEligible } from './sales-intake-policy';
import { followupTime } from './sales-activity-policy';
import { opportunityFollowInput, opportunityFollowSchema } from './opportunity-follow-policy';
import { pendingCustomerName } from './pending-customer';
import { workspaceSortFields, defaultWorkspaceSort, workspaceOrderBy } from './workspace-sort';
import { paymentSchedule, paymentScheduleSchema } from './payment-schedule';
import { financeEventsForActor, hideReceiptCorrectionFields } from './finance-policy';
import { deliveryPeople, handoverProjectManager } from './delivery-staff-policy';
import {
  activeDelivery,
  deliveryEvent,
  deliveryManager,
  projectDeliveryCommand,
  redactTaskEvidence,
  taskHours,
  taskProject,
  validateTaskMilestone,
} from './delivery-policy';
import { checkVersion, id, object, runCommand, text, json, validateActor, type Tx, type Row } from './command-runner';

// Runtime registry delegates are constrained to resource(), while payloads are validated by cleanInput().
interface Delegate {
  findMany(args: Record<string, unknown>): Promise<Row[]>;
  findFirst(args: Record<string, unknown>): Promise<Row | null>;
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<Row>;
  update(args: Record<string, unknown>): Promise<Row>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
}
const code = (prefix: string) => prefix + randomUUID().replaceAll('-', '').slice(0, 16);
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approval: ApprovalService,
  ) {}
  private db(tx: Tx, kind: string): Delegate {
    return (tx as unknown as Record<string, Delegate>)[resource(kind).model];
  }
  async schema(a: Actor) {
    const canWrite = admin(a) || manager(a) || a.roles.includes('sales');
    return Object.entries(resources)
      .filter(([key]) => hasPermission(a, resourcePermission(key, 'read')))
      .map(([key, r]) => {
        const canCreate = !!(
          canWrite &&
          !boss(a) &&
          !r.readonly &&
          hasPermission(a, resourcePermission(key, 'create')) &&
          (key !== 'products' || admin(a))
        );
        const canEdit = !!(
          canWrite &&
          !boss(a) &&
          !r.readonly &&
          hasPermission(a, resourcePermission(key, 'update')) &&
          (key !== 'products' || admin(a))
        );
        const actions = canEdit
          ? r.actions.filter(
              (action) =>
                action !== 'follow' &&
                (!['assign', 'accept', 'reject_acceptance', 'handover_pm'].includes(action) ||
                  admin(a) ||
                  manager(a)) &&
                (key !== 'customers' ||
                  !['assign', 'claim', 'return'].includes(action) ||
                  hasPermission(a, action === 'assign' ? 'customer:assign' : 'pool:' + action)),
            )
          : [];
        const properties = Object.fromEntries(
          r.fields.map((f) => [
            f.key,
            {
              type:
                f.type === 'reference' || f.type === 'number'
                  ? 'number'
                  : f.type === 'money'
                    ? ['string', 'number']
                    : 'string',
              ...(f.options ? { enum: f.options } : {}),
              description: f.label,
            },
          ]),
        );
        const commandProperties = {
          requestKey: { type: 'string', minLength: 1, maxLength: 80 },
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
        };
        return {
          key,
          ...r,
          version: '1.0',
          canCreate,
          canEdit,
          sortFields:workspaceSortFields(key), defaultSort:defaultWorkspaceSort(key),
          actions,
          operations: [
            ...(key === 'customers' && canCreate
              ? [
                  {
                    id: 'customers.duplicate.check',
                    version: '1.0',
                    effect: 'read',
                    permission: 'customer:create or customer:update; current scope',
                    route: 'POST /workspace/customers/duplicate-check',
                    inputSchema: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        name: { type: 'string', maxLength: 200 },
                        shortName: { type: 'string', maxLength: 100 },
                        creditCode: { type: 'string' },
                        companyPhone: { type: 'string', maxLength: 50 },
                        website: { type: 'string', maxLength: 200 },
                        address: { type: 'string', maxLength: 500 },
                        legalPerson: { type: 'string', maxLength: 50 },
                        excludeId: { type: 'integer', minimum: 1 },
                      },
                    },
                    outputSchema: {
                      type: 'object',
                      required: ['hardDuplicate', 'matches', 'restrictedMatch'],
                      properties: {
                        hardDuplicate: { type: 'boolean' },
                        restrictedMatch: { type: 'boolean' },
                        matches: { type: 'array', maxItems: 20 },
                      },
                    },
                    guards: [
                      'live actor; tenant only',
                      'excluded record must be visible',
                      'protected matches reveal no identifiers, names or owners',
                      '10000 row budget; no silent truncation',
                    ],
                    evidence: ['visible reason projection; hard duplicate enforcement repeated on writes'],
                  },
                ]
              : []),
            ...(key === 'customers' && (admin(a) || manager(a))
              ? [
                  {
                    id: 'customers.assignment.people',
                    version: '1.0',
                    effect: 'read',
                    permission: 'customer:update; admin or sales_manager',
                    route: 'GET /workspace/customers/{recordId}/assignment-people',
                    inputSchema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['recordId'],
                      properties: { recordId: { type: 'integer', minimum: 1 } },
                    },
                    outputSchema: {
                      type: 'array',
                      maxItems: 200,
                      items: { type: 'object', required: ['id', 'name', 'deptId'] },
                    },
                    guards: [
                      'live authenticated actor',
                      'customer visibility',
                      'active sales accounts; same department for manager',
                      'bounded eligible recipient projection; no credentials',
                    ],
                    evidence: [
                      'recipient id and department; assignment separately rechecks permissions and customer version',
                    ],
                  },
                ]
              : []),
            ...(['projects', 'tasks'].includes(key) && canEdit
              ? [
                  {
                    id: `${key}.delivery_recipients`,
                    version: '1.0',
                    effect: 'read',
                    permission: 'project:update and delivery management scope',
                    route: `/workspace/${key}/{recordId}/delivery-people`,
                    agentExposed: false,
                    inputSchema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['recordId'],
                      properties: { recordId: { type: 'integer', minimum: 1 } },
                    },
                    outputSchema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'name', 'deptId'],
                        properties: {
                          id: { type: 'integer' },
                          name: { type: 'string' },
                          deptId: { type: ['integer', 'null'] },
                        },
                      },
                    },
                    guards: [
                      'tenant and parent project management scope',
                      'active account and department',
                      'recipient role and project permissions',
                      'department boundary',
                    ],
                    evidence: ['bounded eligible recipient projection; no credentials'],
                  },
                ]
              : []),
            {
              id: `${key}.list`,
              version: '1.0',
              effect: 'read',
              permission: 'authenticated role and tenant record scope',
              inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  page: { type: 'integer', minimum: 1 },
                  pageSize: { type: 'integer', minimum: 1, maximum: 100 },
                  keyword: { type: 'string', maxLength: 100 },
                  sortBy:{enum:workspaceSortFields(key).map(f=>f.key)},sortOrder:{enum:['asc','desc']},
                  ...statisticsProperties,
                  from: { type:'string',format:'date',description:'Inclusive 2010..2060 business date; provide to together' },
                  to: { type:'string',format:'date' },
                  dateField:{type:'string',description:'Resource-specific server allowlisted date axis'},
                  ...(key==='customers'?{customerCategory:{enum:['direct','sales_channel']},channelBrand:{enum:['钉钉','用友','阿里','其他']}}:{}),
                },
              },
              outputSchema: { type: 'object', required: ['items', 'meta'] },
            },
            {
              id: `${key}.get`,
              version: '1.0',
              effect: 'read',
              inputSchema: {
                type: 'object',
                required: ['recordId'],
                properties: { recordId: { type: 'integer', minimum: 1 } },
              },
              outputSchema: { type: 'object', required: ['id'] },
            },
            ...(canCreate
              ? [
                  {
                    id: `${key}.create`,
                    version: '1.0',
                    effect: 'write',
                    permission: 'admin, sales_manager or sales; same tenant and permitted references',
                    inputSchema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['requestKey', 'data'],
                      properties: {
                        requestKey: commandProperties.requestKey,
                        data: {
                          type: 'object',
                          additionalProperties: false,
                          properties,
                          required: r.fields.filter((f) => f.required).map((f) => f.key),
                        },
                      },
                    },
                    guards: ['validated references', 'serializable transaction', 'durable idempotency', 'audit'],
                    outputSchema: { type: 'object', required: ['id'] },
                  },
                ]
              : []),
            ...(canEdit
              ? [
                  {
                    id: `${key}.update`,
                    version: '1.0',
                    effect: 'write',
                    permission: resourcePermission(key, 'update'),
                    inputSchema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['requestKey', 'expectedUpdatedAt', 'data'],
                      properties: {
                        ...commandProperties,
                        data: { type: 'object', additionalProperties: false, properties },
                      },
                    },
                    guards: [
                      'record scope',
                      'expectedUpdatedAt',
                      'immutable object references',
                      'draft state for contracts/orders/projects',
                      'serializable transaction',
                      'audit',
                    ],
                    outputSchema: { type: 'object', required: ['id'] },
                  },
                ]
              : []),
            ...actions.map((action) => ({
              id: `${key}.${action}`,
              version:
                key === 'projects' || key === 'tasks' || (key === 'contracts' && action === 'sign') ? '2.0' : '1.0',
              effect: 'write',
              permission: resourcePermission(key, 'update'),
              inputSchema: {
                type: 'object',
                required: [
                  'requestKey',
                  'expectedUpdatedAt',
                  ...(key==='opportunities'&&action==='follow'?['followup']:[]),
                  ...(key === 'contracts' && action === 'sign' ? ['paymentSchedule'] : []),
                  ...((key === 'projects' &&
                    ['advance', 'request_acceptance', 'reject_acceptance', 'accept', 'handover_pm'].includes(action)) ||
                  key === 'tasks'
                    ? ['note']
                    : []),
                  ...(key === 'tasks' && action === 'complete' ? ['actualHours'] : []),
                  ...(['assign_task', 'handover_pm'].includes(action) ? ['userId'] : []),
                ],
                properties: {
                  ...commandProperties,
                  ...(key === 'contracts' && action === 'sign' ? { paymentSchedule: paymentScheduleSchema } : {}),
                  ...(action === 'submit'
                    ? {
                        form: {
                          type: 'object',
                          description: 'Fields are resolved from the document approval-form endpoint',
                        },
                      }
                    : {}),
                  ...(['assign', 'assign_task', 'handover_pm'].includes(action)
                    ? { userId: { type: 'integer', minimum: 1 } }
                    : {}),
                  ...(action === 'quote' ? { items: { type: 'array', minItems: 1, maxItems: 20 } } : {}),
                  ...(action === 'lose' ? { reason: { type: 'string', minLength: 1 } } : {}),
                  ...(key==='opportunities'&&action==='follow'?{followup:opportunityFollowSchema.toJSONSchema()}:{}),
                  ...((key === 'projects' &&
                    ['advance', 'request_acceptance', 'reject_acceptance', 'accept', 'handover_pm'].includes(action)) ||
                  key === 'tasks'
                    ? { note: { type: 'string', minLength: 1, maxLength: 3000 } }
                    : {}),
                  ...(key === 'tasks' && action === 'complete'
                    ? { actualHours: { type: 'string', pattern: '^\\d{1,4}(\\.\\d)?$' } }
                    : {}),
                },
              },
              guards: [
                'record scope',
                'expectedUpdatedAt',
                'business state preconditions',
                  ...(key==='opportunities'&&action==='follow'?['follow_up:create and visible customer','optional action:create with active opportunity owner','followup and optional action/calendar share one transaction','no external notifications']:[]),
                ...(key === 'opportunities' && action === 'advance' ? ['next active stage only'] : []),
                ...(key === 'opportunities' && action === 'lose'
                  ? ['open opportunity; closedAt and zero weightedAmount atomically']
                  : []),
                ...(key === 'contracts' && action === 'sign'
                  ? [
                      'approved contract; linked opportunity must be open; atomic won closedAt/winDate; explicit installments sum to contract amount',
                    ]
                  : []),
                'serializable transaction',
                'durable idempotency',
                'audit',
              ],
              outputSchema: { type: 'object', required: ['id'] },
            })),
          ],
        };
      });
  }
  async scope(tx: Tx, a: Actor, kind: string): Promise<Record<string, unknown>> {
    const r = resource(kind);
    requirePermission(a, kind, 'read');
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === r.model);
    const base = {
      tenantId: a.tenantId,
      ...(model?.fields.some((f) => f.name === 'deletedAt') ? { deletedAt: null } : {}),
    };
    if (companyWide(a) || kind === 'products') return base;
    let visibility: Record<string, unknown>;
    if (kind === 'customers') visibility = await customerScope(tx, a);
    else if (['opportunities', 'contracts', 'orders'].includes(kind)) visibility = await ownerScope(tx, a);
    else if (kind === 'leads')
      visibility = { OR: [await ownerScope(tx, a, 'assigneeId'), await ownerScope(tx, a, 'createdBy')] };
    else if (kind === 'projects')
      visibility = {
        OR: [
          await ownerScope(tx, a, 'salesOwnerId'),
          await ownerScope(tx, a, 'pmId'),
          {
            tasks: {
              some: {
                tenantId: a.tenantId,
                deletedAt: null,
                status: { notIn: ['done', 'cancelled'] },
                ...(await ownerScope(tx, a, 'assigneeId')),
              },
            },
          },
        ],
      };
    else if (kind === 'contacts')
      visibility = { customer: { tenantId: a.tenantId, deletedAt: null, ...(await customerScope(tx, a, false)) } };
    else if (kind === 'tasks')
      visibility = {
        OR: [
          await ownerScope(tx, a, 'assigneeId'),
          {
            project: {
              tenantId: a.tenantId,
              deletedAt: null,
              OR: [await ownerScope(tx, a, 'salesOwnerId'), await ownerScope(tx, a, 'pmId')],
            },
          },
        ],
      };
    else if (kind === 'receipts') visibility = { OR: [
      { contractId: { in: (await tx.contract.findMany({where:{tenantId:a.tenantId,deletedAt:null,...(await ownerScope(tx,a))},select:{id:true}})).map(c=>c.id) } },
      { contractId: null, customerId: { in: (await tx.customer.findMany({ where: {tenantId:a.tenantId,deletedAt:null,...(await customerScope(tx,a,false))},select:{id:true} })).map(c=>c.id) } },
    ] };
    else if (kind === 'followups')
      visibility = {
        customerId: {
          in: (
            await tx.customer.findMany({
              where: { tenantId: a.tenantId, deletedAt: null, ...(await customerScope(tx, a, false)) },
              select: { id: true },
            })
          ).map((c) => c.id),
        },
      };
    else if (kind === 'actions') visibility = await ownerScope(tx, a, 'assigneeId');
    else visibility = { contract: { tenantId: a.tenantId, deletedAt: null, ...(await ownerScope(tx, a)) } };
    return { ...base, AND: [visibility] };
  }
  private async require(tx: Tx, a: Actor, kind: string, recordId: number) {
    const row = await this.db(tx, kind).findFirst({ where: { ...(await this.scope(tx, a, kind)), id: recordId } });
    if (!row) throw new NotFoundException('记录不存在或无权访问');
    return row;
  }
  private async deliveryAuthority(tx: Tx, a: Actor, projectId: number) {
    const p = await taskProject(tx, a, projectId);
    deliveryManager(a, p);
    if (
      !companyWide(a) &&
      p.pmId !== a.userId &&
      !(await tx.project.findFirst({
        where: {
          tenantId: a.tenantId,
          id: projectId,
          deletedAt: null,
          OR: [await ownerScope(tx, a, 'salesOwnerId'), await ownerScope(tx, a, 'pmId')],
        },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('任务协作可读取项目，不授予其他部门项目的管理权限');
    return p;
  }
  async list(a: Actor, kind: string, query: Record<string, string>) {
    const r = resource(kind),
      tx = this.prisma.system;
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new BadRequestException('分页参数无效');
    const baseScope = await this.scope(tx, a, kind);
    const filtered = query.personRange !== undefined ? await statisticsResourceFilter(tx, a, kind, await statisticsScope(tx, a, query)) : {};
    const where: Record<string, unknown> = { AND: [baseScope, filtered] };
    if (query.keyword) where[r.name] = { contains: query.keyword.slice(0, 100) };
    if (query.status) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === r.model);
      const field = model?.fields.find((f) => f.name === 'status');
      const values = Prisma.dmmf.datamodel.enums.find((e) => e.name === field?.type)?.values.map((v) => v.name) ?? [];
      if (!values.includes(query.status)) throw new BadRequestException('状态筛选值无效');
      where.status = query.status;
    }
    if (query.poolType && kind === 'customers') {
      if (!['public', 'private', 'dept'].includes(query.poolType)) throw new BadRequestException('客户池无效');
      where.poolType = query.poolType;
    }
    if (kind === 'customers' && query.ownerId && query.personRange===undefined) where.ownerId = id(Number(query.ownerId));
    if (kind === 'customers' && query.customerCategory) {
      if (!['direct','sales_channel'].includes(query.customerCategory)) throw new BadRequestException('客户标记无效');
      where.customerCategory = query.customerCategory;
    }
    if (kind === 'customers' && query.channelBrand) {
      if (!['钉钉','用友','阿里','其他'].includes(query.channelBrand)) throw new BadRequestException('渠道标记无效');
      where.channelBrand = query.channelBrand;
    }
    if (query.from || query.to) {
      const p=reportQuery({from:query.from,to:query.to});
      const defaults: Record<string,string>={contracts:'signDate',opportunities:'expectedCloseDate','payment-plans':'dueDate',invoices:'invoiceDate',receipts:'receiptDate',actions:'dueDate',tasks:'dueDate'};
      const field=query.dateField ?? defaults[kind] ?? 'createdAt';
      const allowed=kind==='contracts'?['createdAt','signDate','startDate','endDate']:[defaults[kind]??'createdAt','createdAt'];
      if(!allowed.includes(field))throw new BadRequestException('日期筛选字段无效');
      where[field]={gte:new Date(p.start.getTime()-(field==='createdAt'?8*3600000:0)),lt:new Date(p.end.getTime()-(field==='createdAt'?8*3600000:0))};
    }
    if (query.customerId && r.fields.some((f) => f.key === 'customerId'))
      where.customerId = id(Number(query.customerId));
    const [items, total] = await Promise.all([
      this.db(tx, kind).findMany({
        where,
        orderBy: workspaceOrderBy(kind,query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db(tx, kind).count({ where }),
    ]);
    const userIds = [
      ...new Set(
        items
          .flatMap((row) => [row.ownerId, row.assigneeId, row.pmId, row.salesOwnerId])
          .filter((v): v is number => typeof v === 'number'),
      ),
    ];
    const names = new Map(
      (
        await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: userIds } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const customerIds = [
      ...new Set(items.map((row) => row.customerId).filter((v): v is number => typeof v === 'number')),
    ];
    const customerNames = new Map(
      (
        await tx.customer.findMany({
          where: { tenantId: a.tenantId, id: { in: customerIds } },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );
    for (const row of items) {
      if(kind==='opportunities')Object.assign(row,salesAmountProjection(row));
      if(kind==='followups') row.activityAt=followupTime({createdAt:row.createdAt as Date,aiStructured:row.aiStructured});
      if (kind === 'receipts') hideReceiptCorrectionFields(a, row);
      if (typeof row.ownerId === 'number') row.ownerName = names.get(row.ownerId) ?? '未分配';
      if (typeof row.assigneeId === 'number') row.assigneeName = names.get(row.assigneeId) ?? '未分配';
      if (typeof row.customerId === 'number') row.customerName = customerNames.get(row.customerId) ?? '—';
    }
    return {
      items: items.map((row) =>
        kind === 'customers' && row.poolType === 'public' && !admin(a) && !boss(a)
          ? {
              id: row.id,
              name: row.name,
              code: row.code,
              industry: row.industry,
              level: row.level,
              region: row.region,
              poolType: 'public',
              updatedAt: row.updatedAt,
            }
          : row,
      ),
      meta: { page, pageSize, total },
    };
  }
  async detail(a: Actor, kind: string, recordId: number) {
    const tx = this.prisma.system,
      row = await this.require(tx, a, kind, recordId);
    if (kind === 'receipts') hideReceiptCorrectionFields(a, row);
    if(kind==='opportunities')Object.assign(row,salesAmountProjection(row));
    if(typeof row.customerId==='number') row.customerName=(await tx.customer.findFirst({where:{tenantId:a.tenantId,id:row.customerId},select:{name:true}}))?.name??'—';
    if(typeof row.ownerId==='number') row.ownerName=(await tx.user.findFirst({where:{tenantId:a.tenantId,id:row.ownerId},select:{name:true}}))?.name??'历史负责人';
    if (kind === 'customers' && row.poolType === 'public' && !admin(a) && !boss(a))
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        industry: row.industry,
        region: row.region,
        poolType: row.poolType,
        updatedAt: row.updatedAt,
      };
    const related: Record<string, unknown> = {};
    if (kind === 'customers') {
      for (const child of ['contacts', 'opportunities', 'contracts', 'projects', 'followups'])
        if (hasPermission(a, resourcePermission(child, 'read')))
        related[child] = (await this.db(tx, child).findMany({
          where: { ...(await this.scope(tx, a, child)), customerId: recordId },
          take: 30,
          orderBy: { createdAt: 'desc' },
        })).map(r=>child==='opportunities'?salesAmountProjection(r):r);
      if (hasPermission(a, 'action:read')) related.actions = await tx.actionPlan.findMany({
        where: { ...(await this.scope(tx, a, 'actions')), targetType: 'customer', targetId: recordId },
        take: 30, orderBy: { dueDate: 'asc' },
      });
    }
    if (kind === 'opportunities') {
      if (hasPermission(a, 'follow_up:read')) related.followups = await tx.followUp.findMany({
        where: { ...(await this.scope(tx, a, 'followups')), targetType: 'opportunity', targetId: recordId },
        take: 30, orderBy: { createdAt: 'desc' },
      });
      if (hasPermission(a, 'action:read')) related.actions = await tx.actionPlan.findMany({
        where: { ...(await this.scope(tx, a, 'actions')), targetType: 'customer', targetId: row.customerId as number },
        take: 30, orderBy: { dueDate: 'asc' },
      });
      if(typeof row.contractId==='number'&&hasPermission(a,'contract:read'))related.linkedContract=await tx.contract.findMany({where:{...(await this.scope(tx,a,'contracts')),id:row.contractId}});
      related.quote = await tx.opportunityProduct.findMany({
        where: { tenantId: a.tenantId, opportunityId: recordId },
      });
      related.quoteVersions = await tx.opportunityQuote.findMany({
        where: { tenantId: a.tenantId, opportunityId: recordId },
        orderBy: { version: 'desc' },
        take: 30,
      });
    }
    if (kind === 'contracts') {
      if (hasPermission(a,'action:read')) related.actions = await tx.actionPlan.findMany({
        where:{...(await this.scope(tx,a,'actions')),targetType:'customer',targetId:row.customerId as number,actionType:'contract_lifecycle',title:('成交路径｜'+String(row.contractNo)+'｜'+String(row.name)).slice(0,200)},take:30,
      });
      if (hasPermission(a,'opportunity:read')) related.opportunities = (await tx.opportunity.findMany({
        where: { AND: [await this.scope(tx,a,'opportunities'), { OR: [{contractId:recordId}, ...(typeof row.opportunityId==='number'?[{id:row.opportunityId}]:[])] }] }, take:30,
      })).map(r=>salesAmountProjection(r));
      related.items=await tx.contractItem.findMany({where:{tenantId:a.tenantId,contractId:recordId},orderBy:{sortOrder:'asc'}});
      related.changes = await tx.contractChange.findMany({
        where: { tenantId: a.tenantId, contractId: recordId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      if (hasPermission(a, 'order:read')) related.orders = await tx.order.findMany({
        where: { ...(await this.scope(tx, a, 'orders')), contractId: recordId },
      });
      if (hasPermission(a, 'finance:read')) {
        related['payment-plans'] = await tx.paymentPlan.findMany({ where: { ...(await this.scope(tx, a, 'payment-plans')), contractId: recordId } });
        related.invoices = await tx.invoice.findMany({ where: { ...(await this.scope(tx, a, 'invoices')), contractId: recordId }, orderBy: { invoiceDate: 'asc' } });
        related.receipts = await tx.receipt.findMany({ where: { ...(await this.scope(tx, a, 'receipts')), contractId: recordId }, orderBy: { receiptDate: 'asc' } });
      }
    }
    if (kind === 'projects') {
      const tasks = await this.db(tx, 'tasks').findMany({
        where: { ...(await this.scope(tx, a, 'tasks')), projectId: recordId },
      });
      related.deliveryEvents = redactTaskEvidence(
        await tx.deliveryEvent.findMany({
          where: { tenantId: a.tenantId, projectId: recordId },
          orderBy: { id: 'desc' },
          take: 100,
        }),
        new Set(tasks.map((t) => id(t.id))),
      );
      related.tasks = tasks;
      related.milestones = await tx.projectMilestone.findMany({
        where: { tenantId: a.tenantId, projectId: recordId },
        orderBy: { sortOrder: 'asc' },
      });
    }
    if (kind === 'tasks')
      related.deliveryEvents = await tx.deliveryEvent.findMany({
        where: { tenantId: a.tenantId, taskId: recordId, projectId: id(row.projectId) },
        orderBy: { id: 'desc' },
        take: 100,
      });
    if (kind === 'receipts') {
      related.allocations = await tx.receiptAllocation.findMany({
        where: { tenantId: a.tenantId, receiptId: recordId, paymentPlan: { contract: { tenantId:a.tenantId,deletedAt:null,...(await ownerScope(tx,a)) } } },
        orderBy: { id: 'desc' },
        take: 100,
      });
      related.financeEvents = financeEventsForActor(
        a,
        await tx.financeEvent.findMany({
          where: { tenantId: a.tenantId, receiptId: recordId },
          orderBy: { id: 'desc' },
          take: 100,
        }),
      );
    }
    return { ...row, related };
  }
  async approvalForm(a: Actor, kind: string, recordId: number) {
    const mapping: Record<string, string> = { contracts: 'contract', orders: 'order', projects: 'project_initiation' };
    if (!mapping[kind]) throw new BadRequestException('该对象不支持业务审批');
    const tx = this.prisma.system,
      row = await this.require(tx, a, kind, recordId);
    const flow = await this.approval.matchFlow(
      tx,
      a,
      mapping[kind],
      new Prisma.Decimal(String(row.amount ?? row.totalAmountInclTax ?? row.budgetAmount ?? 0)),
    );
    const definition =
      flow.definition && typeof flow.definition === 'object' && !Array.isArray(flow.definition) ? flow.definition : {};
    return { name: flow.name, version: flow.version, fields: definition.fields ?? [] };
  }
  async duplicateCheck(a: Actor, body: Record<string, unknown>) {
    const { excludeId, ...input } = object(body);
    if (
      Object.keys(input).some(
        (k) => !['name', 'shortName', 'creditCode', 'companyPhone', 'website', 'address', 'legalPerson'].includes(k),
      )
    )
      throw new BadRequestException('存在未定义查重参数');
    const recordId = excludeId === undefined ? undefined : id(excludeId);
    requirePermission(a, 'customers', recordId ? 'update' : 'create');
    const normalized = cleanInput('customers', input, true) as IdentityInput;
    normalized.creditCode = creditCode(normalized.creditCode);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        if (recordId) await this.require(tx, a, 'customers', recordId);
        const rows = await tx.customer.findMany({
          where: { tenantId: a.tenantId, ...(recordId ? { id: { not: recordId } } : {}) },
          select: {
            id: true,
            name: true,
            shortName: true,
            creditCode: true,
            companyPhone: true,
            website: true,
            address: true,
            legalPerson: true,
          },
          take: 10001,
        });
        if (rows.length > 10000) throw new BadRequestException('客户查重超过10000条预算，请联系管理员');
        const visible = new Set(
          (await tx.customer.findMany({ where: await this.scope(tx, a, 'customers'), select: { id: true } })).map(
            (r) => r.id,
          ),
        );
        const matches: { id: number; name: string; hard: boolean; reasons: string[] }[] = [];
        let hardDuplicate = false,
          restrictedMatch = false;
        for (const row of rows) {
          const match = identityMatch(normalized, row);
          if (!match.reasons.length) continue;
          hardDuplicate ||= match.hard;
          if (!visible.has(row.id)) restrictedMatch = true;
          else if (matches.length < 20) matches.push({ id: row.id, name: row.name, ...match });
        }
        return { hardDuplicate, restrictedMatch, matches };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private assignmentAuthority(a: Actor) {
    requirePermission(a, 'customers', 'update');
    if ((!admin(a) && !manager(a)) || !hasPermission(a, 'customer:assign'))
      throw new ForbiddenException('没有客户分配权限');
  }
  async allocationPeople(a: Actor) {
    this.assignmentAuthority(a);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const rows = await tx.user.findMany({
        where: {
          tenantId: a.tenantId,
          status: 'active',
          deletedAt: null,
          ...(!admin(a) ? { deptId: a.deptId } : {}),
          department: { status: 1, deletedAt: null },
          roles: { some: { role: { code: 'sales' } } },
        },
        include: { roles: { include: { role: true } } },
        take: 201,
        orderBy: { id: 'asc' },
      });
      if (rows.length > 200) throw new BadRequestException('可分配人员超过200人预算');
      return rows
        .filter((u) =>
          ['customer:read', 'customer:update'].every((p) =>
            permits(
              u.roles.flatMap((r) => strings(r.role.permissions)),
              p,
            ),
          ),
        )
        .map((u) => ({ id: u.id, name: u.name, deptId: u.deptId }));
    });
  }
  private async assignmentPlan(tx: Tx, a: Actor, customerId: number, targetId: number, expected: unknown) {
    this.assignmentAuthority(a);
    const row = await this.require(tx, a, 'customers', customerId);
    checkVersion(row as { updatedAt: Date }, expected);
    const counts = await Promise.all([
      tx.opportunity.count({ where: { tenantId: a.tenantId, customerId, deletedAt: null } }),
      tx.contract.count({ where: { tenantId: a.tenantId, customerId, deletedAt: null } }),
      tx.order.count({ where: { tenantId: a.tenantId, customerId, deletedAt: null } }),
      tx.project.count({ where: { tenantId: a.tenantId, customerId, deletedAt: null } }),
      tx.lead.count({ where: { tenantId: a.tenantId, convertedCustomerId: customerId, deletedAt: null } }),
    ]);
    if (counts.some(Boolean)) throw new ConflictException('客户含关联销售业务，请使用整体交接入口');
    const target = await tx.user.findFirst({
      where: {
        id: targetId,
        tenantId: a.tenantId,
        status: 'active',
        deletedAt: null,
        department: { status: 1, deletedAt: null },
        ...(!admin(a) ? { deptId: a.deptId } : {}),
        roles: { some: { role: { code: 'sales' } } },
      },
      include: { roles: { include: { role: true } } },
    });
    if (
      !target ||
      !['customer:read', 'customer:update'].every((p) =>
        permits(
          target.roles.flatMap((r) => strings(r.role.permissions)),
          p,
        ),
      )
    )
      throw new BadRequestException('接收人需为可分配部门中已启用、有客户查看/编辑权限的销售');
    if (row.ownerId === target.id && row.poolType === 'private') throw new ConflictException('客户已属于该销售');
    return { row, target };
  }
  async assignCustomerInTransaction(
    tx: Tx,
    a: Actor,
    customerId: number,
    targetId: number,
    expected: unknown,
    stamp?: Date,
  ) {
    const { row, target } = await this.assignmentPlan(tx, a, customerId, targetId, expected);
    const until = new Date(Date.now() + 30 * 86400000);
    await tx.customer.update({
      where: { id: customerId },
      data: {
        poolType: 'private',
        ownerId: target.id,
        ownerDeptId: target.deptId,
        protectUntil: until,
        updatedAt: stamp ?? new Date(Math.max(Date.now(), new Date(row.updatedAt!).getTime() + 1)),
      },
    });
    await tx.privateHolding.deleteMany({ where: { tenantId: a.tenantId, customerId } });
    await tx.privateHolding.create({
      data: { tenantId: a.tenantId, userId: target.id, customerId, claimedAt: new Date(), protectUntil: until },
    });
    return {
      id: customerId,
      name: String(row.name),
      fromUserId: row.ownerId,
      toUserId: target.id,
      toName: target.name,
    };
  }
  private allocationInput(body: Record<string, unknown>, write: boolean) {
    object(body);
    if (Object.keys(body).some((k) => !['records', 'userId', 'reason', ...(write ? ['requestKey'] : [])].includes(k)))
      throw new BadRequestException('不允许的分配参数');
    if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > 50)
      throw new BadRequestException('每批选择1至50个客户');
    const records = body.records.map((item) => {
      const row = object(item);
      if (Object.keys(row).some((k) => !['id', 'expectedUpdatedAt'].includes(k)))
        throw new BadRequestException('不允许的客户字段');
      return { id: id(row.id), expectedUpdatedAt: text(row.expectedUpdatedAt, '版本', 40) };
    });
    if (new Set(records.map((r) => r.id)).size !== records.length) throw new BadRequestException('客户不能重复');
    return { records, target: id(body.userId), reason: text(body.reason, '分配原因', 500) };
  }
  async allocationPreview(a: Actor, body: Record<string, unknown>) {
    this.assignmentAuthority(a);
    const input = this.allocationInput(body, false);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const items = [];
        for (const r of input.records) {
          const p = await this.assignmentPlan(tx, a, r.id, input.target, r.expectedUpdatedAt);
          items.push({
            id: p.row.id,
            name: String(p.row.name),
            fromUserId: p.row.ownerId,
            toUserId: p.target.id,
            toName: p.target.name,
          });
        }
        return { items, reason: input.reason, count: items.length };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
  allocationCommit(a: Actor, body: Record<string, unknown>) {
    this.assignmentAuthority(a);
    const input = this.allocationInput(body, true);
    return runCommand(
      this.prisma,
      a,
      'customer.allocation.batch@1.0',
      body,
      async (tx) => {
        const items = [];
        for (const r of input.records)
          items.push(await this.assignCustomerInTransaction(tx, a, r.id, input.target, r.expectedUpdatedAt));
        return { items, count: items.length, reason: input.reason };
      },
      async (tx) => {
        for (const record of input.records) await this.require(tx, a, 'customers', record.id);
      },
    );
  }
  async assignmentRecipients(a: Actor, recordId: number) {
    this.assignmentAuthority(a);
    await this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      await this.require(tx, a, 'customers', recordId);
    });
    return this.allocationPeople(a);
  }
  async allocationOwners(a: Actor) {
    this.assignmentAuthority(a);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const rows = await tx.user.findMany({
        where: {
          tenantId: a.tenantId,
          deletedAt: null,
          ...(!companyWide(a) ? { id: { in: await teamIds(tx, a) } } : {}),
        },
        select: { id: true, name: true, status: true, deptId: true },
        take: 501,
        orderBy: { id: 'asc' },
      });
      if (rows.length > 500) throw new BadRequestException('人员超过500人查询预算');
      return rows;
    });
  }
  async allocationHistory(a: Actor) {
    this.assignmentAuthority(a);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const history = await tx.auditLog.findMany({
          where: {
            tenantId: a.tenantId,
            action: { in: ['customer.allocation.batch@1.0', 'customers.assign'] },
            ...(!admin(a) ? { userId: a.userId } : {}),
          },
          orderBy: { id: 'desc' },
          take: 50,
        });
        const parsed = history.map((row) => {
          const result =
            row.afterData && typeof row.afterData === 'object' && !Array.isArray(row.afterData) ? row.afterData : {};
          const historyItems = Array.isArray(result.items)
            ? result.items
            : result.assignment && typeof result.assignment === 'object' && !Array.isArray(result.assignment)
              ? [result.assignment]
              : [];
          const items = Array.isArray(historyItems)
            ? historyItems.filter(
                (item): item is { [key: string]: import('@prisma/client').Prisma.JsonValue } =>
                  !!item && typeof item === 'object' && !Array.isArray(item),
              )
            : [];
          return { row, result, items };
        });
        const ids = parsed.flatMap((h) => h.items.map((item) => Number(item.id))).filter(Number.isSafeInteger);
        const visible = await tx.customer.findMany({
          where: { tenantId: a.tenantId, deletedAt: null, id: { in: ids }, AND: [await customerScope(tx, a)] },
          select: { id: true },
        });
        const allowed = new Set(visible.map((r) => r.id));
        return parsed
          .map(({ row, result, items }) => ({
            id: row.id,
            createdAt: row.createdAt,
            actorId: row.userId,
            reason: items.every((r) => allowed.has(Number(r.id)))
              ? String(result.reason ?? '')
              : '部分客户已不在当前可见范围，历史原因隐藏',
            items: items.filter((item) => allowed.has(Number(item.id))),
          }))
          .filter((r) => r.items.length);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async deliveryRecipients(a: Actor, kind: string, recordId: number) {
    allowWrite(a);
    if (!['projects', 'tasks'].includes(kind)) throw new BadRequestException('仅用于交付人员交接');
    requirePermission(a, kind, 'update');
    const tx = this.prisma.system,
      row = await this.require(tx, a, kind, recordId);
    const p = await taskProject(tx, a, kind === 'projects' ? recordId : id(row.projectId));
    await this.deliveryAuthority(tx, a, p.id);
    if (kind === 'projects' && !admin(a) && !manager(a)) throw new ForbiddenException('仅管理员或主管可交接项目经理');
    return deliveryPeople(tx, a, p);
  }
  private async references(tx: Tx, a: Actor, kind: string, data: Record<string, unknown>) {
    for (const f of resource(kind).fields)
      if (f.reference && data[f.key]) {
        const ref = await this.require(tx, a, f.reference, id(data[f.key]));
        if (f.reference === 'customers' && ref.poolType === 'public' && !admin(a) && !manager(a))
          throw new ForbiddenException('请先领取客户再开展业务');
      }
    if (data.opportunityId) {
      const opp = await this.require(tx, a, 'opportunities', id(data.opportunityId));
      if (opp.customerId !== data.customerId) throw new BadRequestException('商机与客户不匹配');
    }
    if (data.contractId && data.customerId) {
      const c = await this.require(tx, a, 'contracts', id(data.contractId));
      if (c.customerId !== data.customerId) throw new BadRequestException('合同与客户不匹配');
    }
    if (data.plannedStartDate && data.plannedEndDate && Number(data.plannedStartDate) > Number(data.plannedEndDate))
      throw new BadRequestException('结束日期不能早于开始日期');
  }
  async save(a: Actor, kind: string, body: Record<string, unknown>, recordId?: number) {
    allowWrite(a);
    const r = resource(kind);
    if (!r.readonly) requirePermission(a, kind, recordId ? 'update' : 'create');
    if (Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'data'].includes(k)))
      throw new BadRequestException('存在未定义参数');
    if (r.readonly) throw new BadRequestException('该模块当前只读，写入功能尚未开通');
    if (kind === 'products' && !admin(a)) throw new ForbiddenException('产品目录仅管理员可维护');
    const data = cleanInput(kind, body.data, !!recordId);
    return runCommand(
      this.prisma,
      a,
      `${kind}.${recordId ? 'update' : 'create'}`,
      { ...body, recordId },
      async (tx) => {
        if (kind === 'actions' && !recordId) return this.createAction(tx, a, body.data);
        let row: Row | undefined;
        if (recordId) {
          row = await this.require(tx, a, kind, recordId);
          checkVersion(row as { updatedAt: Date }, body.expectedUpdatedAt);
          if (kind === 'actions' && ['completed', 'cancelled'].includes(String(row.status)))
            throw new ConflictException('已完成或取消的行动保留历史，不可编辑');
          if (kind === 'leads' && row.status === 'converted')
            throw new BadRequestException('已转化线索保留原始记录，不可继续编辑');
          if (kind === 'customers' && row.poolType === 'public' && !admin(a) && !manager(a))
            throw new ForbiddenException('公海客户请先领取');
          if (['contracts', 'orders', 'projects'].includes(kind) && !['draft', 'rejected'].includes(String(row.status)))
            throw new BadRequestException('仅草稿或驳回单据可编辑');
          if (kind === 'projects') await this.deliveryAuthority(tx, a, recordId);
          if (
            ['contractId', 'customerId', 'opportunityId', 'projectId', 'targetId'].some(
              (key) => key in data && data[key] !== row?.[key],
            )
          )
            throw new BadRequestException('关联对象创建后不可修改，请新建记录');
        }
        if(kind==='opportunities' && row && data.amount!==undefined && Object.keys(salesIntakeMeta(row.healthFactors)).length)data.healthFactors=json({...object(row.healthFactors),salesIntake:{...salesIntakeMeta(row.healthFactors),amountKnown:true}});
        await this.references(tx, a, kind, { ...row, ...data });
        if (
          ['orders', 'projects'].includes(kind) &&
          (data.contractId ?? row?.contractId) &&
          (await tx.contractChange.count({
            where: { tenantId: a.tenantId, contractId: id(data.contractId ?? row?.contractId), status: 'pending' },
          }))
        )
          throw new ConflictException('关联合同变更审批中，请先完成或撤回');
        if (kind === 'customers')
          Object.assign(
            data,
            await uniqueCustomerIdentity(
              tx,
              a.tenantId,
              {
                name: String(data.name ?? row?.name),
                creditCode: (data.creditCode === undefined ? row?.creditCode : data.creditCode) as
                  string | null | undefined,
              },
              recordId,
            ),
          );
        const base = { tenantId: a.tenantId, ...(kind === 'products' ? {} : { createdBy: a.userId }) };
        const defaults: Record<string, unknown> = {};
        if (kind === 'products') defaults.category = 'service';
        if (kind === 'customers')
          Object.assign(defaults, {
            code: code('KH'),
            ownerId: a.userId,
            ownerDeptId: a.deptId,
            poolType: 'private',
            protectUntil: new Date(Date.now() + 30 * 86400000),
          });
        if (kind === 'leads') Object.assign(defaults, { code: code('XS'), assigneeId: a.userId, status: 'assigned' });
        if (kind === 'opportunities' && !recordId) {
          const first = await tx.opportunityStage.findFirst({
            where: { tenantId: a.tenantId, isActive: true },
            orderBy: { sortOrder: 'asc' },
          });
          if (!first) throw new BadRequestException('请先配置商机阶段');
          Object.assign(defaults, { code: code('SJ'), ownerId: a.userId, stage: first.code });
        }
        if (kind === 'contracts') Object.assign(defaults, { contractNo: code('HT'), ownerId: a.userId });
        if (kind === 'orders') {
          const contract = await this.require(tx, a, 'contracts', id(data.contractId ?? row?.contractId));
          if (!['signed', 'executing', 'completed'].includes(String(contract.status)))
            throw new BadRequestException('签约后才能创建订单');
          Object.assign(defaults, {
            orderNo: code('DD'),
            ownerId: contract.ownerId,
            customerId: contract.customerId,
            totalAmount: contract.amount,
            totalAmountInclTax: contract.amount,
            orderDate: new Date(),
          });
        }
        if (kind === 'projects')
          Object.assign(defaults, { projectNo: code('XM'), salesOwnerId: a.userId, pmId: a.userId, status: 'draft' });
        if (kind === 'tasks') {
          const p = await taskProject(tx, a, id(data.projectId ?? row?.projectId));
          activeDelivery(p);
          if (recordId) {
            if (row?.status === 'done') throw new ConflictException('已完成任务不可编辑，请先发起整改');
            if (row?.assigneeId !== a.userId) await this.deliveryAuthority(tx, a, p.id);
          } else await this.deliveryAuthority(tx, a, p.id);
          await validateTaskMilestone(tx, a, p.id, data.milestoneId ?? row?.milestoneId);
          defaults.assigneeId = a.userId;
          await tx.project.update({
            where: { id: p.id },
            data: { updatedAt: new Date(Math.max(Date.now(), p.updatedAt.getTime() + 1)) },
          });
        }
        if (kind === 'actions') Object.assign(defaults, { assigneeId: a.userId, targetType: 'customer' });
        if (kind === 'followups')
          Object.assign(defaults, { targetType: 'customer', targetId: data.customerId, method: 'visit' });
        if (kind === 'contracts') {
          const opportunityId = data.opportunityId ?? row?.opportunityId;
          if (
            opportunityId &&
            (!recordId ||
              (data.amount !== undefined && !new Prisma.Decimal(String(data.amount)).eq(String(row?.amount ?? 0))))
          ) {
            const quote = await tx.opportunityQuote.findFirst({
              where: { tenantId: a.tenantId, opportunityId: id(opportunityId) },
              orderBy: { version: 'desc' },
            });
            if (quote) {
              if (!quote.total.eq(String(data.amount ?? row?.amount ?? 0)))
                throw new BadRequestException('合同金额需与选用的最新报价一致，请先更新商机报价或核对合同金额');
              data.quoteSnapshot = json({
                quoteId: quote.id,
                version: quote.version,
                total: quote.total.toFixed(2),
                items: quote.items,
              });
            }
          }
          const amount = new Prisma.Decimal(String(data.amount ?? row?.amount ?? 0)),
            tax = new Prisma.Decimal(String(data.taxRate ?? row?.taxRate ?? 13));
          data.amountExclTax = amount.div(tax.div(100).add(1)).toDecimalPlaces(2);
          data.taxAmount = amount.sub(data.amountExclTax as Prisma.Decimal);
          data.totalOutstanding = amount;
        }
        if (recordId && row?.updatedAt)
          data.updatedAt = new Date(Math.max(Date.now(), new Date(row.updatedAt).getTime() + 1));
        let result = recordId
          ? await this.db(tx, kind).update({ where: { id: recordId, tenantId: a.tenantId }, data })
          : await this.db(tx, kind).create({ data: { ...base, ...defaults, ...data } });
        if (kind === 'projects' && !recordId)
          await this.projectMilestones(tx, a, result.id, data.plannedStartDate as Date, data.plannedEndDate as Date);
        if (kind === 'customers' && !recordId)
          await tx.privateHolding.create({
            data: {
              tenantId: a.tenantId,
              userId: a.userId,
              customerId: result.id,
              claimedAt: new Date(),
              protectUntil: defaults.protectUntil as Date,
            },
          });
        if (kind === 'followups')
          await tx.customer.updateMany({
            where: { id: id(data.customerId ?? row?.customerId), tenantId: a.tenantId },
            data: { lastFollowAt: new Date(), lastFollowBy: a.userId },
          });
        if (!recordId && ['opportunities','contracts'].includes(kind)) {
          const policy = await businessPolicy(tx, a.tenantId);
          if (policy && new Date() >= new Date(policy.fromDate+'T00:00:00+08:00') && kind === 'opportunities') await notifyOpportunity(tx, a, result, policy);
          if (policy && new Date() >= new Date(policy.fromDate+'T00:00:00+08:00') && kind === 'contracts') {
            if (policy.autoSubmitContracts) {
              if (new Prisma.Decimal(String(result.amount)).lte(0)) throw new BadRequestException('自动提交审批的合同金额必须大于零');
              const approval = await this.approval.start(tx, a, { bizType: 'contract', bizId: result.id, bizNo: String(result.contractNo), title: String(result.name), amount: new Prisma.Decimal(String(result.amount)), flowId: policy.contractFlowId });
              result = await this.db(tx, kind).update({ where: { id: result.id, tenantId: a.tenantId }, data: { approvalId: approval.id, status: 'pending_approval' } });
            }
          }
        }
        return result;
      },
    );
  }
  async previewAction(tx: Tx, a: Actor, input: unknown) {
    allowWrite(a);
    requirePermission(a, 'actions', 'create');
    const data = cleanInput('actions', input);
    await this.references(tx, a, 'actions', data);
    const customer = await this.require(tx, a, 'customers', id(data.targetId));
    return { data, customer };
  }
  async cancelAgentAction(tx: Tx, a: Actor, actionId: number, expected: unknown) {
    allowWrite(a);
    requirePermission(a, 'actions', 'update');
    const action = await this.require(tx, a, 'actions', actionId);
    checkVersion(action as { updatedAt: Date }, expected);
    if (action.source !== 'ai_recommend' || !['pending', 'in_progress', 'overdue'].includes(String(action.status)))
      throw new ConflictException('只能补偿取消尚未完成的AI行动');
    return tx.actionPlan.update({
      where: { id: actionId },
      data: {
        status: 'cancelled',
        updatedAt: new Date(Math.max(Date.now(), (action.updatedAt as Date).getTime() + 1)),
      },
    });
  }
  async createAction(tx: Tx, a: Actor, input: unknown, source: 'manual' | 'ai_recommend' = 'manual') {
    const { data } = await this.previewAction(tx, a, input);
    return tx.actionPlan.create({
      data: {
        tenantId: a.tenantId,
        createdBy: a.userId,
        assigneeId: a.userId,
        targetType: 'customer',
        targetId: id(data.targetId),
        title: text(data.title, '行动名称'),
        content: typeof data.content === 'string' ? data.content : null,
        dueDate: data.dueDate instanceof Date ? data.dueDate : null,
        source,
      },
    });
  }
  async command(a: Actor, kind: string, recordId: number, action: string, body: Record<string, unknown>) {
    allowWrite(a);
    requirePermission(a, kind, 'update');
    if(kind==='opportunities'&&action==='follow'){
      requirePermission(a,'followups','create');
      if(opportunityFollowInput(body.followup).createAction)requirePermission(a,'actions','create');
    }
    if (
      Object.keys(body).some(
        (k) =>
          ![
            'requestKey',
            'expectedUpdatedAt',
            'userId',
            'reason',
            'note',
            'items',
            'form',
            'actualHours',
            ...(kind==='opportunities'&&action==='follow'?['followup']:[]),
            ...(kind === 'contracts' && action === 'sign' ? ['paymentSchedule'] : []),
          ].includes(k),
      )
    )
      throw new BadRequestException('存在未定义参数');
    if (!resource(kind).actions.includes(action)) throw new BadRequestException('不支持的业务操作');
    return runCommand(
      this.prisma,
      a,
      `${kind}.${action}`,
      { ...body, recordId },
      async (tx) => {
        const row = await this.require(tx, a, kind, recordId);
        checkVersion(row as { updatedAt: Date }, body.expectedUpdatedAt);
        if (kind === 'projects') await this.deliveryAuthority(tx, a, recordId);
        if (
          kind === 'contracts' &&
          (await tx.contractChange.count({ where: { tenantId: a.tenantId, contractId: recordId, status: 'pending' } }))
        )
          throw new ConflictException('合同变更审批中，请先完成或撤回');
        const writeStamp = new Date(Math.max(Date.now(), new Date(row.updatedAt!).getTime() + 1));
        let assignmentEvidence: Record<string, unknown> | undefined;
        try {
          const where = { id: recordId, tenantId: a.tenantId };
          if (kind === 'customers') {
            const linked =
              (await tx.opportunity.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
              (await tx.contract.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
              (await tx.order.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
              (await tx.project.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
              (await tx.lead.count({
                where: { tenantId: a.tenantId, convertedCustomerId: recordId, deletedAt: null },
              }));
            if (linked && ['claim', 'return', 'assign'].includes(action))
              throw new ConflictException('客户含关联销售业务，请通过销售归属交接处理，避免业务失联');
            if (action === 'follow') throw new BadRequestException('请通过跟进表单记录内容');
            if (action === 'claim') {
              if (!hasPermission(a, 'pool:claim')) throw new ForbiddenException('没有领取权限');
              if (row.poolType !== 'public') throw new ConflictException('客户已被领取');
              const changed = await tx.customer.updateMany({
                where: { ...where, poolType: 'public', ownerId: null },
                data: {
                  poolType: 'private',
                  ownerId: a.userId,
                  ownerDeptId: a.deptId,
                  protectUntil: new Date(Date.now() + 30 * 86400000),
                },
              });
              if (changed.count !== 1) throw new ConflictException('客户已被领取');
              await tx.privateHolding.create({
                data: {
                  tenantId: a.tenantId,
                  userId: a.userId,
                  customerId: recordId,
                  claimedAt: new Date(),
                  protectUntil: new Date(Date.now() + 30 * 86400000),
                },
              });
            } else if (action === 'return') {
              if (!hasPermission(a, 'pool:return')) throw new ForbiddenException('没有退回公海权限');
              if (row.ownerId !== a.userId && !admin(a) && !manager(a))
                throw new ForbiddenException('不可退回他人的客户');
              await tx.customer.update({
                where,
                data: { poolType: 'public', ownerId: null, ownerDeptId: null, protectUntil: null },
              });
              await tx.privateHolding.deleteMany({ where: { tenantId: a.tenantId, customerId: recordId } });
            } else if (action === 'assign') {
              if (!hasPermission(a, 'customer:assign')) throw new ForbiddenException('没有客户分配权限');
              if (!admin(a) && !manager(a)) throw new ForbiddenException('仅主管可分配');
              assignmentEvidence = await this.assignCustomerInTransaction(
                tx,
                a,
                recordId,
                id(body.userId),
                body.expectedUpdatedAt,
                writeStamp,
              );
            }
          } else if (kind === 'leads' && action === 'convert') {
            if (row.status === 'converted') throw new ConflictException('线索已转化');
            const c = await tx.customer.create({
              data: {
                tenantId: a.tenantId,
                code: code('KH'),
                name: String(row.companyName),
                ...(await uniqueCustomerIdentity(tx, a.tenantId, {
                  name: String(row.companyName),
                  creditCode: row.creditCode as string | null,
                })),
                industry: row.industry as string | null,
                ownerId: a.userId,
                ownerDeptId: a.deptId,
                poolType: 'private',
                protectUntil: new Date(Date.now() + 30 * 86400000),
                createdBy: a.userId,
              },
            });
            if (row.contactName)
              await tx.contact.create({
                data: { tenantId: a.tenantId, customerId: c.id, name: String(row.contactName), createdBy: a.userId },
              });
            await tx.privateHolding.create({
              data: {
                tenantId: a.tenantId,
                customerId: c.id,
                userId: a.userId,
                claimedAt: new Date(),
                protectUntil: c.protectUntil ?? new Date(Date.now() + 30 * 86400000),
              },
            });
            await tx.lead.update({
              where,
              data: { status: 'converted', convertedCustomerId: c.id, convertedAt: new Date() },
            });
            return { id: c.id, kind: 'customers' };
          } else if (kind === 'opportunities') {
            if(action==='follow'){
              requirePermission(a,'followups','create');
              const f=opportunityFollowInput(body.followup);
              await this.require(tx,a,'customers',id(row.customerId));
              const now=new Date(),due=f.nextFollowAt?new Date(f.nextFollowAt+'T00:00:00Z'):null;
              const follow=await tx.followUp.create({data:{tenantId:a.tenantId,targetType:'opportunity',targetId:recordId,customerId:id(row.customerId),method:f.method,content:f.content,nextAction:f.nextAction,nextFollowAt:due,createdBy:a.userId}});
              await tx.opportunity.update({where,data:{lastFollowAt:now,followCount:{increment:1},...(f.nextAction?{nextAction:f.nextAction}:{}),...(due?{nextActionDate:due}:{})}});
              await tx.customer.update({where:{id:id(row.customerId),tenantId:a.tenantId},data:{lastFollowAt:now,lastFollowBy:a.userId}});
              let actionId:number|undefined,calendarId:number|undefined;
              if(f.createAction){
                requirePermission(a,'actions','create');
                if(!due||due.toISOString().slice(0,10)<new Date(Date.now()+8*3600000).toISOString().slice(0,10))throw new BadRequestException('下一步行动须安排今天或今后日期');
                if(!await tx.user.findFirst({where:{tenantId:a.tenantId,id:id(row.ownerId),status:'active',deletedAt:null}}))throw new ConflictException('商机负责人已停用，请先交接');
                let startsAt:Date|undefined;
                for(const minute of [600,630,660,690,780,810,840,870,900,930]){const start=new Date(due.getTime()+(minute-480)*60000);if(start<=now)continue;if(!await tx.calendarEntry.count({where:{tenantId:a.tenantId,ownerId:id(row.ownerId),status:'scheduled',freeBusy:'busy',startsAt:{lt:new Date(start.getTime()+1800000)},endsAt:{gt:start}}})){startsAt=start;break;}}
                if(!startsAt)throw new ConflictException('该日工作时段已满，请选择其他跟进日期');
                const actionPlan=await tx.actionPlan.create({data:{tenantId:a.tenantId,targetType:'customer',targetId:id(row.customerId),title:('商机跟进｜'+String(row.code)+'｜'+f.nextAction).slice(0,200),content:'商机#'+recordId+' '+String(row.name)+'\n本次记录：'+f.content+'\n下一步：'+f.nextAction,assigneeId:id(row.ownerId),dueDate:due,source:'manual',createdBy:a.userId}});
                actionId=actionPlan.id;
                const entry=await tx.calendarEntry.create({data:{tenantId:a.tenantId,ownerId:id(row.ownerId),title:actionPlan.title,description:'【拟定业务推进时段】行动#'+actionId+'；非客户确认会议。\n'+f.nextAction,location:'业务推进安排',startsAt,endsAt:new Date(startsAt.getTime()+1800000),origin:'crm_plan',externalId:'crm-action-plan:'+actionId,externalSnapshot:json({actionId,customerId:row.customerId,opportunityId:recordId,proposed:true})}});calendarId=entry.id;
              }
              return {id:recordId,kind,action,followupId:follow.id,actionId,calendarId};
            }
            if (row.status !== 'open') throw new BadRequestException('仅开放商机可操作');
            if (action === 'advance') {
              // Keep the current stage as an ordering anchor even if it was deactivated.
              const current = await tx.opportunityStage.findFirst({
                where: { tenantId: a.tenantId, code: String(row.stage) },
              });
              if (!current) throw new ConflictException('当前商机阶段不存在，请先核对阶段配置');
              const next = await tx.opportunityStage.findFirst({
                where: { tenantId: a.tenantId, isActive: true, sortOrder: { gt: current.sortOrder } },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              });
              if (!next || next.isWon) throw new BadRequestException('下一步需通过合同签约完成赢单');
              const customer=await tx.customer.findFirst({where:{tenantId:a.tenantId,id:id(row.customerId),deletedAt:null},select:{name:true}});
              if(pendingCustomerName(customer?.name)&&!['new','qualified'].includes(next.code))throw new BadRequestException('客户名字待核实，请先确认客户身份，再进入方案或商务阶段');
              if (new Prisma.Decimal(String(row.amount)).lte(0) || !row.demandSummary)
                throw new BadRequestException('请先填写有效金额和需求摘要');
              await tx.opportunity.update({
                where,
                data: {
                  stage: next.code,
                  weightedAmount: new Prisma.Decimal(String(row.amount)).mul(next.probability).div(100),
                  stageEnteredAt: new Date(),
                },
              });
            }
            if (action === 'lose')
              await tx.opportunity.update({
                where,
                data: {
                  status: 'lost',
                  lossDetail: text(body.reason, '输单原因', 500),
                  closedAt: writeStamp,
                  weightedAmount: 0,
                },
              });
            if (action === 'quote') return this.quote(tx, a, row, body);
          } else if (['contracts', 'orders'].includes(kind)) {
            if (action === 'submit') {
              if (!['draft', 'rejected'].includes(String(row.status)))
                throw new BadRequestException('当前状态不可提交');
              if (new Prisma.Decimal(String(row.amount ?? row.totalAmountInclTax)).lte(0))
                throw new BadRequestException('请先填写有效金额');
              const approval = await this.approval.start(tx, a, {
                bizType: kind === 'contracts' ? 'contract' : 'order',
                form: object(body.form ?? {}),
                bizId: recordId,
                bizNo: String(row.contractNo ?? row.orderNo),
                title: String(row.name ?? row.orderNo),
                amount: new Prisma.Decimal(String(row.amount ?? row.totalAmountInclTax)),
              });
              await this.db(tx, kind).update({ where, data: { status: 'pending_approval', approvalId: approval.id } });
            } else if (action === 'sign' && kind === 'contracts') {
              if (row.status !== 'approved') throw new BadRequestException('合同必须先审批通过');
              const schedule = paymentSchedule(body.paymentSchedule, String(row.amount));
              if (await tx.paymentPlan.count({ where: { tenantId: a.tenantId, contractId: recordId } }))
                throw new ConflictException('合同已有回款计划，请先核对历史数据，系统不会重复生成');
              if (row.opportunityId) {
                const closed = await tx.opportunity.updateMany({
                  where: { id: id(row.opportunityId), tenantId: a.tenantId, deletedAt: null, status: 'open' },
                  data: {
                    status: 'won',
                    stage: 'signing',
                    winDate: writeStamp,
                    closedAt: writeStamp,
                    contractId: recordId,
                  },
                });
                if (closed.count !== 1) throw new ConflictException('关联商机必须为开放状态才能签约');
              }
              await tx.contract.update({ where, data: { status: 'signed', signDate: writeStamp } });
              await recalculateCustomerContracts(tx, a.tenantId, id(row.customerId));
              for (const installment of schedule)
                await tx.paymentPlan.create({
                  data: {
                    tenantId: a.tenantId,
                    contractId: recordId,
                    planNo: code('HK'),
                    ...installment,
                    outstandingAmount: installment.amount,
                    status: 'pending',
                  },
                });
            } else if (action === 'order' && kind === 'contracts') {
              if (!['signed', 'executing'].includes(String(row.status)))
                throw new BadRequestException('签约后才可创建订单');
              const order = await tx.order.create({
                data: {
                  tenantId: a.tenantId,
                  orderNo: code('DD'),
                  contractId: recordId,
                  customerId: id(row.customerId),
                  ownerId: id(row.ownerId),
                  orderDate: new Date(),
                  totalAmount: String(row.amount),
                  totalAmountInclTax: String(row.amount),
                  createdBy: a.userId,
                },
              });
              return { id: order.id, kind: 'orders' };
            } else if (action === 'project' && kind === 'contracts') {
              if (!['signed', 'executing'].includes(String(row.status)))
                throw new BadRequestException('签约后才可创建项目');
              const project = await tx.project.create({
                data: {
                  tenantId: a.tenantId,
                  projectNo: code('XM'),
                  name: `${row.name}·交付`,
                  contractId: recordId,
                  customerId: id(row.customerId),
                  pmId: a.userId,
                  salesOwnerId: id(row.ownerId),
                  status: 'draft',
                  budgetAmount: String(row.amount),
                  plannedStartDate: new Date(),
                  plannedEndDate: new Date(Date.now() + 90 * 86400000),
                  createdBy: a.userId,
                },
              });
              for (const [i, name] of ['项目启动', '方案确认', '系统上线', '验收交付'].entries())
                await tx.projectMilestone.create({
                  data: {
                    tenantId: a.tenantId,
                    projectId: project.id,
                    name,
                    stage: ['initiation', 'blueprint', 'go_live', 'acceptance'][i],
                    sortOrder: i + 1,
                    weight: 25,
                    plannedDate: new Date(Date.now() + (i + 1) * 20 * 86400000),
                  },
                });
              return { id: project.id, kind: 'projects' };
            } else if (action === 'confirm' && kind === 'orders') {
              if (row.status !== 'approved') throw new BadRequestException('订单必须审批通过');
              await tx.order.update({ where, data: { status: 'confirmed' } });
            } else if (action === 'deliver' && kind === 'orders') {
              if (row.status !== 'confirmed') throw new BadRequestException('请先确认订单');
              await tx.order.update({ where, data: { status: 'delivered', actualDeliveryDate: new Date() } });
            } else throw new BadRequestException('操作与业务对象不匹配');
          } else if (kind === 'projects') {
            if (action === 'handover_pm') await handoverProjectManager(tx, a, await taskProject(tx, a, recordId), body);
            if (action === 'submit') {
              if (!['draft', 'rejected'].includes(String(row.status)))
                throw new BadRequestException('仅草稿或驳回项目可提交');
              const approval = await this.approval.start(tx, a, {
                bizType: 'project_initiation',
                form: object(body.form ?? {}),
                bizId: recordId,
                bizNo: String(row.projectNo),
                title: String(row.name),
                amount: new Prisma.Decimal(String(row.budgetAmount ?? 0)),
              });
              await tx.project.update({ where, data: { status: 'pending_approval', approvalId: approval.id } });
            }

            if (action === 'start') {
              if (row.status !== 'active') throw new BadRequestException('项目未激活');
              if (row.actualStartDate) throw new ConflictException('项目已启动');
              deliveryManager(a, await taskProject(tx, a, recordId));
              await tx.project.update({ where, data: { actualStartDate: new Date() } });
              await deliveryEvent(tx, a, recordId, 'project.started', '项目启动', { pmId: row.pmId });
            }
            if (['advance', 'request_acceptance', 'reject_acceptance', 'accept'].includes(action)) {
              const project = await taskProject(tx, a, recordId);
              await projectDeliveryCommand(tx, a, project, action, body);
            }
          } else if (kind === 'tasks') {
            const p = await taskProject(tx, a, id(row.projectId));
            activeDelivery(p);
            if (row.assigneeId !== a.userId || ['reopen_task', 'assign_task'].includes(action)) {
              await this.deliveryAuthority(tx, a, p.id);
            }
            const note = text(body.note, '任务结果或整改说明', 3000);
            let assignment: Record<string, unknown> = {};
            if (action === 'assign_task') {
              if (['done', 'cancelled'].includes(String(row.status)))
                throw new ConflictException('历史已完成或取消任务不能转派');
              const recipient = (await deliveryPeople(tx, a, p)).find((u) => u.id === id(body.userId));
              if (!recipient || recipient.id === row.assigneeId)
                throw new BadRequestException('接收人不可用或没有实际变化');
              assignment = { fromUserId: row.assigneeId, toUserId: recipient.id, toName: recipient.name };
              await tx.projectTask.update({ where, data: { assigneeId: recipient.id } });
            } else if (action === 'start_task') {
              if (row.status !== 'todo') throw new ConflictException('仅待办任务可开始');
              await tx.projectTask.update({ where, data: { status: 'in_progress' } });
            } else if (action === 'complete') {
              if (row.status !== 'in_progress') throw new ConflictException('请先开始任务再记录完成');
              await tx.projectTask.update({
                where,
                data: { status: 'done', completedAt: new Date(), actualHours: taskHours(body.actualHours) },
              });
            } else if (action === 'reopen_task') {
              if (row.status !== 'done') throw new ConflictException('仅已完成任务可发起整改');
              await tx.projectTask.update({ where, data: { status: 'todo', completedAt: null } });
              const milestone = row.milestoneId
                ? await tx.projectMilestone.findFirst({
                    where: { id: id(row.milestoneId), tenantId: a.tenantId, projectId: p.id },
                  })
                : await tx.projectMilestone.findFirst({
                    where: { tenantId: a.tenantId, projectId: p.id },
                    orderBy: { sortOrder: 'desc' },
                  });
              if (milestone)
                await tx.projectMilestone.updateMany({
                  where: { tenantId: a.tenantId, projectId: p.id, sortOrder: { gte: milestone.sortOrder } },
                  data: {
                    status: 'pending',
                    completedAt: null,
                    completedBy: null,
                    actualDate: null,
                    deliverables: null,
                  },
                });
              const total = await tx.projectMilestone.count({ where: { tenantId: a.tenantId, projectId: p.id } });
              const done = await tx.projectMilestone.count({
                where: { tenantId: a.tenantId, projectId: p.id, status: 'completed' },
              });
              const nextMilestone = await tx.projectMilestone.findFirst({
                where: { tenantId: a.tenantId, projectId: p.id, status: { not: 'completed' } },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              });
              await tx.project.update({
                where: { id: p.id },
                data: {
                  progress: total ? Math.round((done / total) * 100) : 0,
                  stage: (nextMilestone?.stage ?? 'initiation') as 'initiation',
                },
              });
            }
            await tx.project.update({
              where: { id: p.id },
              data: { updatedAt: new Date(Math.max(Date.now(), p.updatedAt.getTime() + 1)) },
            });
            await deliveryEvent(
              tx,
              a,
              p.id,
              'task.' + action,
              note,
              {
                from: row.status,
                ...assignment,
                ...(action === 'complete'
                  ? {
                      actualHours: taskHours(body.actualHours).toFixed(1),
                      attachments: await tx.evidenceAttachment.findMany({
                        where: { tenantId: a.tenantId, subjectKind: 'tasks', subjectId: recordId, withdrawnAt: null },
                        select: { id: true, filename: true, sha256: true, size: true },
                        orderBy: { id: 'asc' },
                      }),
                    }
                  : {}),
              },
              recordId,
            );
          } else if (kind === 'actions' && action === 'complete') {
            if (!['pending', 'in_progress', 'overdue'].includes(String(row.status)))
              throw new ConflictException('行动已完成或取消');
            await this.db(tx, kind).update({ where, data: { status: 'completed', completedAt: new Date() } });
            await tx.calendarEntry.updateMany({where:{tenantId:a.tenantId,origin:'crm_plan',externalId:'crm-action-plan:'+recordId,status:'scheduled'},data:{status:'completed',revision:{increment:1}}});
          }
          return {
            id: recordId,
            kind,
            action,
            ...(assignmentEvidence
              ? {
                  assignment: assignmentEvidence,
                  reason: body.reason === undefined ? '客户分配' : text(body.reason, '分配原因', 500),
                }
              : {}),
          };
        } finally {
          await this.db(tx, kind).update({
            where: { id: recordId, tenantId: a.tenantId },
            data: { updatedAt: writeStamp },
          });
        }
      },
      async (tx) => {
        if (kind === 'customers' && action === 'assign') await this.require(tx, a, kind, recordId);
        if(kind==='opportunities'&&action==='follow'){
          const opportunity=await this.require(tx,a,kind,recordId);
          await this.require(tx,a,'customers',id(opportunity.customerId));
        }
      },
    );
  }
  private async projectMilestones(tx: Tx, a: Actor, projectId: number, start: Date, end: Date) {
    for (const [i, name] of ['项目启动', '方案确认', '系统上线', '验收交付'].entries())
      await tx.projectMilestone.create({
        data: {
          tenantId: a.tenantId,
          projectId,
          name,
          stage: ['initiation', 'blueprint', 'go_live', 'acceptance'][i],
          sortOrder: i + 1,
          weight: 25,
          plannedDate: new Date(start.getTime() + ((end.getTime() - start.getTime()) * (i + 1)) / 4),
        },
      });
  }
  private async quote(tx: Tx, a: Actor, row: Row, body: Record<string, unknown>) {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20)
      throw new BadRequestException('报价需1—20条产品明细');
    const items = [];
    let total = new Prisma.Decimal(0);
    for (const raw of body.items) {
      const item = object(raw),
        product = await tx.product.findFirst({
          where: { tenantId: a.tenantId, id: id(item.productId), isActive: true },
        });
      if (!product) throw new BadRequestException('产品无效');
      if (!/^\d{1,6}$/.test(String(item.quantity)) || !/^\d{1,12}(\.\d{1,2})?$/.test(String(item.unitPrice)))
        throw new BadRequestException('数量或单价无效');
      const quantity = new Prisma.Decimal(String(item.quantity)),
        price = new Prisma.Decimal(String(item.unitPrice));
      if (
        !quantity.isFinite() ||
        !quantity.isInteger() ||
        quantity.lte(0) ||
        quantity.gt(100000) ||
        !price.isFinite() ||
        price.lt(0) ||
        price.gt('9999999999.99')
      )
        throw new BadRequestException('数量或单价无效');
      const amount = quantity.mul(price).toDecimalPlaces(2);
      total = total.add(amount);
      items.push({
        tenantId: a.tenantId,
        opportunityId: row.id,
        productId: product.id,
        productName: product.name,
        quantity: quantity.toNumber(),
        estimatedPrice: price,
        estimatedAmount: amount,
      });
    }
    if (total.gt('9999999999999.99')) throw new BadRequestException('报价总额超出合同金额支持范围');
    await tx.opportunityProduct.deleteMany({ where: { tenantId: a.tenantId, opportunityId: row.id } });
    await tx.opportunityProduct.createMany({ data: items });
    await tx.opportunity.update({
      where: { id: row.id, tenantId: a.tenantId },
      data: { amount: total, ...(Object.keys(salesIntakeMeta(row.healthFactors)).length?{healthFactors:json({...object(row.healthFactors),salesIntake:{...salesIntakeMeta(row.healthFactors),amountKnown:true,forecastEligible:true,amountBasis:'正式产品报价明细总额'}})}:{}), updatedAt: new Date(Math.max(Date.now(), new Date(row.updatedAt!).getTime() + 1)) },
    });
    const latest = await tx.opportunityQuote.findFirst({
      where: { tenantId: a.tenantId, opportunityId: row.id },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    await tx.opportunityQuote.create({
      data: { tenantId: a.tenantId, opportunityId: row.id, version, total, items: json(items), createdBy: a.userId },
    });
    return { id: row.id, version, total: total.toString(), items };
  }
  async statisticsOptions(a: Actor) {
    await validateActor(this.prisma.system, a);
    return statisticsOptions(this.prisma.system, a);
  }
  async overview(a: Actor, query: Record<string, string> = {}) {
    if (Object.keys(query).some(k => !['from','to','personRange','ownerId','deptId'].includes(k))) throw new BadRequestException('工作台日期筛选参数无效');
    const period = query.from || query.to ? reportQuery({from:query.from,to:query.to}) : null;
    const dates = (field: string, timestamp = false) => period ? { [field]: { gte: new Date(period.start.getTime() - (timestamp ? 8*3600000 : 0)), lt: new Date(period.end.getTime() - (timestamp ? 8*3600000 : 0)) } } : {};
    return this.prisma.system.$transaction(async tx => {
    await validateActor(tx, a);
    const audience = await statisticsScope(tx, a, query);
    const scoped = async (kind: string) => ({ AND: [await this.scope(tx, a, kind), await statisticsResourceFilter(tx, a, kind, audience)] });
    const [customers, opps, contracts, projects, plans, actions, users, receipts, invoices] = await Promise.all([
      hasPermission(a, resourcePermission('customers', 'read'))
        ? tx.customer.findMany({ where: { ...(await scoped('customers')), ...dates('createdAt',true) } })
        : Promise.resolve([]),
      hasPermission(a, resourcePermission('opportunities', 'read'))
        ? tx.opportunity.findMany({ where: { ...(await scoped('opportunities')), ...dates('expectedCloseDate') } })
        : Promise.resolve([]),
      hasPermission(a, resourcePermission('contracts', 'read'))
        ? tx.contract.findMany({ where: { ...(await scoped('contracts')), ...dates('signDate') } })
        : Promise.resolve([]),
      hasPermission(a, resourcePermission('projects', 'read'))
        ? tx.project.findMany({ where: { ...(await scoped('projects')), ...dates('createdAt',true) } })
        : Promise.resolve([]),
      hasPermission(a, resourcePermission('payment-plans', 'read'))
        ? tx.paymentPlan.findMany({ where: { ...(await scoped('payment-plans')), ...dates('dueDate') } })
        : Promise.resolve([]),
      hasPermission(a, 'action:read')
        ? tx.actionPlan.findMany({
            where: { ...(await scoped('actions')), ...dates('dueDate'), status: { in: ['pending', 'in_progress', 'overdue'] } },
            take: 20,
            orderBy: { dueDate: 'asc' },
          })
        : Promise.resolve([]),
      tx.user.findMany({
        where: {
          tenantId: a.tenantId,
          status: 'active',
          deletedAt: null,
          ...(audience.ownerIds ? { id: { in: audience.ownerIds } } : {}),
        },
        select: { id: true, name: true, deptId: true },
      }),
      period && hasPermission(a,'finance:read') ? tx.receipt.findMany({where:{...(await scoped('receipts')),status:'confirmed',...dates('receiptDate')}}) : Promise.resolve([]),
      period && hasPermission(a,'finance:read') ? tx.invoice.findMany({where:{...(await scoped('invoices')),status:{in:['invoiced','sent']},...dates('invoiceDate')}}) : Promise.resolve([]),
    ]);
    const sum = (values: Prisma.Decimal[]) => values.reduce((n, v) => n.add(v), new Prisma.Decimal(0)).toString();
    const stages = await tx.opportunityStage.findMany({
      where: { tenantId: a.tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const allFinancialContractIds=[...new Set([...contracts.map(c=>c.id),...plans.map(p=>p.contractId),...invoices.map(i=>i.contractId),...receipts.flatMap(r=>r.contractId?[r.contractId]:[])])];
    const trades=await contractTrades(tx,a.tenantId,allFinancialContractIds),commissionIds=new Set([...trades].filter(([,t])=>t.category==='software_commission').map(([id])=>id));
    let businessSummary:ReturnType<typeof businessReport>['summary']|null=null;
    const businessProjectAccess=hasPermission(a,'project:read');
    if(hasPermission(a,'finance:read')&&hasPermission(a,'contract:read')){
      const cids=contracts.filter(c=>c.currency==='CNY'&&['signed','executing','completed'].includes(c.status)).map(c=>c.id);
      const bp=await tx.paymentPlan.findMany({where:{AND:[await scoped('payment-plans'),{contractId:{in:cids}}]}});
      const bi=await tx.invoice.findMany({where:{AND:[await scoped('invoices'),{contractId:{in:cids}}]}});
      const bj=businessProjectAccess?await tx.project.findMany({where:{AND:[await this.scope(tx,a,'projects'),{contractId:{in:cids}}]}}):[];
      if([contracts,bp,bi,bj].some(rows=>rows.length>10000))throw new BadRequestException('统计超过10000条，请缩小日期或人员范围');
      const bc=await tx.customer.findMany({where:{tenantId:a.tenantId,id:{in:contracts.map(c=>c.customerId)}},select:{id:true,name:true,customerCategory:true,channelBrand:true}});
      businessSummary=businessReport(contracts,bp,bi,bj,trades,new Map(bc.map(c=>[c.id,c])),period??reportQuery({from:'2010-01-01',to:'2060-12-31'})).summary;
    }
    const today = new Date(businessDay(new Date()) + 'T00:00:00.000Z');
    return {businessSummary,businessProjectAccess,
      audience,
      restrictedModules: ['customers', 'opportunities', 'contracts', 'projects', 'payment-plans', 'actions'].filter(
        (kind) => !hasPermission(a, resourcePermission(kind, 'read')),
      ),
      role: admin(a) ? 'admin' : boss(a) ? 'boss' : manager(a) ? 'manager' : 'sales',
      customers: customers.length,
      openOpportunities: opps.filter((o) => o.status === 'open').length,
      pipeline: sum(opps.filter((o) => o.status === 'open' && salesForecastEligible(o)).map((o) => ownTradeAmount(o)??new Prisma.Decimal(0))),
      signedAmount: sum(
        contracts.filter((c) => ['signed', 'executing', 'completed'].includes(c.status)&&!commissionIds.has(c.id)).map((c) => c.amount),
      ),
      received: period ? sum(receipts.filter(r=>!r.contractId||!commissionIds.has(r.contractId)).map(r=>r.amount)) : sum(plans.map((p) => p.receivedAmount)),
      invoiced: sum(invoices.filter(i=>!commissionIds.has(i.contractId)).map(i=>i.amount)),
      outstanding: sum(plans.map((p) => p.outstandingAmount)),
      overdue: sum(plans.filter((p) => p.dueDate && p.dueDate < today && p.status !== 'cancelled').map((p) => p.outstandingAmount)),
      projects: projects.length,
      funnel: stages.map((s) => ({
        name: s.name,
        code: s.code,
        count: opps.filter((o) => o.status === 'open' && o.stage === s.code).length,
        amount: sum(opps.filter((o) => o.status === 'open' && o.stage === s.code && salesForecastEligible(o)).map((o) => ownTradeAmount(o)??new Prisma.Decimal(0))),
      })),
      actions,
      users,
      financeNotice: '本地收款台账支持登记、复核、核销及更正；银行、税务和会计连接尚未开通。',
    };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }
}
