import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { object, text } from '../workspace/command-runner';

export const AGENT_CAPABILITIES = ['customer.search', 'customer.get', 'action.propose', 'action.execute'] as const;
export function only(body: Record<string, unknown>, keys: string[]) {
  object(body);
  if (Object.keys(body).some((k) => !keys.includes(k))) throw new BadRequestException('存在未定义参数');
}
export function uuid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new BadRequestException('需要UUID请求或对象编号');
  return value;
}
export function digest(input: unknown) {
  const canonical = (v: unknown, depth = 0): unknown => {
    if (depth > 20) throw new BadRequestException('参数层级过深');
    return Array.isArray(v)
      ? v.map((item) => canonical(item, depth + 1))
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, value]) => [k, canonical(value, depth + 1)]),
          )
        : v;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}
export function contextHash(a: Actor) {
  return digest({
    userId: a.userId,
    tenantId: a.tenantId,
    sessionId: a.sessionId,
    deptId: a.deptId,
    roles: a.roles.slice().sort(),
    permissions: a.permissions.slice().sort(),
    dataScope: a.dataScope,
  });
}
export function tokenHash(token: string, secret: string) {
  return createHmac('sha256', secret)
    .update('tb-crm-agent-v1\0' + token)
    .digest('hex');
}
export function grantInput(body: Record<string, unknown>) {
  only(body, ['requestKey', 'name', 'purpose', 'minutes', 'maxCalls', 'capabilities']);
  const capabilities = body.capabilities;
  if (
    !Array.isArray(capabilities) ||
    !capabilities.length ||
    capabilities.length > 4 ||
    capabilities.some(
      (c) => typeof c !== 'string' || !AGENT_CAPABILITIES.includes(c as (typeof AGENT_CAPABILITIES)[number]),
    ) ||
    new Set(capabilities).size !== capabilities.length
  )
    throw new BadRequestException('请选择不重复的已开放能力');
  if (capabilities.includes('action.execute') && !capabilities.includes('action.propose'))
    throw new BadRequestException('执行行动必须同时允许预演建议');
  const minutes = body.minutes,
    maxCalls = body.maxCalls;
  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440 ||
    typeof maxCalls !== 'number' ||
    !Number.isInteger(maxCalls) ||
    maxCalls < 1 ||
    maxCalls > 1000
  )
    throw new BadRequestException('委托期限1—1440分钟、调用预算1—1000次');
  return {
    name: text(body.name, '智能体名称', 100),
    purpose: text(body.purpose, '委托目的', 1000),
    minutes,
    maxCalls,
    capabilities: capabilities as string[],
  };
}
export function invocation(body: Record<string, unknown>) {
  only(body, ['requestKey', 'capabilityId', 'input']);
  const capabilityId = text(body.capabilityId, '能力编号', 60);
  if (!AGENT_CAPABILITIES.includes(capabilityId as (typeof AGENT_CAPABILITIES)[number]))
    throw new BadRequestException('智能体能力未开放');
  const input = object(body.input);
  digest(input);
  if (JSON.stringify(input).length > 10000) throw new BadRequestException('智能体参数超过10000字符');
  return { requestKey: uuid(body.requestKey), capabilityId, input };
}
