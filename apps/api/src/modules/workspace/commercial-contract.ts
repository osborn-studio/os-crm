const string = { type: 'string' },
  integer = { type: 'integer', minimum: 1 };
const command = {
  requestKey: { type: 'string', minLength: 1, maxLength: 80 },
  expectedUpdatedAt: { type: 'string', format: 'date-time' },
};
const routes: Record<string, string> = {
  'customer.import.preview': 'POST /commercial/customers/import/preview',
  'customer.import.commit': 'POST /commercial/customers/import/commit',
  'customer.sales.handover.options': 'GET /commercial/customers/handover/options',
  'customer.sales.handover.preview': 'POST /commercial/customers/:id/handover/preview',
  'customer.sales.handover': 'POST /commercial/customers/:id/handover',
  'contract.change.list': 'GET /commercial/contracts/:id/changes',
  'contract.change.preview': 'POST /commercial/contracts/:id/changes/preview',
  'contract.change.request': 'POST /commercial/contracts/:id/changes',
  'opportunity.stages.list': 'GET /commercial/opportunity-stages',
};
export const commercialCapabilities = [
  {
    id: 'customer.sales.handover.options',
    access: 'supervisor',
    permission: 'customer:update',
    effect: 'read',
    inputSchema: { properties: { keyword: string } },
    outputSchema: { required: ['customers', 'recipients'] },
    guards: ['current and former department members', 'bounded minimal projection'],
  },
  {
    id: 'contract.change.list',
    access: 'read',
    permission: 'contract:read',
    effect: 'read',
    inputSchema: { properties: {} },
    outputSchema: { required: ['items'] },
    guards: ['contract record scope', 'immutable history; legacy text retained'],
  },
  {
    id: 'opportunity.stages.list',
    access: 'read',
    permission: 'opportunity:read',
    effect: 'read',
    inputSchema: { properties: {} },
    outputSchema: { required: ['items'] },
    guards: ['authenticated tenant definitions'],
  },
  {
    id: 'customer.import.preview',
    access: 'admin',
    permission: 'customer:create',
    effect: 'proposal',
    inputSchema: {
      required: ['requestKey', 'csv'],
      properties: {
        requestKey: command.requestKey,
        csv: { type: 'string', description: 'UTF-8 CSV <=1MiB, <=200 records; Chinese template headers' },
      },
    },
    outputSchema: { required: ['previewId', 'digest', 'rows', 'ready', 'duplicates', 'errors', 'expiresAt'] },
    guards: [
      'administrator only',
      'column whitelist',
      'normalized-name duplicate report',
      'no business records written',
    ],
  },
  {
    id: 'customer.import.commit',
    access: 'admin',
    permission: 'customer:create',
    effect: 'write',
    inputSchema: {
      required: ['requestKey', 'previewId', 'digest'],
      properties: { requestKey: command.requestKey, previewId: string, digest: string },
    },
    outputSchema: { required: ['previewId', 'imported', 'skippedDuplicates', 'customerIds', 'sourceHash'] },
    guards: [
      'same tenant/actor preview',
      '15-minute expiry',
      'all errors corrected',
      'explicit duplicate skipping',
      'fresh duplicate recheck',
      'quota',
      'atomic batch',
    ],
  },
  {
    id: 'customer.sales.handover.preview',
    access: 'supervisor',
    permission: 'customer:update',
    effect: 'read',
    inputSchema: { required: ['userId'], properties: { userId: integer } },
    outputSchema: { required: ['customerId', 'expectedUpdatedAt', 'counts', 'toUserId'] },
    guards: [
      'current or former department members',
      'all related sales owners in scope',
      'no pending business approval',
      'active sales recipient',
    ],
  },
  {
    id: 'customer.sales.handover',
    access: 'supervisor',
    permission: 'customer:update',
    effect: 'write',
    inputSchema: {
      required: ['requestKey', 'expectedUpdatedAt', 'digest', 'userId', 'reason'],
      properties: { ...command, digest: string, userId: integer, reason: string },
    },
    outputSchema: { required: ['customerId', 'fromUserId', 'toUserId', 'counts', 'reason'] },
    guards: [
      'record version',
      'same checks as preview',
      'atomic related sales ownership',
      'delivery managers and historical authors preserved',
    ],
  },
  {
    id: 'contract.change.preview',
    access: 'sales',
    permission: 'contract:create',
    effect: 'read',
    inputSchema: {
      required: ['changeType', 'data'],
      properties: { changeType: { enum: ['amount', 'schedule', 'terms', 'terminate'] }, data: { type: 'object' } },
    },
    outputSchema: { required: ['contractId', 'expectedUpdatedAt', 'before', 'proposed', 'formFields', 'impact'] },
    guards: [
      'visible signed contract',
      'no downstream execution',
      'one unexecuted payment plan',
      'configured approval flow',
    ],
  },
  {
    id: 'contract.change.request',
    access: 'sales',
    permission: 'contract:create',
    effect: 'write',
    inputSchema: {
      required: ['requestKey', 'expectedUpdatedAt', 'changeType', 'data', 'reason'],
      properties: {
        ...command,
        changeType: { enum: ['amount', 'schedule', 'terms', 'terminate'] },
        data: { type: 'object' },
        reason: string,
        form: { type: 'object' },
      },
    },
    outputSchema: { required: ['id', 'contractId', 'approvalId', 'status'] },
    guards: [
      'same conditions as preview',
      'immutable source/patch snapshots',
      'no self approval',
      'versioned approval definition',
      'atomic callback',
      'Decimal recalculation',
      'reject/withdraw release pending guard',
    ],
  },
].map((c) => ({
  ...c,
  version: '1.0',
  route: routes[c.id],
  ...(routes[c.id].includes(':id')
    ? { pathSchema: { type: 'object', required: ['id'], properties: { id: integer } } }
    : {}),
  inputSchema: { type: 'object', additionalProperties: false, ...c.inputSchema },
  outputSchema: ['contract.change.list', 'opportunity.stages.list'].includes(c.id)
    ? { type: 'array', items: { type: 'object' } }
    : { type: 'object', ...c.outputSchema },
  actorSource: 'authenticated context; no tenant/actor body fields',
  agentExposed: false,
  evidence:
    c.effect === 'read'
      ? 'scoped projection or impact preview; no business mutation'
      : 'durable execution/audit and preview or immutable snapshots',
}));
