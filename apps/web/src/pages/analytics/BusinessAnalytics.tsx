import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Collapse, Row, Space, Spin, Statistic, Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import Table from '../../components/BusinessTable';
import BusinessSort, { type BusinessSortValue } from '../../components/BusinessSort';
import type { StatisticsPeopleRange } from '../../components/StatisticsPeople';
import { get, money, errorText } from '../../services/workspace';
type ContractRow = {
  id: number;
  name: string;
  contractNo: string;
  customerName: string;
  ownerName: string;
  amount: string;
  received: string;
  outstandingAmount: string;
  invoiced: string;
  invoiceReceived:string|null;invoiceUnpaid:string|null;
  signDate: string;
  category: string;
  building: boolean;
  classificationConfirmed: boolean;
};
type CashRow = {
  id: string;
  contractId: number;
  name: string;
  customerName: string;
  ownerName: string;
  amount: string;
  expectedDate: string;
  weight: number;
  weighted: string;
  basis: string[];
};
type ChannelRow = {
  id: number;
  name: string;
  channelBrand: string;
  amount: string;
  received: string;
  outstandingAmount: string;
  commission: string;
  commissionReceived: string;
  commissionOutstanding: string;
};
type BusinessReport = {
  summary: {
    signed: string;
    contractReceived:string;invoiceReceived:string|null;invoiceKnownReceived:string;
    unpaid: string;
    invoiced: string;
    invoiceUnpaid: string | null;
    invoiceKnownUnpaid: string;
    construction: string;
    commission: string;
    commissionUnpaid: string;
    unmatchedInvoiceCount: number;
    unclassifiedCount: number;
  };
  projectAccess: boolean;
  notices: string[];
  generatedAt: string;
  contracts: { items: ContractRow[]; meta: { total: number } };
  channels: ChannelRow[];
  cashProjection: {
    rulesVersion: string;
    total: string;
    weighted: string;
    buckets: { name: string; count: number; amount: string; weighted: string }[];
    details: { items: CashRow[]; meta: { total: number } };
  };
};
const amount = (v: unknown) => '¥' + money(v);
const labels: Record<string, string> = {
  contractReceived:'已收到款的合同',invoiceReceived:'已开票并收到款的合同',
  contracts: '我方已签合同',
  unpaid: '合同待收款',
  invoiced: '已开票合同',
  invoiceUnpaid: '已开票待收款合同',
  construction: '建设中项目合同',
  commission: '软件返佣合同',
};
export default function BusinessAnalytics({
  period,
  people,
  onChanged,
}: {
  period: { from: string; to: string };
  people: StatisticsPeopleRange;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<BusinessReport>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [metric, setMetric] = useState(()=>{const v=new URLSearchParams(window.location.search).get('metric')??'contracts';return ['contracts','contractReceived','invoiceReceived','unpaid','invoiced','invoiceUnpaid','construction','commission'].includes(v)?v:'contracts';}),
    [view, setView] = useState('contracts'),
    [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<BusinessSortValue>({ sortBy: 'signDate', sortOrder: 'desc' }),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0),
    navigate = useNavigate();
  useEffect(() => {
    const id = ++sequence.current;
    setBusy(true);
    setData(undefined);
    void get<BusinessReport>('/analytics/business', { ...period, ...people, ...sorting, page, pageSize: 20, metric })
      .then((r) => {
        if (id === sequence.current) {
          setData(r);
          setError('');
        }
      })
      .catch((e) => {
        if (id === sequence.current) setError(errorText(e));
      })
      .finally(() => {
        if (id === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
    };
  }, [
    period.from,
    period.to,
    people.personRange,
    people.ownerId,
    people.deptId,
    sorting.sortBy,
    sorting.sortOrder,
    page,
    metric,
    revision,
  ]);
  useEffect(() => {
    setPage(1);
  }, [period.from, period.to, people.personRange, people.ownerId, people.deptId]);
  const choose = (key: string) => {
    setMetric(key);
    setView('contracts');
    setPage(1);
    setSorting({ sortBy: 'signDate', sortOrder: 'desc' });
  };
  const cash = view === 'cash';
  return (
    <Spin spinning={busy}>
      <Space style={{ marginBottom: 16 }}>
        <Button
          onClick={() => {
            setRevision((v) => v + 1);
            onChanged?.();
          }}
        >
          刷新合同与回款
        </Button>
        <Typography.Text type="secondary">按所选签约日期归集合同，查看这批合同当前累计开票与回款。</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      {data && (
        <>
          <Row gutter={[12, 12]}>
            {(
              [
                ['合同总金额', 'signed', 'contracts'],
                ['合同已收款','contractReceived','contractReceived'],
                ['合同待收款', 'unpaid', 'unpaid'],
                ['已开票金额', 'invoiced', 'invoiced'],
                ['已开票已收款','invoiceReceived','invoiceReceived'],
                ['已开票待收款', 'invoiceUnpaid', 'invoiceUnpaid'],
                ['在建项目金额', 'construction', 'construction'],
                ['软件返佣（另列）','commission','commission'],
              ] as const
            ).map(([title, key, filter]) => (
              <Col xs={24} sm={12} xl={8} key={key}>
                <Card className="business-metric" hoverable onClick={() => choose(filter)}>
                  <Statistic
                    title={title}
                    value={
                      key === 'construction' && !data.projectAccess
                        ? '待授权'
                        : data.summary[key] === null
                          ? '待核实'
                          : amount(data.summary[key])
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
          <Alert
            type="info"
            showIcon
            style={{ margin: '16px 0' }}
            message="我方业务与软件返佣分别统计"
            description="查看所选签约时间内的合同及收款情况。“待收款”就是还没有收到的钱。渠道作为甲方支付的实施、开发及外包费用计入业务；软件返佣单列。点击金额查看合同明细。"
          />
          <Collapse ghost size="small" style={{marginBottom:16}} items={[{key:'basis',label:'统计口径与回款规则说明',children:data.notices.map((n,i)=><Typography.Paragraph key={i} style={{lineHeight:1.8,marginBottom:10}}>{n}</Typography.Paragraph>)}]}/>
          {data.summary.unmatchedInvoiceCount > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${data.summary.unmatchedInvoiceCount}张发票的分期核销关联待核实；已明确的已开票待收款 ${amount(data.summary.invoiceKnownUnpaid)}，不以估算冒充完整余额。`}
            />
          )}
          <Card
            title="预计收款安排"
            style={{ marginBottom: 16 }}
            extra={<Typography.Text type="secondary">规则版本{data.cashProjection.rulesVersion}</Typography.Text>}
          >
            <Typography.Paragraph>
              合同待收款 {amount(data.cashProjection.total)}；谨慎预计收款 {amount(data.cashProjection.weighted)}
              。下表金额按预计回款时间分组，权重参考考虑已开票、已回过款、验收、逾期及日期完整性。金额可逐笔核对。
            </Typography.Paragraph>
            <Table
              rowKey="name"
              pagination={false}
              dataSource={data.cashProjection.buckets}
              columns={[
                { title: '预计时间', dataIndex: 'name', sorter: (a, b) => ['未来30天', '第31—60天', '第61—90天', '90天以后'].indexOf(a.name) - ['未来30天', '第31—60天', '第61—90天', '90天以后'].indexOf(b.name) },
                { title: '笔数', dataIndex: 'count' },
                { title: '待收款', dataIndex: 'amount', render: amount },
                { title: '谨慎预计收款', dataIndex: 'weighted', render: amount },
              ]}
            />
            <Button
              onClick={() => {
                setView('cash');
                setPage(1);
                setSorting({ sortBy: 'expectedDate', sortOrder: 'asc' });
              }}
            >
              查看每笔预计收款与判断依据
            </Button>
          </Card>
          <Card title="渠道客户往来 · 渠道为甲方付款" style={{ marginBottom: 16 }}>
            <Typography.Paragraph type="secondary">
              实施、开发和外包服务计入我方业绩；软件返佣单列。终端客户使用厂商产品，不会因此把整单归入厂商往来。
            </Typography.Paragraph>
            <Table<ChannelRow>
              rowKey="id"
              dataSource={data.channels}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1100 }}
              columns={[
                {
                  title: '渠道甲方',
                  dataIndex: 'name',
                  render: (v: string, r: ChannelRow) => (
                    <Button type="link" onClick={() => navigate('/customers?id=' + r.id)}>
                      {v}
                    </Button>
                  ),
                },
                { title: '渠道品牌', dataIndex: 'channelBrand' },
                { title: '我方业务合同金额', dataIndex: 'amount', render: amount },
                { title: '业务已回款', dataIndex: 'received', render: amount },
                { title: '业务未回款', dataIndex: 'outstandingAmount', render: amount },
                { title: '软件返佣金额', dataIndex: 'commission', render: amount },
                { title: '返佣已收', dataIndex: 'commissionReceived', render: amount },
                { title: '返佣未收', dataIndex: 'commissionOutstanding', render: amount },
              ]}
            />
            <Button onClick={() => choose('commission')}>查看软件返佣合同（不计我方业务业绩）</Button>
          </Card>
          <Card title={cash ? '每笔预计收款' : labels[metric]}>
            <Tabs
              activeKey={view}
              onChange={(v) => {
                setView(v);
                setPage(1);
                setSorting({
                  sortBy: v === 'cash' ? 'expectedDate' : 'signDate',
                  sortOrder: v === 'cash' ? 'asc' : 'desc',
                });
              }}
              items={[
                { key: 'contracts', label: '合同明细' },
                { key: 'cash', label: '回款安排与权重' },
              ]}
            />
            <BusinessSort
              value={sorting}
              fields={
                cash
                  ? [
                      { key: 'expectedDate', label: '预计回款日期' },
                      { key: 'amount', label: '待收款' },
                      { key: 'weighted', label: '谨慎预计收款' },
                      { key: 'weight', label: '回款权重' },
                      { key: 'name', label: '合同名称' },
                    ]
                  : [
                      { key: 'signDate', label: '签约日期' },
                      { key: 'name', label: '合同名称' },
                      { key: 'customerName', label: '客户名称' },
                      { key: 'amount', label: '合同金额' },
                      { key: 'received', label: '已回款' },
                      { key: 'outstandingAmount', label: '合同待收款' },
                      { key: 'invoiced', label: '已开票金额' },
                      {key:'invoiceReceived',label:'已开票已收款'},{key:'invoiceUnpaid',label:'已开票待收款'},
                    ]
              }
              onChange={(v) => {
                setSorting(v);
                setPage(1);
              }}
            />
            {cash ? (
              <Table<CashRow>
                serverSorted
                rowKey="id"
                scroll={{ x: 1800 }}
                dataSource={data.cashProjection.details.items}
                pagination={{
                  current: page,
                  pageSize: 20,
                  total: data.cashProjection.details.meta.total,
                  onChange: setPage,
                  showSizeChanger: false,
                }}
                columns={[
                  {
                    title: '合同',
                    dataIndex: 'name',
                    render: (v: string, r: CashRow) => (
                      <Button type="link" onClick={() => navigate('/contracts?id=' + r.contractId)}>
                        {v}
                      </Button>
                    ),
                  },
                  { title: '客户', dataIndex: 'customerName' },
                  { title: '负责人', dataIndex: 'ownerName' },
                  { title: '待收款', dataIndex: 'amount', render: amount },
                  { title: '预计回款', dataIndex: 'expectedDate' },
                  { title: '参考把握', dataIndex: 'weight', render: (v: number) => v + '%' },
                  { title: '谨慎预计收款', dataIndex: 'weighted', render: amount },
                  { title: '判断依据', dataIndex: 'basis', render: (v: string[]) => v.join('；') },
                ]}
              />
            ) : (
              <Table<ContractRow>
                serverSorted
                rowKey="id"
                scroll={{ x: 1800 }}
                dataSource={data.contracts.items}
                pagination={{
                  current: page,
                  pageSize: 20,
                  total: data.contracts.meta.total,
                  onChange: setPage,
                  showSizeChanger: false,
                }}
                columns={[
                  {
                    title: '合同',
                    dataIndex: 'name',
                    render: (v: string, r: ContractRow) => (
                      <Button type="link" onClick={() => navigate('/contracts?id=' + r.id)}>
                        {v}
                      </Button>
                    ),
                  },
                  { title: '客户', dataIndex: 'customerName' },
                  { title: '负责人', dataIndex: 'ownerName' },
                  { title: '签约日期', dataIndex: 'signDate', render: (v: string) => v?.slice(0, 10) || '待确认' },
                  { title: '合同金额', dataIndex: 'amount', render: amount },
                  { title: '合同已收款', dataIndex: 'received', render: amount },
                  { title: '合同待收款', dataIndex: 'outstandingAmount', render: amount },
                  { title: '已开票金额', dataIndex: 'invoiced', render: amount },
                  {title:'已开票已收款',dataIndex:'invoiceReceived',render:(v:string|null)=>v===null?'待核实':amount(v)},
                  {title:'已开票待收款',dataIndex:'invoiceUnpaid',render:(v:string|null)=>v===null?'待核实':amount(v)},
                  {
                    title: '交易分类',
                    dataIndex: 'category',
                    render: (v: string, r: ContractRow) =>
                      (v === 'software_commission' ? '软件返佣' : '我方业务') +
                      (r.classificationConfirmed ? '' : '（待核）'),
                  },
                ]}
              />
            )}
          </Card>
          <Typography.Paragraph type="secondary">
            生成于 {new Date(data.generatedAt).toLocaleString('zh-CN')}
            。金额为当前单据累计值，预计时间和权重可作为跟催安排参考。
          </Typography.Paragraph>
        </>
      )}
    </Spin>
  );
}
