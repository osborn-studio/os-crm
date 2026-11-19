import { knowledgeBatch, knowledgeEntry } from './knowledge-policy';
const row = {
  key: 'project-1',
  kind: 'project',
  title: '项目',
  customerId: 1,
  summary: '有来源的拟定动作',
  evidenceStatus: 'proposed',
  sources: [{ id: 'file:1', label: '原件', location: '/private/source' }],
  content: { amount: null },
  expectedVersion: 0,
};
describe('knowledge evidence import contract', () => {
  it('keeps unknown money and evidence status without creating financial events', () =>
    expect(knowledgeEntry.parse(row).content.amount).toBeNull());
  it('rejects impersonated actors and companies', () =>
    expect(knowledgeBatch.safeParse({ requestKey: 'x', entries: [row], tenantId: 2 }).success).toBe(false));
  it('requires explicit customer mapping for project evidence', () =>
    expect(knowledgeEntry.safeParse({ ...row, customerId: null }).success).toBe(false));
  it('rejects duplicate source keys in one atomic batch', () =>
    expect(knowledgeBatch.safeParse({ requestKey: 'x', entries: [row, row] }).success).toBe(false));
  it('requires stable version and evidence sources', () => {
    expect(knowledgeEntry.safeParse({ ...row, expectedVersion: -1 }).success).toBe(false);
    expect(knowledgeEntry.safeParse({ ...row, sources: [] }).success).toBe(false);
  });
  it('bounds a single record and the batch', () => {
    expect(knowledgeEntry.safeParse({ ...row, content: { x: 'x'.repeat(120001) } }).success).toBe(false);
    expect(knowledgeBatch.safeParse({ requestKey: 'x', entries: Array(51).fill(row) }).success).toBe(false);
  });
});

describe('meeting association boundary', () => {
  it('preserves unassigned meeting evidence without allowing an invented customer', () => {
    expect(
      knowledgeEntry.safeParse({
        ...row,
        kind: 'meeting',
        customerId: null,
        content: { associationStatus: 'unassigned' },
      }).success,
    ).toBe(true);
    expect(knowledgeEntry.safeParse({ ...row, kind: 'meeting', customerId: null, content: {} }).success).toBe(false);
  });
});
