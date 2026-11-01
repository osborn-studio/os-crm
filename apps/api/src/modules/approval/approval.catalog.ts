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
    approverType: { enum: ['user', 'role', 'dept_leader'] },
    approverValue: { type: 'string' },
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
  version: '1.0';
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
  version: '1.0',
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
      objectResult,
      [...writeGuards, 'current assigned node', 'pending status', 'no self approval', 'atomic business callback'],
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
