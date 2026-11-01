import { Table } from 'antd';
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
        { title: '含税合计', dataIndex: 'total', render: money },
        { title: '报价时间', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString() },
      ]}
      expandable={{ expandedRowRender: (r) => <QuoteLines items={r.items} /> }}
    />
  );
}
