import { activeDelivery, taskHours } from './delivery-policy';
describe('delivery state and exact hours', () => {
  it.each(['0', '-1', '10000', 'NaN', '1e2', '1.25', ' 1.0', '', 1, null])('rejects invalid hours %s', (v) => {
    expect(() => taskHours(v)).toThrow();
  });
  it.each(['0.1', '1', '12.5', '9999.9'])('preserves valid decimal hours %s', (v) => {
    expect(taskHours(v).toFixed(1)).toBe(Number(v).toFixed(1));
  });
  it('blocks inactive, unstarted and pending acceptance work', () => {
    expect(() =>
      activeDelivery({ status: 'completed', actualStartDate: new Date(), acceptanceState: 'accepted' }),
    ).toThrow();
    expect(() =>
      activeDelivery({ status: 'active', actualStartDate: null, acceptanceState: 'not_requested' }),
    ).toThrow();
    expect(() =>
      activeDelivery({ status: 'active', actualStartDate: new Date(), acceptanceState: 'pending' }),
    ).toThrow();
    expect(() =>
      activeDelivery({ status: 'active', actualStartDate: new Date(), acceptanceState: 'rejected' }),
    ).not.toThrow();
  });
});
