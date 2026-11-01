import type { Actor } from '../../common/types/actor';
import { admin, hasPermission } from '../workspace/access';
import { CAPABILITIES } from './capability.catalog';
const uuid = { type: 'string', format: 'uuid' };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const actionInput = object(
  {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    targetId: { type: 'integer', minimum: 1 },
    dueDate: { type: 'string', format: 'date' },
    content: { type: 'string', maxLength: 3000 },
  },
  ['title', 'targetId'],
);
export function agentCatalog(a: Actor) {
  const tools = CAPABILITIES.filter((c) => hasPermission(a, c.permission)).map((c) => ({
    ...c,
    guards: ['live delegated owner scope', 'call budget', 'no raw SQL', 'fresh read; unique attempt UUID'],
    evidence: ['executionId', 'grantId', 'businessExecutionId'],
  }));
  const canWrite =
    hasPermission(a, 'action:create') &&
    hasPermission(a, 'customer:read') &&
    (admin(a) || a.roles.includes('sales') || a.roles.includes('sales_manager'));
  const writes = canWrite
    ? [
        {
          id: 'action.propose',
          version: '1.0',
          effect: 'proposal',
          permission: 'action:create',
          inputSchema: actionInput,
          outputSchema: {
            type: 'object',
            required: ['proposalId', 'input', 'customer', 'expiresAt', 'requiresHumanApproval'],
          },
          guards: [
            'live grant/owner/session/permission',
            'shared workspace preview',
            'customer visible; public-customer ownership rules',
            'expires in at most 30 minutes',
            'no business write',
          ],
          evidence: ['proposalId', 'executionId', 'inputHash', 'customerVersion'],
        },
        {
          id: 'action.execute',
          version: '1.0',
          effect: 'write',
          permission: 'action:create',
          inputSchema: object({ proposalId: uuid }, ['proposalId']),
          outputSchema: { type: 'object', required: ['proposalId', 'status', 'actionId'] },
          guards: [
            'original owner explicit approval',
            'immutable approved payload',
            'live customer version/scope',
            'grant session/scope/expiry/revocation',
            'Serializable transaction',
            'durable idempotency and quota',
            'no financial or external effects',
          ],
          evidence: ['executionId', 'grantId', 'proposalId', 'actionId', 'ownerId', 'decidedBy'],
        },
      ]
    : [];
  return {
    version: '1.0',
    identity: 'opaque agent credential; never human JWT',
    credentialOnce: true,
    maxMinutes: 1440,
    maxCalls: 1000,
    tools: [...tools, ...writes],
    controls: [
      {
        id: 'agent.grant.issue',
        version: '1.0',
        effect: 'credential',
        method: 'POST',
        path: '/api/v1/agent-control/grants',
        inputSchema: object(
          {
            requestKey: uuid,
            name: { type: 'string', maxLength: 100 },
            purpose: { type: 'string', maxLength: 1000 },
            minutes: { type: 'integer', minimum: 1, maximum: 1440 },
            maxCalls: { type: 'integer', minimum: 1, maximum: 1000 },
            capabilities: { type: 'array', uniqueItems: true, items: { enum: [...tools, ...writes].map((t) => t.id) } },
          },
          ['requestKey', 'name', 'purpose', 'minutes', 'maxCalls', 'capabilities'],
        ),
        outputSchema: {
          type: 'object',
          required: ['id', 'expiresAt', 'capabilities'],
          properties: { token: { type: 'string', description: 'first response only; never persisted' } },
        },
        permission: 'human owner only; cannot delegate absent capabilities',
        guards: ['live session', 'snapshot permissions', 'HMAC hash only', 'max 10 active grants'],
        evidence: ['grantId', 'ownerId', 'audit'],
      },
      {
        id: 'agent.grant.revoke',
        version: '1.0',
        effect: 'revoke',
        method: 'POST',
        path: '/api/v1/agent-control/grants/{grantId}/revoke',
        inputSchema: object({ requestKey: uuid, reason: { type: 'string', minLength: 1, maxLength: 1000 } }, [
          'requestKey',
          'reason',
        ]),
        permission: 'human owner or same-tenant administrator',
        guards: ['no stale quota-version barrier', 'immediate on next authorization', 'never recreate credentials'],
        evidence: ['reason', 'revokedAt', 'audit'],
      },
      {
        id: 'agent.proposal.decide',
        version: '1.0',
        effect: 'authorize',
        method: 'POST',
        path: '/api/v1/agent-control/proposals/{proposalId}/{approve|reject}',
        inputSchema: object(
          {
            requestKey: uuid,
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            reason: { type: 'string', minLength: 1, maxLength: 1000 },
          },
          ['requestKey', 'expectedUpdatedAt', 'reason'],
        ),
        permission: 'original human owner only',
        guards: ['pending', 'not expired', 'current grant and target', 'no action execution in approval'],
        evidence: ['decidedBy', 'decidedAt', 'decisionNote', 'audit'],
      },
      {
        id: 'agent.action.compensate',
        version: '1.0',
        effect: 'write',
        method: 'POST',
        path: '/api/v1/agent-control/proposals/{proposalId}/cancel-action',
        inputSchema: object(
          {
            requestKey: uuid,
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            expectedActionUpdatedAt: { type: 'string', format: 'date-time' },
            reason: { type: 'string', minLength: 1, maxLength: 1000 },
          },
          ['requestKey', 'expectedUpdatedAt', 'expectedActionUpdatedAt', 'reason'],
        ),
        outputSchema: { type: 'object', required: ['id', 'status', 'compensation', 'input'] },
        permission: 'original human owner; current action:update and record scope',
        guards: [
          'executed AI action only',
          'action/proposal versions',
          'not completed or already cancelled',
          'no deleted history',
          'grant may already be revoked',
          'same workspace service and atomic audit',
        ],
        evidence: [
          'original proposal and decision preserved',
          'compensation.reason/actorId/cancelledAt',
          'actionId',
          'audit',
        ],
      },
      ...(['grants', 'proposals', 'executions'] as const).map((kind) => ({
        id: `agent.${kind}.list`,
        version: '1.0',
        effect: 'read',
        method: 'GET',
        path: `/api/v1/agent-control/${kind}`,
        inputSchema: object({ after: uuid }, []),
        outputSchema: { type: 'object', required: ['items', 'nextCursor'] },
        permission: 'human owner or same-tenant administrator audit',
        guards: ['tenant scope', '50-row timestamp/id cursor pagination', 'no raw credentials or token hash'],
        evidence: ['stored proposal/receipt IDs'],
      })),
      {
        id: 'agent.runtime.catalog',
        version: '1.0',
        effect: 'read',
        method: 'GET',
        path: '/api/v1/agent-runtime/capabilities',
        inputSchema: object({}, []),
        outputSchema: { type: 'object', required: ['grantId', 'expiresAt', 'remainingCalls', 'capabilities'] },
        permission: 'independent agent credential only',
        guards: ['live parent session and owner snapshot', 'actual grant allowlist', 'no budget charge for metadata'],
        evidence: ['grantId'],
      },
      {
        id: 'agent.runtime.invoke',
        version: '1.0',
        effect: 'dispatch',
        method: 'POST',
        path: '/api/v1/agent-runtime/invoke',
        inputSchema: object(
          {
            requestKey: uuid,
            capabilityId: { enum: [...tools, ...writes].map((t) => t.id) },
            input: { type: 'object' },
          },
          ['requestKey', 'capabilityId', 'input'],
        ),
        outputSchema: { type: 'object', required: ['executionId', 'grantId', 'executor', 'result'] },
        permission: 'independent agent credential with exact capability',
        guards: ['tool-specific schema', 'budget', 'no human control routes', 'write idempotency'],
        evidence: ['executionId', 'inputHash', 'grantId'],
      },
      {
        id: 'agent.runtime.receipt',
        version: '1.0',
        effect: 'read',
        method: 'GET',
        path: '/api/v1/agent-runtime/receipts/{executionId}',
        inputSchema: object({}, []),
        outputSchema: { type: 'object', required: ['id', 'status', 'currentProposal'] },
        permission: 'same live independent grant that owns the receipt',
        guards: [
          'tenant and grant scope',
          'current compensation status distinct from original receipt',
          'no stored customer read results',
        ],
        evidence: ['executionId', 'currentProposal.status', 'compensation'],
      },
    ],
    readControls: ['GET /agent-control/grants', 'GET /agent-control/proposals', 'GET /agent-control/executions'],
    readLimit: 50,
    readOrder: 'latest first; opaque after UUID cursor with timestamp/id tie breaking',
    modelUsage:
      'no model invoked; budget counts admitted read attempts and committed write commands, not failed rolled-back writes, discovery/receipts, model tokens or currency',
  };
}
