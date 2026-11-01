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
import { uniqueCustomer } from './customer-policy';
import { recalculateCustomerContracts } from './contract-change-policy';
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
import { checkVersion, id, object, runCommand, text, json, type Tx, type Row } from './command-runner';

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
                (!['assign', 'accept', 'reject_acceptance', 'handover_pm'].includes(action) || admin(a) || manager(a)),
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
          actions,
          operations: [
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
              version: key === 'projects' || key === 'tasks' ? '2.0' : '1.0',
              effect: 'write',
              inputSchema: {
                type: 'object',
                required: [
                  'requestKey',
                  'expectedUpdatedAt',
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
    if (admin(a) || boss(a) || kind === 'products') return base;
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
    else if (kind === 'followups' || kind === 'receipts')
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
      !admin(a) &&
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
    const where = await this.scope(tx, a, kind);
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
    if (query.customerId && r.fields.some((f) => f.key === 'customerId'))
      where.customerId = id(Number(query.customerId));
    const [items, total] = await Promise.all([
      this.db(tx, kind).findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
        related[child] = await this.db(tx, child).findMany({
          where: { ...(await this.scope(tx, a, child)), customerId: recordId },
          take: 30,
          orderBy: { createdAt: 'desc' },
        });
    }
    if (kind === 'opportunities') {
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
      related.changes = await tx.contractChange.findMany({
        where: { tenantId: a.tenantId, contractId: recordId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      related.orders = await tx.order.findMany({
        where: { ...(await this.scope(tx, a, 'orders')), contractId: recordId },
      });
      related['payment-plans'] = await tx.paymentPlan.findMany({
        where: { tenantId: a.tenantId, contractId: recordId },
      });
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
        where: { tenantId: a.tenantId, receiptId: recordId },
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
    if (r.readonly) throw new BadRequestException('演示系统，暂无财务写入功能');
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
        await this.references(tx, a, kind, { ...row, ...data });
        if (
          ['orders', 'projects'].includes(kind) &&
          (data.contractId ?? row?.contractId) &&
          (await tx.contractChange.count({
            where: { tenantId: a.tenantId, contractId: id(data.contractId ?? row?.contractId), status: 'pending' },
          }))
        )
          throw new ConflictException('关联合同变更审批中，请先完成或撤回');
        if (kind === 'customers' && typeof data.name === 'string')
          data.nameFingerprint = await uniqueCustomer(tx, a.tenantId, data.name, recordId);
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
        const result = recordId
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
    if (
      Object.keys(body).some(
        (k) =>
          !['requestKey', 'expectedUpdatedAt', 'userId', 'reason', 'note', 'items', 'form', 'actualHours'].includes(k),
      )
    )
      throw new BadRequestException('存在未定义参数');
    if (!resource(kind).actions.includes(action)) throw new BadRequestException('不支持的业务操作');
    return runCommand(this.prisma, a, `${kind}.${action}`, { ...body, recordId }, async (tx) => {
      const row = await this.require(tx, a, kind, recordId);
      checkVersion(row as { updatedAt: Date }, body.expectedUpdatedAt);
      if (kind === 'projects') await this.deliveryAuthority(tx, a, recordId);
      if (
        kind === 'contracts' &&
        (await tx.contractChange.count({ where: { tenantId: a.tenantId, contractId: recordId, status: 'pending' } }))
      )
        throw new ConflictException('合同变更审批中，请先完成或撤回');
      const writeStamp = new Date(Math.max(Date.now(), new Date(row.updatedAt!).getTime() + 1));
      try {
        const where = { id: recordId, tenantId: a.tenantId };
        if (kind === 'customers') {
          const linked =
            (await tx.opportunity.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
            (await tx.contract.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
            (await tx.order.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
            (await tx.project.count({ where: { tenantId: a.tenantId, customerId: recordId, deletedAt: null } })) +
            (await tx.lead.count({ where: { tenantId: a.tenantId, convertedCustomerId: recordId, deletedAt: null } }));
          if (linked && ['claim', 'return', 'assign'].includes(action))
            throw new ConflictException('客户含关联销售业务，请通过销售归属交接处理，避免业务失联');
          if (action === 'follow') throw new BadRequestException('请通过跟进表单记录内容');
          if (action === 'claim') {
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
            if (row.ownerId !== a.userId && !admin(a) && !manager(a))
              throw new ForbiddenException('不可退回他人的客户');
            await tx.customer.update({
              where,
              data: { poolType: 'public', ownerId: null, ownerDeptId: null, protectUntil: null },
            });
            await tx.privateHolding.deleteMany({ where: { tenantId: a.tenantId, customerId: recordId } });
          } else if (action === 'assign') {
            if (!admin(a) && !manager(a)) throw new ForbiddenException('仅主管可分配');
            const target = await tx.user.findFirst({
              where: {
                tenantId: a.tenantId,
                id: id(body.userId),
                status: 'active',
                deletedAt: null,
                ...(!admin(a) ? { deptId: a.deptId } : {}),
                roles: { some: { tenantId: a.tenantId, role: { code: 'sales' } } },
              },
            });
            if (!target) throw new BadRequestException('销售不在可分配团队');
            await tx.customer.update({
              where,
              data: { poolType: 'private', ownerId: target.id, ownerDeptId: target.deptId },
            });
            await tx.privateHolding.deleteMany({ where: { tenantId: a.tenantId, customerId: recordId } });
            await tx.privateHolding.create({
              data: {
                tenantId: a.tenantId,
                userId: target.id,
                customerId: recordId,
                claimedAt: new Date(),
                protectUntil: new Date(Date.now() + 30 * 86400000),
              },
            });
          }
        } else if (kind === 'leads' && action === 'convert') {
          if (row.status === 'converted') throw new ConflictException('线索已转化');
          const c = await tx.customer.create({
            data: {
              tenantId: a.tenantId,
              code: code('KH'),
              name: String(row.companyName),
              nameFingerprint: await uniqueCustomer(tx, a.tenantId, String(row.companyName)),
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
          if (row.status !== 'open') throw new BadRequestException('仅开放商机可操作');
          if (action === 'advance') {
            const stages = await tx.opportunityStage.findMany({
              where: { tenantId: a.tenantId },
              orderBy: { sortOrder: 'asc' },
            });
            const index = stages.findIndex((s) => s.code === row.stage);
            const next = stages[index + 1];
            if (!next || next.isWon) throw new BadRequestException('下一步需通过合同签约完成赢单');
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
              data: { status: 'lost', lossDetail: text(body.reason, '输单原因', 500) },
            });
          if (action === 'quote') return this.quote(tx, a, row, body);
        } else if (['contracts', 'orders'].includes(kind)) {
          if (action === 'submit') {
            if (!['draft', 'rejected'].includes(String(row.status))) throw new BadRequestException('当前状态不可提交');
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
            await tx.contract.update({ where, data: { status: 'signed', signDate: new Date() } });
            await recalculateCustomerContracts(tx, a.tenantId, id(row.customerId));
            if (row.opportunityId)
              await tx.opportunity.updateMany({
                where: { id: id(row.opportunityId), tenantId: a.tenantId },
                data: { status: 'won', stage: 'signing', winDate: new Date(), contractId: recordId },
              });
            const amount = new Prisma.Decimal(String(row.amount));
            await tx.paymentPlan.create({
              data: {
                tenantId: a.tenantId,
                contractId: recordId,
                planNo: code('HK'),
                amount,
                outstandingAmount: amount,
                dueDate: new Date(Date.now() + 30 * 86400000),
                status: 'pending',
                triggerCondition: '演示：合同签约后30天',
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
                data: { status: 'pending', completedAt: null, completedBy: null, actualDate: null, deliverables: null },
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
        }
        return { id: recordId, kind, action };
      } finally {
        await this.db(tx, kind).update({
          where: { id: recordId, tenantId: a.tenantId },
          data: { updatedAt: writeStamp },
        });
      }
    });
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
      data: { amount: total, updatedAt: new Date(Math.max(Date.now(), new Date(row.updatedAt!).getTime() + 1)) },
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
  async overview(a: Actor) {
    const tx = this.prisma.system;
    const [customers, opps, contracts, projects, plans, actions, users] = await Promise.all([
      tx.customer.findMany({ where: await this.scope(tx, a, 'customers') }),
      tx.opportunity.findMany({ where: await this.scope(tx, a, 'opportunities') }),
      tx.contract.findMany({ where: await this.scope(tx, a, 'contracts') }),
      tx.project.findMany({ where: await this.scope(tx, a, 'projects') }),
      tx.paymentPlan.findMany({ where: await this.scope(tx, a, 'payment-plans') }),
      tx.actionPlan.findMany({
        where: { ...(await this.scope(tx, a, 'actions')), status: { in: ['pending', 'in_progress', 'overdue'] } },
        take: 20,
        orderBy: { dueDate: 'asc' },
      }),
      tx.user.findMany({
        where: {
          tenantId: a.tenantId,
          status: 'active',
          deletedAt: null,
          ...(!admin(a) && !boss(a) ? { id: { in: await teamIds(tx, a) } } : {}),
        },
        select: { id: true, name: true, deptId: true },
      }),
    ]);
    const sum = (values: Prisma.Decimal[]) => values.reduce((n, v) => n.add(v), new Prisma.Decimal(0)).toString();
    const stages = await tx.opportunityStage.findMany({
      where: { tenantId: a.tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      role: admin(a) ? 'admin' : boss(a) ? 'boss' : manager(a) ? 'manager' : 'sales',
      customers: customers.length,
      openOpportunities: opps.filter((o) => o.status === 'open').length,
      pipeline: sum(opps.filter((o) => o.status === 'open').map((o) => o.amount)),
      signedAmount: sum(
        contracts.filter((c) => ['signed', 'executing', 'completed'].includes(c.status)).map((c) => c.amount),
      ),
      received: sum(plans.map((p) => p.receivedAmount)),
      outstanding: sum(plans.map((p) => p.outstandingAmount)),
      overdue: sum(
        plans.filter((p) => p.dueDate < new Date() && p.status !== 'cancelled').map((p) => p.outstandingAmount),
      ),
      projects: projects.length,
      funnel: stages.map((s) => ({
        name: s.name,
        code: s.code,
        count: opps.filter((o) => o.stage === s.code).length,
        amount: sum(opps.filter((o) => o.stage === s.code).map((o) => o.amount)),
      })),
      actions,
      users,
      financeNotice: '财务数据为合成演示数据，暂无真实财务处理功能',
    };
  }
}
