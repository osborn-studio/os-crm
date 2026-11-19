import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import {BusinessReportService} from '../workspace/business-report.service';
import {reportSortFields} from '../workspace/workspace-sort';
import { AnalyticsService } from '../workspace/analytics.service';
import { allowedReportCapabilities } from '../workspace/analytics.contract';
import { json, validateActor } from '../workspace/command-runner';

export function reportInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('报表参数必须为对象');
  const numeric: Record<string, [number, number]> = {
    year: [2010, 2060], month: [0, 12], ownerId: [1, 2147483647], deptId: [1, 2147483647],
    contractId: [1, 2147483647], page: [1, 1000000], pageSize: [1, 100],
  };
  const enums: Record<string, readonly string[]> = {
    sortBy:reportSortFields,sortOrder:['asc','desc'],metric:['contracts','contractReceived','invoiceReceived','unpaid','invoiced','invoiceUnpaid','construction','commission','projection'],
    personRange: ['self','person','company','department'],
    source: ['managed', 'legacy'], detail: ['contracts', 'plans', 'receipts', 'balances', 'overdue'],
    bucket: ['open', 'won', 'lost', 'closed', 'undated'],
  };
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.hasOwn(numeric, key)) {
      const [min, max] = numeric[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(key + '必须为范围内整数');
      query[key] = String(value);
    } else if (['from','to'].includes(key) && typeof value==='string' && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value) && value>='2010-01-01' && value<='2060-12-31' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value) query[key]=value;
    else if (Object.hasOwn(enums, key) && typeof value === 'string' && enums[key].includes(value)) query[key] = value;
    else throw new BadRequestException('存在未定义或无效报表参数');
  }
  return query;
}
@Injectable()
export class ReportCapabilityService {
  constructor(private readonly analytics: AnalyticsService, private readonly prisma: PrismaService, private readonly business:BusinessReportService) {}
  async invoke(actor: Actor, id: string, input: unknown, trace?: { grantId: string; agentExecutionId: string }) {
    const definition = allowedReportCapabilities(actor).find(c => c.id === id);
    if (!definition) throw new ForbiddenException('无权调用此报表能力');
    const executionId = randomUUID();
    const evidence = { capabilityId: id, version: definition.version, effect: 'read', executor: trace ? 'agent' : 'human', ...trace };
    try {
      const query = reportInput(input);
      const result = id === 'report.business.cash' ? await this.business.read(actor,query) : id === 'report.sales.forecast' ? await this.analytics.forecast(actor, query) : await this.analytics.collections(actor, query);
      await this.prisma.system.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'capability.succeeded', objectType: 'capability', objectNo: executionId,
        afterData: json({ ...evidence, inputHash: createHash('sha256').update(JSON.stringify(query)).digest('hex'), generatedAt: result.generatedAt }),
      } });
      await validateActor(this.prisma.system, actor);
      return { executionId, capabilityId: id, version: definition.version, result };
    } catch (error) {
      await this.prisma.system.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'capability.failed', objectType: 'capability', objectNo: executionId, afterData: json(evidence) } });
      throw error;
    }
  }
}
