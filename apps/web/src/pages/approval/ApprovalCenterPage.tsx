import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Steps,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import { get, post, key, errorText, statusNames, type RecordRow } from '../../services/workspace';
import { ChangeComparison } from '../workspace/ContractChanges';
function BusinessChangeEvidence({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    !snapshot.before ||
    !snapshot.proposed ||
    typeof snapshot.before !== 'object' ||
    typeof snapshot.proposed !== 'object'
  )
    return null;
  return (
    <Card title="合同变更前后对照" style={{ marginBottom: 20 }}>
      <Typography.Paragraph>{String(snapshot.reason ?? '')}</Typography.Paragraph>
      <ChangeComparison
        before={snapshot.before as Record<string, unknown>}
        after={snapshot.proposed as Record<string, unknown>}
      />
    </Card>
  );
}
interface Approval extends RecordRow {
  title: string;
  status: string;
  approvalNo: string;
  bizType: string;
  formData: Record<string, unknown>;
  nodes?: { id: number; nodeName: string; action: string; comment: string }[];
}
interface Pending {
  nodeId: number;
  nodeName: string;
  approval: Approval;
}
interface Flow extends RecordRow {
  name: string;
  bizType: string;
  definition?: { fields: { key: string; label: string; type: string; required: boolean }[] };
}
export default function ApprovalCenterPage() {
  const [pending, setPending] = useState<Pending[]>([]),
    [initiated, setInitiated] = useState<Approval[]>([]),
    [flows, setFlows] = useState<Flow[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<Approval>();
  const [form] = Form.useForm();
  const selected = Form.useWatch('flowId', form);
  const flow = flows.find((f) => f.id === selected);
  const load = async () => {
    try {
      const [p, i, f] = await Promise.all([
        get<Pending[]>('/approvals/pending'),
        get<{ items: Approval[] }>('/approvals/my-initiated'),
        get<Flow[]>('/approvals/flows'),
      ]);
      setPending(p);
      setInitiated(i.items);
      setFlows(f.filter((v) => !['contract', 'order', 'project_initiation'].includes(v.bizType)));
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const decide = (p: Pending, reject = false) => {
    let comment = '';
    Modal.confirm({
      title: reject ? '驳回申请' : '通过当前节点',
      content: (
        <>
          <Typography.Paragraph>
            {p.approval.title} · {p.nodeName}
          </Typography.Paragraph>
          <Input.TextArea
            placeholder={reject ? '驳回意见（必填）' : '审批意见（选填）'}
            onChange={(e) => {
              comment = e.target.value;
            }}
          />
        </>
      ),
      onOk: async () => {
        if (reject && !comment.trim()) {
          message.error('请填写驳回意见');
          throw new Error('缺少意见');
        }
        try {
          await post(`/approvals/${p.approval.id}/nodes/${p.nodeId}/${reject ? 'reject' : 'approve'}`, {
            requestKey: key(),
            comment: comment || (reject ? '' : '同意'),
          });
          message.success('审批已处理');
          await load();
        } catch (e) {
          message.error(errorText(e));
          throw e;
        }
      },
    });
  };
  const submit = async () => {
    try {
      const body = await form.validateFields();
      setBusy(true);
      await post('/approvals', { ...body, requestKey: key() });
      message.success('申请已提交');
      setOpen(false);
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = (a: Approval) =>
    Modal.confirm({
      title: '撤回申请？',
      onOk: async () => {
        try {
          await post(`/approvals/${a.id}/withdraw`, { requestKey: key() });
          await load();
        } catch (e) {
          message.error(errorText(e));
          throw e;
        }
      },
    });
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">APPROVAL CENTER</div>
          <h1>审批中心</h1>
          <Typography.Text type="secondary">只显示当前轮到你处理的节点，处理结果与业务单据同步保存。</Typography.Text>
        </div>
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        >
          发起通用申请
        </Button>
      </div>
      {error && <Alert type="error" message={error} showIcon />}
      <Tabs
        items={[
          {
            key: 'pending',
            label: `待我审批 (${pending.length})`,
            children: (
              <List
                dataSource={pending}
                locale={{ emptyText: '暂无待审批事项' }}
                renderItem={(p) => (
                  <Card style={{ marginBottom: 12 }}>
                    <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <Tag color="blue">{p.approval.bizType}</Tag>
                        <a onClick={() => setDetail(p.approval)}>{p.approval.title}</a>
                        <div style={{ marginTop: 8, color: '#64748b' }}>
                          {p.approval.approvalNo} · {p.nodeName}
                        </div>
                      </div>
                      <Space>
                        <Button onClick={() => setDetail(p.approval)}>查看申请</Button>
                        <Button type="primary" onClick={() => decide(p)}>
                          通过
                        </Button>
                        <Button danger onClick={() => decide(p, true)}>
                          驳回
                        </Button>
                      </Space>
                    </Space>
                  </Card>
                )}
              />
            ),
          },
          {
            key: 'mine',
            label: '我发起的',
            children: (
              <List
                dataSource={initiated}
                renderItem={(a) => (
                  <Card style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Space>
                        <a onClick={() => setDetail(a)}>{a.title}</a>
                        <Tag
                          color={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'error' : 'processing'}
                        >
                          {statusNames[a.status] ?? a.status}
                        </Tag>
                      </Space>
                      {a.status === 'pending' && <Button onClick={() => withdraw(a)}>撤回</Button>}
                    </div>
                    {a.nodes && (
                      <Steps
                        style={{ marginTop: 16 }}
                        size="small"
                        items={a.nodes.map((n) => ({
                          title: n.nodeName,
                          description: n.comment,
                          status: n.action === 'approved' ? 'finish' : n.action === 'rejected' ? 'error' : 'wait',
                        }))}
                      />
                    )}
                  </Card>
                )}
              />
            ),
          },
        ]}
      />
      <Modal
        title="发起通用申请"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={busy}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="flowId" label="流程" rules={[{ required: true }]}>
            <Select options={flows.map((f) => ({ value: f.id, label: f.name }))} />
          </Form.Item>
          <Form.Item name="title" label="申请标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="amount" label="申请金额（用于条件匹配）" initialValue={0}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          {flow?.definition?.fields?.map((f) => (
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
        </Form>
      </Modal>
      <Drawer title={detail?.title} open={!!detail} onClose={() => setDetail(undefined)} width={640}>
        {detail?.bizType === 'contract_change' && <BusinessChangeEvidence value={detail.formData.businessSnapshot} />}
        <Descriptions
          bordered
          column={1}
          items={Object.entries(detail?.formData ?? {})
            .filter(
              ([k]) => k !== 'flowSnapshot' && !(detail?.bizType === 'contract_change' && k === 'businessSnapshot'),
            )
            .map(([k, v]) => ({ key: k, label: k, children: typeof v === 'object' ? JSON.stringify(v) : String(v) }))}
        />
        <Card title="流程版本快照" style={{ marginTop: 20 }}>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail?.formData?.flowSnapshot, null, 2)}</pre>
        </Card>
      </Drawer>
    </div>
  );
}
