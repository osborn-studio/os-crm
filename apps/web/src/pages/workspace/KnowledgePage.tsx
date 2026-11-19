import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
interface Entry {
  id: number;
  sourceKey: string;
  kind: string;
  title: string;
  summary: string;
  customerId: number | null;
  evidenceStatus: string;
  version: number;
  sources: { id: string; label: string; location: string }[];
  content: Record<string, unknown>;
}
interface Page {
  items: Entry[];
  total: number;
  page: number;
  pageSize: number;
}
interface Preview {
  previewId: string;
  digest: string;
  entries: number;
  expiresInSeconds: number;
}
const names: Record<string, string> = {
  product: '产品与服务',
  price: '版本报价',
  project: '客户项目历程',
  meeting: '会议与听记',
  outsourcing: '外包与能力分析',
};
const statuses: Record<string, string> = {
  verified_source: '来源已核对',
  historical: '历史记录',
  proposed: '拟定待执行',
  pending: '待核实',
};
function contentView(v: unknown, depth = 0): ReactNode {
  if (v === null || v === undefined) return <Typography.Text type="secondary">待确认</Typography.Text>;
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v !== 'object')
    return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <Typography.Text type="secondary">暂无记录</Typography.Text>;
    if (v.every((x) => x === null || typeof x !== 'object'))
      return <span>{v.map((x) => String(x ?? '待确认')).join('；')}</span>;
    return (
      <Collapse
        size="small"
        items={v.map((x, i) => ({ key: String(i), label: '第' + (i + 1) + '项', children: contentView(x, depth + 1) }))}
      />
    );
  }
  const pairs = Object.entries(v as Record<string, unknown>);
  return (
    <Descriptions
      column={1}
      size="small"
      bordered
      styles={{ label: { width: 150, whiteSpace: 'normal' }, content: { overflowWrap: 'anywhere' } }}
      items={pairs.map(([k, x]) => ({
        key: k,
        label: k,
        children: depth > 5 ? <Typography.Text code>{JSON.stringify(x)}</Typography.Text> : contentView(x, depth + 1),
      }))}
    />
  );
}
export default function KnowledgePage() {
  const [kind, setKind] = useState('product'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page>(),
    [detail, setDetail] = useState<Entry>(),
    [raw, setRaw] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState<'asc' | 'desc'>('desc'),
    [sort, setSort] = useState('updatedAt');
  async function load() {
    try {
      setData(await get<Page>('/business-knowledge', { kind, search, page, pageSize: 20, sort, order }));
    } catch (e) {
      void message.error(errorText(e));
    }
  }
  useEffect(() => {
    setData(undefined);
    let active = true;
    get<Page>('/business-knowledge', { kind, search, page, pageSize: 20, sort, order })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) void message.error(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [kind, search, page, sort, order]);
  async function prepare() {
    setBusy(true);
    setPreview(undefined);
    try {
      const payload: unknown = JSON.parse(raw);
      if (!Array.isArray(payload)) throw new Error('请选择导入包中entries数组；每批最多50条');
      setPreview(await post<Preview>('/business-knowledge/preview', { requestKey: key(), entries: payload }));
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      await post('/business-knowledge/commit', {
        requestKey: key(),
        previewId: preview.previewId,
        digest: preview.digest,
        confirm: true,
      });
      setPreview(undefined);
      setRaw('');
      message.success('资料已保存，没有修改合同金额、审批或外部日程');
      await load();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="page-heading">
        <h1>产品报价与客户项目知识</h1>
        <Button onClick={() => void load()}>刷新</Button>
      </div>
      <Alert
        showIcon
        type="info"
        message="当前仅管理员可读写，含内部报价和项目证据。历史报价不自动变现价；建议不等于已拜访、签约或付款。导入不会对外发送。"
        style={{ marginBottom: 16 }}
      />
      <Tabs
        activeKey={kind}
        onChange={(v) => {
          setKind(v);
          setPage(1);
          setPreview(undefined);
        }}
        items={Object.entries(names).map(([k, label]) => ({ key: k, label }))}
      />
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            aria-label="排序字段"
            value={sort}
            onChange={(v) => {
              setSort(v);
              setPage(1);
            }}
            options={[
              { value: 'updatedAt', label: '按更新日期' },
              { value: 'title', label: '按名称' },
            ]}
            style={{ width: 160 }}
          />
          <Button
            onClick={() => {
              setOrder(order === 'asc' ? 'desc' : 'asc');
              setPage(1);
            }}
          >
            {order === 'desc' ? '倒序 ↓' : '正序 ↑'}
          </Button>
        </Space>
        <br />
        <Input.Search
          aria-label="搜索知识资料"
          placeholder="搜索产品、客户项目或模块"
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          style={{ maxWidth: 440, marginBottom: 16 }}
          allowClear
        />
        <Table<Entry>
          rowKey="id"
          dataSource={data?.items ?? []}
          loading={!data}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (n) => `共${n}条`,
          }}
          scroll={{ x: 950 }}
          columns={[
            {
              title: '资料',
              dataIndex: 'title',
              width: 300,
              render: (v: string, r) => (
                <Button
                  type="link"
                  onClick={() => setDetail(r)}
                  style={{ padding: 0, whiteSpace: 'normal', textAlign: 'left', height: 'auto' }}
                >
                  {v}
                </Button>
              ),
            },
            { title: '摘要', dataIndex: 'summary', width: 420, ellipsis: true },
            { title: '核实状态', dataIndex: 'evidenceStatus', render: (s: string) => <Tag>{statuses[s] ?? s}</Tag> },
            { title: '版本', dataIndex: 'version', render: (v: number) => `v${v}` },
          ]}
        />
      </Card>
      <Card title="受控导入（JSON，最多50条/批）" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">
          先核对文件来源、客户ID和expectedVersion。预演30分钟有效；重复请求有回执，版本冲突整批拒绝。此入口只保存知识，不替代业务单据导入。
        </Typography.Paragraph>
        <Input.TextArea
          aria-label="知识导入JSON"
          rows={4}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(undefined);
          }}
          placeholder="粘贴导入包entries数组"
        />
        <Space style={{ marginTop: 12 }}>
          <Button onClick={() => void prepare()} loading={busy} disabled={!raw}>
            预演导入
          </Button>
          {preview && (
            <>
              <Tag>预演{preview.entries}条</Tag>
              <Button type="primary" loading={busy} onClick={() => void commit()}>
                确认保存此批资料
              </Button>
            </>
          )}
        </Space>
      </Card>
      <Drawer title={detail?.title} width={850} open={!!detail} onClose={() => setDetail(undefined)}>
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{detail?.summary}</Typography.Paragraph>
        <h3>结构化内容</h3>
        {contentView(detail?.content)}
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'raw',
              label: '开发与导出：查看JSON',
              children: (
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(detail?.content, null, 2)}
                </pre>
              ),
            },
          ]}
        />
        <h3>来源与核实依据</h3>
        {detail?.sources.map((s) => (
          <Card key={s.id} size="small" style={{ marginBottom: 8 }}>
            <b>{s.label}</b>
            <Typography.Paragraph copyable>{s.location}</Typography.Paragraph>
            <Typography.Text type="secondary">{s.id}</Typography.Text>
          </Card>
        ))}
      </Drawer>
    </div>
  );
}
