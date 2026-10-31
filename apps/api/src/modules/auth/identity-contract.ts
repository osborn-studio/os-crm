const string = { type: 'string' };
const integer = { type: 'integer', minimum: 1 };
const nullableId = { anyOf: [integer, { type: 'null' }] };
const user = {
  type: 'object',
  required: ['id', 'username', 'name', 'status', 'roles', 'updatedAt'],
  properties: {
    id: integer,
    username: string,
    name: string,
    status: { enum: ['active', 'inactive', 'resigned'] },
    roles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'code', 'name'],
        properties: { id: integer, code: string, name: string },
      },
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
const userFields = {
  name: { type: 'string', minLength: 1, maxLength: 50 },
  deptId: nullableId,
  roleIds: { type: 'array', minItems: 1, maxItems: 1, uniqueItems: true, items: integer },
  email: { anyOf: [string, { type: 'null' }] },
  position: { anyOf: [string, { type: 'null' }] },
};
const password = {
  type: 'string',
  minLength: 12,
  description: 'Upper/lowercase letters and digits; maximum 72 UTF-8 bytes',
};
const departmentFields = {
  name: { type: 'string', minLength: 1, maxLength: 100 },
  code: { anyOf: [string, { type: 'null' }] },
  parentId: nullableId,
  leaderId: nullableId,
  status: { enum: [0, 1] },
};
const envelope = (properties: object, required: string[], version = false) => ({
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', 'data', ...(version ? ['expectedUpdatedAt'] : [])],
  properties: {
    requestKey: { type: 'string', minLength: 1, maxLength: 80 },
    ...(version ? { expectedUpdatedAt: { type: 'string', format: 'date-time' } } : {}),
    data: { type: 'object', additionalProperties: false, properties, required },
  },
});
const message = { type: 'object', required: ['message'], properties: { message: string } };
export const identityCapabilities = [
  {
    id: 'identity.user.create',
    route: 'POST /system/users',
    permission: 'system:user',
    effect: 'write',
    inputSchema: envelope({ username: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,40}$' }, password, ...userFields }, [
      'username',
      'password',
      'name',
      'roleIds',
    ]),
    outputSchema: user,
    guards: ['tenant references', 'seat quota', 'exactly one of four supported roles'],
  },
  {
    id: 'identity.user.update',
    route: 'PUT /system/users/:id',
    permission: 'system:user',
    effect: 'write',
    inputSchema: envelope({ ...userFields, status: { enum: ['active', 'inactive', 'resigned'] } }, [], true),
    outputSchema: user,
    guards: [
      'tenant scope',
      'version',
      'last administrator',
      'no self-disable/demotion',
      'pending approval handover',
      'session revocation',
    ],
  },
  {
    id: 'identity.user.password.reset',
    route: 'POST /system/users/:id/reset-password',
    permission: 'system:user',
    effect: 'write',
    inputSchema: envelope({ password }, ['password'], true),
    outputSchema: message,
    guards: ['tenant scope', 'version', 'strong password', 'revoke target sessions'],
  },
  {
    id: 'identity.department.create',
    route: 'POST /system/departments',
    permission: 'system:department',
    effect: 'write',
    inputSchema: envelope(departmentFields, ['name']),
    outputSchema: {
      type: 'object',
      required: ['id', 'name', 'updatedAt'],
      properties: { id: integer, name: string, updatedAt: { type: 'string', format: 'date-time' } },
    },
    guards: ['tenant parent', 'acyclic hierarchy', 'active department member as leader'],
  },
  {
    id: 'identity.department.update',
    route: 'PUT /system/departments/:id',
    permission: 'system:department',
    effect: 'write',
    inputSchema: envelope(departmentFields, [], true),
    outputSchema: {
      type: 'object',
      required: ['id', 'name', 'updatedAt'],
      properties: { id: integer, name: string, updatedAt: { type: 'string', format: 'date-time' } },
    },
    guards: ['tenant scope', 'version', 'acyclic hierarchy', 'no active members or children when disabling'],
  },
  {
    id: 'identity.password.change',
    route: 'POST /auth/password',
    permission: 'authenticated',
    effect: 'write',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestKey', 'expectedUpdatedAt', 'currentPassword', 'newPassword'],
      properties: {
        requestKey: string,
        expectedUpdatedAt: { type: 'string', format: 'date-time' },
        currentPassword: string,
        newPassword: password,
      },
    },
    outputSchema: message,
    guards: ['current password', 'version', 'revoke all sessions'],
  },
  {
    id: 'identity.sessions.list',
    route: 'GET /auth/sessions',
    permission: 'authenticated',
    effect: 'read',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'current', 'expiresAt'],
        properties: { id: string, current: { type: 'boolean' }, expiresAt: { type: 'string', format: 'date-time' } },
      },
    },
    guards: ['own sessions only', 'no bearer token or token hash in output'],
  },
  {
    id: 'identity.sessions.revoke_all',
    route: 'POST /auth/sessions/revoke-all',
    permission: 'authenticated',
    effect: 'write',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: message,
    guards: ['own sessions only', 'server-side revocation'],
  },
].map((c) => ({
  ...c,
  version: '1.0',
  actor: 'authenticated context; tenant/actor input forbidden',
  agentExposed: false,
  evidence: c.effect === 'read' ? 'bounded projection' : 'transactional state and audit; no credentials in output',
}));
