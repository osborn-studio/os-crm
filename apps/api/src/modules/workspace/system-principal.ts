import { ForbiddenException } from '@nestjs/common';

// Reserved policies only: no job, scheduler, handler or transport adapter is registered.
const policies = Object.freeze({
  renewal: Object.freeze({ policyVersion: '1.0', capabilities: Object.freeze(['renewal.generate']) }),
  forecast: Object.freeze({ policyVersion: '1.0', capabilities: Object.freeze(['forecast.lock']) }),
});
export type SystemJobName = keyof typeof policies;
declare const serverPrincipal: unique symbol;
export type SystemPrincipal = Readonly<{
  [serverPrincipal]: true;
  tenantId: number;
  jobName: SystemJobName;
  allowedCapabilities: readonly string[];
  policyVersion: string;
  jobRunId: string;
}>;
const issued = new WeakSet<object>();

/** Internal composition boundary. Never call from a controller, DTO or tool adapter. */
export function createSystemPrincipal(tenantId: number, jobName: SystemJobName, jobRunId: string): SystemPrincipal {
  if (
    !Number.isSafeInteger(tenantId) ||
    tenantId <= 0 ||
    !Object.hasOwn(policies, jobName) ||
    typeof jobRunId !== 'string' ||
    !jobRunId.trim() ||
    jobRunId.length > 80
  ) {
    throw new ForbiddenException('无效系统执行主体');
  }
  const policy = policies[jobName];
  const principal = Object.freeze({
    tenantId,
    jobName,
    jobRunId,
    policyVersion: policy.policyVersion,
    allowedCapabilities: policy.capabilities,
  }) as SystemPrincipal;
  issued.add(principal);
  return principal;
}

export function validateSystemPrincipal(principal: SystemPrincipal, capability: string): void {
  if (
    !principal ||
    !issued.has(principal) ||
    principal.policyVersion !== policies[principal.jobName].policyVersion ||
    !principal.allowedCapabilities.includes(capability)
  ) {
    throw new ForbiddenException('系统任务无此能力授权');
  }
}
