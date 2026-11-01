import type { Actor } from '../../common/types/actor';
import { pageCursor, requireTransfer, transferInput } from './transfer-policy';
const actor = {
  userId: 2,
  tenantId: 1,
  roles: ['sales_manager'],
  permissions: ['approval:approve', 'approval:reject'],
} as Actor;
const approval = { status: 'pending', currentNodeId: 10, applicantId: 1 };
const node = { id: 10, action: 'pending', approverId: 2 };
describe('Approval transfer policy', () => {
  test('current assignee may transfer; unrelated approver cannot', () => {
    expect(() => requireTransfer(actor, approval, node)).not.toThrow();
    expect(() => requireTransfer({ ...actor, userId: 3 }, approval, node)).toThrow();
  });
  test('future assignee cannot process early; administrator can recover pending assignment', () => {
    expect(() => requireTransfer(actor, { ...approval, currentNodeId: 11 }, node)).toThrow();
    expect(() =>
      requireTransfer({ ...actor, userId: 3, roles: ['super_admin'] }, { ...approval, currentNodeId: 11 }, node),
    ).not.toThrow();
  });
  test('cannot transfer completed node or withdrawn approval', () => {
    expect(() => requireTransfer(actor, approval, { ...node, action: 'transferred' })).toThrow();
    expect(() => requireTransfer(actor, { ...approval, status: 'withdrawn' }, node)).toThrow();
  });
  test('partial approval permission and applicant ownership never authorize transfer', () => {
    expect(() => requireTransfer({ ...actor, permissions: ['approval:approve'] }, approval, node)).toThrow();
    expect(() => requireTransfer(actor, { ...approval, applicantId: actor.userId }, node)).toThrow();
  });
  test('requires reason, integer target, and rejects identity or node injection', () => {
    expect(transferInput({ targetUserId: 3, reason: '  调岗交接  ' })).toEqual({ targetUserId: 3, reason: '调岗交接' });
    expect(() => transferInput({ targetUserId: 3, reason: ' ' })).toThrow();
    expect(() => transferInput({ targetUserId: '3', reason: '交接' })).toThrow();
    expect(() => transferInput({ targetUserId: 3, reason: '交接', actorId: 3 })).toThrow();
  });
  test.each(['0', '-1', '1.1', 'NaN', '1 OR true', '99999999999'])('rejects malformed page cursor %s', (value) => {
    expect(() => pageCursor(value)).toThrow();
  });
  test('parses bounded positive cursor or first page', () => {
    expect(pageCursor(undefined)).toBeUndefined();
    expect(pageCursor('12')).toBe(12);
  });
});
