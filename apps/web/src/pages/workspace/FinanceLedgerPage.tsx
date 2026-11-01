import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { get, post, key, errorText, money, type RecordRow } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
type Receipt = RecordRow & {
  receiptNo: string;
  customerId: number;
  customerName: string;
  contractId: number | null;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  status: string;
  ledgerManaged: boolean;
  createdBy: number;
  allocations?: Allocation[];
  events?: RecordRow[];
  serialNo?: string;
  receiptDate?: string;
  canCorrect?: boolean;
  previous?: RecordRow | null;
  replacement?: RecordRow | null;
  contract?: RecordRow | null;
};
type Allocation = RecordRow & { paymentPlanId: number; amount: string; active: boolean };
type Plan = RecordRow & {
  planNo: string;
  contractId: number;
  amount: string;
  receivedAmount: string;
  outstandingAmount: string;
  dueDate: string;
  contract: { customerId: number; contractNo: string };
};
const statuses: Record<string, string> = { draft: '待独立复核', confirmed: '已复核', voided: '已作废' };
const actions: Record<string, string> = {
  create: '登记收款',
  confirm: '独立复核确认',
  allocate: '分摊核销',
  reverse: '撤销核销',
  void: '作废登记',
  correct: '更正登记 / 同凭据重开',
};
const eventNames: Record<string, string> = {
  registered: '登记收款',
  confirmed: '独立复核',
  allocated: '分摊核销',
  'allocation.reversed': '撤销核销',
  voided: '作废登记',
  'correction.replaced': '原登记已更正',
  'correction.registered': '更正登记待复核',
};
export default function FinanceLedgerPage() {
  const user = useAuthStore((s) => s.user),
    isAdmin = !!user?.roles.includes('super_admin');
  const [rows, setRows] = useState<Receipt[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [customers, setCustomers] = useState<RecordRow[]>([]),
    [contracts, setContracts] = useState<RecordRow[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [detail, setDetail] = useState<Receipt>();
  const [action, setAction] = useState<{ name: string; row?: Receipt }>();
  const [form] = Form.useForm();
  const requestKey = useRef(key());
  const customerId = Form.useWatch('customerId', form),
    planId = Form.useWatch('paymentPlanId', form),
    allocationId = Form.useWatch('allocationId', form);
  async function load() {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        get<Receipt[]>('/finance-ledger/receipts'),
        get<Plan[]>('/finance-ledger/plans'),
      ]);
      setRows(r);
      setPlans(p);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function open(name: string, row?: Receipt) {
    setBusy(true);
    try {
      const current = row ? await get<Receipt>(`/finance-ledger/receipts/${row.id}`) : undefined;
      const p = await get<Plan[]>('/finance-ledger/plans');
      setPlans(p);
      if (name === 'correct' && !current?.canCorrect)
        throw new Error('请先撤销全部有效核销，并从该凭据的当前登记发起更正');
      if (['create', 'correct'].includes(name)) {
        const [c, cs] = await Promise.all([
          get<{ items: RecordRow[] }>('/workspace/customers', { pageSize: 100 }),
          get<{ items: RecordRow[] }>('/workspace/contracts', { pageSize: 100 }),
        ]);
        setCustomers(
          current && !c.items.some((x) => x.id === current.customerId)
            ? [{ id: current.customerId, name: current.customerName }, ...c.items]
            : c.items,
        );
        setContracts(
          current?.contract && !cs.items.some((x) => x.id === current.contractId)
            ? [current.contract, ...cs.items]
            : cs.items,
        );
      }
      requestKey.current = key();
      form.resetFields();
      if (name === 'correct' && current)
        form.setFieldsValue({
          customerId: current.customerId,
          contractId: current.contractId,
          amount: current.amount,
          receiptDate: current.receiptDate?.slice(0, 10),
        });
      setAction({ name, row: current });
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const eligiblePlans = plans.filter(
    (p) =>
      p.contract.customerId === action?.row?.customerId &&
      (!action.row.contractId || action.row.contractId === p.contractId),
  );
  const selectedAllocation = action?.row?.allocations?.find((a) => a.id === allocationId);
  const selectedPlan = plans.find(
    (p) => p.id === (action?.name === 'reverse' ? selectedAllocation?.paymentPlanId : planId),
  );
  async function save() {
    if (!action) return;
    setBusy(true);
    try {
      const fields = await form.validateFields();
      const body: Record<string, unknown> = { ...fields, requestKey: requestKey.current };
      if (action.name === 'correct') body.contractId = fields.contractId ?? null;
      if (action.name !== 'create') {
        body.expectedUpdatedAt = action.row?.updatedAt;
        if (['allocate', 'reverse'].includes(action.name)) {
          if (!selectedPlan) throw new Error('未找到当前回款计划，请刷新后重试');
          body.expectedPlanUpdatedAt = selectedPlan.updatedAt;
        }
      }
      const result = await post<{ id: number }>(
        action.name === 'create'
          ? '/finance-ledger/receipts'
          : `/finance-ledger/receipts/${action.row?.id}/${action.name}`,
        body,
      );
      message.success('台账操作已保存');
      setAction(undefined);
      setDetail(undefined);
      await load();
      if (action.name === 'correct') setDetail(await get<Receipt>(`/finance-ledger/receipts/${result.id}`));
    } catch (e) {
      if (!(e && typeof e === 'object' && 'errorFields' in e)) message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LOCAL RECEIVABLES LEDGER</div>
          <h1>收款登记与核销</h1>
        </div>
        <Space>
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          {isAdmin && (
            <Button type="primary" onClick={() => void open('create')}>
              登记收款
            </Button>
          )}
        </Space>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="本地收款台账：登记 → 另一管理员复核 → 核销 → 撤销/作废"
        description="仅记录业务已取得的到账凭据，不连接银行、不转账、不退款、不执行税务开票或会计记账。历史演示记录保持只读；当前写操作仅限管理员。"
      />
      <Tabs
        items={[
          {
            key: 'receipts',
            label: '收款登记',
            children: (
              <Table
                rowKey="id"
                loading={loading}
                dataSource={rows}
                scroll={{ x: 1000 }}
                columns={[
                  { title: '收款编号', dataIndex: 'receiptNo' },
                  { title: '客户', dataIndex: 'customerName' },
                  { title: '金额', dataIndex: 'amount', render: money },
                  { title: '已核销', dataIndex: 'allocatedAmount', render: money },
                  { title: '未核销', dataIndex: 'unallocatedAmount', render: money },
                  {
                    title: '状态',
                    render: (_: unknown, r: Receipt) => (
                      <Space>
                        <Tag>{statuses[r.status] ?? r.status}</Tag>
                        {!r.ledgerManaged && <Tag>历史只读</Tag>}
                      </Space>
                    ),
                  },
                  {
                    title: '操作',
                    render: (_: unknown, r: Receipt) => (
                      <Space wrap>
                        <Button
                          size="small"
                          onClick={() =>
                            void get<Receipt>(`/finance-ledger/receipts/${r.id}`)
                              .then(setDetail)
                              .catch((e) => message.error(errorText(e)))
                          }
                        >
                          记录
                        </Button>
                        {isAdmin && r.ledgerManaged && (
                          <>
                            <Button size="small" onClick={() => void open('correct', r)}>
                              更正 / 重开
                            </Button>
                            {r.status === 'draft' && (
                              <Button
                                size="small"
                                disabled={r.createdBy === user?.id}
                                onClick={() => void open('confirm', r)}
                              >
                                独立复核
                              </Button>
                            )}
                            {r.status === 'confirmed' && (
                              <>
                                <Button size="small" onClick={() => void open('allocate', r)}>
                                  核销
                                </Button>
                                <Button size="small" onClick={() => void open('reverse', r)}>
                                  撤销核销
                                </Button>
                              </>
                            )}
                            {r.status !== 'voided' && (
                              <Button size="small" danger onClick={() => void open('void', r)}>
                                作废
                              </Button>
                            )}
                          </>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'plans',
            label: '应收计划',
            children: (
              <Card title="合同剩余应收（最近100笔计划）">
                <Alert
                  type="info"
                  message="金额来自本地计划与核销记录；不代表外部银行或税务核验结果。"
                  style={{ marginBottom: 12 }}
                />
                <Table
                  rowKey="id"
                  dataSource={plans}
                  columns={[
                    { title: '计划', dataIndex: 'planNo' },
                    { title: '合同', render: (_: unknown, p: Plan) => p.contract.contractNo },
                    { title: '计划金额', dataIndex: 'amount', render: money },
                    { title: '已收', dataIndex: 'receivedAmount', render: money },
                    { title: '剩余', dataIndex: 'outstandingAmount', render: money },
                    { title: '到期日', dataIndex: 'dueDate', render: (v: unknown) => String(v).slice(0, 10) },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title={actions[action?.name ?? '']}
        open={!!action}
        onCancel={() => setAction(undefined)}
        onOk={() => void save()}
        confirmLoading={busy}
        destroyOnClose
        width={650}
      >
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 16 }}
          message={
            action?.name === 'correct'
              ? '保留原凭据编号及历史，原登记作废，新登记必须由另一管理员重新复核；不会转账或退款。更正前请撤销全部有效核销。'
              : action?.name === 'confirm'
                ? '须由登记人以外的另一名管理员核对凭据。'
                : action?.name === 'reverse'
                  ? '撤销本次整笔核销，保留原核销及余额变动历史；不会发起退款。'
                  : action?.name === 'void'
                    ? '须先撤销所有有效核销。作废保留原凭据，禁止重复登记相同凭据。'
                    : '操作仅更新本地台账，请核对金额、客户和凭据。'
          }
        />
        <Form form={form} layout="vertical">
          {action?.row && (
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'receipt', label: '收款', children: action.row.receiptNo },
                { key: 'customer', label: '客户', children: action.row.customerName },
                { key: 'available', label: '可用余额', children: '¥' + money(action.row.unallocatedAmount) },
              ]}
              style={{ marginBottom: 16 }}
            />
          )}
          {action?.name === 'correct' && (
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              message={`原凭据：${action.row?.serialNo}；原金额：¥${money(action.row?.amount)}；原日期：${action.row?.receiptDate?.slice(0, 10)}`}
              description="凭据编号不可修改。更正后的合同须有效，必要时明确清除合同绑定。"
            />
          )}
          {action && ['create', 'correct'].includes(action.name) && (
            <>
              <Form.Item name="customerId" label="客户" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  onChange={() => form.setFieldValue('contractId', undefined)}
                  options={customers.map((c) => ({ value: c.id, label: String(c.name) }))}
                />
              </Form.Item>
              <Form.Item name="contractId" label="绑定合同（可选；绑定后只允许该合同核销）">
                <Select
                  allowClear
                  options={contracts
                    .filter(
                      (c) =>
                        c.customerId === customerId &&
                        (['signed', 'executing', 'completed'].includes(String(c.status)) ||
                          c.id === action.row?.contractId),
                    )
                    .map((c) => ({ value: c.id, label: String(c.contractNo) + ' ' + String(c.name) }))}
                />
              </Form.Item>
              <Form.Item name="amount" label="到账凭据金额" rules={[{ required: true }]}>
                <InputNumber stringMode precision={2} min="0.01" max="9999999999999.99" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="receiptDate" label="凭据到账日期" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
              {action.name === 'create' && (
                <Form.Item name="reference" label="外部到账凭据编号（本企业唯一）" rules={[{ required: true }]}>
                  <Input maxLength={50} />
                </Form.Item>
              )}
            </>
          )}
          {action?.name === 'allocate' && (
            <>
              <Form.Item name="paymentPlanId" label="同客户回款计划" rules={[{ required: true }]}>
                <Select
                  options={eligiblePlans.map((p) => ({
                    value: p.id,
                    label: `${p.planNo} · ${p.contract.contractNo} · 剩余 ${money(p.outstandingAmount)}`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="amount" label="本次核销金额" rules={[{ required: true }]}>
                <InputNumber stringMode min="0.01" max="9999999999999.99" precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <p>
                收款可用余额：¥{money(action.row?.unallocatedAmount)}；所选计划剩余：¥
                {money(selectedPlan?.outstandingAmount)}
              </p>
            </>
          )}
          {action?.name === 'reverse' && (
            <Form.Item name="allocationId" label="待撤销核销记录（整笔）" rules={[{ required: true }]}>
              <Select
                options={(action.row?.allocations ?? [])
                  .filter((a) => a.active)
                  .map((a) => ({ value: a.id, label: `计划 #${a.paymentPlanId} · ¥${money(a.amount)}` }))}
              />
            </Form.Item>
          )}
          <Form.Item name="note" label="依据与处理说明" rules={[{ required: true }]}>
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={'台账记录 · ' + (detail?.receiptNo ?? '')}
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width={900}
      >
        {detail && (
          <>
            {(detail.previous || detail.replacement) && (
              <Card size="small" title="更正凭据链" style={{ marginBottom: 16 }}>
                <Space wrap>
                  {[detail.previous, detail.replacement].filter(Boolean).map((r, i) => (
                    <Button
                      key={r!.id}
                      onClick={() =>
                        void get<Receipt>(`/finance-ledger/receipts/${r!.id}`)
                          .then(setDetail)
                          .catch((e) => message.error(errorText(e)))
                      }
                    >
                      {i === 0 && detail.previous ? '更正前登记' : '后续更正登记'}：{String(r!.receiptNo)}
                    </Button>
                  ))}
                </Space>
              </Card>
            )}
            {isAdmin && detail.canCorrect && (
              <Button style={{ marginBottom: 16 }} onClick={() => void open('correct', detail)}>
                更正 / 同凭据重开
              </Button>
            )}
            <Descriptions
              items={[
                { key: 'amount', label: '凭据金额', children: money(detail.amount) },
                { key: 'allocated', label: '已核销', children: money(detail.allocatedAmount) },
                { key: 'available', label: '未核销', children: money(detail.unallocatedAmount) },
                { key: 'reference', label: '外部凭据', children: String(detail.serialNo ?? '历史记录只读') },
              ]}
            />
            <h3>核销及撤销历史</h3>
            <Table
              rowKey="id"
              dataSource={detail.allocations}
              columns={[
                { title: '计划编号', dataIndex: 'paymentPlanId' },
                { title: '金额', dataIndex: 'amount', render: money },
                { title: '状态', render: (_: unknown, a: Allocation) => (a.active ? '有效' : '已撤销') },
                { title: '撤销依据', dataIndex: 'reverseReason' },
              ]}
            />
            <h3>处理记录</h3>
            <Table
              rowKey="id"
              dataSource={detail.events}
              columns={[
                {
                  title: '时间（北京时间）',
                  dataIndex: 'createdAt',
                  render: (v: unknown) =>
                    new Date(String(v)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
                },
                { title: '处理', dataIndex: 'kind', render: (v: unknown) => eventNames[String(v)] ?? String(v) },
                { title: '说明', dataIndex: 'note' },
                {
                  title: '操作人',
                  render: (_: unknown, e: RecordRow) =>
                    String((e.evidence as Record<string, unknown>)?.actorName ?? e.actorId),
                },
              ]}
              expandable={{
                expandedRowRender: (e) => {
                  const x = e.evidence as Record<string, Record<string, string>>;
                  if (String(e.kind).startsWith('correction.') && x.before && x.after)
                    return (
                      <Descriptions
                        items={[
                          {
                            key: 'customer',
                            label: '客户',
                            children: `${x.before.customerName} → ${x.after.customerName}`,
                          },
                          { key: 'amount', label: '登记金额', children: `${x.before.amount} → ${x.after.amount}` },
                          {
                            key: 'date',
                            label: '到账日期',
                            children: `${x.before.receiptDate} → ${x.after.receiptDate}`,
                          },
                          {
                            key: 'contract',
                            label: '合同绑定',
                            children: `${x.before.contractNo ?? '未绑定'} → ${x.after.contractNo ?? '未绑定'}`,
                          },
                        ]}
                      />
                    );
                  return x.before && x.after ? (
                    <Descriptions
                      items={[
                        {
                          key: 'receipt',
                          label: '收款已核销',
                          children: `${x.before.receiptAllocated} → ${x.after.receiptAllocated}`,
                        },
                        {
                          key: 'plan',
                          label: '计划已收',
                          children: `${x.before.planReceived} → ${x.after.planReceived}`,
                        },
                        {
                          key: 'contract',
                          label: '合同已收',
                          children: `${x.before.contractReceived} → ${x.after.contractReceived}`,
                        },
                      ]}
                    />
                  ) : null;
                },
              }}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
