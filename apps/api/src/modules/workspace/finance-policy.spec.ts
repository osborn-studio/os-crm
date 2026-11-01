import { ledgerMoney, ledgerDate, referenceKey } from './finance-policy';
describe('exact receivable ledger inputs', () => {
  it.each([0, 1, '0', '-1', '1e2', 'NaN', '1.001', '10000000000000', ' 1.00', null])('rejects invalid money %s', (v) =>
    expect(() => ledgerMoney(v)).toThrow(),
  );
  it.each(['0.01', '1.10', '9999999999999.99'])('preserves money %s', (v) => expect(ledgerMoney(v).toFixed(2)).toBe(v));
  it.each(['2026-02-30', '2026-13-01', '0000-01-01', null, '2026-1-1'])('rejects invalid date %s', (v) =>
    expect(() => ledgerDate(v)).toThrow(),
  );
  it('canonicalizes full-width references without merging different case', () => {
    expect(referenceKey(' Ａ１ ')).toBe(referenceKey('A1'));
    expect(referenceKey('a1')).not.toBe(referenceKey('A1'));
  });
});
