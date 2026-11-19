import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Button, Progress } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';
import dayjs from 'dayjs';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  pending_approval: { text: '审批中', color: 'processing' },
  approved: { text: '已审批', color: 'cyan' },
  signed: { text: '已签约', color: 'blue' },
  executing: { text: '执行中', color: 'green' },
  completed: { text: '已完成', color: 'success' },
  terminated: { text: '已终止', color: 'red' },
  expired: { text: '服务已结束', color: 'warning' },
};

const TYPE_MAP: Record<string, string> = {
  software_sale: '软件销售', implementation: '实施服务', maintenance: '运维服务',
  outsource: '外包', ai_fde: 'AI FDE', saas_sub: 'SaaS订阅', channel: '渠道联合',
};

export default function ContractListPage() {
  const actionRef = useRef<ActionType>();
  const navigate = useNavigate();

  const columns: ProColumns[] = [
    { title: '合同编号', dataIndex: 'contractNo', width: 130, search: false },
    { title: '合同名称', dataIndex: 'name', ellipsis: true, width: 200, render: (_, r) => <a onClick={() => navigate(`/contracts/${r.id}`)}>{r.name}</a> },
    { title: '客户', dataIndex: ['customer', 'name'], width: 150, ellipsis: true, search: false },
    { title: '类型', dataIndex: 'contractType', width: 90, search: false, render: (_, r) => <Tag>{TYPE_MAP[r.contractType] || r.contractType}</Tag> },
    { title: '金额', dataIndex: 'amount', width: 100, search: false, sorter: true, render: (_, r) => `¥${(Number(r.amount) / 10000).toFixed(1)}万` },
    { title: '回款进度', width: 140, search: false, render: (_, r) => {
      const pct = Number(r.amount) > 0 ? Math.round(Number(r.totalReceived) / Number(r.amount) * 100) : 0;
      return <Progress percent={pct} size="small" strokeColor={pct >= 100 ? '#16a34a' : pct > 0 ? '#3b82f6' : '#e2e8f0'} format={() => `${pct}%`} />;
    }},
    { title: '签约日', dataIndex: 'signDate', width: 100, search: false, valueType: 'date' },
    { title: '合同结束日期', dataIndex: 'endDate', width: 100, search: false, render: (_, r) => {
      if (!r.endDate) return '—';
      const days = dayjs(r.endDate).diff(dayjs(), 'day');
      return days <= 90 && days >= 0 ? <Tag color="orange">{dayjs(r.endDate).format('YYYY-MM-DD')}（{days}天）</Tag> : dayjs(r.endDate).format('YYYY-MM-DD');
    }},
    { title: '状态', dataIndex: 'status', width: 80, valueType: 'select', fieldProps: { options: Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STATUS_MAP[r.status]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.status; } },
  ];

  return (
    <ProTable
      headerTitle="合同管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1300 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/contracts', { params: { page: params.current, pageSize: params.pageSize, status: params.status, keyword: params.name } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      toolBarRender={() => [<Button key="create" type="primary" icon={<PlusOutlined />} onClick={() => navigate('/contracts/new')}>新建合同</Button>]}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}
