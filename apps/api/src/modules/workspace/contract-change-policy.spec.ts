import { changePatch } from './contract-change-policy';
describe('Contract change input policy', () => {
  it('normalizes exact money and terminates only through the dedicated change type', () => {
    expect(changePatch('amount', { amount: '100.10', taxRate: '13' })).toEqual({ amount: '100.10', taxRate: '13' });
    expect(changePatch('terminate', {})).toEqual({ status: 'terminated' });
    expect(() => changePatch('terms', { status: 'terminated' })).toThrow();
  });
  it.each([
    { amount: '0' },
    { amount: 12 },
    { amount: '1e3' },
    { amount: '1.001' },
    { amount: '1', taxRate: '101' },
    { amount: '1', taxRate: '13.001' },
    { amount: '10000000000000' },
  ])('rejects unsupported money %p', (data) => expect(() => changePatch('amount', data)).toThrow());
  it.each(['2026-02-30', '2026-13-01', '0000-01-01', '2026-01-01T00:00:00Z'])(
    'rejects invalid contract dates %s',
    (date) => expect(() => changePatch('schedule', { endDate: date })).toThrow(),
  );
  it('supports explicit clearing but rejects empty schedule and unsupported field injection', () => {
    expect(changePatch('schedule', { endDate: null })).toEqual({ endDate: null });
    expect(() => changePatch('schedule', {})).toThrow();
    expect(() => changePatch('amount', { amount: '1', tenantId: 9 })).toThrow();
    expect(() => changePatch('constructor', {})).toThrow();
  });
});
