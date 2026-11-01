import { useEffect, useState, useRef } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons';
import ContractChanges from './ContractChanges';
import AttachmentPanel from './AttachmentPanel';
import QuoteHistory, { QuoteLines } from './QuoteHistory';
import {
  get,
  post,
  put,
  key,
  errorText,
  money,
  statusNames,
  actionNames,
  type Resource,
  type RecordRow,
  type Field,
} from '../../services/workspace';
interface ListResult {
  items: RecordRow[];
  meta: { total: number };
}
const labels: Record<string, string> = {
  id: '编号',
  acceptanceState: '验收状态',
  actualHours: '累计实际工时',
  milestoneId: '关联里程碑',
  name: '名称',
  code: '编码',
  companyName: '企业名称',
  content: '内容',
  title: '标题',
  industry: '行业',
  region: '地区',
  level: '级别',
  status: '状态',
  poolType: '客户池',
  stage: '阶段',
  amount: '金额',
  totalAmountInclTax: '价税合计',
  contractNo: '合同编号',
  orderNo: '订单编号',
  projectNo: '项目编号',
  planNo: '回款编号',
  invoiceNo: '发票编号',
  receiptNo: '收款编号',
  receivedAmount: '已收金额',
  outstandingAmount: '未收金额',
  dueDate: '到期日',
  orderDate: '订单日期',
  invoiceDate: '开票日期',
  receiptDate: '收款日期',
  budgetAmount: '项目预算',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  ownerId: '负责人编号',
  ownerName: '负责人',
  customerName: '客户名称',
  assigneeName: '执行人',
  customerId: '客户编号',
  contractId: '合同编号',
  assigneeId: '执行人',
  progress: '进度%',
  remark: '备注',
  contactName: '联系人',
  source: '来源',
  demand: '需求',
  demandSummary: '需求摘要',
  expectedCloseDate: '预计成交',
  plannedStartDate: '计划开始',
  plannedEndDate: '计划结束',
  nextAction: '下一步',
  nextFollowAt: '下次跟进',
  phone: '电话',
  email: '邮箱',
  taxRate: '税率%',
  paymentTerms: '付款约定',
  contractType: '合同类型',
  productName: '产品',
  quantity: '数量',
  estimatedPrice: '报价单价',
  estimatedAmount: '报价金额',
  listPrice: '目录单价',
  category: '分类',
  unit: '单位',
  description: '说明',
  protectUntil: '保护期',
  salesOwnerId: '销售负责人',
  pmId: '项目经理',
};
const stages: Record<string, string> = {
  new: '初步接洽',
  qualified: '需求确认',
  intention: '意向',
  contact: '初步接触',
  requirement: '需求确认',
  proposal: '方案报价',
  negotiation: '商务谈判',
  signing: '签约',
  delivery: '交付',
  acceptance: '验收',
  closed: '结项',
};
const display = (name: string, v: unknown) =>
  v === null || v === undefined ? (
    '—'
  ) : name === 'status' || name === 'poolType' || name === 'acceptanceState' ? (
    <Tag
      color={
        ['approved', 'signed', 'completed', 'won', 'delivered'].includes(String(v))
          ? 'success'
          : String(v).includes('reject')
            ? 'error'
            : 'processing'
      }
    >
      {statusNames[String(v)] ?? String(v)}
    </Tag>
  ) : name === 'source' || name === 'contractType' || name === 'category' ? (
    (statusNames[String(v)] ?? String(v))
  ) : name === 'stage' ? (
    (stages[String(v)] ?? String(v))
  ) : name.toLowerCase().includes('amount') || name === 'listPrice' || name === 'estimatedPrice' ? (
    `¥${money(v)}`
  ) : typeof v === 'object' ? (
    JSON.stringify(v)
  ) : /Date$|At$|Until$/.test(name) ? (
    String(v).slice(0, 10)
  ) : (
    String(v)
  );
