import { ticketActions } from './service-ticket-policy';
const positiveId = { type: 'integer', minimum: 1 };
const cursor = { type: 'string', pattern: '^[1-9][0-9]*$' };
const note = { type: 'string', minLength: 1, maxLength: 5000 };
const outputSchema = {
  type: 'object',
  required: ['id', 'status', 'updatedAt'],
  properties: {
    id: positiveId,
    status: { enum: ['open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled'] },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const serviceTicketCapabilities = [
  ...['list', 'detail', 'people'].map((name) => ({
    id: `service-ticket.${name}`,
    version: '1.0',
    effect: 'read',
    permission: name === 'people' ? 'project:update' : 'project:read',
    agentEnabled: false,
    route: name === 'list' ? '/service-tickets' : `/service-tickets/{ticketId}${name === 'people' ? '/people' : ''}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...(name === 'list' ? {} : { ticketId: positiveId }), ...(name === 'people' ? {} : { cursor }) },
      required: name === 'list' ? [] : ['ticketId'],
    },
    outputSchema:
      name === 'detail'
        ? outputSchema
        : name === 'people'
          ? { type: 'array', items: { type: 'object', required: ['id', 'name'] } }
          : {
              type: 'object',
              required: ['items', 'nextCursor'],
              properties: {
                items: { type: 'array', maxItems: 50, items: outputSchema },
                nextCursor: { type: ['string', 'null'] },
              },
            },
    guards: [
      'current tenant',
      'current project scope or ticket creator/assignee',
      ...(name === 'people' ? ['project management authority', 'eligible active execution role and department'] : []),
    ],
    evidence: ['ticket id/version', 'paged append-only event history'],
  })),
  ...['create', ...ticketActions].map((action) => {
    const properties =
      action === 'create'
        ? {
            requestKey: { type: 'string', minLength: 1, maxLength: 80 },
            projectId: positiveId,
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: note,
            priority: { enum: ['low', 'medium', 'high'] },
          }
        : {
            requestKey: { type: 'string', minLength: 1, maxLength: 80 },
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            note,
            ...(action === 'assign' ? { userId: positiveId } : {}),
          };
    return {
      id: `service-ticket.${action}`,
      version: '1.0',
      effect: 'write',
      permission: 'project:update',
      agentEnabled: false,
      route: action === 'create' ? '/service-tickets' : `/service-tickets/{ticketId}/${action}`,
      pathSchema: action === 'create' ? null : { ticketId: positiveId },
      inputSchema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
      outputSchema,
      guards: [
        'live authenticated actor',
        'tenant and record scope',
        'serializable transaction and durable idempotency',
        'optimistic ticket version',
        'accepted completed project for creation',
        'project manager/department supervisor/admin for assignment, review, reopen, cancellation',
        'current assignee for start, note, solution',
        'resolver cannot review own solution, including administrator',
      ],
      evidence: [
        'append-only event with actor-name snapshot and before/after state',
        'command execution receipt',
        'audit',
      ],
    };
  }),
];
