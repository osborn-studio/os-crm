import { activeDelivery, redactTaskEvidence, taskHours } from './delivery-policy';
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
describe('project history task evidence', () => {
  const snapshot = { from: 'doing', attachments: [{ id: 7, filename: '客户合同.pdf', sha256: 'x', size: 1 }] };
  it('withholds attachment metadata of tasks the reader cannot see', () => {
    const [hidden, visible, project] = redactTaskEvidence(
      [
        { taskId: 2, evidence: snapshot },
        { taskId: 1, evidence: snapshot },
        { taskId: null, evidence: snapshot },
      ],
      new Set([1]),
    );
    expect(hidden.evidence).toEqual({ from: 'doing', attachments: [], attachmentsWithheld: 1 });
    expect(JSON.stringify(hidden)).not.toContain('客户合同');
    expect(visible.evidence).toBe(snapshot);
    expect(project.evidence).toBe(snapshot);
  });
});
