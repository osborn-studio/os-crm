import Table from '../../components/BusinessTable';
import BusinessSort, {type BusinessSortValue} from '../../components/BusinessSort';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { errorText, get, key, post } from '../../services/workspace';
interface Customer {
  id: number;
  name: string;
  ownerId: number | null;
  poolType: string;
  updatedAt: string;
}
interface Person {
  id: number;
  name: string;
  status?: string;
}
interface Preview {
  count: number;
  reason: string;
  items: { id: number; name: string; fromUserId: number | null; toUserId: number; toName: string }[];
}
interface History {
  id: number;
  createdAt: string;
  actorId: number;
  reason: string;
  items: { id: number; name: string; toName: string }[];
}
export default function CustomerAllocationPage() {
  const [sorting,setSorting]=useState<BusinessSortValue>({sortBy:'createdAt',sortOrder:'desc'});
  const [rows, setRows] = useState<Customer[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [owners, setOwners] = useState<Person[]>([]),
    [selected, setSelected] = useState<React.Key[]>([]);
  const [keyword, setKeyword] = useState(''),
    [owner, setOwner] = useState<number | undefined>(() => {
      const value = Number(new URLSearchParams(window.location.search).get('ownerId'));
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    }),
    [pool, setPool] = useState<string>(),
    [target, setTarget] = useState<number>(),
    [reason, setReason] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>(),
    [pending, setPending] = useState<object>();
  const [history, setHistory] = useState<History[]>([]),
    [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const navigate = useNavigate();
  const refresh = async () => {
    const current = ++sequence.current;
    setLoading(true);
    setSelected([]);
    try {
      const [r, p, o, h] = await Promise.all([
        get<{ items: Customer[]; meta: { total: number } }>('/workspace/customers', {
          page,
          pageSize: 50,
          ...sorting,
          keyword,
          ...(owner ? { ownerId: owner } : {}),
          ...(pool ? { poolType: pool } : {}),
        }),
        get<Person[]>('/customer-allocation/people'),
        get<Person[]>('/customer-allocation/owners'),
        get<History[]>('/customer-allocation/history'),
      ]);
      if (current !== sequence.current) return;
      setRows(r.items);
      setTotal(r.meta.total);
      setPeople(p);
      setHistory(h);
      setOwners(o);
      setSelected([]);
      setError('');
    } catch (e) {
      if (current === sequence.current) setError(errorText(e));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [page, owner, pool,sorting.sortBy,sorting.sortOrder]);
  const prepare = async () => {
    if (!target || !reason.trim() || !selected.length) {
      message.warning('请选择客户、接收销售并填写分配原因');
      return;
    }
    setBusy(true);
    try {
      const body = {
        records: rows.filter((r) => selected.includes(r.id)).map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt })),
        userId: target,
        reason,
      };
      const p = await post<Preview>('/customer-allocation/preview', body);
      setPending({ ...body, requestKey: key() });
      setPreview(p);
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await post<{ count: number }>('/customer-allocation/commit', pending);
      message.success(`已分配${r.count}个客户`);
      setPreview(undefined);
      setPending(undefined);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CUSTOMER OWNERSHIP</div>
          <h1>客户分配工作台</h1>
          <Typography.Text type="secondary">按人员查询名下客户，核对后单条或批量分配。</Typography.Text>
        </div>
        <Button onClick={() => navigate('/customer-operations')}>有关联业务：整体交接</Button>
      </div>
      <Alert
        type="info"
        showIcon
        message="每批最多50个客户，整批成功或整体回滚"
        description="接收人为已启用、有部门且具备客户查看/编辑权限的销售。主管接收人仅限本部门。含商机、合同、订单、项目或线索关联的客户须走整体交接，不能只修改客户负责人。新同步且仍停用的人员不会进入接收名单。"
      />
      {error && <Alert type="error" showIcon message={error} />}
      <Card>
        <BusinessSort value={sorting} fields={[{key:'createdAt',label:'录入日期'},{key:'updatedAt',label:'更新日期'},{key:'name',label:'客户名称'},{key:'lastFollowAt',label:'最近跟进日期'}]} onChange={v=>{setPage(1);setSorting(v);}}/>
        <Space wrap>
          <Input.Search
            aria-label="搜索待分配客户"
            placeholder="客户名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => {
              if (page === 1) void refresh();
              else setPage(1);
            }}
            style={{ width: 220 }}
          />
          <Select
            aria-label="当前客户负责人"
            placeholder="查看人员名下客户"
            allowClear
            showSearch
            optionFilterProp="label"
            value={owner}
            options={owners.map((p) => ({
              value: p.id,
              label: `${p.name}${p.status !== 'active' ? '（非启用）' : ''}`,
            }))}
            onChange={(v) => {
              setOwner(v);
              setPage(1);
            }}
            style={{ width: 240 }}
          />
          <Select
            aria-label="客户池"
            placeholder="全部公私海"
            allowClear
            value={pool}
            options={[
              { value: 'public', label: '公海未分配' },
              { value: 'private', label: '私海已有负责人' },
            ]}
            onChange={(v) => {
              setPool(v);
              setPage(1);
            }}
            style={{ width: 180 }}
          />
          <Button onClick={() => void refresh()}>刷新</Button>
        </Space>
      </Card>
      <Table<Customer> serverSorted
        loading={loading}
        rowKey="id"
        size="small"
        dataSource={rows}
        scroll={{ x: 700 }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        pagination={{ current: page, pageSize: 50, total, onChange: setPage }}
        columns={[
          { title: '客户', dataIndex: 'name' },
          {
            title: '当前负责人',
            render: (_, r) =>
              r.ownerId === null ? '未分配' : (owners.find((p) => p.id === r.ownerId)?.name ?? `#${r.ownerId}`),
          },
          { title: '客户池', dataIndex: 'poolType', render: (v) => <Tag>{v === 'public' ? '公海' : '私海'}</Tag> },
          {
            title: '操作',
            render: (_, r) => (
              <Button size="small" onClick={() => setSelected([r.id])}>
                选择此客户分配
              </Button>
            ),
          },
        ]}
      />
      <Card title={`已选择${selected.length}个客户`}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            aria-label="客户接收销售"
            placeholder="选择接收销售"
            value={target}
            showSearch
            optionFilterProp="label"
            options={people.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setTarget}
            style={{ width: '100%', maxWidth: 400 }}
          />
          <Input.TextArea
            aria-label="客户分配原因"
            placeholder="填写分配原因（必填）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
          />
          <Button
            type="primary"
            loading={busy}
            disabled={loading || !selected.length || !target || !reason.trim()}
            onClick={() => void prepare()}
          >
            预览分配影响
          </Button>
        </Space>
      </Card>
      <Card title="最近50条分配记录（仅当前可见客户）">
        <Table<History>
          rowKey="id"
          size="small"
          dataSource={history}
          columns={[
            { title: '时间', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString('zh-CN') },
            { title: '原因', dataIndex: 'reason' },
            { title: '客户数', render: (_, r) => r.items.length },
          ]}
          expandable={{
            expandedRowRender: (r) => (
              <Space direction="vertical">
                {r.items.map((i) => (
                  <span key={i.id}>
                    {i.name} → {i.toName}
                  </span>
                ))}
              </Space>
            ),
          }}
        />
      </Card>
      <Modal
        title="确认客户分配"
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        onOk={() => void commit()}
        confirmLoading={busy}
        okText="确认整批分配"
        cancelText="返回核对"
        width={800}
      >
        <Typography.Paragraph>
          {preview?.reason} · 本次{preview?.count}个客户；提交时会重新检查权限、版本和关联业务。
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          dataSource={preview?.items}
          pagination={false}
          columns={[
            { title: '客户', dataIndex: 'name' },
            {
              title: '原负责人',
              render: (_, r) =>
                r.fromUserId ? (owners.find((p) => p.id === r.fromUserId)?.name ?? `#${r.fromUserId}`) : '公海未分配',
            },
            { title: '接收销售', dataIndex: 'toName' },
          ]}
        />
      </Modal>
    </Space>
  );
}
