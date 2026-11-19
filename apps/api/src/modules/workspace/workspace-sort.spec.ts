import { Prisma } from '@prisma/client';
import { workspaceOrderBy, workspaceSortFields, sortBusinessRows } from './workspace-sort';
import { pageRows, reportQuery } from './analytics-policy';
describe('permission-neutral stable business sorting', () => {
  it('admits only actual public scalar resource fields', () => {
    expect(workspaceSortFields('actions').some((f) => f.key === 'dueDate')).toBe(true);
    expect(() => workspaceOrderBy('actions', { sortBy: 'passwordHash' })).toThrow();
    expect(() => workspaceOrderBy('contracts', { sortOrder: 'sideways' })).toThrow();
    expect(workspaceOrderBy('actions', {})).toEqual([{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
  });
  it('keeps nulls last in either direction with stable ties and exact decimal precision', () => {
    const rows = [
      { id: 1, amount: '90071992547409.01' },
      { id: 2, amount: null },
      { id: 3, amount: '90071992547409.02' },
      { id: 4, amount: new Prisma.Decimal('90071992547409.01') },
    ];
    expect(sortBusinessRows(rows, 'amount', 'asc').map((r) => r.id)).toEqual([1, 4, 3, 2]);
    expect(sortBusinessRows(rows, 'amount', 'desc').map((r) => r.id)).toEqual([3, 4, 1, 2]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
  it('sorts all matches before taking an arbitrary page', () => {
    const rows = Array.from({ length: 47 }, (_, i) => ({ id: i + 1, amount: String(47 - i) }));
    expect(
      pageRows(rows, reportQuery({ sortBy: 'amount', sortOrder: 'asc', page: '2', pageSize: '20' })).items.map(
        (r) => r.amount,
      ),
    ).toEqual(Array.from({ length: 20 }, (_, i) => String(21 + i)));
    expect(() => reportQuery({ sortBy: 'tenantId' })).toThrow();
  });
});
