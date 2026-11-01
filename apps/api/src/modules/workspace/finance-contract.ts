const integer = { type: 'integer', minimum: 1 };
const note = { type: 'string', minLength: 1, maxLength: 1000 };
const money = { type: 'string', pattern: '^\\d{1,13}(\\.\\d{1,2})?$' };
const version = { type: 'string', format: 'date-time' };
const envelope = { requestKey: { type: 'string', minLength: 1, maxLength: 80 }, expectedUpdatedAt: version, note };
const commands = {
  register: {
    customerId: integer,
    contractId: { type: ['integer', 'null'], minimum: 1 },
    amount: money,
    receiptDate: { type: 'string', format: 'date' },
    reference: { type: 'string', minLength: 1, maxLength: 50 },
    note,
    requestKey: envelope.requestKey,
  },
  confirm: envelope,
  allocate: { ...envelope, paymentPlanId: integer, expectedPlanUpdatedAt: version, amount: money },
  reverse: { ...envelope, allocationId: integer, expectedPlanUpdatedAt: version },
  void: envelope,
  correct: {
    ...envelope,
    customerId: integer,
    contractId: { type: ['integer', 'null'], minimum: 1 },
    amount: money,
    receiptDate: { type: 'string', format: 'date' },
  },
};
export const financeCapabilities = [
  ...['list', 'detail', 'plans'].map((name) => ({
    id: 'finance.ledger.' + name,
    version: '1.0',
    effect: 'read',
    permission: 'finance:read with workspace record scope',
    agentExposed: false,
    route:
      name === 'list'
        ? '/finance-ledger/receipts'
        : name === 'detail'
          ? '/finance-ledger/receipts/{recordId}'
          : '/finance-ledger/plans',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: name === 'detail' ? { recordId: integer } : {},
      required: name === 'detail' ? ['recordId'] : [],
    },
    outputSchema:
      name === 'detail'
        ? {
            type: 'object',
            required: [
              'id',
              'receiptNo',
              'amount',
              'allocatedAmount',
              'unallocatedAmount',
              'events',
              'allocations',
              'previous',
              'replacement',
              'canCorrect',
            ],
            properties: {
              id: integer,
              receiptNo: { type: 'string' },
              amount: money,
              allocatedAmount: money,
              unallocatedAmount: money,
              events: { type: 'array', maxItems: 100 },
              allocations: { type: 'array', maxItems: 100 },
              previous: { type: ['object', 'null'] },
              replacement: { type: ['object', 'null'] },
              canCorrect: { type: 'boolean' },
            },
          }
        : { type: 'array', maxItems: 100, items: { type: 'object', required: ['id'], properties: { id: integer } } },
    guards: ['authenticated tenant and record scope', 'bounded 100 results'],
    evidence: ['local ledger only; no bank/tax verification'],
  })),
  ...Object.entries(commands).map(([name, properties]) => ({
    id: 'finance.receipt.' + name,
    version: '1.0',
    effect: 'write',
    permission: 'super_admin only; confirmation must use another admin',
    agentExposed: false,
    route: name === 'register' ? '/finance-ledger/receipts' : `/finance-ledger/receipts/{recordId}/${name}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: Object.keys(properties).filter((k) => name === 'correct' || k !== 'contractId'),
    },
    outputSchema: {
      type: 'object',
      required: ['id', ...(name === 'correct' ? ['sourceId'] : [])],
      properties: { id: integer, ...(name === 'correct' ? { sourceId: integer, action: { const: 'correct' } } : {}) },
    },
    guards: [
      'current authenticated actor and tenant',
      'managed ledger record only',
      'serializable transaction',
      'durable idempotency',
      'optimistic receipt/plan versions',
      'exact decimal balances and same customer/contract',
      'pending contract change guard',
      'immutable history; no bank movement',
      ...(name === 'correct'
        ? [
            'no active allocations',
            'current receipt of an immutable voucher reference',
            'original reference never released',
            'replacement starts unconfirmed',
            'cross-customer correction evidence redacted for non-admin readers',
          ]
        : []),
    ],
    evidence: [
      'finance event with before/after balances',
      'command execution and audit',
      'reversed allocations retained',
    ],
  })),
];
