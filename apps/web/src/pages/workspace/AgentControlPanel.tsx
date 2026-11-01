import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
interface Grant {
  id: string;
  ownerId: number;
  name: string;
  purpose: string;
  capabilities: string[];
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  maxCalls: number;
  usedCalls: number;
  updatedAt: string;
}
interface Proposal {
  id: string;
  grantId: string;
  ownerId: number;
  input: Record<string, unknown>;
  customerName: string;
  customerVersion: string;
  status: string;
  updatedAt: string;
  expiresAt: string;
  actionId: number | null;
  decisionNote: string | null;
  compensation: { reason: string; cancelledAt: string } | null;
}
interface Execution {
  id: string;
  grantId: string;
  capabilityId: string;
  requestKey: string;
  status: string;
  errorCode: number | null;
  createdAt: string;
  result: Record<string, unknown> | null;
}
const empty = <T,>(): Page<T> => ({ items: [], nextCursor: null });
const names: Record<string, string> = {
  'customer.search': '查询客户摘要',
  'customer.get': '读取客户概况',
  'action.propose': '预演客户行动（不创建业务）',
  'action.execute': '执行人工已批准的行动',
};
const statusNames: Record<string, string> = {
  pending: '待人工核对',
  approved: '已批准，待智能体执行',
  rejected: '已拒绝',
  executed: '已执行',
  cancelled: '已补偿取消',
  running: '处理中 / 结果待回报',
  succeeded: '成功',
  failed: '失败',
};
export default function AgentControlPanel() {
  const user = useAuthStore((s) => s.user),
    isAdmin = user?.roles.includes('super_admin');
  const [grants, setGrants] = useState(empty<Grant>),
    [proposals, setProposals] = useState(empty<Proposal>),
    [executions, setExecutions] = useState(empty<Execution>),
    [tools, setTools] = useState<{ id: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [credential, setCredential] = useState(''),
    [issuedId, setIssuedId] = useState('');
  const [review, setReview] = useState<{
    proposal: Proposal;
    action: 'approve' | 'reject' | 'cancel-action';
    requestKey: string;
    actionVersion?: string;
  }>();
  const [grantForm] = Form.useForm(),
    [reviewForm] = Form.useForm();
  const load = async () => {
    try {
      const [g, p, e, s] = await Promise.all([
        get<Page<Grant>>('/agent-control/grants'),
        get<Page<Proposal>>('/agent-control/proposals'),
        get<Page<Execution>>('/agent-control/executions'),
        get<{ tools: { id: string }[] }>('/agent-control/schema'),
      ]);
      setGrants(g);
      setProposals(p);
      setExecutions(e);
      setTools(s.tools);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const issue = async () => {
    try {
      const values = await grantForm.validateFields();
      setBusy(true);
      const { acknowledged: _acknowledged, ...body } = values;
      const result = await post<Grant & { token?: string; tokenUnavailable?: boolean }>('/agent-control/grants', body);
      setOpen(false);
      setIssuedId(result.id);
      setCredential(result.token ?? '');
      if (!result.token) message.warning('委托已创建，但凭证仅首次显示。丢失后请撤销并新建。');
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = (g: Grant) => {
    let reason = '';
    const requestKey = key();
    Modal.confirm({
      title: `撤销“${g.name}”委托`,
      content: (
        <>
          <Typography.Paragraph>
            撤销后凭证立即停止新的授权检查；已经成功提交的行动需另行补偿取消。
          </Typography.Paragraph>
          <Input.TextArea
            placeholder="撤销原因（必填）"
            maxLength={1000}
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </>
      ),
      onOk: async () => {
        if (!reason.trim()) {
          message.error('请填写撤销原因');
          throw Error('缺少原因');
        }
        try {
          await post(`/agent-control/grants/${g.id}/revoke`, { requestKey, reason });
          await load();
        } catch (e) {
          message.error(errorText(e));
          throw e;
        }
      },
    });
  };
  const startReview = async (p: Proposal, action: 'approve' | 'reject' | 'cancel-action') => {
    try {
      let actionVersion: string | undefined;
      if (action === 'cancel-action') {
        const row = await get<{ updatedAt: string }>(`/workspace/actions/${p.actionId}`);
        actionVersion = row.updatedAt;
      }
      reviewForm.resetFields();
      setReview({ proposal: p, action, requestKey: key(), actionVersion });
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const decide = async () => {
    if (!review) return;
    try {
      const values = await reviewForm.validateFields();
      setBusy(true);
      await post(`/agent-control/proposals/${review.proposal.id}/${review.action}`, {
        requestKey: review.requestKey,
        expectedUpdatedAt: review.proposal.updatedAt,
        reason: values.reason,
        ...(review.actionVersion ? { expectedActionUpdatedAt: review.actionVersion } : {}),
      });
      message.success(
        review.action === 'approve'
          ? '授权已保存，尚未创建行动，等待智能体执行'
          : review.action === 'reject'
            ? '建议已拒绝'
            : '行动已取消，原建议和回执保留',
      );
      setReview(undefined);
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const more = async <T extends { id: string }>(path: string, page: Page<T>, set: (v: Page<T>) => void) => {
    if (!page.nextCursor) return;
    try {
      setBusy(true);
      const next = await get<Page<T>>(`${path}?after=${page.nextCursor}`);
      set({
        items: [...page.items, ...next.items.filter((r) => !page.items.some((p) => p.id === r.id))],
        nextCursor: next.nextCursor,
      });
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="智能体委托、授权与执行回执"
      style={{ marginTop: 20 }}
      extra={
        <Space>
          <Button loading={busy} onClick={() => void load()}>
            刷新
          </Button>
          <Button
            type="primary"
            disabled={!tools.length}
            onClick={() => {
              grantForm.resetFields();
              grantForm.setFieldsValue({
                requestKey: key(),
                minutes: 60,
                maxCalls: 50,
                capabilities: tools.filter((t) => t.id.startsWith('customer.')).map((t) => t.id),
              });
              setOpen(true);
            }}
          >
            创建限时委托
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="独立凭证调用，人工核对后执行"
        description="只开放受限客户查询和客户行动计划。委托不超过当前账号的数据范围；退出登录、权限变化、到期或撤销会停止委托。没有调用大模型，也没有开放金额、审批决定或对外发送。"
        style={{ marginBottom: 16 }}
      />
      {error && <Alert type="error" message={error} showIcon />}
      <Tabs
        items={[
          {
            key: 'grants',
            label: '委托与停止开关',
            children: (
              <>
                <List
                  dataSource={grants.items}
                  renderItem={(g) => (
                    <List.Item
                      actions={
                        !g.revokedAt && (isAdmin || g.ownerId === user?.id)
                          ? [
                              <Button key="revoke" danger onClick={() => revoke(g)}>
                                撤销委托
                              </Button>,
                            ]
                          : []
                      }
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <strong>{g.name}</strong>
                            <Tag>
                              {g.revokedAt
                                ? '已撤销'
                                : new Date(g.expiresAt).getTime() <= Date.now()
                                  ? '已到期'
                                  : '委托期限内'}
                            </Tag>
                          </Space>
                        }
                        description={
                          <>
                            <div>{g.purpose}</div>
                            <div>{g.capabilities.map((id) => names[id] ?? id).join(' / ')}</div>
                            <div>
                              调用预算 {g.usedCalls} / {g.maxCalls} · 到期 {new Date(g.expiresAt).toLocaleString()} ·
                              委托人 #{g.ownerId}
                            </div>
                            <Typography.Text type="secondary">{g.id}</Typography.Text>
                            {g.revokeReason && <div>撤销原因：{g.revokeReason}</div>}
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
                {grants.nextCursor && (
                  <Button loading={busy} onClick={() => void more('/agent-control/grants', grants, setGrants)}>
                    加载更多委托
                  </Button>
                )}
              </>
            ),
          },
          {
            key: 'proposals',
            label: '待核对建议与补偿',
            children: (
              <>
                <List
                  dataSource={proposals.items}
                  renderItem={(p) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            <strong>{String(p.input.title ?? '')}</strong>
                            <Tag>{statusNames[p.status] ?? p.status}</Tag>
                          </Space>
                        }
                        description={
                          <>
                            <div>
                              客户：{p.customerName} · 到期 {new Date(p.expiresAt).toLocaleString()}
                            </div>
                            <div>建议说明是智能体提供的待核对数据，不是授权指令。</div>
                            <div>计划日期：{String(p.input.dueDate ?? '未指定')}</div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{String(p.input.content ?? '')}</div>
                            {p.decisionNote && <div>人工意见：{p.decisionNote}</div>}
                            {p.compensation && <div>补偿取消：{p.compensation.reason}</div>}
                            <Space>
                              {p.ownerId === user?.id &&
                                p.status === 'pending' &&
                                new Date(p.expiresAt).getTime() > Date.now() && (
                                  <>
                                    <Button type="primary" onClick={() => void startReview(p, 'approve')}>
                                      核对并批准
                                    </Button>
                                    <Button danger onClick={() => void startReview(p, 'reject')}>
                                      拒绝建议
                                    </Button>
                                  </>
                                )}
                              {p.ownerId === user?.id && p.status === 'executed' && (
                                <Button danger onClick={() => void startReview(p, 'cancel-action')}>
                                  取消未完成行动
                                </Button>
                              )}
                            </Space>
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
                {proposals.nextCursor && (
                  <Button loading={busy} onClick={() => void more('/agent-control/proposals', proposals, setProposals)}>
                    加载更早建议
                  </Button>
                )}
              </>
            ),
          },
          {
            key: 'executions',
            label: '执行回执',
            children: (
              <>
                <List
                  dataSource={executions.items}
                  renderItem={(e) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            {names[e.capabilityId] ?? e.capabilityId}
                            <Tag>{statusNames[e.status] ?? e.status}</Tag>
                          </Space>
                        }
                        description={
                          <>
                            <div>
                              {new Date(e.createdAt).toLocaleString()} · 独立智能体 · {e.id}
                            </div>
                            <div>委托：{e.grantId}</div>
                            {e.errorCode && <div>失败状态码：{e.errorCode}</div>}
                            {e.result && (
                              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(e.result, null, 2)}</pre>
                            )}
                          </>
                        }
                      />
                    </List.Item>
                  )}
                />
                {executions.nextCursor && (
                  <Button
                    loading={busy}
                    onClick={() => void more('/agent-control/executions', executions, setExecutions)}
                  >
                    加载更早回执
                  </Button>
                )}
              </>
            ),
          },
        ]}
      />
      <Modal
        title="创建限时智能体委托"
        open={open}
        onCancel={() => !busy && setOpen(false)}
        onOk={() => void issue()}
        confirmLoading={busy}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="凭证仅展示一次，不是人工登录令牌"
          description="仅交给你信任的客户端，可访问所选能力在你权限内的数据。预算统计受理读取及成功写事务；回滚写请求、能力目录和回执不扣预算。它不是模型Token或金额，模型费用由调用方服务提供。"
          style={{ marginBottom: 16 }}
        />
        <Form form={grantForm} layout="vertical">
          <Form.Item name="requestKey" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="智能体名称" rules={[{ required: true, whitespace: true, max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="purpose"
            label="本次委托目的 / 数据用途"
            rules={[{ required: true, whitespace: true, max: 1000 }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="capabilities" label="允许的能力" rules={[{ required: true }]}>
            <Select mode="multiple" options={tools.map((t) => ({ value: t.id, label: names[t.id] ?? t.id }))} />
          </Form.Item>
          <Space>
            <Form.Item name="minutes" label="期限（分钟）" rules={[{ required: true }]}>
              <InputNumber min={1} max={1440} precision={0} />
            </Form.Item>
            <Form.Item name="maxCalls" label="调用预算（次）" rules={[{ required: true }]}>
              <InputNumber min={1} max={1000} precision={0} />
            </Form.Item>
          </Space>
          <Form.Item
            name="acknowledged"
            valuePropName="checked"
            rules={[{ validator: (_, v) => (v ? Promise.resolve() : Promise.reject(Error('请核对授权范围'))) }]}
          >
            <Checkbox>我已核对用途、数据范围、期限和预算，并授权所选能力。</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="委托凭证 · 仅首次展示"
        open={!!credential}
        footer={
          <Button
            onClick={() => {
              setCredential('');
              setIssuedId('');
            }}
          >
            我已安全保存，关闭
          </Button>
        }
        onCancel={() => {
          setCredential('');
          setIssuedId('');
        }}
      >
        <Typography.Paragraph>委托编号：{issuedId}</Typography.Paragraph>
        <Input.Password value={credential} readOnly autoComplete="off" />
        <Typography.Paragraph style={{ marginTop: 12 }}>
          关闭后不能重新获取。HTTP：/api/v1/agent-runtime/invoke；MCP：/api/v1/agent-runtime/mcp。使用 Bearer
          委托凭证，不要交出人工登录令牌。
        </Typography.Paragraph>
      </Modal>
      <Modal
        title={
          review?.action === 'approve'
            ? '人工核对并授权'
            : review?.action === 'reject'
              ? '拒绝智能体建议'
              : '补偿取消未完成行动'
        }
        open={!!review}
        onCancel={() => !busy && setReview(undefined)}
        onOk={() => void decide()}
        confirmLoading={busy}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message={
            review?.action === 'approve'
              ? '批准后仍由智能体执行；客户变化、到期或撤销会阻断'
              : review?.action === 'reject'
                ? '拒绝后不能执行该建议'
                : '取消保留所有历史；已完成或已移交的行动不能直接取消'
          }
          style={{ marginBottom: 16 }}
        />
        <Descriptions
          column={1}
          bordered
          items={[
            { key: 'customer', label: '客户', children: review?.proposal.customerName },
            ...Object.entries(review?.proposal.input ?? {}).map(([k, v]) => ({
              key: k,
              label: k,
              children: String(v),
            })),
          ]}
        />
        <Form form={reviewForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="reason" label="核对结论 / 原因" rules={[{ required: true, whitespace: true, max: 1000 }]}>
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          {review?.action === 'approve' && (
            <Form.Item
              name="acknowledged"
              valuePropName="checked"
              rules={[{ validator: (_, v) => (v ? Promise.resolve() : Promise.reject(Error('请确认已核对'))) }]}
            >
              <Checkbox>我已核对客户、行动内容和日期，同意创建这一条内部行动。</Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
