import Table from '../../components/BusinessTable';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Policy {
  enabled: boolean;
  processCode: string;
  departmentId: number;
  flowId: number;
  fromDate: string;
  autoPoll: boolean;
}
interface Run {
  id: string;
  kind: string;
  status: string;
  summary: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
}
interface State {
  policy: Policy | null;
  updatedAt: string | null;
  bound: boolean;
  pending: { id: number; title: string; updatedAt: string }[];
  flows: { id: number; name: string }[];
  runs: Run[];
  synchronization?: {
    workerEnabled: boolean;
    pollIntervalSeconds: number;
    retryLimit: number;
    scope: string;
    pending: number;
    blocked: number;
    lastSuccessfulReadAt: string | null;
  };
}
interface Preview {
  runId: string;
  digest: string;
  expiresAt: string;
  formValues: Record<string, string>;
  people: { id: string; name: string }[];
  mode: string;
  departmentId: number;
}
const root = '/integrations/dingtalk-native-approval';
const statusName: Record<string, string> = {
  prepared: '已预演，未发送',
  sending: '发送中，禁止重复',
  uncertain: '结果不明，须核查',
  sent: '已发送，等待实际审批',
  completed: '已回写',
  cancelled: '钉钉已撤销，可本地撤回',
  blocked: '已暂停，须核查',
};
export default function NativeApprovalPanel() {
  const isAdmin = useAuthStore((s) => s.user?.roles.includes('super_admin'));
  const [data, setData] = useState<State>(),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState<number>(),
    [preview, setPreview] = useState<Preview>(),
    [form] = Form.useForm<Omit<Policy, 'fromDate'> & { fromDate: Dayjs }>();
  async function load(updateForm = false) {
    const r = await get<State>(root);
    setData(r);
    if (updateForm)
      form.setFieldsValue(
        r.policy
          ? { ...r.policy, fromDate: dayjs(r.policy.fromDate) }
          : { enabled: false, autoPoll: true, fromDate: dayjs() },
      );
    return r;
  }
  useEffect(() => {
    void load(true).catch((e) => message.error(errorText(e)));
    let active = true;
    const timer = setInterval(() => {
      void get<State>(root)
        .then((r) => {
          if (active) setData(r);
        })
        .catch(() => undefined);
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function execute(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      const r = await fn();
      message.success('操作已完成，请查看状态和回执');
      await load();
      return r;
    } catch (e) {
      message.error(errorText(e));
      return undefined;
    } finally {
      setBusy('');
    }
  }
  async function prepare() {
    const row = data?.pending.find((v) => v.id === selected);
    if (!row) return;
    const r = await execute('prepare', () =>
      post<Preview>(root + '/prepare', { requestKey: key(), approvalId: row.id, expectedUpdatedAt: row.updatedAt }),
    );
    if (r) setPreview(r as Preview);
  }
  async function send() {
    if (!preview) return;
    const r = await get<State>(root),
      run = r.runs.find((v) => v.id === preview.runId);
    if (!run) {
      message.error('预演记录已不可见，请重新预演');
      return;
    }
    const p = preview;
    Modal.confirm({
      title: '确认发送此合同到钉钉原生审批',
      width: 760,
      okText: '确认发送审批单',
      content: (
        <>
          <Typography.Paragraph>
            接收人：{p.people.map((v) => v.name).join('、')}
            ；任一同意即可通过。将向上述人员发送真实钉钉审批，不发群消息。
          </Typography.Paragraph>
          <Descriptions
            column={1}
            size="small"
            bordered
            items={Object.entries(p.formValues).map(([label, children]) => ({
              key: label,
              label,
              children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</span>,
            }))}
          />
        </>
      ),
      onOk: async () => {
        await execute('send', () =>
          post(root + `/runs/${p.runId}/dispatch`, {
            requestKey: key(),
            expectedUpdatedAt: run.updatedAt,
            digest: p.digest,
            confirm: true,
          }),
        );
        setPreview(undefined);
      },
    });
  }
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="手机直接在钉钉审批，CRM主动拉回结果"
        description="审批单内容和决定保存在钉钉；本机CRM只需出站HTTPS，不要求公开局域网网址或配置公网回调。当前逐单核对后发送，支持每60秒主动读取已发送单据结果。历史资料不补发，不启用群机器人。"
      />
      <Alert
        type={data?.bound ? 'success' : 'warning'}
        showIcon
        message={data?.bound ? '本人钉钉授权已绑定' : '本人尚未绑定可执行的钉钉授权'}
        description="现阶段仅支持本人授权、本人发起的单步或签合同；其他申请人需要各自本人授权及匹配人员的模板。个人待办完成不会代替审批决定。"
      />
      <Card title="审批同步运行状态（本人最近30条连接）">
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: 'worker',
              label: '后台同步',
              children:
                data?.synchronization?.workerEnabled && data.policy?.enabled && data.policy.autoPoll
                  ? '已开启，每60秒读取'
                  : '未开启自动读取',
            },
            {
              key: 'last',
              label: '最近成功读取',
              children: data?.synchronization?.lastSuccessfulReadAt
                ? dayjs(data.synchronization.lastSuccessfulReadAt).format('YYYY-MM-DD HH:mm:ss')
                : '暂无成功读取记录',
            },
            { key: 'pending', label: '等待或重试', children: data?.synchronization?.pending ?? 0 },
            { key: 'blocked', label: '需人工核查', children: data?.synchronization?.blocked ?? 0 },
          ]}
        />
        <Typography.Paragraph type="secondary">
          页面每15秒刷新状态，不覆盖正在编辑的连接设置。网络暂时故障按间隔自动重试，连续5次失败暂停；人员、金额、模板或本地版本不匹配立即暂停，不自动通过，也不重新发单。
        </Typography.Paragraph>
      </Card>
      {isAdmin && (
        <Card title="原生审批连接设置">
          <Form form={form} layout="vertical" style={{ maxWidth: 720 }}>
            <Form.Item name="enabled" label="启用钉钉原生审批连接" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="flowId" label="CRM已发布的合同或签流程" rules={[{ required: true }]}>
              <Select options={data?.flows.map((v) => ({ value: v.id, label: v.name }))} />
            </Form.Item>
            <Form.Item name="processCode" label="钉钉审批模板编码" rules={[{ required: true }]}>
              <Input placeholder="PROC-..." />
            </Form.Item>
            <Form.Item name="departmentId" label="本人所属发起部门编号" rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="fromDate" label="生效日期（此前及历史补录不外发）" rules={[{ required: true }]}>
              <DatePicker minDate={dayjs('2010-01-01')} maxDate={dayjs('2060-12-31')} />
            </Form.Item>
            <Form.Item name="autoPoll" label="每60秒主动读取已发送单据的审批结果" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Space wrap>
              <Button
                type="primary"
                loading={busy === 'save'}
                onClick={() =>
                  void execute('save', async () => {
                    const v = await form.validateFields();
                    return post(root + '/settings', {
                      requestKey: key(),
                      expectedUpdatedAt: data?.updatedAt,
                      data: { ...v, fromDate: v.fromDate.format('YYYY-MM-DD') },
                    });
                  })
                }
              >
                保存连接
              </Button>
              <Button
                loading={busy === 'probe'}
                disabled={!data?.policy}
                onClick={() => void execute('probe', () => post(root + '/probe', { requestKey: key() }))}
              >
                验证真实模板、人员和部门
              </Button>
              <Button href="/business-rules">商机提醒与自动送审规则</Button>
            </Space>
          </Form>
        </Card>
      )}
      <Card title="审批对照与发送">
        <Typography.Paragraph type="secondary">
          先在合同中通过通用流程发起审批，再选择本人待审批合同。每次预演会核对字段、金额、人员、模板和本地版本；有效10分钟。
        </Typography.Paragraph>
        <Space wrap>
          <Select
            style={{ minWidth: 280, maxWidth: '100%' }}
            placeholder="选择本人发起的待审批合同"
            value={selected}
            options={data?.pending.map((v) => ({ value: v.id, label: v.title }))}
            onChange={(v) => {
              setSelected(v);
              setPreview(undefined);
            }}
          />
          <Button
            disabled={!selected || !data?.policy?.enabled || !data?.bound}
            loading={busy === 'prepare'}
            onClick={() => void prepare()}
          >
            读取钉钉流程并预演
          </Button>
          <Button onClick={() => void execute('refresh', () => load())}>刷新状态</Button>
        </Space>
        {preview && (
          <div style={{ marginTop: 16 }}>
            <Alert
              type="warning"
              message={`预演尚未发送：${preview.people.map((v) => v.name).join('、')}，任一同意。有效至${dayjs(preview.expiresAt).format('HH:mm:ss')}`}
            />
            <Descriptions
              column={1}
              bordered
              size="small"
              style={{ margin: '16px 0' }}
              items={Object.entries(preview.formValues).map(([label, children]) => ({
                key: label,
                label,
                children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</span>,
              }))}
            />
            <Button type="primary" loading={busy === 'send'} onClick={() => void send()}>
              核对并确认发送
            </Button>
          </div>
        )}
      </Card>
      <Card title="真实连接、外发与回写记录">
        <Table<Run>
          rowKey="id"
          size="small"
          dataSource={data?.runs ?? []}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 760 }}
          columns={[
            { title: '类型', dataIndex: 'kind', render: (v) => (v === 'probe' ? '连接验证' : '合同审批') },
            {
              title: '状态',
              dataIndex: 'status',
              render: (v, r) => (
                <Tag color={v === 'completed' ? 'green' : v === 'blocked' || v === 'uncertain' ? 'orange' : 'blue'}>
                  {r.kind === 'probe' && v === 'completed' ? '验证通过' : (statusName[String(v)] ?? String(v))}
                </Tag>
              ),
            },
            {
              title: '对应审批/说明',
              render: (_, r) => (
                <div>
                  {r.summary?.approvalId
                    ? `本地审批 #${String(r.summary.approvalId)}`
                    : String(r.summary?.templateName ?? '')}
                  <br />
                  {String(r.summary?.externalId ?? '')}
                  <br />
                  {String(r.summary?.error ?? '')}
                  <br />
                  {r.summary?.remoteStatus
                    ? `钉钉结果：${({ pending: '等待审批', approved: '已同意', rejected: '已驳回', cancelled: '已撤销' } as Record<string, string>)[String(r.summary.remoteStatus)] ?? String(r.summary.remoteStatus)}`
                    : ''}
                  {r.summary?.nextRetryAt ? (
                    <div>
                      下次重试：{dayjs(String(r.summary.nextRetryAt)).format('MM-DD HH:mm:ss')}（连续失败
                      {String(r.summary.retryCount)}次）
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: '最近更新',
              dataIndex: 'updatedAt',
              render: (v) => dayjs(String(v)).format('YYYY-MM-DD HH:mm:ss'),
            },
            {
              title: '操作',
              render: (_, r) =>
                r.status === 'uncertain' || (r.status === 'blocked' && r.summary?.readbackVerified !== true) ? (
                  <Button
                    size="small"
                    loading={busy === r.id}
                    onClick={() =>
                      void execute(r.id, () =>
                        post(root + `/runs/${r.id}/recover`, { requestKey: key(), expectedUpdatedAt: r.updatedAt }),
                      )
                    }
                  >
                    只读查找并核回
                  </Button>
                ) : ['sent', 'blocked'].includes(r.status) ? (
                  <Button
                    size="small"
                    loading={busy === r.id}
                    onClick={() =>
                      void execute(r.id, () => post(root + `/runs/${r.id}/reconcile`, { requestKey: key() }))
                    }
                  >
                    读取钉钉结果
                  </Button>
                ) : null,
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          发送不确定时禁止重发；可只读查询本人已发起记录，按认领时间与完整指纹唯一核回，不创建第二张单。模板、审批人或单据变化会暂停回写；只有经核验的实际人工决定才进入CRM通用审批及业务回调。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
