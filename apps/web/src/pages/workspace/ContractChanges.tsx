import { useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, message } from 'antd';
import { get, post, key, errorText, statusNames, type RecordRow } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Field {
  key: string;
  label: string;
  type: string;
  required: boolean;
}
interface Plan {
  expectedUpdatedAt: string;
  before: Record<string, unknown>;
  proposed: Record<string, unknown>;
  formFields: Field[];
  flowName: string;
  impact: string;
}
interface Change {
  id: number;
  changeType: string;
  status: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  requestedBy: string;
  approvedBy: string | null;
  createdAt: string;
}
const labels: Record<string, string> = {
  amount: '含税金额',
  taxRate: '税率%',
  startDate: '开始日期',
  endDate: '结束日期',
  paymentTerms: '付款条款',
  status: '合同状态',
};
export function ChangeComparison({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="field"
      dataSource={Object.keys(labels).map((field) => ({
        field,
        label: labels[field],
        before: before[field],
        after: after[field],
      }))}
      columns={[
        { title: '内容', dataIndex: 'label' },
        {
          title: '变更前',
          render: (_, r) =>
            r.field === 'status' ? (statusNames[String(r.before)] ?? String(r.before)) : String(r.before ?? '—'),
        },
        {
          title: '变更后',
          render: (_, r) =>
            r.field === 'status' ? (statusNames[String(r.after)] ?? String(r.after)) : String(r.after ?? '—'),
        },
      ]}
    />
  );
}
export default function ContractChanges({ row, onChanged }: { row: RecordRow; onChanged: () => void }) {
  const roles = useAuthStore((s) => s.user?.roles ?? []),
    canRequest = roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r));
  const [open, setOpen] = useState(false),
    [history, setHistory] = useState<Change[]>([]),
    [plan, setPlan] = useState<Plan>(),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const requestKey = useRef(key());
  const load = async () => {
    try {
      setHistory(await get<Change[]>(`/commercial/contracts/${row.id}/changes`));
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const values = () => {
    const v = form.getFieldsValue(true);
    const type = String(v.changeType);
    const data =
      type === 'terminate'
        ? {}
        : type === 'schedule'
          ? { startDate: v.data?.startDate || null, endDate: v.data?.endDate || null }
          : type === 'amount'
            ? {
                amount: String(v.data?.amount ?? ''),
                ...(v.data?.taxRate !== undefined && v.data.taxRate !== '' ? { taxRate: String(v.data.taxRate) } : {}),
              }
            : { paymentTerms: v.data?.paymentTerms };
    return { changeType: type, data };
  };
  return (
    <>
      <Button
        type="link"
        onClick={() => {
          form.resetFields();
          form.setFieldsValue({
            changeType: 'amount',
            data: { amount: String(row.amount ?? ''), taxRate: String(row.taxRate ?? 13) },
          });
          setPlan(undefined);
          setOpen(true);
          void load();
        }}
      >
        合同变更 / 记录
      </Button>
      <Modal title={`合同变更 · ${row.name}`} width={820} open={open} footer={null} onCancel={() => setOpen(false)}>
        <Tabs
          items={[
            {
              key: 'history',
              label: '变更记录',
              children: (
                <Table
                  rowKey="id"
                  dataSource={history}
                  columns={[
                    {
                      title: '变更',
                      dataIndex: 'changeType',
                      render: (t) =>
                        ({ amount: '金额/税率', schedule: '日期', terms: '条款', terminate: '终止' })[t as string] ?? t,
                    },
                    { title: '状态', dataIndex: 'status', render: (s) => statusNames[s] ?? s },
                    { title: '申请人', dataIndex: 'requestedBy' },
                    { title: '审批人', dataIndex: 'approvedBy' },
                    { title: '原因及凭据说明', dataIndex: 'reason' },
                  ]}
                  expandable={{ expandedRowRender: (r) => <ChangeComparison before={r.before} after={r.after} /> }}
                />
              ),
            },
            ...(canRequest
              ? [
                  {
                    key: 'request',
                    label: '发起变更 / 终止',
                    children: (
                      <>
                        <Alert
                          type="info"
                          message="需配置“合同变更/终止”审批流；本批仅支持尚无订单、项目、开票或核销，且只有一笔未执行回款计划的签约合同。"
                        />
                        <Form
                          form={form}
                          layout="vertical"
                          onValuesChange={(changed) => {
                            if ('changeType' in changed) {
                              form.setFieldValue('data', {});
                              setPlan(undefined);
                            }
                            if ('data' in changed) setPlan(undefined);
                            requestKey.current = key();
                          }}
                          style={{ marginTop: 16 }}
                        >
                          <Form.Item name="changeType" label="变更类型">
                            <Select
                              options={[
                                { value: 'amount', label: '金额 / 税率' },
                                { value: 'schedule', label: '日期' },
                                { value: 'terms', label: '付款条款' },
                                { value: 'terminate', label: '终止合同' },
                              ]}
                            />
                          </Form.Item>
                          <Form.Item noStyle shouldUpdate={(a, b) => a.changeType !== b.changeType}>
                            {() => {
                              const t = form.getFieldValue('changeType');
                              return t === 'amount' ? (
                                <Space align="start">
                                  <Form.Item name={['data', 'amount']} label="新含税金额">
                                    <Input placeholder="例如12000.50" />
                                  </Form.Item>
                                  <Form.Item name={['data', 'taxRate']} label="新税率%（可选）">
                                    <Input placeholder="例如13" />
                                  </Form.Item>
                                </Space>
                              ) : t === 'schedule' ? (
                                <Space>
                                  <Form.Item name={['data', 'startDate']} label="开始日期（留空清除）">
                                    <Input type="date" />
                                  </Form.Item>
                                  <Form.Item name={['data', 'endDate']} label="结束日期（留空清除）">
                                    <Input type="date" />
                                  </Form.Item>
                                </Space>
                              ) : t === 'terms' ? (
                                <Form.Item name={['data', 'paymentTerms']} label="新付款条款">
                                  <Input.TextArea maxLength={200} />
                                </Form.Item>
                              ) : (
                                <Alert
                                  type="warning"
                                  message="批准后终止合同、取消未执行回款计划；不自动处理外部法律手续或退款。"
                                />
                              );
                            }}
                          </Form.Item>
                          <Form.Item name="reason" label="变更原因及凭据说明" rules={[{ required: true }]}>
                            <Input.TextArea maxLength={3000} />
                          </Form.Item>
                          <Button
                            loading={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                const p = await post<Plan>(`/commercial/contracts/${row.id}/changes/preview`, values());
                                setPlan(p);
                                requestKey.current = key();
                              } catch (e) {
                                message.error(errorText(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            预检影响与审批表单
                          </Button>
                          {plan && (
                            <>
                              <Alert
                                style={{ marginTop: 16 }}
                                message={`${plan.flowName}：${plan.impact}`}
                                type="info"
                              />
                              <ChangeComparison before={plan.before} after={plan.proposed} />
                              {plan.formFields.map((f) => (
                                <Form.Item
                                  key={f.key}
                                  name={['form', f.key]}
                                  label={f.label}
                                  rules={[{ required: f.required }]}
                                >
                                  {f.type === 'number' ? (
                                    <InputNumber />
                                  ) : (
                                    <Input type={f.type === 'date' ? 'date' : 'text'} />
                                  )}
                                </Form.Item>
                              ))}
                              <Button
                                type="primary"
                                loading={busy}
                                onClick={async () => {
                                  try {
                                    const v = await form.validateFields();
                                    setBusy(true);
                                    await post(`/commercial/contracts/${row.id}/changes`, {
                                      requestKey: requestKey.current,
                                      expectedUpdatedAt: plan.expectedUpdatedAt,
                                      ...values(),
                                      reason: v.reason,
                                      form: v.form ?? {},
                                    });
                                    message.success('变更已进入审批，原合同尚未变更');
                                    setPlan(undefined);
                                    await load();
                                    onChanged();
                                  } catch (e) {
                                    if (!(e && typeof e === 'object' && 'errorFields' in e))
                                      message.error(errorText(e));
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                确认提交审批
                              </Button>
                            </>
                          )}
                        </Form>
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Modal>
    </>
  );
}
