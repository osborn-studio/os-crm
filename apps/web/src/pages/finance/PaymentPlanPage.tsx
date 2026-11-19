import { useRef } from 'react';
import { Tag, Button } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  pending: { text: '待回款', color: 'default' },
  partial: { text: '部分回款', color: 'processing' },
  completed: { text: '已回款', color: 'success' },
  overdue: { text: '逾期', color: 'error' },
  cancelled: { text: '已取消', color: 'default' },
};

export default function PaymentPlanPage() {
  const actionRef = useRef<ActionType>();

  const columns: ProColumns[] = [
    { title: '计划编号', dataIndex: 'planNo', width: 130, search: false },
    { title: '客户', dataIndex: ['contract', 'customer', 'name'], width: 160, ellipsis: true, search: false },
    { title: '合同', dataIndex: ['contract', 'contractNo'], width: 130, search: false },
    { title: '里程碑', dataIndex: 'triggerCondition', width: 120, ellipsis: true, search: false },
    { title: '计划金额', dataIndex: 'amount', width: 110, search: false, render: (_, r) => `¥${Number(r.amount).toLocaleString()}` },
    { title: '预计收款日', dataIndex: 'dueDate', width: 110, search: false, valueType: 'date', sorter: true },
    { title: '已收', dataIndex: 'receivedAmount', width: 100, search: false, render: (_, r) => Number(r.receivedAmount) > 0 ? <span style={{ color: '#16a34a' }}>¥{Number(r.receivedAmount).toLocaleString()}</span> : '—' },
    { title: '未收', dataIndex: 'outstandingAmount', width: 100, search: false, render: (_, r) => Number(r.outstandingAmount) > 0 ? <span style={{ color: '#dc2626' }}>¥{Number(r.outstandingAmount).toLocaleString()}</span> : '—' },
    { title: '逾期天数', dataIndex: 'overdueDays', width: 90, search: false, render: (_, r) => r.overdueDays > 0 ? <Tag color={r.overdueDays > 60 ? 'red' : r.overdueDays > 30 ? 'orange' : 'gold'}>{r.overdueDays}天</Tag> : '—' },
    { title: '状态', dataIndex: 'status', width: 90, valueType: 'select', fieldProps: { options: Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STATUS_MAP[r.status]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.status; } },
  ];

  return (
    <ProTable
      headerTitle="回款计划"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1300 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/finance/payment-plans', { params: { page: params.current, pageSize: params.pageSize, status: params.status } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
      toolBarRender={() => [
        <Button key="overdue" danger onClick={() => { actionRef.current?.setPageInfo?.({ current: 1 }); }}>只看逾期</Button>,
      ]}
    />
  );
}
