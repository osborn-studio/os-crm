import { ticketTransition, ticketKeys } from './service-ticket-policy';
describe('service ticket independent review and transition guards', () => {
  test.each([
    ['open', 'assign', 'assigned'],
    ['assigned', 'start', 'in_progress'],
    ['in_progress', 'note', 'in_progress'],
    ['in_progress', 'resolve', 'resolved'],
    ['resolved', 'close', 'closed'],
    ['resolved', 'reopen', 'assigned'],
    ['closed', 'reopen', 'assigned'],
    ['assigned', 'assign', 'assigned'],
    ['in_progress', 'cancel', 'cancelled'],
  ])('%s + %s = %s', (status, action, expected) =>
    expect(ticketTransition({ status, resolvedBy: 1 }, action, 2)).toBe(expected),
  );
  test.each([
    ['open', 'close'],
    ['resolved', 'assign'],
    ['closed', 'note'],
    ['cancelled', 'reopen'],
    ['in_progress', 'start'],
    ['open', 'resolve'],
  ])('rejects %s + %s', (status, action) =>
    expect(() => ticketTransition({ status, resolvedBy: null }, action, 2)).toThrow(),
  );
  it('blocks resolver self closure even for administrators', () =>
    expect(() => ticketTransition({ status: 'resolved', resolvedBy: 2 }, 'close', 2)).toThrow('不能自行'));
  it('rejects unknown actions and forged fields', () => {
    expect(() => ticketTransition({ status: 'open', resolvedBy: null }, 'delete', 2)).toThrow();
    expect(() => ticketKeys({ tenantId: 9 }, ['note'])).toThrow();
  });
});
