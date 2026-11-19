import { statisticsProperties } from '../workspace/statistics-scope';
const str = { type: 'string' },
  requestKey = { type: 'string', minLength: 1, maxLength: 80 },
  version = { type: 'string', format: 'date-time' };
const envelope = (properties: object, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', ...required],
  properties: { requestKey, ...properties },
});
const entryFields = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 2000 },
  location: { type: 'string', maxLength: 300 },
  startsAt: version,
  endsAt: version,
  freeBusy: { enum: ['busy', 'free'] },
  status: { enum: ['scheduled', 'cancelled'] },
};
const jobVersion = { expectedUpdatedAt: version };
export const activityCapabilities = [
  {id:'integration.calendar.pull',route:'POST /integrations/dingtalk-activities/pull',permission:'own bound identity and action read/update',effect:'external-read-and-local-write',inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object',required:['created','updated','unchanged','from','until','sourceHash']}},
  {
    id: 'calendar.list',
    route: 'GET /calendar',
    permission: 'action:read',
    effect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'until'],
      properties: { from: version, until: version, ...statisticsProperties },
    },
    outputSchema: {
      type: 'object',
      required: ['items', 'timeZone'],
      properties: { items: { type: 'array', maxItems: 5000, items: { type: 'object' } }, timeZone: str },
    },
  },
  ...[false, true].map((update) => ({
    id: update ? 'calendar.update' : 'calendar.create',
    route: update ? 'PUT /calendar/:id' : 'POST /calendar',
    permission: update ? 'action:update AND sales business writer' : 'action:create AND sales business writer',
    effect: 'write',
    inputSchema: envelope(
      {
        ...(update ? jobVersion : {}),
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'startsAt', 'endsAt'],
          properties: entryFields,
        },
      },
      ['data', ...(update ? ['expectedUpdatedAt'] : [])],
    ),
    outputSchema: {
      type: 'object',
      required: ['id', 'ownerId', 'revision', 'updatedAt'],
      properties: {
        id: { type: 'integer' },
        ownerId: { type: 'integer' },
        revision: { type: 'integer' },
        updatedAt: version,
      },
    },
  })),
  {
    id: 'integration.activity.state',
    route: 'GET /integrations/dingtalk-activities',
    permission: 'authenticated; own data only',
    effect: 'read',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      required: ['bound', 'owner', 'jobs', 'links'],
      properties: {
        bound: { type: 'boolean' },
        owner: { type: 'object' },
        jobs: { type: 'array', maxItems: 100 },
        links: { type: 'array', maxItems: 100 },
      },
    },
  },
  {
    id: 'integration.activity.history',
    route: 'GET /integrations/dingtalk-activities/history',
    permission: 'authenticated; own currently visible module data only',
    effect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { before: { type: 'string', maxLength: 36 } },
    },
    outputSchema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: { items: { type: 'array', maxItems: 50 }, nextCursor: { type: ['string', 'null'] } },
    },
  },
  {
    id: 'integration.activity.configure',
    route: 'POST /integrations/dingtalk-activities/settings',
    permission: 'own bound identity; action read/update or approval approve/reject for selected type',
    effect: 'write',
    inputSchema: envelope(
      {
        expectedUpdatedAt: version,
        calendarEnabled: { type: 'boolean' },
        todoEnabled: { type: 'boolean' },
        autoEnabled: { type: 'boolean' },
      },
      ['calendarEnabled', 'todoEnabled', 'autoEnabled'],
    ),
    outputSchema: {
      type: 'object',
      required: ['id', 'bindingHash', 'updatedAt'],
      properties: { id: str, bindingHash: str, updatedAt: version },
    },
  },
  {
    id: 'integration.activity.preview',
    route: 'GET /integrations/dingtalk-activities/preview',
    permission: 'own bound identity; enabled feature permission',
    effect: 'read',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      required: ['items', 'complete'],
      properties: { items: { type: 'array', items: { type: 'object' } }, complete: { const: true } },
    },
  },
  {
    id: 'integration.activity.prepare',
    route: 'POST /integrations/dingtalk-activities/prepare',
    permission: 'own bound identity; enabled feature permission',
    effect: 'write',
    inputSchema: envelope(
      {
        rows: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'sourceId', 'sourceVersion'],
            properties: {
              kind: { enum: ['calendar', 'approval'] },
              sourceId: { type: 'integer', minimum: 1 },
              sourceVersion: { type: 'string', minLength: 64, maxLength: 64 },
            },
          },
        },
      },
      ['rows'],
    ),
    outputSchema: {
      type: 'object',
      required: ['jobs'],
      properties: { jobs: { type: 'array', maxItems: 50, items: { type: 'object' } } },
    },
  },
  {
    id: 'integration.activity.archive',
    route: 'POST /integrations/dingtalk-activities/links/:id/archive',
    permission: 'own ended projection only',
    effect: 'write',
    inputSchema: envelope(jobVersion, ['expectedUpdatedAt']),
    outputSchema: { type: 'object', required: ['id', 'archivedAt'] },
  },
  ...['dispatch', 'cancel', 'reconcile', 'stop', 'resume'].map((action) => ({
    id: `integration.activity.${action}`,
    route: `POST /integrations/dingtalk-activities/jobs/:id/${action}`,
    permission: 'own bound identity and current consent; no cross-user writes',
    effect:
      action === 'dispatch' ? 'external-write' : action === 'reconcile' ? 'external-read-and-local-write' : 'write',
    inputSchema: envelope(
      {
        ...jobVersion,
        ...(action === 'dispatch' ? { forceOverwrite: { type: 'boolean' } } : {}),
        ...(action === 'reconcile' ? { externalId: { type: 'string', maxLength: 200 } } : {}),
      },
      ['expectedUpdatedAt'],
    ),
    outputSchema: { type: 'object' },
  })),
].map((c) => ({
  ...c,
  version: '1.0',
  actor: 'authenticated server context; actor/tenant/profile input forbidden',
  agentWriteEnabled: false,
  guards: [
    'own objects only',
    'current actor and enabled consent',
    'bounded counts',
    'expected source and settings versions',
    'transaction/idempotency/audit for local writes',
    'external effects outside retried transaction',
    'durable lease; never replay a nonidempotent create',
    'uncertain outcomes require read-only reconciliation',
    'DingTalk todo completion never approves CRM',
  ],
  evidence: [
    'CalendarEntry',
    'ActivitySyncSetting',
    'ActivitySyncJob',
    'ActivitySyncLink',
    'CommandExecution',
    'SystemCommandExecution',
    'AuditLog',
  ],
}));
