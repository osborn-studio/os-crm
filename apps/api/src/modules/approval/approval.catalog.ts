import type { Actor } from '../../common/types/actor';
import { admin, hasPermission } from '../workspace/access';
const requestKey = { type: 'string', minLength: 1, maxLength: 80 };
const integer = { type: 'integer', minimum: 1 };
const objectResult = { type: 'object', required: ['id'] };
const node = {
  type: 'object',
  required: ['name', 'approverType'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 50 },
    approverType: { enum: ['user', 'users_all', 'role', 'dept_leader'] },
    approverValue: {
      type: 'string',
      description: 'users_all:2..8 distinct user IDs separated by commas; every member must approve',
    },
    condition: { type: 'string', description: 'always or anchored amount comparison' },
  },
};
const field = {
  type: 'object',
  required: ['key', 'label', 'type'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: '^[a-z][a-zA-Z0-9_]*$' },
    label: { type: 'string', maxLength: 50 },
    type: { enum: ['text', 'number', 'date'] },
    required: { type: 'boolean' },
  },
};
interface Operation {
  id: string;
  version: '1.0' | '2.0';
  effect: 'read' | 'write';
  method: string;
  path: string;
  permission: string;
  role?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  guards: string[];
}
const definition = (
  id: string,
  effect: Operation['effect'],
  method: string,
  path: string,
  permission: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  guards: string[],
  role?: string,
): Operation => ({
  id,
  version: [
    'approval.flow.save',
    'approval.flow.preview',
    'approval.transfer',
    'approval.pending',
    'approval.detail',
    'approval.approve',
    'approval.reject',
  ].includes(id)
    ? '2.0'
    : '1.0',
  effect,
  method,
  path,
  permission,
  inputSchema,
  outputSchema,
  guards,
  ...(role ? { role } : {}),
});
const keyed = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', ...required],
  properties: { requestKey, ...properties },
});
const writeGuards = ['authenticated tenant/actor', 'Serializable transaction', 'durable idempotency', 'audit'];
export const APPROVAL_OPERATIONS: readonly Operation[] = [
  definition(
    'approval.history',
    'read',
    'GET',
    '/api/v1/approvals/history',
    'authenticated',
    { type: 'object', properties: { after: integer }, additionalProperties: false },
    { type: 'object', required: ['items', 'nextCursor'] },
    ['tenant scope', 'applicant or assigned participant; administrator tenant audit', '50-row cursor pagination'],
  ),
  definition(
    'approval.detail',
    'read',
    'GET',
    '/api/v1/approvals/{approvalId}',
    'authenticated',
    { type: 'object', additionalProperties: false },
    { type: 'object', required: ['id', 'nodes', 'updatedAt'] },
    [
      'tenant scope',
      'applicant or assigned participant; administrator tenant audit',
      'transfer flags are not write authority',
    ],
  ),
  definition(
    'approval.events',
    'read',
    'GET',
    '/api/v1/approvals/{approvalId}/events',
    'authenticated',
    { type: 'object', properties: { after: integer }, additionalProperties: false },
    { type: 'object', required: ['items', 'nextCursor'] },
    ['same approval visibility', '50-row cursor pagination', 'no fabricated legacy events'],
  ),
  definition(
    'approval.transfer.people',
    'read',
    'GET',
    '/api/v1/approvals/{approvalId}/nodes/{nodeId}/transfer-people',
    'authenticated',
    { type: 'object', properties: { after: integer }, additionalProperties: false },
    { type: 'object', required: ['items', 'nextCursor'] },
    [
      'current assigned approver or administrator',
      'active same-tenant user and department',
      'complete approval permissions',
      'excludes applicant and original assignee',
      '100-user scan cursor',
    ],
  ),
  definition(
    'approval.transfer',
    'write',
    'POST',
    '/api/v1/approvals/{approvalId}/nodes/{nodeId}/transfer',
    'authenticated',
    keyed(
      {
        expectedUpdatedAt: { type: 'string', format: 'date-time' },
        targetUserId: integer,
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      ['expectedUpdatedAt', 'targetUserId', 'reason'],
    ),
    { type: 'object', required: ['id', 'nodeId', 'status', 'updatedAt'] },
    [
      ...writeGuards,
      'live current assigned approver with approve/reject; administrator may recover future pending nodes',
      'expectedUpdatedAt',
      'pending approval and node',
      'active same-tenant fully authorized target',
      'target cannot be applicant or old assignee',
      'preserve original node and flow snapshot',
      'atomic event and inbox notifications',
      'no business callback or implicit approval',
      'agent writes disabled',
    ],
  ),
  definition(
    'approval.flow.list',
    'read',
    'GET',
    '/api/v1/approvals/flows',
    'authenticated',
    { type: 'object', additionalProperties: false },
    { type: 'array' },
    ['tenant scope', 'published only for non-admin'],
  ),
  definition(
    'approval.flow.save',
    'write',
    'POST',
    '/api/v1/approvals/flows',
    'approval:design',
    keyed(
      {
        name: { type: 'string', maxLength: 100 },
        bizType: {
          enum: [
            'general',
            'contract',
            'contract_change',
            'order',
            'project_initiation',
            'discount',
            'expense',
            'leave',
            'purchase',
          ],
        },
        priority: { type: 'integer', minimum: 0, maximum: 1000 },
        condition: { type: 'string' },
        nodes: { type: 'array', minItems: 1, maxItems: 12, items: node },
        fields: { type: 'array', maxItems: 20, items: field },
      },
      ['name', 'bizType', 'nodes'],
    ),
    objectResult,
    [...writeGuards, 'valid conditions/approvers', 'new draft version'],
    'super_admin',
  ),
  definition(
    'approval.flow.publish',
    'write',
    'POST',
    '/api/v1/approvals/flows/{flowId}/publish',
    'approval:design',
    keyed({ expectedUpdatedAt: { type: 'string', format: 'date-time' } }, ['expectedUpdatedAt']),
    objectResult,
    [...writeGuards, 'tenant flow', 'expectedUpdatedAt', 'non-empty nodes'],
    'super_admin',
  ),
  definition(
    'approval.flow.preview',
    'read',
    'POST',
    '/api/v1/approvals/flows/{flowId}/preview',
    'authenticated',
    { type: 'object', properties: { amount: { type: ['number', 'string'] } } },
    { type: 'object', required: ['matches', 'nodes', 'version'] },
    ['tenant scope', 'active flow for non-admin', 'valid amount', 'resolve actual approvers'],
  ),
  definition(
    'approval.create',
    'write',
    'POST',
    '/api/v1/approvals',
    'approval:create',
    keyed(
      {
        flowId: integer,
        title: { type: 'string', maxLength: 200 },
        amount: { type: ['string', 'number'] },
        form: { type: 'object' },
      },
      ['flowId', 'title'],
    ),
    objectResult,
    [
      ...writeGuards,
      'published matching general form',
      'required form fields',
      'no self approval',
      'no missing/ambiguous approvers',
    ],
  ),
  definition(
    'approval.pending',
    'read',
    'GET',
    '/api/v1/approvals/pending',
    'authenticated',
    { type: 'object', additionalProperties: false },
    { type: 'array', items: { type: 'object', required: ['nodeId', 'nodeName', 'approval'] } },
    ['assigned actor', 'current node only', 'pending approval'],
  ),
  definition(
    'approval.initiated',
    'read',
    'GET',
    '/api/v1/approvals/my-initiated',
    'authenticated',
    { type: 'object', additionalProperties: false },
    { type: 'object', required: ['items'] },
    ['applicant actor', 'tenant scope'],
  ),
  ...(['approve', 'reject'] as const).map((action) =>
    definition(
      `approval.${action}`,
      'write',
      'POST',
      `/api/v1/approvals/{approvalId}/nodes/{nodeId}/${action}`,
      `approval:${action}`,
      keyed({ comment: { type: 'string', maxLength: 1000 } }, action === 'reject' ? ['comment'] : []),
      {
        type: 'object',
        required: ['id', 'status', 'waitingForCountersign'],
        properties: {
          id: integer,
          status: { enum: ['pending', 'approved', 'rejected'] },
          waitingForCountersign: {
            type: 'boolean',
            description: 'This vote is saved but other distinct members of the same stage must still approve',
          },
          nextNode: { type: ['string', 'null'] },
        },
      },
      [
        ...writeGuards,
        'assigned participant in current stage',
        'pending status',
        'no self approval',
        'all distinct stage participants approve before advancing; any rejection terminates',
        'final-stage atomic business callback',
      ],
    ),
  ),
  definition(
    'approval.withdraw',
    'write',
    'POST',
    '/api/v1/approvals/{approvalId}/withdraw',
    'approval:withdraw',
    keyed({}),
    { type: 'object', required: ['status'] },
    [...writeGuards, 'applicant only', 'pending status', 'atomic draft callback'],
  ),
];
export function approvalCatalog(actor: Actor) {
  return APPROVAL_OPERATIONS.filter(
    (op) => (!op.role || admin(actor)) && (op.permission === 'authenticated' || hasPermission(actor, op.permission)),
  );
}
