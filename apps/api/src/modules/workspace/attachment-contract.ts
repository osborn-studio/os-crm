const identifier = { type: 'string', format: 'uuid' };
const subject = {
  subjectKind: { enum: ['projects', 'tasks', 'service-tickets'] },
  subjectId: { type: 'integer', minimum: 1 },
};
const meta = {
  id: identifier,
  ...subject,
  filename: { type: 'string', minLength: 1, maxLength: 160 },
  size: { type: 'integer', minimum: 1, maximum: 1048576 },
  sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  mediaType: { enum: ['application/pdf', 'image/png', 'image/jpeg'] },
  createdBy: { type: 'integer' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  withdrawnAt: { type: ['string', 'null'], format: 'date-time' },
  withdrawalReason: { type: ['string', 'null'] },
};
const inputs = {
  list: subject,
  download: { attachmentId: identifier },
  upload: {
    ...subject,
    expectedParentUpdatedAt: { type: 'string', format: 'date-time' },
    requestKey: { type: 'string', minLength: 1, maxLength: 80 },
    filename: meta.filename,
    contentBase64: { type: 'string', contentEncoding: 'base64', minLength: 4, maxLength: 1398104 },
    acknowledged: { const: true },
  },
  withdraw: {
    attachmentId: identifier,
    requestKey: { type: 'string', minLength: 1, maxLength: 80 },
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
    expectedParentUpdatedAt: { type: 'string', format: 'date-time' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
};
const metadataSchema = { type: 'object', additionalProperties: false, properties: meta, required: Object.keys(meta) };
export const attachmentCapabilities = Object.entries(inputs).map(([name, properties]) => ({
  id: `attachment.${name}`,
  // 2.0: writes require the reviewed parent version (expectedParentUpdatedAt).
  version: ['upload', 'withdraw'].includes(name) ? '2.0' : '1.0',
  effect: ['list', 'download'].includes(name) ? 'read' : 'write',
  agentEnabled: false,
  method: ['list', 'download'].includes(name) ? 'GET' : 'POST',
  route:
    name === 'list' || name === 'upload'
      ? '/evidence-attachments'
      : `/evidence-attachments/{attachmentId}/${name === 'download' ? 'content' : 'withdraw'}`,
  parameterBinding:
    name === 'list'
      ? 'query'
      : name === 'upload'
        ? 'JSON body'
        : name === 'download'
          ? 'attachmentId in path'
          : 'attachmentId in path, remaining properties in JSON body',
  permission: ['list', 'download'].includes(name)
    ? 'project:read + parent scope'
    : 'project:update + parent execution/management authority',
  inputSchema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
  outputSchema:
    name === 'list'
      ? { type: 'array', maxItems: 100, items: metadataSchema }
      : name === 'download'
        ? {
            type: 'object',
            additionalProperties: false,
            properties: { ...meta, contentBase64: inputs.upload.contentBase64 },
            required: [...Object.keys(meta), 'contentBase64'],
          }
        : metadataSchema,
  guards: [
    'live session/user/role/department/tenant revalidation',
    'parent visibility and execution authority',
    'serializable mutation with durable idempotency',
    '1MiB file,16MiB retained enterprise quota,100 records per object',
    'PDF/PNG/JPEG extension and magic header',
    'immutable bytes and SHA256 verified on download',
    'review/completion freezes attachment mutations',
    'upload/withdrawal require the reviewed parent version and then change it',
    'withdrawal preserves bytes; only current admin may download withdrawn bytes',
    'no public URL or agent tool',
  ],
  evidence: [
    'SHA256/size/uploader/time',
    'withdrawal reason',
    'metadata-only command receipt/audit',
    'download audit excludes bytes',
    'task completion, project submission and solution submission snapshot active file IDs/hashes',
  ],
}));