export default function WorkspacePage({ kind, poolType }: { kind: string; poolType?: string }) {
  const [spec, setSpec] = useState<Resource>(),
    [rows, setRows] = useState<RecordRow[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [detail, setDetail] = useState<RecordRow>(),
    [editing, setEditing] = useState<RecordRow | null | undefined>(),
    [options, setOptions] = useState<Record<string, RecordRow[]>>({}),
    [busy, setBusy] = useState(false),
    [command, setCommand] = useState<{ row: RecordRow; action: string }>();
  const [approvalForm, setApprovalForm] = useState<{
    name: string;
    version: number;
    fields: { key: string; label: string; type: string; required: boolean }[];
  }>();
  const editRequestKey = useRef(key()),
    actionRequestKey = useRef(key());
  const [form] = Form.useForm(),
    [actionForm] = Form.useForm();
  const selectedProject = Form.useWatch('projectId', form);
  const [taskMilestones, setTaskMilestones] = useState<RecordRow[]>([]);
  useEffect(() => {
    let current = true;
    setTaskMilestones([]);
    if (kind === 'tasks' && selectedProject)
      void get<RecordRow>(`/workspace/projects/${selectedProject}`)
        .then((p) => {
          if (current) setTaskMilestones(((p.related as Record<string, unknown>)?.milestones ?? []) as RecordRow[]);
        })
        .catch(() => {
          if (current) setTaskMilestones([]);
        });
    return () => {
      current = false;
    };
  }, [kind, selectedProject]);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [specs, res] = await Promise.all([
        get<Resource[]>('/workspace/schema'),
        get<ListResult>(`/workspace/${kind}`, {
          page,
          pageSize: 20,
          keyword: query,
          ...(poolType ? { poolType } : {}),
        }),
      ]);
      setSpec(specs.find((s) => s.key === kind));
      setRows(res.items);
      setTotal(res.meta.total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setDetail(undefined);
    setEditing(undefined);
    setPage(1);
    setQuery('');
  }, [kind, poolType]);
  useEffect(() => {
    void load();
  }, [kind, poolType, page, query]);
  const openDetail = async (row: RecordRow) => {
    try {
      setDetail(await get<RecordRow>(`/workspace/${kind}/${row.id}`));
    } catch (e) {
      message.error(errorText(e));
    }
  };
  async function loadOptions(fields: Field[]) {
    const opts: Record<string, RecordRow[]> = {};
    await Promise.all(
      fields
        .filter((f) => f.reference)
        .map(async (f) => {
          opts[f.key] = (await get<ListResult>(`/workspace/${f.reference}`, { pageSize: 100 })).items;
        }),
    );
    setOptions(opts);
  }
  const openEdit = async (row: RecordRow | null) => {
    if (!spec) return;
    editRequestKey.current = key();
    setEditing(row);
    form.resetFields();
    if (row) {
      const values: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const v = row[f.key];
        values[f.key] = f.type === 'date' && v ? String(v).slice(0, 10) : v;
      }
      form.setFieldsValue(values);
    }
    try {
      await loadOptions(spec.fields);
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const save = async () => {
    if (!spec) return;
    try {
      const data = await form.validateFields();
      if (editing)
        for (const f of spec.fields)
          if (!f.required && (data[f.key] === undefined || data[f.key] === '')) data[f.key] = null;
      setBusy(true);
      const body = { data, requestKey: editRequestKey.current, expectedUpdatedAt: editing?.updatedAt };
      if (editing) await put(`/workspace/${kind}/${editing.id}`, body);
      else await post(`/workspace/${kind}`, body);
      message.success('已保存');
      setEditing(undefined);
      setDetail(undefined);
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async (row: RecordRow, action: string) => {
    if (action === 'follow') {
      message.info('请从“跟进记录”新建，选择当前客户');
      return;
    }
    actionRequestKey.current = key();
    setCommand({ row, action });
    actionForm.resetFields();
    setApprovalForm(undefined);
    if (action === 'submit') {
      setBusy(true);
      try {
        setApprovalForm(await get(`/workspace/${kind}/${row.id}/approval-form`));
      } catch (e) {
        message.error(errorText(e));
        setCommand(undefined);
      } finally {
        setBusy(false);
      }
    }
    if (['assign_task', 'handover_pm'].includes(action)) {
      try {
        setOptions({ users: await get<RecordRow[]>(`/workspace/${kind}/${row.id}/delivery-people`) });
      } catch (e) {
        message.error(errorText(e));
        setCommand(undefined);
      }
    }
    if (action === 'assign')
      try {
        const overview = await get<{ users: RecordRow[] }>('/workspace/overview');
        setOptions({ users: overview.users });
      } catch (e) {
        message.error(errorText(e));
      }
    if (action === 'quote')
      try {
        setOptions({ products: (await get<ListResult>('/workspace/products', { pageSize: 100 })).items });
      } catch (e) {
        message.error(errorText(e));
      }
  };
  const apply = async () => {
    if (!command) return;
    try {
      const fields = await actionForm.validateFields();
      setBusy(true);
      const result = await post<RecordRow & { kind?: string }>(
        `/workspace/${kind}/${command.row.id}/${command.action}`,
        { ...fields, requestKey: actionRequestKey.current, expectedUpdatedAt: command.row.updatedAt },
      );
      message.success('操作已完成');
      setCommand(undefined);
      setDetail(undefined);
      await load();
      if (result.kind && result.kind !== kind) message.info(`已生成关联记录 #${result.id}，可从对应模块查看`);
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const exportData = () => {
    const columns = Object.keys(rows[0] ?? {}).filter((k) => labels[k]);
    const csv =
      '\uFEFF' +
      [columns.map((k) => labels[k]), ...rows.map((r) => columns.map((k) => String(r[k] ?? '')))]
        .map((line) =>
          line
            .map(
              (c) => '"' + (/^[\s]*[=+\-@]/.test(c) || /^[\t\r\n]/.test(c) ? "'" : '') + c.split('"').join('""') + '"',
            )
            .join(','),
        )
        .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-当前页.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const availableActions = (row: RecordRow) =>
    spec?.actions.filter((a) => {
      if (a === 'follow') return false;
      if (kind === 'customers')
        return row.poolType === 'public' ? a === 'claim' || a === 'assign' : a === 'return' || a === 'assign';
      if (kind === 'leads') return row.status !== 'converted';
      if (a === 'submit') return ['draft', 'rejected'].includes(String(row.status));
      if (a === 'sign' || a === 'confirm') return row.status === 'approved';
      if (a === 'deliver') return row.status === 'confirmed';
      if (a === 'order' || a === 'project') return ['signed', 'executing'].includes(String(row.status));
      if (kind === 'opportunities') return row.status === 'open';
      if (a === 'handover_pm')
        return (
          ['draft', 'rejected', 'active', 'on_hold'].includes(String(row.status)) && row.acceptanceState !== 'pending'
        );
      if (a === 'accept' || a === 'reject_acceptance')
        return row.status === 'active' && row.acceptanceState === 'pending';
      if (a === 'request_acceptance')
        return row.status === 'active' && row.acceptanceState !== 'pending' && Number(row.progress) === 100;
      if (a === 'start') return row.status === 'active' && !row.actualStartDate;
      if (kind === 'projects' && a === 'advance')
        return (
          row.status === 'active' &&
          !!row.actualStartDate &&
          row.acceptanceState !== 'pending' &&
          Number(row.progress) < 100
        );
      if (kind === 'tasks')
        return a === 'assign_task'
          ? !['done', 'cancelled'].includes(String(row.status))
          : a === 'start_task'
            ? row.status === 'todo'
            : a === 'complete'
              ? row.status === 'in_progress'
              : a === 'reopen_task' && row.status === 'done';
      if (a === 'complete') return !['done', 'completed'].includes(String(row.status));
      return true;
    }) ?? [];
  const primary = spec?.name ?? 'name';
  const extras: Record<string, string[]> = {
    customers: ['industry', 'poolType', 'ownerName'],
    contacts: ['customerName', 'title', 'phone', 'email'],
    leads: ['contactName', 'source', 'status', 'assigneeName'],
    opportunities: ['stage', 'amount', 'ownerName'],
    contracts: ['customerName', 'status', 'amount', 'ownerName'],
    orders: ['customerName', 'status', 'totalAmountInclTax', 'orderDate'],
    projects: ['status', 'progress', 'acceptanceState', 'plannedEndDate'],
    tasks: ['status', 'assigneeName', 'dueDate'],
    actions: ['status', 'assigneeName', 'dueDate'],
    followups: ['customerName', 'nextAction', 'nextFollowAt'],
    products: ['category', 'unit', 'listPrice', 'taxRate'],
    'payment-plans': ['status', 'amount', 'receivedAmount', 'outstandingAmount', 'dueDate'],
    invoices: ['customerName', 'amount', 'invoiceDate', 'status'],
    receipts: ['customerName', 'amount', 'receiptDate', 'status'],
  };
  const extra = extras[kind] ?? ['status'];
  const columns = [
    {
      title: spec?.title ?? '名称',
      dataIndex: primary,
      key: primary,
      render: (_: unknown, r: RecordRow) => (
        <a onClick={() => void openDetail(r)}>{String(r[primary] ?? `#${r.id}`)}</a>
      ),
    },
    ...extra
      .filter((k) => k !== primary && rows.some((r) => k in r))
      .map((k) => ({ title: labels[k] ?? k, dataIndex: k, key: k, render: (v: unknown) => display(k, v) })),
    {
      title: '操作',
      key: 'operations',
      width: 220,
      render: (_: unknown, r: RecordRow) => (
        <Space wrap>
          <Button type="link" size="small" onClick={() => void openDetail(r)}>
            详情
          </Button>
          {spec?.canEdit &&
            (!['contracts', 'orders', 'projects'].includes(kind) ||
              ['draft', 'rejected'].includes(String(r.status))) && (
              <Button type="link" size="small" onClick={() => void openEdit(r)}>
                编辑
              </Button>
            )}
          {availableActions(r).map((a) => (
            <Button key={a} type="link" size="small" onClick={() => void run(r, a)}>
              {actionNames[a]}
            </Button>
          ))}
          {kind === 'contracts' && <ContractChanges row={r} onChanged={() => void load()} />}
        </Space>
      ),
    },
  ];
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUSINESS WORKSPACE</div>
          <h1>
            {poolType === 'public' ? '公海客户' : poolType === 'private' ? '私海客户' : (spec?.title ?? '业务工作区')}
          </h1>
          <Typography.Text type="secondary">
            {spec?.readonly
              ? '此列表按权限只读查询；收款登记与核销请使用独立本地台账。'
              : '按当前账号权限展示与操作，所有变更保存到当前企业数据库。'}
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ExportOutlined />} disabled={!rows.length} onClick={exportData}>
            导出当前页
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {spec?.canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void openEdit(null)}>
              新建{spec.title}
            </Button>
          )}
        </Space>
      </div>
      {spec?.readonly && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={kind === 'invoices' ? '演示系统，暂无税务开票功能' : '当前页面为只读查询'}
          description="本页不执行业务处理；独立收款台账支持登记及核销，银行、税务与会计接口仍未开放。"
          action={<Button href="/finance/ledger">收款登记与核销</Button>}
        />
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      <Card>
        <Input.Search
          style={{ width: 320, marginBottom: 20 }}
          placeholder={`搜索${spec?.title ?? ''}`}
          allowClear
          onSearch={(v) => {
            setPage(1);
            setQuery(v);
          }}
        />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 900 }}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showTotal: (n) => `共 ${n} 条` }}
          locale={{ emptyText: <Empty description="暂无数据，可新建或初始化演示数据" /> }}
        />
      </Card>
      <Drawer width={760} title={`${spec?.title}详情`} open={!!detail} onClose={() => setDetail(undefined)}>
        {detail && (
          <>
            <Descriptions
              bordered
              column={2}
              size="small"
              items={Object.entries(detail)
                .filter(([k, v]) => k in labels && v !== null)
                .map(([k, v]) => ({ key: k, label: labels[k], children: display(k, v) }))}
            />
            {['projects', 'tasks'].includes(kind) && (
              <AttachmentPanel
                subjectKind={kind}
                subjectId={detail.id}
                onChanged={async () => setDetail(await get<RecordRow>(`/workspace/${kind}/${detail.id}`))}
                writable={
                  !!spec?.canEdit &&
                  !['done', 'cancelled', 'completed'].includes(String(detail.status)) &&
                  detail.acceptanceState !== 'pending'
                }
              />
            )}
            {kind === 'contracts' && detail.quoteSnapshot && typeof detail.quoteSnapshot === 'object' && (
              <Card
                title={`选用报价版本 ${(detail.quoteSnapshot as Record<string, unknown>).version}`}
                style={{ marginTop: 16 }}
              >
                <QuoteLines items={(detail.quoteSnapshot as Record<string, unknown>).items} />
              </Card>
            )}
            {detail.related && typeof detail.related === 'object' && (
              <Tabs
                style={{ marginTop: 24 }}
                items={Object.entries(detail.related).map(([name, values]) => ({
                  key: name,
                  label:
                    (
                      {
                        contacts: '联系人',
                        opportunities: '商机',
                        contracts: '合同',
                        projects: '项目',
                        followups: '跟进',
                        orders: '订单',
                        'payment-plans': '回款计划',
                        tasks: '任务',
                        milestones: '里程碑',
                        deliveryEvents: '交付与验收记录',
                        quote: '报价明细',
                        quoteVersions: '报价历史版本',
                        changes: '合同变更记录',
                      } as Record<string, string>
                    )[name] ?? name,
                  children:
                    name === 'deliveryEvents' ? (
                      <Table
                        rowKey="id"
                        size="small"
                        dataSource={values as RecordRow[]}
                        pagination={{ pageSize: 10 }}
                        columns={[
                          {
                            title: '时间（北京时间）',
                            dataIndex: 'createdAt',
                            render: (v: unknown) =>
                              new Date(String(v)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
                          },
                          {
                            title: '动作',
                            dataIndex: 'kind',
                            render: (v: unknown) =>
                              ({
                                'project.started': '项目启动',
                                'milestone.completed': '里程碑完成',
                                'acceptance.requested': '提交验收',
                                'acceptance.rejected': '拒收整改',
                                'acceptance.accepted': '确认验收',
                                'task.start_task': '任务开始',
                                'task.complete': '任务完成',
                                'task.reopen_task': '任务整改',
                                'task.assign_task': '任务转派',
                                'project.pm_handover': '项目经理交接',
                              })[String(v)] ?? String(v),
                          },
                          { title: '依据/整改要求', dataIndex: 'note' },
                          {
                            title: '记录人',
                            render: (_: unknown, r: RecordRow) =>
                              String((r.evidence as Record<string, unknown>)?.actorName ?? r.actorId),
                          },
                        ]}
                      />
                    ) : name === 'quoteVersions' ? (
                      <QuoteHistory versions={values as RecordRow[]} />
                    ) : (
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={values as RecordRow[]}
                        pagination={false}
                        scroll={{ x: 500 }}
                        columns={Object.keys((values as RecordRow[])[0] ?? {})
                          .filter((k) => labels[k] || k === 'name')
                          .slice(0, 7)
                          .map((k) => ({ title: labels[k] ?? k, dataIndex: k, render: (v: unknown) => display(k, v) }))}
                      />
                    ),
                }))}
              />
            )}
          </>
        )}
      </Drawer>
      <Modal
        title={`${editing ? '编辑' : '新建'}${spec?.title ?? ''}`}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={() => void save()}
        confirmLoading={busy}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {spec?.fields.map((f) => (
            <Form.Item
              key={f.key}
              name={f.key}
              label={f.label}
              rules={[{ required: f.required, message: `请填写${f.label}` }]}
            >
              {f.key === 'milestoneId' ? (
                <Select
                  allowClear
                  placeholder="选择项目后可关联里程碑；未关联任务在最终交付前检查"
                  options={taskMilestones
                    .filter((m) => m.status !== 'completed')
                    .map((m) => ({ value: m.id, label: String(m.name) }))}
                />
              ) : f.reference ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={(options[f.key] ?? []).map((r) => ({
                    value: r.id,
                    label: String(r.name ?? r.companyName ?? r.contractNo ?? r.title ?? r.id),
                  }))}
                />
              ) : f.type === 'select' ? (
                <Select options={f.options?.map((v) => ({ value: v, label: statusNames[v] ?? v }))} />
              ) : f.type === 'money' || f.type === 'number' ? (
                <InputNumber style={{ width: '100%' }} min={0} precision={f.type === 'money' ? 2 : 0} />
              ) : f.type === 'date' ? (
                <Input type="date" />
              ) : f.type === 'textarea' ? (
                <Input.TextArea rows={3} />
              ) : (
                <Input maxLength={200} />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
      <Modal
        title={actionNames[command?.action ?? ''] ?? '业务操作'}
        open={!!command}
        onCancel={() => setCommand(undefined)}
        onOk={() => void apply()}
        confirmLoading={busy}
        width={command?.action === 'quote' ? 760 : 520}
      >
        <Typography.Paragraph>对象：{String(command?.row[primary] ?? '')}。此操作会保存业务变更。</Typography.Paragraph>
        <Form form={actionForm} layout="vertical">
          {command?.action === 'submit' && approvalForm && (
            <>
              <Alert
                type="info"
                message={`${approvalForm.name} v${approvalForm.version}`}
                style={{ marginBottom: 16 }}
              />
              {approvalForm.fields.map((f) => (
                <Form.Item key={f.key} name={['form', f.key]} label={f.label} rules={[{ required: f.required }]}>
                  {f.type === 'number' ? (
                    <InputNumber style={{ width: '100%' }} />
                  ) : f.type === 'date' ? (
                    <Input type="date" />
                  ) : (
                    <Input.TextArea rows={2} />
                  )}
                </Form.Item>
              ))}
            </>
          )}
          {command?.action === 'handover_pm' && (
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message="同时交接原项目经理名下未完成任务及其负责的未完成里程碑，保留已完成记录和其他执行人的工作。"
            />
          )}
          {command && ['assign', 'assign_task', 'handover_pm'].includes(command.action) && (
            <Form.Item
              name="userId"
              label={command.action === 'assign' ? '目标销售' : '接收人'}
              rules={[{ required: true }]}
            >
              <Select options={(options.users ?? []).map((u) => ({ value: u.id, label: String(u.name) }))} />
            </Form.Item>
          )}
          {command?.action === 'lose' && (
            <Form.Item name="reason" label="输单原因" rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
          )}
          {command &&
            ((kind === 'projects' &&
              ['advance', 'request_acceptance', 'reject_acceptance', 'accept', 'handover_pm'].includes(
                command.action,
              )) ||
              kind === 'tasks') && (
              <Form.Item
                name="note"
                label={
                  ['handover_pm', 'assign_task'].includes(command.action)
                    ? '交接原因及待办说明'
                    : '交付结果、验收依据或整改要求'
                }
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} maxLength={3000} />
              </Form.Item>
            )}
          {kind === 'tasks' && command?.action === 'complete' && (
            <Form.Item name="actualHours" label="本任务累计实际工时（小时）" rules={[{ required: true }]}>
              <InputNumber stringMode min="0.1" max="9999.9" precision={1} />
            </Form.Item>
          )}
          {command?.action === 'quote' && (
            <Form.List name="items" initialValue={[{ quantity: 1, unitPrice: 0 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Space key={f.key} align="baseline">
                      <Form.Item name={[f.name, 'productId']} rules={[{ required: true }]}>
                        <Select
                          style={{ width: 220 }}
                          placeholder="产品"
                          options={(options.products ?? []).map((p) => ({ value: p.id, label: String(p.name) }))}
                        />
                      </Form.Item>
                      <Form.Item name={[f.name, 'quantity']} rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} placeholder="数量" />
                      </Form.Item>
                      <Form.Item name={[f.name, 'unitPrice']} rules={[{ required: true }]}>
                        <InputNumber min={0} precision={2} placeholder="单价" />
                      </Form.Item>
                      <Button danger onClick={() => remove(f.name)}>
                        移除
                      </Button>
                    </Space>
                  ))}
                  <Button onClick={() => add({ quantity: 1, unitPrice: 0 })}>添加产品</Button>
                </>
              )}
            </Form.List>
          )}
        </Form>
      </Modal>
    </div>
  );
}
