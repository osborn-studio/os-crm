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
  Timeline,
  message,
} from 'antd';
import { get, post, key, errorText, statusNames, type RecordRow } from '../../services/workspace';
import { ChangeComparison } from '../workspace/ContractChanges';
import { useAuthStore } from '../../stores/useAuthStore';
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
  nodes?: {
    id: number;
    nodeOrder: number;
    nodeName: string;
    action: string;
    comment: string;
    approverName: string;
    canTransfer: boolean;
  }[];
}
interface AuditEvent {
  id: number;
  actorName: string;
  action: string;
  note: string;
  createdAt: string;
  evidence: { fromName?: string; toName?: string; current?: boolean };
}
interface Page<T> {
  items: T[];
  nextCursor: number | null;
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
  const isAdmin = useAuthStore((s) => s.user?.roles.includes('super_admin'));
  const [pending, setPending] = useState<Pending[]>([]),
    [initiated, setInitiated] = useState<Approval[]>([]),
    [flows, setFlows] = useState<Flow[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<Approval>();
  const [history, setHistory] = useState<Page<Approval>>({ items: [], nextCursor: null });
  const [events, setEvents] = useState<Page<AuditEvent>>({ items: [], nextCursor: null });
  const [transfer, setTransfer] = useState<{ approval: Approval; nodeId: number; requestKey: string }>();
  const [people, setPeople] = useState<Page<{ id: number; name: string }>>({ items: [], nextCursor: null });
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferForm] = Form.useForm();
  const showDetail = async (approval: Approval) => {
    try {
      const [row, audit] = await Promise.all([
        get<Approval>(`/approvals/${approval.id}`),
        get<Page<AuditEvent>>(`/approvals/${approval.id}/events`),
      ]);
      setDetail(row);
      setEvents(audit);
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const startTransfer = async (approval: Approval, nodeId: number) => {
    try {
      const [fresh, candidates] = await Promise.all([
        get<Approval>(`/approvals/${approval.id}`),
        get<Page<{ id: number; name: string }>>(`/approvals/${approval.id}/nodes/${nodeId}/transfer-people`),
      ]);
      setPeople(candidates);
      transferForm.resetFields();
      setTransfer({ approval: fresh, nodeId, requestKey: key() });
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const submitTransfer = async () => {
    if (!transfer) return;
    try {
      const values = await transferForm.validateFields();
      setTransferBusy(true);
      await post(`/approvals/${transfer.approval.id}/nodes/${transfer.nodeId}/transfer`, {
        ...values,
        requestKey: transfer.requestKey,
        expectedUpdatedAt: transfer.approval.updatedAt,
      });
      message.success('转审已保存，原节点和原因保留');
      setTransfer(undefined);
      await load();
      await showDetail(transfer.approval);
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setTransferBusy(false);
    }
  };
  const [form] = Form.useForm();
  const selected = Form.useWatch('flowId', form);
  const flow = flows.find((f) => f.id === selected);
  const load = async () => {
    try {
      const [p, i, f, h] = await Promise.all([
        get<Pending[]>('/approvals/pending'),
        get<{ items: Approval[] }>('/approvals/my-initiated'),
        get<Flow[]>('/approvals/flows'),
        get<Page<Approval>>('/approvals/history'),
      ]);
      setPending(p);
      setInitiated(i.items);
      setFlows(f.filter((v) => !['contract', 'contract_change', 'order', 'project_initiation'].includes(v.bizType)));
      setHistory(h);
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
      title: reject ? '驳回申请' : '提交同意意见',
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
          const result = await post<{ status: string; waitingForCountersign: boolean }>(
            `/approvals/${p.approval.id}/nodes/${p.nodeId}/${reject ? 'reject' : 'approve'}`,
            {
              requestKey: key(),
              comment: comment || (reject ? '' : '同意'),
            },
          );
          message.success(
            reject
              ? '申请已驳回'
              : result.waitingForCountersign
                ? '意见已保存，等待同组其他成员'
                : result.status === 'approved'
                  ? '申请已通过'
                  : '本步已完成，等待下一步',
          );
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
                        <a onClick={() => void showDetail(p.approval)}>{p.approval.title}</a>
                        <div style={{ marginTop: 8, color: '#64748b' }}>
                          {p.approval.approvalNo} · {p.nodeName}
                        </div>
                      </div>
                      <Space>
                        <Button onClick={() => void showDetail(p.approval)}>查看申请</Button>
                        <Button onClick={() => void startTransfer(p.approval, p.nodeId)}>转审</Button>
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
                        <a onClick={() => void showDetail(a)}>{a.title}</a>
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
                          description: n.action === 'transferred' ? `已转审：${n.comment}` : n.comment,
                          status: n.action === 'approved' ? 'finish' : n.action === 'rejected' ? 'error' : 'wait',
                        }))}
                      />
                    )}
                  </Card>
                )}
              />
            ),
          },
          {
            key: 'history',
            label: isAdmin ? '企业审批与交接' : '我参与的审批',
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  message={
                    isAdmin
                      ? '管理员可转交当前或后续待审节点，不能代替审批通过。先交接完待审节点，再办理账号停用或调岗。'
                      : '包含曾经转出的节点，方便回看处理历史；只能转交当前轮到自己处理的节点。'
                  }
                  style={{ marginBottom: 16 }}
                />
                <List
                  dataSource={history.items}
                  renderItem={(a) => (
                    <List.Item>
                      <a onClick={() => void showDetail(a)}>{a.title}</a>
                      <Space>
                        <Typography.Text type="secondary">{a.approvalNo}</Typography.Text>
                        <Tag>{statusNames[a.status] ?? a.status}</Tag>
                      </Space>
                    </List.Item>
                  )}
                />
                {history.nextCursor && (
                  <Button
                    onClick={async () => {
                      try {
                        const more = await get<Page<Approval>>(`/approvals/history?after=${history.nextCursor}`);
                        setHistory({ items: [...history.items, ...more.items], nextCursor: more.nextCursor });
                      } catch (e) {
                        message.error(errorText(e));
                      }
                    }}
                  >
                    加载更多审批
                  </Button>
                )}
              </>
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
      <Modal
        title="转审 / 管理员恢复流转"
        open={!!transfer}
        onCancel={() => !transferBusy && setTransfer(undefined)}
        onOk={() => void submitTransfer()}
        confirmLoading={transferBusy}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="转交不会通过审批。原节点、已处理意见和流程快照保留；接收人必须具备审批权限，且不能是申请人。"
          style={{ marginBottom: 16 }}
        />
        <Form form={transferForm} layout="vertical">
          <Form.Item label="接收审批人" name="targetUserId" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={people.items.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          {people.nextCursor && (
            <Button
              onClick={async () => {
                if (!transfer) return;
                try {
                  const more = await get<Page<{ id: number; name: string }>>(
                    `/approvals/${transfer.approval.id}/nodes/${transfer.nodeId}/transfer-people?after=${people.nextCursor}`,
                  );
                  setPeople({ items: [...people.items, ...more.items], nextCursor: more.nextCursor });
                } catch (e) {
                  message.error(errorText(e));
                }
              }}
            >
              加载更多候选人员
            </Button>
          )}
          <Form.Item label="转审原因" name="reason" rules={[{ required: true, whitespace: true, max: 1000 }]}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer title={detail?.title} open={!!detail} onClose={() => setDetail(undefined)} width={640}>
        {detail?.nodes?.some(
          (n) =>
            n.action !== 'transferred' &&
            detail.nodes!.filter((v) => v.nodeOrder === n.nodeOrder && v.action !== 'transferred').length > 1,
        ) && (
          <Alert
            type="info"
            showIcon
            message="会签：同一步内全部人员同意后才能流转；任一驳回会结束申请。转审不会代替审批意见。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Card title="节点与交接" style={{ marginBottom: 20 }}>
          <List
            dataSource={detail?.nodes}
            renderItem={(n) => (
              <List.Item
                actions={
                  n.canTransfer
                    ? [
                        <Button key="transfer" onClick={() => detail && void startTransfer(detail, n.id)}>
                          转审
                        </Button>,
                      ]
                    : []
                }
              >
                <List.Item.Meta
                  title={`第${n.nodeOrder}步 · ${n.nodeName} · ${n.approverName}`}
                  description={`${({ transferred: '已转交', pending: '待处理', approved: '已通过', rejected: '已驳回' } as Record<string, string>)[n.action] ?? n.action}${n.comment ? ' · ' + n.comment : ''}`}
                />
              </List.Item>
            )}
          />
        </Card>
        <Card title="处理与转审历史" style={{ marginBottom: 20 }}>
          {!events.items.length && (
            <Typography.Text type="secondary">暂无新审计事件；旧审批的处理记录请查看节点，不补造历史。</Typography.Text>
          )}
          <Timeline
            items={events.items.map((e) => ({
              children: (
                <>
                  <Typography.Text strong>
                    {e.actorName} ·{' '}
                    {(
                      {
                        created: '提交',
                        approved: '通过',
                        rejected: '驳回',
                        withdrawn: '撤回',
                        transferred: '转审',
                      } as Record<string, string>
                    )[e.action] ?? e.action}
                  </Typography.Text>
                  <div>
                    {e.evidence.fromName &&
                      `${e.evidence.fromName} → ${e.evidence.toName} · ${e.evidence.current ? '当前节点' : '后续节点'}`}
                  </div>
                  <div>{e.note}</div>
                  <Typography.Text type="secondary">{new Date(e.createdAt).toLocaleString()}</Typography.Text>
                </>
              ),
            }))}
          />
          {events.nextCursor && (
            <Button
              onClick={async () => {
                if (!detail) return;
                try {
                  const more = await get<Page<AuditEvent>>(`/approvals/${detail.id}/events?after=${events.nextCursor}`);
                  setEvents({ items: [...events.items, ...more.items], nextCursor: more.nextCursor });
                } catch (e) {
                  message.error(errorText(e));
                }
              }}
            >
              加载更早历史
            </Button>
          )}
        </Card>
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
