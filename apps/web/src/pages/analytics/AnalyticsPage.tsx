import Table from '../../components/BusinessTable';
import BusinessSort, { type BusinessSortValue } from '../../components/BusinessSort';
import SalesFunnel from './SalesFunnel';
import BusinessAnalytics from './BusinessAnalytics';
import StatisticsPeople, { statisticsPeopleFromParams } from '../../components/StatisticsPeople';
import type { SpreadsheetCell } from '../../utils/xlsx';
import { csvCell } from '../../utils/csv';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { get, money, errorText } from '../../services/workspace';
import StatisticsPeriod, { defaultStatisticsRange } from '../../components/StatisticsPeriod';
type Detail = {
  id: number;
  name?: string;
  contractNo?: string;
  receiptNo?: string;
  planNo?: string;
  contractName?: string;
  ownerName?: string;
  amount: string | null;
  weighted?: string | null;
  stageName?: string;
  expectedCloseDate?: string | null;
  risk?: string;
  planned?: string;
  received?: string;
  currentOutstanding?: string;
  currentOverdue?: string;
  allocatedAmount?: string;
  unallocatedAmount?: string;
  receiptDate?: string;
  dueDate?: string;
  outstandingAmount?: string;
  receivedAmount?: string;
  nextAction?: string | null;
  status?: string;
  closedAt?: string | null;
  months?: { year?: number; month: number; planned: string; received: string }[];
};
type Paginated = { items: Detail[]; meta: { page: number; pageSize: number; total: number } };
type Report = {
  version: string;
  generatedAt: string;
  summary: Record<string, string | number | null>;
  notices: string[];
  balanceAsOf?: string;
  excludedCurrencyContracts?: number;
  stages?: { stage: string; name: string; count: number; amount: string; weighted: string; excluded: number }[];
  owners?: {
    ownerId: number;
    name: string;
    open: string;
    weighted: string;
    won: string;
    wonCount: number;
    lostCount: number;
    planned?: string;
    received?: string;
    currentOutstanding?: string;
    currentOverdue?: string;
  }[];
  monthly: { year?: number; month: number; amount?: string; weighted?: string; won?: string; planned?: string; received?: string }[];
  aging?: { name: string; count: number; amount: string }[];
  details?: Paginated;
  matrix?: Paginated;
  receipts?: Paginated;
  plans?: Paginated;
  balances?: Paginated;
  overdue?: Paginated;
};
type Options = {
  owners: { id: number; name: string; deptId: number | null }[];
  departments: { id: number; name: string }[];
  canForecast: boolean;
  canCollections: boolean;
};
const m = (v: unknown) => money(v);
const day = (v?: string | null) => v?.slice(0, 10) || '待确认';
function Trend({ rows, forecast }: { rows: Report['monthly']; forecast: boolean }) {
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [Number(forecast ? r.weighted : r.planned), Number(forecast ? r.won : r.received)]),
  );
  return (
    <>
      <Space>
        <Tag color="blue">{forecast ? '按进度折算' : '收款计划'}</Tag>
        <Tag>{forecast ? '已赢单' : '已复核到账'}</Tag>
      </Space>
      <div
        style={{ display: 'flex', gap: 12, height: 140, overflowX: 'auto', alignItems: 'flex-end', margin: '16px 0' }}
      >
        {rows.map((r) => (
          <div
            key={`${r.year}-${r.month}`}
            style={{ minWidth: 32, flex: 1 }}
            title={`${r.year ?? ''}-${r.month}：${m(forecast ? r.weighted : r.planned)} / ${m(forecast ? r.won : r.received)}`}
          >
            <div style={{ height: 105, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
              <div
                style={{
                  flex: 1,
                  background: '#2563eb',
                  minHeight: 1,
                  height: (Number(forecast ? r.weighted : r.planned) / max) * 100,
                }}
              />
              <div
                style={{
                  flex: 1,
                  background: '#94a3b8',
                  minHeight: 1,
                  height: (Number(forecast ? r.won : r.received) / max) * 100,
                }}
              />
            </div>
            <small>{r.year}-{r.month}月</small>
          </div>
        ))}
      </div>
    </>
  );
}
async function exportDetail(rows: Detail[], name: string, columns: ColumnsType<Detail>, format: 'xlsx' | 'csv' = 'xlsx') {
  const keys = columns.flatMap((c) =>
    'dataIndex' in c && typeof c.dataIndex === 'string'
      ? [{ title: String(c.title), key: c.dataIndex as keyof Detail }]
      : [],
  );
  const numeric = new Set(['amount', 'weighted', 'planned', 'received', 'currentOutstanding', 'currentOverdue', 'allocatedAmount', 'unallocatedAmount', 'outstandingAmount', 'receivedAmount']);
  const months = rows.find(r => r.months)?.months ?? [];
  const headers = [...keys.map(c => c.title), ...months.flatMap(v => [`${v.year ?? ''}-${v.month}计划`,`${v.year ?? ''}-${v.month}已回`])];
  const values: SpreadsheetCell[][] = rows.map(r => [
    ...keys.map(c => {
      const v = r[c.key];
      if (c.key === 'status' && typeof v === 'string') return ({open:'进行中',won:'已赢单',lost:'已输单',confirmed:'已复核',pending:'待处理',voided:'已作废'})[v] ?? v;
      if (c.key === 'weighted' && v === null) return '不纳入加权';
      if (['expectedCloseDate','receiptDate','dueDate','closedAt'].includes(c.key)) return typeof v === 'string' ? v.slice(0,10) : '待确认';
      if (numeric.has(c.key) && typeof v === 'string') return { decimal: v };
      return typeof v === 'number' ? v : v == null ? '' : String(v);
    }),
    ...months.flatMap((_v,i)=>[{decimal:r.months?.[i]?.planned??'0.00'},{decimal:r.months?.[i]?.received??'0.00'}]),
  ]);
  try {
    if (format === 'xlsx') {
      await (await import('../../utils/xlsx')).downloadSpreadsheet(name + '-当前页', headers, values);
      return;
    }
    const csv = [headers, ...values.map(row => row.map(v => v && typeof v === 'object' ? v.decimal : v))].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name + '-当前页.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { message.error(errorText(e)); }
}
export default function AnalyticsPage() {
  const [sorting,setSorting]=useState<BusinessSortValue>({sortBy:'id',sortOrder:'desc'});
  const [options, setOptions] = useState<Options>();
  const [kind, setKind] = useState(new URLSearchParams(window.location.search).get('tab') === 'collections' ? 'collections' : 'business'),
    [section, setSection] = useState('contracts');
  const [period, setPeriod] = useState(()=>{const p=new URLSearchParams(window.location.search),d=defaultStatisticsRange();return {from:p.get('from')??d.from,to:p.get('to')??d.to};});
  const [people, setPeople] = useState(()=>statisticsPeopleFromParams(new URLSearchParams(window.location.search)));
  const [source, setSource] = useState('managed');
  const [bucket, setBucket] = useState('open');
  const [page, setPage] = useState(1),
    [data, setData] = useState<Report>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Detail>();
  const seq = useRef(0);
  useEffect(() => {
    get<Options>('/analytics/options')
      .then((o) => {
        setOptions(o);
        if (!o.canCollections && o.canForecast) setKind('forecast');
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  const load = async () => {
    if(kind==='business'){setData(undefined);return;}
    const id = ++seq.current;
    setBusy(true);
    setError('');
    setData(undefined);
    setSelected(undefined);
    try {
      const r = await get<Report>('/analytics/' + kind, {
        ...period,
        ...people,
        ...sorting,
        source,
        page,
        pageSize: 20,
        detail: section,
        bucket,
      });
      if (id === seq.current) setData(r);
    } catch (e) {
      if (id === seq.current) setError(errorText(e));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (options && (kind === 'forecast' ? options.canForecast : options.canCollections)) void load();
    return () => {
      seq.current++;
    };
  }, [options, kind, period.from, period.to, people.personRange, people.ownerId, people.deptId, source, page, section, bucket,sorting.sortBy,sorting.sortOrder]);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const forecast = kind === 'forecast';
  const scopeName = people.personRange === 'self' ? '本人' : people.personRange === 'company' ? '全公司' : people.personRange === 'person' ? '人员' + people.ownerId : '部门' + people.deptId;
  const detailData = forecast
    ? data?.details
    : section === 'receipts'
      ? data?.receipts
      : section === 'plans'
        ? data?.plans
        : section === 'balances'
          ? data?.balances
          : section === 'overdue'
            ? data?.overdue
            : data?.matrix;
  const monetary = (title: string, key: keyof Detail): ColumnsType<Detail>[number] => ({
    title,
    dataIndex: key,
    align: 'right',
    render: (v: unknown) => v===null?'金额待确认':m(v),
  });
  const titleColumn: ColumnsType<Detail>[number] = {
    title: forecast ? '商机' : section === 'contracts' ? '合同 / 项目' : section === 'receipts' ? '收款单' : '付款计划',
    dataIndex: forecast || section === 'contracts' ? 'name' : section === 'receipts' ? 'receiptNo' : 'planNo',
    fixed: 'left',
    width: 210,
    render: (v: string, r: Detail) => (
      <Button
        type="link"
        onClick={() => setSelected(r)}
        style={{ padding: 0, whiteSpace: 'normal', textAlign: 'left' }}
      >
        {v}
      </Button>
    ),
  };
  const columns: ColumnsType<Detail> = [
    titleColumn,
    ...(forecast
      ? [
          { title: '负责人', dataIndex: 'ownerName' },
          { title: '阶段', dataIndex: 'stageName' },
          {
            title: '状态',
            dataIndex: 'status',
            render: (v: string) => ({ open: '进行中', won: '已赢单', lost: '已输单' })[v] ?? v,
          },
          monetary('商机金额', 'amount'),
          {
            title: '按进度折算金额',
            dataIndex: 'weighted',
            render: (v: string | null) => (v === null ? '不纳入加权' : m(v)),
          },
          { title: '预计成交', dataIndex: 'expectedCloseDate', render: day },
          { title: '下一步', dataIndex: 'nextAction' },
          { title: '关注事项', dataIndex: 'risk', render: (v: string) => (v ? <Tag>{v}</Tag> : '—') },
        ]
      : section === 'contracts'
        ? [
            { title: '负责人', dataIndex: 'ownerName' },
            monetary('合同金额', 'amount'),
            monetary('计划收款', 'planned'),
            monetary('已登记收款', 'received'),
            monetary('待收款', 'currentOutstanding'),
            monetary('已过计划日期未收到的款', 'currentOverdue'),
            ...(data?.monthly ?? []).map((month, i) => ({
              title: `${month.year}-${month.month} · 计划 / 已回`,
              width: 165,
              render: (_: unknown, r: Detail) => {
                const cell = r.months?.[i];
                return (
                  <div>
                    <span>{m(cell?.planned)}</span>
                    <br />
                    <Typography.Text type="secondary">{m(cell?.received)}</Typography.Text>
                  </div>
                );
              },
            })),
          ]
        : section === 'receipts'
          ? [
              { title: '合同', dataIndex: 'contractName' },
              { title: '到账日期', dataIndex: 'receiptDate', render: day },
              monetary('到账金额', 'amount'),
              monetary('其中当前已核销', 'allocatedAmount'),
              monetary('其中当前未核销', 'unallocatedAmount'),
            ]
          : [
              { title: '合同', dataIndex: 'contractName' },
              { title: '预计收款日', dataIndex: 'dueDate', render: day },
              monetary('计划金额', 'amount'),
              monetary('当前已核销', 'receivedAmount'),
              monetary('待收款', 'outstandingAmount'),
            ]),
  ];
  const cards = forecast
    ? [
        ['我方待签业务报价', 'open'],
        ['按商机进度折算金额', 'weighted'],
        ['已签约商机', 'won'],
        ['待补关闭日期商机', 'unknownClosedCount'],
      ]
    : [
        ['收款计划', 'planned'],
        ['已登记收款', 'received'],
        ['计划待收款', 'currentOutstanding'],
        ['需要跟催的收款', 'currentOverdue'],
      ];
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SALES & CASH ANALYTICS</div>
          <h1>合同、开票与收款</h1>
          <Typography.Text type="secondary">看清合同签了多少、收了多少、还差多少；每个数字都能查看明细。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} disabled={!options || busy}>
          刷新
        </Button>
      </div>
      <Tabs
        activeKey={kind}
        onChange={(k) => reset(() => setKind(k))}
        items={[
          ...(options?.canCollections?[{key:'business',label:'合同与回款经营统计'}]:[]),
          ...(options?.canForecast ? [{ key: 'forecast', label: '商机报价与阶段参考' }] : []),
          ...(options?.canCollections ? [{ key: 'collections', label: '收款记录与收款计划' }] : []),
        ]}
      />
      <Card size="small" style={{ marginBottom: 18 }}>
        <StatisticsPeriod value={period} onChange={v => reset(() => setPeriod(v))} />
        <Space wrap>
          <StatisticsPeople value={people} onChange={v => reset(() => setPeople(v))} />
          {kind==='collections' && (
            <Select
              aria-label="收款来源"
              style={{ width: 180 }}
              value={source}
              onChange={(v) => reset(() => setSource(v))}
              options={[
                { value: 'managed', label: '本地管理台账' },
                { value: 'legacy', label: '历史只读记录' },
              ]}
            />
          )}
        </Space>
      </Card>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Spin spinning={busy}>
        {kind==='business'&&options?.canCollections?<BusinessAnalytics period={period} people={people}/>:data ? (
          <>
            {forecast && <SalesFunnel period={period} people={people}/>}
            <Row gutter={[16, 16]}>
              {cards.map(([title, key]) => (
                <Col xs={24} sm={12} xl={6} key={key}>
                  <Card
                    hoverable
                    onClick={() =>
                      reset(() =>
                        forecast
                          ? setBucket(key === 'won' ? 'won' : key === 'winRate' ? 'closed' : 'open')
                          : setSection(
                              key === 'planned'
                                ? 'plans'
                                : key === 'received'
                                  ? 'receipts'
                                  : key === 'currentOutstanding'
                                    ? 'balances'
                                    : 'overdue',
                            ),
                      )
                    }
                  >
                    <Statistic
                      title={title}
                      value={
                        key === 'unknownClosedCount'
                          ? data.summary[key]+' 个' : key === 'winRate'
                          ? data.summary[key] === null
                            ? '暂无关闭商机'
                            : `${data.summary[key]}%`
                          : m(data.summary[key])
                      }
                      prefix={['winRate','unknownClosedCount'].includes(key) ? undefined : '¥'}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
            <Alert
              style={{ margin: '16px 0' }}
              type="info"
              showIcon
              message={
                forecast
                  ? `待确认成交日期 ${data.summary.undatedCount} 个；不纳入加权 ${data.summary.unweightedCount} 个；缺关闭日期 ${data.summary.unknownClosedCount} 个`
                  : `当前余额日期 ${data.balanceAsOf}；未绑定合同到账 ¥${m(data.summary.unboundReceived)}；排除非CNY合同 ${data.excludedCurrencyContracts} 份`
              }
              description={data.notices.join(' ')}
            />
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={15}>
                <Card title={forecast ? '每月预测 / 已赢单' : '每月计划收款 / 实际收款'}>
                  <Trend rows={data.monthly} forecast={forecast} />
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={r => `${r.year}-${r.month}`}
                    dataSource={data.monthly}
                    columns={[
                      { title: '月份', dataIndex: 'month', sorter:(a:Report['monthly'][number],b:Report['monthly'][number])=>((a.year??0)*12+a.month)-((b.year??0)*12+b.month), render: (_v: number, r: Report['monthly'][number]) => `${r.year}-${r.month}月` },
                      {
                        title: forecast ? '开放商机' : '收款计划',
                        dataIndex: forecast ? 'amount' : 'planned',
                        align: 'right',
                        render: m,
                      },
                      ...(forecast
                        ? [{ title: '按进度折算', dataIndex: 'weighted', align: 'right' as const, render: m }]
                        : []),
                      {
                        title: forecast ? '已赢单' : '已复核到账',
                        dataIndex: forecast ? 'won' : 'received',
                        align: 'right',
                        render: m,
                      },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} xl={9}>
                <Card title={forecast ? '负责人预测分布' : '待收款拖延天数'}>
                  {forecast ? (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="ownerId"
                      dataSource={data.owners}
                      scroll={{ x: 460 }}
                      columns={[
                        {
                          title: '负责人',
                          dataIndex: 'name',
                          render: (v: string, r: { ownerId: number }) => (
                            <Button type="link" onClick={() => reset(() => setPeople({personRange:'person',ownerId:r.ownerId}))}>
                              {v}
                            </Button>
                          ),
                        },
                        { title: '开放金额', dataIndex: 'open', render: m },
                        { title: '加权', dataIndex: 'weighted', render: m },
                        { title: '赢单', dataIndex: 'won', render: m },
                      ]}
                    />
                  ) : (
                    <>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="name"
                        dataSource={data.aging}
                        columns={[
                          { title: '账龄', dataIndex: 'name' },
                          { title: '笔数', dataIndex: 'count' },
                          { title: '当前余额', dataIndex: 'amount', align: 'right', render: m },
                        ]}
                      />
                      <p style={{ marginTop: 16 }}>
                        已登记收款中，当前已核销 ¥{m(data.summary.currentAllocatedOfReceipts)}；当前未核销 ¥
                        {m(data.summary.currentUnallocatedOfReceipts)}。二者不再加到到账总额。
                      </p>
                    </>
                  )}
                </Card>
              </Col>
            </Row>
            {!forecast && (
              <Card title="负责人回款与应收 · 未绑定合同款单列" style={{ marginTop: 18 }}>
                <Table
                  size="small"
                  rowKey="ownerId"
                  pagination={{ pageSize: 10 }}
                  dataSource={data.owners}
                  scroll={{ x: 700 }}
                  columns={[
                    {
                      title: '负责人',
                      dataIndex: 'name',
                      render: (v: string, r: { ownerId: number }) => (
                        <Button type="link" onClick={() => reset(() => setPeople({personRange:'person',ownerId:r.ownerId}))}>
                          {v}
                        </Button>
                      ),
                    },
                    { title: '计划收款', dataIndex: 'planned', render: m },
                    { title: '已登记收款', dataIndex: 'received', render: m },
                    { title: '待收款', dataIndex: 'currentOutstanding', render: m },
                    { title: '已过计划日期未收到的款', dataIndex: 'currentOverdue', render: m },
                  ]}
                />
              </Card>
            )}
            <Card
              style={{ marginTop: 18 }}
              title={forecast ? '商机明细 · 所选口径' : '项目 / 计划 / 到账明细'}
              extra={
                <Space wrap>
                  <Button icon={<DownloadOutlined />} disabled={!detailData?.items.length} onClick={() => void exportDetail(detailData?.items ?? [], `${period.from}至${period.to}-${scopeName}-${forecast ? '销售预测' : section}`, columns)}>
                    导出 Excel
                  </Button>
                  <Button disabled={!detailData?.items.length} onClick={() => void exportDetail(detailData?.items ?? [], `${period.from}至${period.to}-${scopeName}-${forecast ? '销售预测' : section}`, columns, 'csv')}>导出 CSV</Button>
                </Space>
              }
            >
              {forecast && (
                <Select
                  aria-label="商机明细范围"
                  style={{ width: 240, marginBottom: 16 }}
                  value={bucket}
                  onChange={(v) => reset(() => setBucket(v))}
                  options={[
                    { value: 'open', label: '跟进中商机' },
                    { value: 'won', label: '已签约商机' },
                    { value: 'lost', label: '未成交商机' },
                    { value: 'closed', label: '已结束商机' },
                    { value: 'undated', label: '全部待确认成交日期' },
                  ]}
                />
              )}
              {!forecast && (
                <Tabs
                  activeKey={section}
                  onChange={(k) => reset(() => setSection(k))}
                  items={[
                    { key: 'contracts', label: '合同每月收款表' },
                    { key: 'plans', label: '收款计划' },
                    { key: 'receipts', label: '收款记录' },
                    { key: 'balances', label: '计划待收款' },
                    { key: 'overdue', label: '需要跟催的收款' },
                  ]}
                />
              )}
              <BusinessSort value={sorting} onChange={v=>reset(()=>setSorting(v))} fields={[{key:"id",label:"录入顺序"},...columns.flatMap(c=>"dataIndex"in c&&typeof c.dataIndex==="string"&&!["ownerName","stageName","risk","nextAction","contractName"].includes(c.dataIndex)?[{key:c.dataIndex,label:String(c.title)}]:[])]}/>
              <Table<Detail>
                serverSorted
                rowKey="id"
                size="small"
                dataSource={detailData?.items}
                columns={columns}
                scroll={{ x: forecast ? 1100 : section === 'contracts' ? 2800 : 900 }}
                pagination={{
                  current: page,
                  pageSize: 20,
                  total: detailData?.meta.total ?? 0,
                  showSizeChanger: false,
                  onChange: setPage,
                  showTotal: (n) => `共 ${n} 条；导出仅当前页`,
                }}
              />
            </Card>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              口径版本 {data.version} · 生成时间 {new Date(data.generatedAt).toLocaleString('zh-CN')} ·
              当前归属权限；历史快照与预测提报见建设计划。
            </Typography.Paragraph>
          </>
        ) : !busy && !error ? (
          <Empty
            description={
              options && !options.canForecast && !options.canCollections ? '当前账号没有报表读取权限' : '请选择报表'
            }
          />
        ) : null}
      </Spin>
      <Drawer
        title={selected?.name ?? selected?.receiptNo ?? selected?.planNo ?? '明细'}
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width={640}
      >
        {selected && (
          <>
            <p>金额：{selected.amount===null?'待确认':'¥'+m(selected.amount)}</p>
            {selected.ownerName && <p>负责人：{selected.ownerName}</p>}
            {selected.contractName && <p>合同：{selected.contractName}</p>}
            {selected.expectedCloseDate && <p>预计成交：{day(selected.expectedCloseDate)}</p>}
            {selected.nextAction && <p>下一步：{selected.nextAction}</p>}
            {selected.months && (
              <Table
                size="small"
                rowKey={r => `${r.year}-${r.month}`}
                pagination={false}
                dataSource={selected.months}
                columns={[
                  { title: '月份', dataIndex: 'month', sorter:(a:NonNullable<Detail['months']>[number],b:NonNullable<Detail['months']>[number])=>((a.year??0)*12+a.month)-((b.year??0)*12+b.month), render: (_v: number, r: NonNullable<Detail['months']>[number]) => `${r.year}-${r.month}月` },
                  { title: '计划', dataIndex: 'planned', render: m },
                  { title: '已回', dataIndex: 'received', render: m },
                ]}
              />
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
