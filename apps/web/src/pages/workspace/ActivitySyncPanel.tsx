import Table from '../../components/BusinessTable';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Modal, Space, Switch, Tag, Typography, message } from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
interface CalendarPayload {
  title: string;
  description: string;
  start: string;
  end: string;
  freeBusy: string;
}
interface Payload {
  marker: string;
  calendar?: CalendarPayload;
  todo?: { title: string; done: boolean };
}
interface Job {
  id: string;
  kind: string;
  sourceId: number;
  sourceVersion: string;
  payload: Payload;
  operation: string;
  status: string;
  error: string | null;
  evidence?: { conflict?: boolean; canOverwrite?: boolean };
  externalId: string | null;
  updatedAt: string;
  createdAt: string;
}
interface Setting {
  id: string;
  calendarEnabled: boolean;
  todoEnabled: boolean;
  autoEnabled: boolean;
  updatedAt: string;
  lastScannedAt: string | null;
  lastError: string | null;
}
interface State {
  bound: boolean;
  bindingHash: string | null;
  owner: { id: number; name: string; username: string };
  setting: Setting | null;
  jobs: Job[];
  links: { id: number; kind: string; sourceId: number; externalId: string; updatedAt: string }[];
  calendarAllowed: boolean;
  todoAllowed: boolean;
}
interface Preview {
  kind: string;
  sourceId: number;
  sourceVersion: string;
  payload: Payload;
  operation: string;
  externalId: string | null;
}
const root = '/integrations/dingtalk-activities';
const statusText: Record<string, string> = {
  prepared: '待发送',
  dispatching: '发送中',
  sent: '已验证',
  uncertain: '结果不确定',
  rejected: '发送前被拒绝',
  cancelled: '已取消',
  stopped: '已停止（结果未核定）',
};
const operationText: Record<string, string> = {
  calendar_create: '新建日程',
  calendar_update: '更新日程',
  todo_create: '新建审批提醒',
  todo_state: '同步待办状态',
};
const title = (p: Payload) => p.calendar?.title || p.todo?.title || '';
export default function ActivitySyncPanel() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [calendarEnabled, setCalendar] = useState(false),
    [todoEnabled, setTodo] = useState(false),
    [autoEnabled, setAuto] = useState(false);
  const [preview, setPreview] = useState<Preview[]>([]),
    [selected, setSelected] = useState<React.Key[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false),
    [historyPages, setHistoryPages] = useState<{ items: Job[]; nextCursor: string | null }[]>([]),
    [historyIndex, setHistoryIndex] = useState(0);
  const [reconcile, setReconcile] = useState<Job | null>(null),
    [externalId, setExternalId] = useState('');
  const reload = useCallback(async (reset = false) => {
    const value = await get<State>(root);
    setState(value);
    if (reset) {
      setCalendar(value.setting?.calendarEnabled ?? false);
      setTodo(value.setting?.todoEnabled ?? false);
      setAuto(value.setting?.autoEnabled ?? false);
    }
    return value;
  }, []);
  useEffect(() => {
    reload(true).catch((e) => setError(errorText(e)));
  }, [reload]);
  const polling = !!state?.setting?.autoEnabled || !!state?.jobs.some((j) => j.status === 'dispatching');
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      reload().catch((e) => setError(errorText(e)));
    }, 5000);
    return () => clearInterval(timer);
  }, [polling, reload]);
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
      setError('');
    } catch (e) {
      const text = errorText(e);
      setError(text);
      message.error(text);
    } finally {
      setBusy('');
    }
  };
  const save = () =>
    Modal.confirm({
      title: autoEnabled ? '开启本人自动同步？' : '保存本人同步配置？',
      content:
        '日程内容和当前有效审批节点将按开关同步到本人钉钉。自动同步每60秒扫描，每轮最多派发本人一条任务。外部待办完成不会批准CRM业务。关闭开关停止后续派发，已发送记录保留。',
      okText: '确认保存',
      onOk: () =>
        run('save', async () => {
          await post(root + '/settings', {
            requestKey: key(),
            ...(state?.setting ? { expectedUpdatedAt: state.setting.updatedAt } : {}),
            calendarEnabled,
            todoEnabled,
            autoEnabled,
          });
          setPreview([]);
          setSelected([]);
          await reload(true);
          message.success('同步配置已保存');
        }),
    });
  const scan = () =>
    run('scan', async () => {
      setPreview([]);
      setSelected([]);
      const result = await get<{ items: Preview[] }>(root + '/preview');
      setPreview(result.items);
      if (!result.items.length) message.info('当前没有待同步变化');
    });
  const prepare = () =>
    run('prepare', async () => {
      const rows = preview
        .filter((p) => selected.includes(p.kind + ':' + p.sourceId))
        .map(({ kind, sourceId, sourceVersion }) => ({ kind, sourceId, sourceVersion }));
      await post(root + '/prepare', { requestKey: key(), rows });
      setPreview([]);
      setSelected([]);
      await reload();
      message.success('已加入持久发送队列');
    });
  const dispatch = (job: Job, forceOverwrite = false) =>
    Modal.confirm({
      title: forceOverwrite ? '核对后以CRM内容覆盖钉钉改动？' : '发送这条记录到本人钉钉？',
      content: title(job.payload),
      okText: '确认发送',
      onOk: () =>
        run(job.id, async () => {
          await post(`${root}/jobs/${job.id}/dispatch`, {
            requestKey: key(),
            expectedUpdatedAt: job.updatedAt,
            ...(forceOverwrite ? { forceOverwrite: true } : {}),
          });
          await reload();
          message.success('已受理，正在发送及核验');
        }),
    });
  const cancel = (job: Job) =>
    run(job.id, async () => {
      await post(`${root}/jobs/${job.id}/cancel`, { requestKey: key(), expectedUpdatedAt: job.updatedAt });
      await reload();
    });
  const control = (job: Job, resume: boolean) =>
    Modal.confirm({
      title: resume ? '恢复本条的只读核对？' : '停止此来源同步？',
      content: resume
        ? '只恢复核对，不会重新创建外部记录。'
        : '外部结果仍未核定。停止后，此来源不会自动重发或重新创建，业务资料与证据保留；以后可恢复只读核对。',
      onOk: () =>
        run(job.id, async () => {
          await post(`${root}/jobs/${job.id}/${resume ? 'resume' : 'stop'}`, {
            requestKey: key(),
            expectedUpdatedAt: job.updatedAt,
          });
          setHistoryOpen(false);
          await reload();
        }),
    });
  const archive = (link: State['links'][number]) =>
    Modal.confirm({
      title: '归档已结束的同步对应？',
      content:
        '停止追踪已结束来源，保留CRM证据和钉钉记录。仅已取消/结束超过7天的日程、或已处理的审批提醒可以归档；有未完成发送时拒绝操作。',
      onOk: () =>
        run('archive', async () => {
          await post(`${root}/links/${link.id}/archive`, { requestKey: key(), expectedUpdatedAt: link.updatedAt });
          await reload();
          message.success('对应已归档，外部记录保留');
        }),
    });
  const loadHistory = (cursor?: string) =>
    run('history', async () => {
      const page = await get<{ items: Job[]; nextCursor: string | null }>(
        root + '/history',
        cursor ? { before: cursor } : {},
      );
      if (cursor) {
        setHistoryPages((p) => [...p.slice(0, historyIndex + 1), page]);
        setHistoryIndex((i) => i + 1);
      } else {
        setHistoryPages([page]);
        setHistoryIndex(0);
      }
      setHistoryOpen(true);
    });
  const confirmReconcile = () =>
    reconcile &&
    run('reconcile', async () => {
      await post(`${root}/jobs/${reconcile.id}/reconcile`, {
        requestKey: key(),
        expectedUpdatedAt: reconcile.updatedAt,
        ...(externalId ? { externalId } : {}),
      });
      setReconcile(null);
      await reload();
      message.success('远端状态与快照一致，已完成对账');
    });
  if (!state) return error ? <Alert type="error" message={error} /> : <Card loading />;
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type={state.bound ? 'info' : 'warning'}
        showIcon
        message={state.bound ? '本人钉钉授权及CRM人员对应已配置' : '本人尚未连接钉钉'}
        description="只操作授权本人的主日历及本人审批提醒。其他人员需用自己的账号授权并建立唯一对应，系统不会借用管理员账号替代。"
      />
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="本人同步配置"
        extra={
          <Button
            onClick={() =>
              run('reload', async () => {
                await reload(true);
              })
            }
            loading={busy === 'reload'}
          >
            刷新状态
          </Button>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="CRM人员">
            {state.owner.name}（{state.owner.username}）
          </Descriptions.Item>
          <Descriptions.Item label="授权状态">
            <Tag color={state.bound ? 'blue' : 'default'}>{state.bound ? '已对应本人' : '未对应'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="最近自动扫描">
            {state.setting?.lastScannedAt
              ? new Date(state.setting.lastScannedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              : '尚无扫描'}
          </Descriptions.Item>
        </Descriptions>
        {state.setting?.lastError && (
          <Alert type="warning" message={state.setting.lastError} style={{ margin: '12px 0' }} />
        )}
        <Space wrap size={24} style={{ margin: '16px 0' }}>
          <label>
            日程同步{' '}
            <Switch
              aria-label="日程同步"
              checked={calendarEnabled}
              disabled={!state.bound || (!state.calendarAllowed && !calendarEnabled)}
              onChange={setCalendar}
            />
          </label>
          <label>
            审批提醒{' '}
            <Switch
              aria-label="审批提醒同步"
              checked={todoEnabled}
              disabled={!state.bound || (!state.todoAllowed && !todoEnabled)}
              onChange={setTodo}
            />
          </label>
          <label>
            每60秒自动同步{' '}
            <Switch aria-label="自动同步" checked={autoEnabled} disabled={!state.bound} onChange={setAuto} />
          </label>
          <Button type="primary" disabled={!state.bound} loading={busy === 'save'} onClick={save}>
            保存同步配置
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          自动同步默认关闭。日程取消会在原钉钉记录标注“已取消”并改为空闲，不直接删除；审批转审、撤回或结束后关闭旧提醒。新增日程只扫描过去7天至未来93天，已建立对应的对象继续追踪变化。
        </Typography.Paragraph>
      </Card>
      <Card
        title="预览待同步变化"
        extra={
          <Space wrap>
            <Button onClick={scan} disabled={!state.bound || !state.setting} loading={busy === 'scan'}>
              扫描变化
            </Button>
            <Button
              type="primary"
              disabled={!selected.length || selected.length > 50}
              loading={busy === 'prepare'}
              onClick={prepare}
            >
              加入发送队列（{selected.length}）
            </Button>
          </Space>
        }
      >
        <Table<Preview>
          size="small"
          rowKey={(p) => p.kind + ':' + p.sourceId}
          dataSource={preview}
          scroll={{ x: 720 }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '对象', dataIndex: 'kind', width: 90, render: (v) => (v === 'calendar' ? '日程' : '审批节点') },
            { title: '操作', dataIndex: 'operation', width: 110, render: (v) => operationText[v] || v },
            {
              title: '发送主题',
              render: (_, p) => (
                <Typography.Text style={{ wordBreak: 'break-all' }}>{title(p.payload)}</Typography.Text>
              ),
            },
            {
              title: '目标状态',
              width: 110,
              render: (_, p) =>
                p.payload.todo
                  ? p.payload.todo.done
                    ? '关闭旧提醒'
                    : '待处理'
                  : p.payload.calendar?.freeBusy === 'free'
                    ? '空闲'
                    : '忙碌',
            },
          ]}
          expandable={{
            expandedRowRender: (p) => (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {p.payload.calendar
                  ? `${p.payload.calendar.start} — ${p.payload.calendar.end}\n${p.payload.calendar.description}`
                  : '仅同步审批编号和节点名称；处理决定请回CRM审批中心。'}
              </pre>
            ),
          }}
        />
      </Card>
      <Card
        title="发送记录与失败对账（最近100条，待处理优先）"
        extra={
          <Button onClick={() => loadHistory()} loading={busy === 'history'}>
            全部发送历史
          </Button>
        }
      >
        <Alert
          type="info"
          message="结果不确定时先核对远端稳定编号与完整快照；禁止重新创建。已知远端编号不能替换。"
          style={{ marginBottom: 12 }}
        />
        <Table<Job>
          size="small"
          rowKey="id"
          dataSource={state.jobs}
          scroll={{ x: 940 }}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '创建时间',
              width: 150,
              render: (_, j) => new Date(j.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            },
            {
              title: '主题',
              render: (_, j) => (
                <Typography.Text style={{ wordBreak: 'break-all' }}>{title(j.payload)}</Typography.Text>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (v) => (
                <Tag
                  color={
                    v === 'sent' ? 'green' : v === 'uncertain' ? 'orange' : v === 'dispatching' ? 'blue' : 'default'
                  }
                >
                  {statusText[v] || v}
                </Tag>
              ),
            },
            {
              title: '操作',
              width: 200,
              render: (_, j) => (
                <Space wrap>
                  {j.status === 'prepared' && (
                    <Button size="small" loading={busy === j.id} onClick={() => dispatch(j)}>
                      发送并核验
                    </Button>
                  )}
                  {['prepared', 'rejected'].includes(j.status) && (
                    <Button size="small" onClick={() => cancel(j)}>
                      取消
                    </Button>
                  )}
                  {j.status === 'rejected' && j.evidence?.canOverwrite && (
                    <Button size="small" onClick={() => dispatch(j, true)}>
                      以CRM为准覆盖
                    </Button>
                  )}
                  {['uncertain', 'rejected'].includes(j.status) && (
                    <Button size="small" onClick={() => control(j, false)}>
                      停止本条同步
                    </Button>
                  )}
                  {j.status === 'stopped' && (
                    <Button size="small" onClick={() => control(j, true)}>
                      恢复只读核对
                    </Button>
                  )}
                  {j.status === 'uncertain' && (
                    <Button
                      size="small"
                      onClick={() => {
                        setReconcile(j);
                        setExternalId(j.externalId || '');
                      }}
                    >
                      只读对账
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          expandable={{
            expandedRowRender: (j) => (
              <Space direction="vertical">
                <Typography.Text type={j.error ? 'danger' : 'secondary'}>
                  {j.error || '已保留来源版本、发送快照及结果证据'}
                </Typography.Text>
                <Typography.Text copyable={!!j.externalId}>
                  远端编号：{j.externalId || '尚未知晓；请按主题中的唯一CRM标记在本人钉钉核对'}
                </Typography.Text>
                <Typography.Text>
                  CRM来源：{j.kind === 'calendar' ? '日程' : '审批节点'} #{j.sourceId}
                </Typography.Text>
              </Space>
            ),
          }}
        />
      </Card>
      <Card title="当前同步对应（前100条）">
        <Table
          size="small"
          rowKey="id"
          dataSource={state.links}
          scroll={{ x: 650 }}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: '对象', dataIndex: 'kind', render: (v) => (v === 'calendar' ? '日程' : '审批节点') },
            { title: 'CRM编号', dataIndex: 'sourceId' },
            {
              title: '钉钉编号',
              dataIndex: 'externalId',
              render: (v) => <Typography.Text copyable>{v}</Typography.Text>,
            },
            {
              title: '操作',
              render: (_, link) => (
                <Button size="small" onClick={() => archive(link)}>
                  归档已结束对应
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title="全部发送历史（按创建时间分页）"
        width={1000}
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={
          <Space>
            <Button disabled={historyIndex === 0} onClick={() => setHistoryIndex((i) => i - 1)}>
              上一页
            </Button>
            <Button
              loading={busy === 'history'}
              disabled={!historyPages[historyIndex]?.nextCursor}
              onClick={() => loadHistory(historyPages[historyIndex]?.nextCursor || undefined)}
            >
              下一页
            </Button>
          </Space>
        }
      >
        <Table<Job>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={historyPages[historyIndex]?.items || []}
          scroll={{ x: 700, y: '60vh' }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              render: (v) => new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            },
            { title: '主题', render: (_, j) => title(j.payload) },
            { title: '状态', dataIndex: 'status', render: (v) => statusText[v] || v },
            { title: '钉钉记录编号', dataIndex: 'externalId' },
            {
              title: '操作',
              render: (_, j) =>
                j.status === 'stopped' ? (
                  <Button size="small" onClick={() => control(j, true)}>
                    恢复只读核对
                  </Button>
                ) : null,
            },
          ]}
        />
      </Modal>
      <Modal
        title="结果不确定：仅回读核对，不重新发送"
        open={!!reconcile}
        onCancel={() => setReconcile(null)}
        onOk={confirmReconcile}
        okText="回读并核对"
        confirmLoading={busy === 'reconcile'}
      >
        <Typography.Paragraph>{reconcile && title(reconcile.payload)}</Typography.Paragraph>
        <Input
          aria-label="对账远端编号"
          placeholder="本次记录对应的钉钉稳定ID"
          value={externalId}
          disabled={!!reconcile?.externalId}
          onChange={(e) => setExternalId(e.target.value)}
        />
      </Modal>
    </Space>
  );
}
