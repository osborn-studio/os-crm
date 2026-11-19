import Table from '../../components/BusinessTable';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Calendar,
  Card,
  DatePicker,
  Form,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import ActivitySyncPanel from './ActivitySyncPanel';
import { get, post, put, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
import StatisticsPeople, { defaultStatisticsPeople } from '../../components/StatisticsPeople';
import { useNavigate } from 'react-router-dom';
dayjs.extend(utc);
dayjs.extend(timezone);
interface Entry {
  id: number;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  freeBusy: string;
  status: string;
  revision: number;
  updatedAt: string;
  origin?: string;
  ownerId: number;
  ownerName?: string;
}
const local = (value?: string) => dayjs(value).tz('Asia/Shanghai');
export default function CalendarPage() {
  const [people,setPeople]=useState(defaultStatisticsPeople), navigate=useNavigate();
  const user = useAuthStore((s) => s.user),
    permissions = user?.permissions ?? [];
  const has = (point: string) => permissions.some((p) => [point, '*', point.split(':')[0] + ':*'].includes(p));
  const hasRead = has('action:read'),
    writer = user?.roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r));
  const canCreate = writer && has('action:create'),
    canUpdate = writer && has('action:update');
  const [selected, setSelected] = useState(() => local()),
    [view, setView] = useState('month'),
    [statusFilter, setStatusFilter] = useState('scheduled'),
    [rows, setRows] = useState<Entry[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Entry | null | undefined>(undefined),
    [saving, setSaving] = useState(false),
    [form] = Form.useForm();
  const [detailDay, setDetailDay] = useState<Dayjs | null>(null);
  const [pulling,setPulling]=useState(false);
  async function pullCalendar(){setPulling(true);try{const r=await post<{created:number;updated:number;unchanged:number}>('/integrations/dingtalk-activities/pull',{});message.success(`已读取本人未来31天钉钉日程：新增${r.created}，更新${r.updated}，未变${r.unchanged}`);await load();}catch(e){message.error(errorText(e));}finally{setPulling(false);}}
  const screens = Grid.useBreakpoint();
  useEffect(() => {
    if (screens.xs) setView('list');
  }, [screens.xs]);
  const from = (
    view === 'week'
      ? selected.startOf('day').subtract((selected.day() + 6) % 7, 'day')
      : selected.startOf('month').subtract(7, 'day')
  ).toISOString();
  const until = (view === 'week' ? dayjs(from).add(7, 'day') : selected.endOf('month').add(8, 'day')).toISOString();
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    if (!hasRead) return;
    const request = ++loadSequence.current;
    setLoading(true);
    try {
      const r = await get<{ items: Entry[] }>('/calendar', { from, until, ...people });
      if (request === loadSequence.current) {
        setRows(r.items);
        setError('');
      }
    } catch (e) {
      if (request === loadSequence.current) setError(errorText(e));
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [hasRead, from, until, people.personRange,people.ownerId,people.deptId]);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [load]);
  const open = (entry: Entry | null, date = selected) => {
    setEditing(entry);
    form.setFieldsValue(
      entry
        ? { ...entry, range: [local(entry.startsAt), local(entry.endsAt)] }
        : {
            title: '',
            description: '',
            location: '',
            range: [date.hour(9).minute(0).second(0).millisecond(0), date.hour(10).minute(0).second(0).millisecond(0)],
            freeBusy: 'busy',
            status: 'scheduled',
          },
    );
  };
  const save = async () => {
    try {
      const data = await form.validateFields();
      setSaving(true);
      const payload = {
        requestKey: key(),
        ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}),
        data: {
          title: data.title,
          description: data.description ?? '',
          location: data.location ?? '',
          startsAt: data.range[0].toISOString(),
          endsAt: data.range[1].toISOString(),
          freeBusy: data.freeBusy,
          status: data.status,
        },
      };
      if (editing) await put('/calendar/' + editing.id, payload);
      else await post('/calendar', payload);
      setEditing(undefined);
      await load();
      message.success('日程已保存；同步请查看同步页或已开启的自动任务');
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const visibleRows = rows.filter((r) => statusFilter === 'all' || r.status === statusFilter);
  const dayEntries = (date: Dayjs) =>
    visibleRows.filter(
      (r) =>
        local(r.startsAt).startOf('day').valueOf() <= date.startOf('day').valueOf() &&
        (local(r.endsAt).valueOf() > date.startOf('day').valueOf() || Date.parse(r.startsAt)===Date.parse(r.endsAt)&&local(r.startsAt).isSame(date,'day')),
    );
  const event = (r: Entry) => (
    <button
      key={r.id}
      type="button"
      title={r.title}
      onClick={(e) => {
        e.stopPropagation();
        setDetailDay(null);
        open(r);
      }}
      style={{
        display: 'block',
        maxWidth: '100%',
        border: 0,
        background: r.status === 'cancelled' ? '#f0f2f5' : '#eaf2ff',
        color: r.status === 'cancelled' ? '#687587' : '#164f9f',
        borderRadius: 4,
        textAlign: 'left',
        padding: '3px 6px',
        margin: '3px 0',
        cursor: 'pointer',
        wordBreak: 'break-word',
      }}
    >
      {local(r.startsAt).format('HH:mm')} {r.status === 'cancelled' ? '[已取消] ' : ''}
      {r.title}
      {r.origin==='dingtalk'&&<Tag color="blue">钉钉</Tag>}
      {r.origin==='crm_plan'&&<Tag>业务计划 · {r.ownerName}</Tag>}
    </button>
  );
  const calendar = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert showIcon type="error" message={error} />}
      <StatisticsPeople value={people} onChange={setPeople}/>
      <Typography.Text type="secondary">业务计划按当前数据权限展示；个人及钉钉日程仅本人可见。拟定推进时段不等于客户已确认的会议。</Typography.Text>
      <Card>
        <Space wrap>
          <Button onClick={() => setSelected(selected.subtract(1, view === 'week' ? 'week' : 'month'))}>
            上一{view === 'week' ? '周' : '月'}
          </Button>
          <DatePicker allowClear={false} value={selected} onChange={(d) => d && setSelected(d)} aria-label="日程日期" />
          <Button onClick={() => setSelected(selected.add(1, view === 'week' ? 'week' : 'month'))}>
            下一{view === 'week' ? '周' : '月'}
          </Button>
          <Button onClick={() => setSelected(local())}>今天</Button>
          <Select
            aria-label="日程视图"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: '月历' },
              { value: 'week', label: '周视图' },
              { value: 'list', label: '列表' },
            ]}
          />
          <Select
            aria-label="日程状态筛选"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'scheduled', label: '已安排' },
              { value: 'cancelled', label: '已取消' },
              { value: 'completed', label: '行动已完成' },
              { value: 'all', label: '全部状态' },
            ]}
          />
          <Button loading={loading} onClick={() => void load()}>
            刷新日程
          </Button>
          {canUpdate&&<Button loading={pulling} onClick={()=>void pullCalendar()}>读取近期钉钉日程</Button>}
          {canCreate && (
            <Button type="primary" onClick={() => open(null)}>
              新建日程
            </Button>
          )}
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
          仅本人日程；时间按上海时区显示。取消保留历史，日程内容不会自动分配给其他员工。
        </Typography.Paragraph>
      </Card>
      {view === 'month' ? (
        <Card loading={loading}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 620 }}>
              <Calendar
                value={selected}
                onSelect={(d, info) => {
                  if (info.source === 'date') setSelected(d);
                }}
                onPanelChange={(d) => setSelected(d)}
                cellRender={(d, info) =>
                  info.type === 'date' ? (
                    <div>
                      {dayEntries(d).slice(0, 3).map(event)}
                      {dayEntries(d).length > 3 && (
                        <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); setDetailDay(d); }}>
                          另有{dayEntries(d).length - 3}项 · 查看全部
                        </Button>
                      )}
                    </div>
                  ) : info.originNode
                }
              />
            </div>
          </div>
        </Card>
      ) : view === 'week' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          {Array.from({ length: 7 }, (_, index) => {
            const d = local(from).add(index, 'day');
            return (
              <Card
                size="small"
                title={d.format('MM-DD') + ' ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.day()]}
                key={index}
              >
                {dayEntries(d).length ? (
                  dayEntries(d).map(event)
                ) : (
                  <Typography.Text type="secondary">暂无日程</Typography.Text>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card loading={loading}>
          <Table<Entry>
            size="small"
            rowKey="id"
            dataSource={visibleRows}
            scroll={{ x: 650 }}
            pagination={{ pageSize: 15 }}
            columns={[
              {
                title: '主题',
                dataIndex: 'title',
                render: (_, r) => (
                  <Button type="link" style={{ whiteSpace: 'normal', padding: 0 }} onClick={() => open(r)}>
                    {r.title}
                  </Button>
                ),
              },
              { title: '开始', dataIndex: 'startsAt', render: (v) => local(v).format('MM-DD HH:mm') },
              { title: '结束', dataIndex: 'endsAt', render: (v) => local(v).format('MM-DD HH:mm') },
              { title:'负责人',dataIndex:'ownerName' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'scheduled' ? 'blue' : v==='completed'?'green':'default'}>{v === 'scheduled' ? '已安排' : v==='completed'?'行动已完成':'已取消'}</Tag>
                ),
              },
              { title: '忙闲', dataIndex: 'freeBusy', render: (v) => (v === 'free' ? '空闲' : '忙碌') },
            ]}
          />
        </Card>
      )}
    </Space>
  );
  const readOnly = editing ? !canUpdate || editing.origin === 'dingtalk' || editing.ownerId!==user?.id || editing.status==='completed' : !canCreate;
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERSONAL CALENDAR & SYNC</div>
          <h1>日程与业务推进</h1>
        </div>
      </div>
      <Tabs
        items={[
          ...(hasRead ? [{ key: 'calendar', label: '日程与行动', children: calendar }] : []),
          { key: 'sync', label: '本人钉钉同步', children: <ActivitySyncPanel /> },
        ]}
      />
      <Modal
        title={detailDay?.format('YYYY年MM月DD日') + '全部日程'}
        open={detailDay !== null}
        onCancel={() => setDetailDay(null)}
        footer={<Button onClick={() => setDetailDay(null)}>关闭</Button>}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>{detailDay && dayEntries(detailDay).map(event)}</div>
      </Modal>
      <Modal
        title={editing ? '日程详情' : '新建日程'}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={save}
        okText="保存日程"
        confirmLoading={saving}
        footer={readOnly ? <Button onClick={() => setEditing(undefined)}>关闭</Button> : undefined}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" disabled={readOnly}>
          {editing?.origin==='crm_plan'&&<Button disabled={false} type="link" onClick={()=>navigate('/actions?keyword='+encodeURIComponent(editing.title))}>查看对应行动计划</Button>}
          <Form.Item name="title" label="主题" rules={[{ required: true, message: '请填写主题' }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="range" label="起止时间（上海时区）" rules={[{ required: true, message: '请选择起止时间' }]}>
            <DatePicker.RangePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="location" label="地点">
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item name="description" label="内容">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
          <Space>
            <Form.Item name="freeBusy" label="忙闲">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: 'busy', label: '忙碌' },
                  { value: 'free', label: '空闲' },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: 'scheduled', label: '已安排' },
                  { value: 'cancelled', label: '已取消' },
                ]}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
