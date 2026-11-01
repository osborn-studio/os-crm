import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CustomerService } from '../customer/customer.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';
import type { Actor } from '../../common/types/actor';
import { CAPABILITIES } from './capability.catalog';

@Injectable()
export class CapabilityService {
  constructor(
    private readonly customers: CustomerService,
    private readonly audit: AuditLogService,
  ) {}

  list(actor: Actor) {
    return CAPABILITIES.filter((entry) => this.allowed(actor, entry.permission));
  }

  async invoke(
    actor: Actor,
    id: string,
    input: unknown,
    trace?: { grantId: string; agentExecutionId: string },
  ): Promise<unknown> {
    const definition = CAPABILITIES.find((entry) => entry.id === id);
    if (!definition) throw new NotFoundException('业务能力不存在');
    if (!this.allowed(actor, definition.permission)) throw new ForbiddenException('无权调用此业务能力');
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('input必须为对象');
    }
    const values = input as Record<string, unknown>;
    const keys = id === 'customer.get' ? ['customerId'] : ['keyword', 'page', 'pageSize'];
    if (Object.keys(values).some((key) => !keys.includes(key))) throw new BadRequestException('存在未定义参数');
    if (id === 'customer.get') this.integer(values.customerId, 1, Number.MAX_SAFE_INTEGER);
    else {
      if (values.keyword !== undefined && (typeof values.keyword !== 'string' || values.keyword.length > 200)) {
        throw new BadRequestException('keyword必须为不超过200字的文本');
      }
      if (values.page !== undefined) this.integer(values.page, 1, 1_000_000);
      if (values.pageSize !== undefined) this.integer(values.pageSize, 1, 100);
    }
    const executionId = randomUUID();
    try {
      let result: unknown;
      if (id === 'customer.search') {
        const data = await this.customers.findAll(
          actor.tenantId,
          {
            keyword: values.keyword as string | undefined,
            page: values.page as number | undefined,
            pageSize: values.pageSize as number | undefined,
          },
          actor,
        );
        result = {
          ...data,
          items: data.items.map((entry) => ({
            id: entry.id,
            code: entry.code,
            name: entry.name,
            industry: entry.industry,
            poolType: entry.poolType,
          })),
        };
      } else {
        const entry = await this.customers.findOne(actor.tenantId, values.customerId as number, actor);
        result = {
          id: entry.id,
          code: entry.code,
          name: entry.name,
          industry: entry.industry,
          poolType: entry.poolType,
          status: entry.status,
          ...(entry.poolType === 'public' && !actor.roles.some((role) => ['super_admin', 'gm'].includes(role))
            ? {}
            : { contractAmount: entry.contractAmount, statistics: entry._stats }),
        };
      }
      await this.audit.log({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'capability.succeeded',
        objectType: 'capability',
        objectNo: executionId,
        afterData: {
          capabilityId: id,
          version: definition.version,
          effect: definition.effect,
          ...(trace ? { executor: 'agent', ...trace } : { executor: 'human' }),
        },
      });
      return { executionId, capabilityId: id, version: definition.version, result };
    } catch (error) {
      await this.audit.log({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'capability.failed',
        objectType: 'capability',
        objectNo: executionId,
        afterData: {
          capabilityId: id,
          version: definition.version,
          ...(trace ? { executor: 'agent', ...trace } : { executor: 'human' }),
        },
      });
      throw error;
    }
  }

  private integer(value: unknown, min: number, max: number): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new BadRequestException('整数参数超出允许范围');
    }
  }

  private allowed(actor: Actor, permission: string): boolean {
    return (
      actor.roles.includes('super_admin') ||
      actor.permissions.some(
        (entry) => entry === '*' || entry === permission || entry === `${permission.split(':')[0]}:*`,
      )
    );
  }
}
