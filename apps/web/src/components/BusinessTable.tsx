import { useState } from 'react';
import BusinessSort from './BusinessSort';
import { Table as AntTable, type TableProps } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
const valueAt = (row: object, path: unknown): unknown => {
  let v: unknown = row;
  for (const k of Array.isArray(path) ? path : [path]) {
    if (!v || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[String(k)];
  }
  return v;
};
export function compareBusinessValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a),
    y = String(b);
  if (/^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y) && x.length < 100 && y.length < 100) {
    const scale = Math.max((x.split('.')[1] ?? '').length, (y.split('.')[1] ?? '').length);
    const fixed = (v: string) => {
      const neg = v.startsWith('-'),
        [i, f = ''] = v.replace(/^-/, '').split('.');
      return BigInt(i + f.padEnd(scale, '0')) * (neg ? -1n : 1n);
    };
    const aa = fixed(x),
      bb = fixed(y);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(x) && /^\d{4}-\d{2}-\d{2}/.test(y)) {
    const aa = Date.parse(x),
      bb = Date.parse(y);
    if (Number.isFinite(aa) && Number.isFinite(bb)) return aa - bb;
  }
  return x.localeCompare(y, 'zh-CN', { numeric: true, sensitivity: 'base' });
}
function sortedColumns<T extends object>(columns: ColumnsType<T>): ColumnsType<T> {
  return columns.map((c) => {
    if ('children' in c) return { ...c, children: sortedColumns(c.children) };
    if (!c.dataIndex || c.sorter !== undefined) return c;
    const path = c.dataIndex;
    return {
      ...c,
      sortDirections: ['ascend', 'descend', 'ascend'],
      sorter: (a: T, b: T, order) => {
        const av = valueAt(a, path),
          bv = valueAt(b, path);
        const n = compareBusinessValues(av, bv);
        const empty = (v: unknown) => v === null || v === undefined || v === '';
        return empty(av) || empty(bv) ? n * (order === 'descend' ? -1 : 1) : n;
      },
    } as ColumnType<T>;
  });
}
function BusinessTable<T extends object = Record<string, unknown>>({
  serverSorted,
  ...props
}: TableProps<T> & { serverSorted?: boolean }) {
  const [currentPage,setCurrentPage]=useState(1);
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: 'asc' | 'desc' }>();
  if (serverSorted) return <AntTable<T> {...props} scroll={{x:'max-content',...props.scroll}} />;
  const collect = (cols: ColumnsType<T>): { key: string; label: string }[] =>
    cols.flatMap((c) =>
      'children' in c
        ? collect(c.children)
        : c.dataIndex
          ? [
              {
                key: String(c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : c.dataIndex)),
                label: typeof c.title === 'string' ? c.title : String(c.dataIndex),
              },
            ]
          : [],
    );
  const fields = collect(props.columns ?? []);
  const effective = (sorting && fields.some((f) => f.key === sorting.sortBy) ? sorting : undefined) ?? {
    sortBy:
      fields.find((f) => {
        const c = props.columns?.find((c) => c.key === f.key || ('dataIndex' in c && c.dataIndex === f.key));
        return c && 'defaultSortOrder' in c && c.defaultSortOrder;
      })?.key ??
      fields.find(f=>['createdAt','startsAt','dueDate'].includes(f.key))?.key ??
      fields[0]?.key ??
      '',
    sortOrder: props.columns?.some((c) => 'defaultSortOrder' in c && c.defaultSortOrder === 'descend')
      ? ('desc' as const)
      : ('asc' as const),
  };
  const stateful = (cols: ColumnsType<T>): ColumnsType<T> =>
    cols.map((c) =>
      'children' in c
        ? { ...c, children: stateful(c.children) }
        : {
            ...c,
            ...(c.dataIndex
              ? { key: c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : String(c.dataIndex)) }
              : {}),
            ...(effective.sortBy
              ? {
                  defaultSortOrder: undefined,
                  sortOrder:
                    String(c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : c.dataIndex)) ===
                    effective.sortBy
                      ? effective.sortOrder === 'asc'
                        ? ('ascend' as const)
                        : ('descend' as const)
                      : null,
                }
              : {}),
          },
    );
  return (
    <>
      {fields.length > 0 && <BusinessSort value={effective} fields={fields} onChange={value=>{setSorting(value);setCurrentPage(1);}} />}
      <AntTable<T>
        {...props}
        scroll={{x:'max-content',...props.scroll}}
        pagination={props.pagination===false?false:{...props.pagination,current:currentPage,onChange:(page,size)=>{setCurrentPage(page);if(props.pagination)props.pagination.onChange?.(page,size);}}}
        columns={stateful(sortedColumns(props.columns ?? []))}
        onChange={(pagination, filters, sorter, extra) => {
          if(extra.action==='sort')setCurrentPage(1);
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          if (s.columnKey && s.order)
            setSorting({ sortBy: String(s.columnKey), sortOrder: s.order === 'ascend' ? 'asc' : 'desc' });
          props.onChange?.(pagination, filters, sorter, extra);
        }}
      />
    </>
  );
}
export default BusinessTable;
