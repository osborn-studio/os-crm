import { randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { contextHash, digest, grantInput, invocation, tokenHash, uuid } from './agent-policy';
const actor: Actor = {
  userId: 1,
  tenantId: 1,
  deptId: 1,
  roles: ['sales'],
  permissions: ['customer:read', 'action:create'],
  dataScope: 'self',
  sessionId: randomUUID(),
};
const grant = {
  name: '合成智能体',
  purpose: '合成跟进计划',
  minutes: 60,
  maxCalls: 10,
  capabilities: ['customer.search'],
};
describe('Delegated execution input and identity boundaries', () => {
  test('only explicit capabilities and bounded durations/call budgets are accepted', () => {
    expect(grantInput(grant).maxCalls).toBe(10);
    for (const change of [
      { minutes: 0 },
      { minutes: 1441 },
      { minutes: '60' },
      { maxCalls: 1001 },
      { maxCalls: -1 },
      { capabilities: ['*'] },
      { capabilities: ['action.execute'] },
      { capabilities: ['customer.search', 'customer.search'] },
      { capabilities: ['finance.receipt.register'] },
      { ownerId: 2 },
      { tenantId: 2 },
    ]) {
      expect(() => grantInput({ ...grant, ...change })).toThrow();
    }
  });
  test('caller cannot supply actor, tenant, raw SQL or approve arbitrary endpoints', () => {
    expect(() =>
      invocation({ capabilityId: 'action.execute', requestKey: randomUUID(), input: {}, actorId: 9 }),
    ).toThrow();
    expect(() => invocation({ capabilityId: 'sql.execute', requestKey: randomUUID(), input: {} })).toThrow();
    expect(() => invocation({ capabilityId: 'approval.approve', requestKey: randomUUID(), input: {} })).toThrow();
    expect(() => invocation({ capabilityId: 'customer.get', requestKey: 'not-uuid', input: {} })).toThrow();
    expect(() => invocation({ capabilityId: 'customer.get', requestKey: randomUUID(), input: [] })).toThrow();
  });
  test('permission snapshot is order independent and detects every security dimension', () => {
    expect(contextHash({ ...actor, permissions: actor.permissions.slice().reverse() })).toBe(contextHash(actor));
    for (const change of [
      { userId: 2 },
      { tenantId: 2 },
      { sessionId: randomUUID() },
      { deptId: 2 },
      { roles: ['super_admin'] },
      { permissions: ['*'] },
      { dataScope: 'all' as const },
    ]) {
      expect(contextHash({ ...actor, ...change })).not.toBe(contextHash(actor));
    }
  });
  test('credential hash rotates with server signing secret and never contains raw credential', () => {
    const token = 'tbcrm_agent_synthetic';
    expect(tokenHash(token, 'a')).toHaveLength(64);
    expect(tokenHash(token, 'a')).not.toBe(tokenHash(token, 'b'));
    expect(tokenHash(token, 'a')).not.toContain(token);
  });
  test('payload hashing is canonical but distinguishes changed business intent', () => {
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
    expect(digest({ title: 'review' })).not.toBe(digest({ title: 'execute' }));
    let deep: unknown = {};
    for (let i = 0; i < 30; i++) deep = { nested: deep };
    expect(() => digest(deep)).toThrow();
  });
  test('rejects non-object bodies and oversized input instead of crashing', () => {
    expect(() => invocation(null as unknown as Record<string, unknown>)).toThrow();
    expect(() =>
      invocation({ capabilityId: 'customer.search', requestKey: randomUUID(), input: { keyword: 'x'.repeat(10001) } }),
    ).toThrow();
  });
  test.each(['0', '1 OR true', 'undefined', ''])('rejects malformed UUID %s', (value) =>
    expect(() => uuid(value)).toThrow(),
  );
});
