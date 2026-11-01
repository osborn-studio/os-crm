import { allApprovers, flowInput } from './flow-rules';
import { requireTransfer } from './transfer-policy';
import type { Actor } from '../../common/types/actor';
describe('explicit independent countersign participants', () => {
  test('normalizes explicit participants without collapsing votes', () => {
    expect(allApprovers('2, 3,4')).toEqual([2, 3, 4]);
    expect(
      flowInput({
        name: '会签',
        bizType: 'general',
        nodes: [{ name: '财务及销售核对', approverType: 'users_all', approverValue: '2, 3' }],
      }).nodes[0].approverValue,
    ).toBe('2,3');
  });
  test.each(['1', '1,1', '0,2', '2,03', '1,2147483648', '1,2,3,4,5,6,7,8,9', '1,admin'])(
    'rejects unqualified participant list %s',
    (v) => expect(() => allApprovers(v)).toThrow(),
  );
  test('another active countersign member may transfer their own vote only', () => {
    const a = { userId: 2, roles: ['sales_manager'], permissions: ['approval:approve', 'approval:reject'] } as Actor;
    const approval = { status: 'pending', currentNodeId: 10, applicantId: 1, activeOrder: 1 };
    const node = { id: 11, approverId: 2, action: 'pending', nodeOrder: 1 };
    expect(() => requireTransfer(a, approval, node)).not.toThrow();
    expect(() => requireTransfer(a, approval, { ...node, nodeOrder: 2 })).toThrow();
    expect(() => requireTransfer({ ...a, userId: 3 }, approval, node)).toThrow();
  });
});
