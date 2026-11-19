import Table from '../../components/BusinessTable';
import {} from 'antd';
import { money, type RecordRow } from '../../services/workspace';
export function QuoteLines({ items }: { items: unknown }) {
  const rows = Array.isArray(items)
    ? items.filter((v) => v && typeof v === 'object').map((v, i) => ({ ...v, id: i + 1 }))
    : [];
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: '产品', dataIndex: 'productName' },
        { title: '数量', dataIndex: 'quantity' },
        { title: '报价单价', dataIndex: 'estimatedPrice', render: money },
        { title: '行金额', dataIndex: 'estimatedAmount', render: money },
      ]}
    />
  );
}
export default function QuoteHistory({ versions }: { versions: RecordRow[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={versions}
      pagination={false}
      columns={[
        { title: '版本', dataIndex: 'version' },
        { title: '报价合计（税口径见原件）', dataIndex: 'total', render: money },
        {
          title: '资料报价日期',
          render: (_, r: RecordRow) => {
            const line = Array.isArray(r.items) ? r.items[0] : null;
            const meta = line && typeof line === 'object' ? (line as RecordRow).salesIntake : null;
            return meta && typeof meta === 'object'
              ? String((meta as RecordRow).sourceDate ?? '待核实')
              : new Date(String(r.createdAt)).toLocaleString();
          },
        },
        { title: '归档时间', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString() },
      ]}
      expandable={{ expandedRowRender: (r) => <QuoteLines items={r.items} /> }}
    />
  );
}
