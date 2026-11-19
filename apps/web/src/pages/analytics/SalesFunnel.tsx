import Table from '../../components/BusinessTable';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Drawer, Input, Tag, Typography, message } from 'antd';
import type { StatisticsPeopleRange } from '../../components/StatisticsPeople';
import { get, money, errorText } from '../../services/workspace';
type Item = {
  caseKey: string;
  customerId: number | null;
  customerName: string;
  leadId: number | null;
  opportunityId: number | null;
  contractId: number | null;
  name: string;
  stage: string;
  outcome: string;
  amount: string | null;
  forecastEligible: boolean;
  amountBasis: string;
  sourceDate: string | null;
  channel: string;
  ownerName: string;
  lossReason: string | null;
  lossGroup: string | null;
  lossConfirmedAt: string | null;
  nextAction: string | null;
  notes: string;
};
type Result = {
  items: Item[];
  stageNames: Record<string, string>;
  summary: {
    count: number;
    confirmedLostCount: number;
    confirmedLostAmount: string;
    pendingIdentityLostCount: number;
    pendingIdentityLostAmount: string;
    undatedCount: number;
  };
};
type Group = { key: string; name: string; rows: Item[]; count?:number; amount?:string };
export default function SalesFunnel({
  period,
  people,
}: {
  period: { from: string; to: string };
  people: StatisticsPeopleRange;
}) {
  const [data, setData] = useState<Result>(),
    [busy, setBusy] = useState(false),
    [undated, setUndated] = useState(true),
    [selected, setSelected] = useState<string>(),
    [keyword, setKeyword] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    let active = true;
    const id = ++seq.current;
    setBusy(true);
    setData(undefined);
    setSelected(undefined);
    void get<Result>('/analytics/funnel', { ...period, ...people, includeUndated: String(undated) })
      .then((r) => {
        if (active && id === seq.current) setData(r);
      })
      .catch((e) => {
        if (active) message.error(errorText(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [period.from, period.to, people.personRange, people.ownerId, people.deptId, undated]);
  const items = data?.items ?? [],
    groups: Group[] = [
      { key: 'lead', name: '线索', rows: items.filter((r) => r.outcome === 'lead') },
      ...Object.entries(data?.stageNames ?? {})
        .map(([key, name]) => ({
          key: 'open:' + key,
          name,
          rows: items.filter((r) => r.outcome === 'open' && r.stage === key),
        }))
        .filter((g) => g.rows.length),
      { key: 'won', name: '已成交 / 履约', rows: items.filter((r) => r.outcome === 'won') },
      { key: 'lost', name: '掉单', rows: items.filter((r) => r.outcome === 'lost') },
      {
        key: 'other',
        name: '暂缓 / 其他',
        rows: items.filter((r) => !['lead', 'open', 'won', 'lost'].includes(r.outcome)),
      },
    ].filter((g) => g.rows.length || g.key === 'lost');
  const current = groups.find((g) => g.key === selected);
  const total = (rows: Item[]) => {
    const cents = rows
      .filter((r) => r.amount !== null && r.forecastEligible && r.lossGroup !== 'identity_pending')
      .reduce((n, r) => n + BigInt(r.amount!.replace('.', '')), 0n);
    return (cents / 100n).toLocaleString('zh-CN') + '.' + String(cents % 100n).padStart(2, '0');
  };
  const rows =
    current?.rows.filter(
      (r) =>
        !keyword ||
        [r.customerName, r.name, r.channel, r.lossReason, r.ownerName, r.amountBasis].join(' ').includes(keyword),
    ) ?? [];
  return (
    <Card
      title="销售漏斗统计"
      style={{ marginTop: 18 }}
      extra={
        <Checkbox checked={undated} onChange={(e) => setUndated(e.target.checked)}>
          包含来源日期待核实
        </Checkbox>
      }
    >
      <Typography.Paragraph type="secondary">
        沿用上方日期及人员权限。历史补录按资料日期，日常新建按创建日期；点击数量查看明细。
      </Typography.Paragraph>
      <Table<Group>
        loading={busy}
        rowKey="key"
        pagination={false}
        size="small"
        dataSource={groups.map(g=>({...g,count:g.rows.length,amount:g.rows.filter(r=>r.amount!==null&&r.forecastEligible&&r.lossGroup!=='identity_pending').reduce((n,r)=>n+BigInt(r.amount!.replace('.','')),0n).toString()}))}
        columns={[
          {
            title: '销售阶段 / 结果',
            dataIndex: 'name',
            render: (v, r) => (
              <Button
                type="link"
                onClick={() => {
                  setSelected(r.key);
                  setKeyword('');
                }}
              >
                {v}
              </Button>
            ),
          },
          {
            title: '数量',
            dataIndex:'count',
            render: (_, r) => (
              <Button
                type="link"
                onClick={() => {
                  setSelected(r.key);
                  setKeyword('');
                }}
              >
                {r.rows.length}
              </Button>
            ),
          },
          { title: '已核总价合计', dataIndex:'amount', render: (_, r) => '¥' + total(r.rows) },
          {
            title: '说明',
            render: (_, r) =>
              r.key === 'lost'
                ? `具名${r.rows.filter((x) => x.lossGroup === 'confirmed').length}项；主体待核${r.rows.filter((x) => x.lossGroup === 'identity_pending').length}项单列，不并入总价`
                : `未知金额${r.rows.filter((x) => x.amount === null).length}项；月费、单位价及待核候选不混入总价`,
          },
        ]}
      />
      <Drawer
        title={'销售漏斗 · ' + (current?.name ?? '明细')}
        open={!!selected}
        onClose={() => setSelected(undefined)}
        width="min(1280px, 96vw)"
      >
        {selected === 'lost' && (
          <Alert
            type="info"
            showIcon
            message="掉单报价是未成交机会，不是应收款"
            description={`具名商务掉单 ${data?.summary.confirmedLostCount ?? 0} 项，¥${money(data?.summary.confirmedLostAmount)}；主体待核候选 ${data?.summary.pendingIdentityLostCount ?? 0} 项，¥${money(data?.summary.pendingIdentityLostAmount)}，单列待核。历史实际掉单日期未核实，不使用导入日代替。`}
          />
        )}
        <Input.Search
          aria-label="搜索漏斗明细"
          placeholder="客户、项目、渠道、负责人、原因"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ maxWidth: 520, margin: '16px 0' }}
        />
        <Table<Item>
          rowKey="caseKey"
          dataSource={rows}
          scroll={{ x: 1900 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: '客户',
              dataIndex: 'customerName',
              width: 220,
              render: (v, r) => (r.customerId ? <a href={'/customers?id=' + r.customerId}>{v}</a> : v),
            },
            {
              title: '项目',
              dataIndex: 'name',
              width: 220,
              render: (v, r) =>
                r.opportunityId ? (
                  <a href={'/opportunities?id=' + r.opportunityId}>{v}</a>
                ) : r.leadId ? (
                  <a href={'/leads?id=' + r.leadId}>{v}</a>
                ) : (
                  v
                ),
            },
            {
              title: '渠道',
              dataIndex: 'channel',
              width: 90,
              render: (v) => (v === 'direct' ? '来源待核' : String(v)),
            },
            {
              title: '最后到达阶段',
              dataIndex: 'stage',
              width: 130,
              render: (v) => (v === 'lead' ? '线索' : (data?.stageNames[String(v)] ?? v)),
            },
            {
              title: '报价 / 合同参考额',
              dataIndex: 'amount',
              width: 160,
              render: (v) => (v === null ? '金额待确认' : '¥' + money(v)),
            },
            { title: '金额口径', dataIndex: 'amountBasis', width: 300 },
            { title: '掉单原因', dataIndex: 'lossReason', width: 280, render: (v) => v || '—' },
            {
              title: '分组',
              dataIndex: 'lossGroup',
              width: 140,
              render: (v) =>
                v === 'identity_pending' ? (
                  <Tag color="orange">主体待核（单列）</Tag>
                ) : v === 'confirmed' ? (
                  '具名已核报价'
                ) : (
                  '—'
                ),
            },
            { title: '负责人', dataIndex: 'ownerName', width: 100 },
            { title: '资料日期', dataIndex: 'sourceDate', width: 120, render: (v) => v || '待核实' },
            { title: '下一步', dataIndex: 'nextAction', width: 260 },
            {
              title: '合同',
              width: 100,
              render: (_, r) => (r.contractId ? <a href={'/contracts?id=' + r.contractId}>#{r.contractId}</a> : '—'),
            },
            { title: '备注', dataIndex: 'notes', width: 320 },
          ]}
        />
      </Drawer>
    </Card>
  );
}
