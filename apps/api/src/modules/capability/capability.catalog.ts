export interface CapabilityDefinition {
  id: string;
  version: '1.0';
  description: string;
  permission: string;
  effect: 'read';
  inputSchema: Record<string, unknown>;
  outputDescription: string;
  outputSchema: Record<string, unknown>;
}

/** Versioned business contracts, independent of a particular model or transport. */
export const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: 'customer.search',
    version: '1.0',
    description: '查询当前身份有权查看的客户，返回受限的客户摘要。',
    permission: 'customer:read',
    effect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keyword: { type: 'string', maxLength: 200 },
        page: { type: 'integer', minimum: 1, maximum: 1000000 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    outputDescription: 'items: 客户编号、名称、行业、池类型；meta: 分页。',
    outputSchema: {
      type: 'object',
      required: ['items', 'meta'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'code', 'name', 'poolType'],
            properties: {
              id: { type: 'integer' },
              code: { type: 'string' },
              name: { type: 'string' },
              industry: { type: ['string', 'null'] },
              poolType: { enum: ['public', 'dept', 'private'] },
            },
          },
        },
        meta: {
          type: 'object',
          required: ['page', 'pageSize', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  },
  {
    id: 'customer.get',
    version: '1.0',
    description: '按ID读取有权查看的客户概况，不返回联系人隐私字段。',
    permission: 'customer:read',
    effect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['customerId'],
      properties: { customerId: { type: 'integer', minimum: 1 } },
    },
    outputDescription: '客户基本信息、合同金额及业务统计；不包含手机、银行账号和完整附件。',
    outputSchema: {
      type: 'object',
      required: ['id', 'code', 'name', 'status'],
      properties: {
        id: { type: 'integer' },
        code: { type: 'string' },
        name: { type: 'string' },
        industry: { type: ['string', 'null'] },
        poolType: { enum: ['public', 'dept', 'private'] },
        status: { enum: ['active', 'inactive', 'churned'] },
        contractAmount: { type: ['string', 'number'], description: '人民币元，十进制金额' },
        statistics: {
          type: 'object',
          properties: {
            openOpportunities: { type: 'integer' },
            activeContracts: { type: 'integer' },
            totalReceived: { type: ['string', 'number'] },
            totalOutstanding: { type: 'number' },
            activeProjects: { type: 'integer' },
            contactCount: { type: 'integer' },
          },
        },
      },
    },
  },
];
