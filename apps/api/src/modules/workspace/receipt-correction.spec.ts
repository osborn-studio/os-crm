import { financeEventsForActor, hideReceiptCorrectionFields } from './finance-policy';
import type { Actor } from '../../common/types/actor';
import type { FinanceEvent } from '@prisma/client';
const actor = (role: string): Actor => ({
  userId: 1,
  tenantId: 1,
  deptId: 1,
  roles: [role],
  permissions: ['finance:read'],
  dataScope: role === 'gm' ? 'all' : 'self',
});
const event: FinanceEvent = {
  id: 1,
  tenantId: 1,
  receiptId: 1,
  actorId: 2,
  kind: 'correction.replaced',
  note: '另一客户的机密说明',
  evidence: { actorName: '复核员', before: { customerId: 1 }, after: { customerId: 2, amount: '400.00' } },
  createdAt: new Date(),
};
describe('receipt correction disclosure', () => {
  it.each(['sales', 'sales_manager'])('redacts cross-customer evidence and raw notes for %s', (role) => {
    const a = actor(role),
      result = financeEventsForActor(a, [event]);
    expect(JSON.stringify(result)).not.toContain('机密');
    expect(result[0].evidence).toEqual({ redacted: true, actorName: '复核员' });
    const row: Record<string, unknown> = {
      id: 2,
      replacesId: 1,
      remark: '旧客户机密',
      voidReason: '登记更正：新客户机密',
      amount: '4.25',
    };
    hideReceiptCorrectionFields(a, row);
    expect(row.replacesId).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('机密');
    expect(row.amount).toBe('4.25');
  });
  it.each(['super_admin', 'gm'])('preserves permitted enterprise audit for %s', (role) => {
    expect(financeEventsForActor(actor(role), [event])[0]).toEqual(event);
  });
  it('does not mutate the stored event projection', () => {
    financeEventsForActor(actor('sales'), [event]);
    expect(event.note).toContain('机密');
  });
});
