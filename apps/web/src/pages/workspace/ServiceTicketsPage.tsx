import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSearchParams } from 'react-router-dom';
type Event = { id: number; kind: string; note: string; actorName: string; createdAt: string; evidence: unknown };
type Ticket = {
  id: number;
  projectId: number;
  customerId: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigneeId: number | null;
  resolution: string | null;
  updatedAt: string;
  events?: Event[];
  allowedActions?: string[];
  nextEventCursor?: string | null;
};
type Page = { items: Ticket[]; nextCursor: string | null };
const statuses: Record<string, string> = {
  open: '待指派',
  assigned: '已指派',
  in_progress: '处理中',
  resolved: '待独立复核',
  closed: '已关闭',
  cancelled: '已取消',
};
const actions: Record<string, string> = {
  created: '提交问题',
  assign: '指派 / 转派',
  start: '开始处理',
  note: '追加处理记录',
  resolve: '提交解决方案',
  close: '独立复核关闭',
  reopen: '退回 / 重开',
  cancel: '取消工单',
};
export default function ServiceTicketsPage() {
  const [search] = useSearchParams();
  const linkedId = search.get('ticketId');
  const user = useAuthStore((s) => s.user);
  const canWrite = !!user?.roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r));
  const [rows, setRows] = useState<Ticket[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null),
    [modal, setModal] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]),
    [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  const requestKey = useRef(key());
  const fail = (e: unknown) => {
    void message.error(errorText(e));
  };
  async function load(more = false) {
    const page = await get<Page>('/service-tickets', more && cursor ? { cursor } : undefined);
    setRows((old) => (more ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }
  async function detail(ticketId: number, more = false) {
    const row = await get<Ticket>(
      '/service-tickets/' + ticketId,
      more && selected?.nextEventCursor ? { cursor: selected.nextEventCursor } : undefined,
    );
    setSelected((old) => (more && old ? { ...row, events: [...(old.events ?? []), ...(row.events ?? [])] } : row));
  }
  useEffect(() => {
    void load().catch(fail);
  }, []);
  useEffect(() => {
    if (linkedId && /^[1-9][0-9]*$/.test(linkedId)) void detail(Number(linkedId)).catch(fail);
  }, [linkedId]);
  async function open(action: string) {
    if (action === 'create') {
      // Traverse project pages so eligible older projects are not silently omitted.
      const all: { id: number; name: string }[] = [];
      for (let page = 1; ; page++) {
        const result = await get<{
          items: { id: number; name: string; status: string; acceptanceState: string }[];
          meta: { total: number };
        }>('/workspace/projects', { page, pageSize: 100 });
        all.push(...result.items.filter((p) => p.status === 'completed' && p.acceptanceState === 'accepted'));
        if (page * 100 >= result.meta.total) break;
      }
      setProjects(all);
    } else if (action === 'assign' && selected) setPeople(await get('/service-tickets/' + selected.id + '/people'));
    form.resetFields();
    requestKey.current = key();
    setModal(action);
  }
  async function submit() {
    const values: Record<string, unknown> = await form.validateFields();
    setBusy(true);
    try {
      const row = await post<Ticket>(
        modal === 'create' ? '/service-tickets' : `/service-tickets/${selected!.id}/${modal}`,
        {
          requestKey: requestKey.current,
          ...(modal === 'create' ? {} : { expectedUpdatedAt: selected!.updatedAt }),
          ...values,
        },
      );
      setModal(null);
      await load();
      await detail(row.id);
      void message.success('已保存，历史记录已保留');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="售后服务闭环"
        description="已验收项目可提交问题；指派处理人，记录处理过程，提交解决方案后由另一位项目管理人复核关闭。退回、转派及历史方案保留。当前为内部服务台，暂无客户门户、附件或自动外发。"
      />
      <Card
        title="售后服务工单"
        extra={
          <Space>
            <Button onClick={() => void load().catch(fail)}>刷新</Button>
            {canWrite && (
              <Button type="primary" onClick={() => void open('create').catch(fail)}>
                提交工单
              </Button>
            )}
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '编号', dataIndex: 'id' },
            { title: '问题', dataIndex: 'title' },
            { title: '项目编号', dataIndex: 'projectId' },
            {
              title: '优先级',
              dataIndex: 'priority',
              render: (v: string) => ({ high: '高', medium: '中', low: '低' })[v],
            },
            { title: '状态', dataIndex: 'status', render: (v: string) => <Tag>{statuses[v] ?? v}</Tag> },
            { title: '处理人编号', dataIndex: 'assigneeId', render: (v: number | null) => v ?? '待指派' },
            {
              title: '操作',
              render: (_, row) => <Button onClick={() => void detail(row.id).catch(fail)}>查看 / 处理</Button>,
            },
          ]}
        />
        {cursor && <Button onClick={() => void load(true).catch(fail)}>加载更多工单</Button>}
      </Card>
      <Drawer width={850} title={selected?.title} open={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions
              column={1}
              bordered
              items={[
                { key: 'status', label: '状态', children: statuses[selected.status] },
                {
                  key: 'project',
                  label: '项目 / 客户编号',
                  children: `${selected.projectId} / ${selected.customerId}`,
                },
                {
                  key: 'description',
                  label: '原始问题',
                  children: <div style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</div>,
                },
                {
                  key: 'resolution',
                  label: '当前解决方案',
                  children: <div style={{ whiteSpace: 'pre-wrap' }}>{selected.resolution ?? '尚未提交'}</div>,
                },
              ]}
            />
            <Space wrap>
              {selected.allowedActions?.map((action) => (
                <Button key={action} onClick={() => void open(action).catch(fail)}>
                  {actions[action]}
                </Button>
              ))}
            </Space>
            <Table
              rowKey="id"
              dataSource={selected.events}
              pagination={false}
              columns={[
                { title: '操作', dataIndex: 'kind', render: (v: string) => actions[v] ?? v },
                { title: '操作人', dataIndex: 'actorName' },
                {
                  title: '说明 / 方案',
                  dataIndex: 'note',
                  render: (v: string) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>,
                },
                { title: '时间', dataIndex: 'createdAt' },
              ]}
            />
            {selected.nextEventCursor && (
              <Button onClick={() => void detail(selected.id, true).catch(fail)}>加载更早历史</Button>
            )}
          </Space>
        )}
      </Drawer>
      <Modal
        width={720}
        title={modal === 'create' ? '提交售后工单' : actions[modal ?? '']}
        open={!!modal}
        onCancel={() => !busy && setModal(null)}
        confirmLoading={busy}
        onOk={() => void submit().catch(fail)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          {modal === 'create' ? (
            <>
              <Form.Item name="projectId" label="已验收项目" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
                />
              </Form.Item>
              <Form.Item name="title" label="问题标题" rules={[{ required: true, max: 200 }]}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'low', label: '低' },
                    { value: 'medium', label: '中' },
                    { value: 'high', label: '高' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="description" label="问题描述 / 复现步骤" rules={[{ required: true, max: 5000 }]}>
                <Input.TextArea rows={5} maxLength={5000} />
              </Form.Item>
            </>
          ) : (
            <>
              {modal === 'assign' && (
                <Form.Item name="userId" label="接收人" rules={[{ required: true }]}>
                  <Select options={people.map((p) => ({ value: p.id, label: p.name }))} />
                </Form.Item>
              )}
              {modal === 'close' && (
                <Alert
                  type="warning"
                  message="请先核对解决方案和处理记录；解决人不能自行关闭。此操作为内部复核，不代表客户签署验收。"
                />
              )}
              <Form.Item
                name="note"
                label={modal === 'resolve' ? '解决方案及验证结果' : '处理说明 / 原因'}
                rules={[{ required: true, max: 5000 }]}
              >
                <Input.TextArea rows={5} maxLength={5000} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
