import BusinessSort, {type BusinessSortValue} from '../../components/BusinessSort';
import StatisticsPeople, { statisticsPeopleFromParams, statisticsQuery } from '../../components/StatisticsPeople';
import { useAuthStore } from '../../stores/useAuthStore';
import { useState, useEffect, useRef } from 'react';
import StatisticsPeriod, { defaultStatisticsRange } from '../../components/StatisticsPeriod';
import { Alert, Button, Card, Empty, Pagination, Space, Spin, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post, key, errorText, money, type RecordRow } from '../../services/workspace';
import { menuAccess } from '../../services/access';
export default function BoardPage() {
  const [people, setPeople] = useState(() => statisticsPeopleFromParams(new URLSearchParams(window.location.search)));
  const [period,setPeriod]=useState(() => { const p = new URLSearchParams(window.location.search); return { from: p.get('from') ?? defaultStatisticsRange().from, to: p.get('to') ?? defaultStatisticsRange().to }; });
  const [sorting,setSorting]=useState<BusinessSortValue>({sortBy:'createdAt',sortOrder:'desc'});
  const revision=useRef(0);
  const [page, setPage] = useState(1), [loading, setLoading] = useState(false);
  const user=useAuthStore(s=>s.user);
  const has=(p:string)=>user?.roles.includes('super_admin')||user?.permissions?.some(x=>[p,'*',p.split(':')[0]+':*'].includes(x));
  const canEdit=Boolean(user?.roles.some(r=>['super_admin','sales_manager','sales'].includes(r))&&has('opportunity:update'));
  const canCustomer=menuAccess('/customers',user?.permissions??[],user?.roles.includes('super_admin')??false);
  const [stages, setStages] = useState<string[][]>([]);
  const [rows, setRows] = useState<RecordRow[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const load = async () => {
    const requestRevision=++revision.current;setRows([]);setError('');setLoading(true);
    try {
      const [r, definitions] = await Promise.all([
        get<{ items: RecordRow[]; meta: { total: number } }>('/workspace/opportunities', { page, pageSize: 100, ...period, ...people, ...sorting }),
        get<{ code: string; name: string }[]>('/commercial/opportunity-stages'),
      ]);
      const items=r.items.slice();
      if(requestRevision!==revision.current)return;
      if(page>1 && !items.length && r.meta.total<=(page-1)*100){setPage(1);return;}
      const known = definitions.map((d) => [d.code, d.name]);
      for (const row of items)
        if (!known.some(([code]) => code === String(row.stage)))
          known.push([String(row.stage), '历史阶段：' + String(row.stage)]);
      setStages(known);
      setRows(items);
      setTotal(r.meta.total);
      setError('');
    } catch (e) {
      if(requestRevision===revision.current)setError(errorText(e));
    } finally {
      if(requestRevision===revision.current)setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return ()=>{revision.current++;};
  }, [period.from,period.to,people.personRange,people.ownerId,people.deptId,page,sorting.sortBy,sorting.sortOrder]);
  const advance = async (r: RecordRow) => {
    try {
      await post(`/workspace/opportunities/${r.id}/advance`, { requestKey: key(), expectedUpdatedAt: r.updatedAt });
      message.success('阶段已推进');
      await load();
    } catch (e) {
      message.error(errorText(e));
    }
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SALES PIPELINE</div>
          <h1>商机看板</h1>
          <Typography.Text type="secondary">按阶段掌握管道，推进结果同步到商机列表。</Typography.Text>
        </div>
        <Button onClick={() => navigate(`/opportunities?${statisticsQuery(period, people)}`)}>商机列表与报价</Button>
      </div>
      <StatisticsPeriod value={period} onChange={v=>{setPage(1);setPeriod(v);}} />
      <StatisticsPeople value={people} onChange={v=>{setPage(1);setPeople(v);}} />
      <BusinessSort value={sorting} fields={[{key:"createdAt",label:"录入日期"},{key:"updatedAt",label:"更新日期"},{key:"expectedCloseDate",label:"预计成交日期"},{key:"amount",label:"商机金额"},{key:"name",label:"商机名称"}]} onChange={v=>{setPage(1);setSorting(v);}}/>
      <Typography.Paragraph type="secondary">按预计成交日期筛选，共{total}条，当前页{rows.length}条。阶段数量和金额为本页汇总；完整统计请查看销售预测。未填写预计成交日的商机可在列表补齐。</Typography.Paragraph>
      {error && <Alert type="error" message={error} />}{' '}
      {loading && <Spin tip="正在读取商机" />}
      {!loading && !error && total===0 && <Empty description="当前日期和人员范围内暂无商机，请调整筛选或到商机列表核对预计成交日期。" />}
      {total>100 && <Pagination current={page} pageSize={100} total={total} showSizeChanger={false} showQuickJumper onChange={setPage} style={{marginBottom:16}} />}
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 20 }}>
        {stages.map(([code, name], i) => {
          const list = rows.filter((r) => r.stage === code);
          return (
            <div key={code} style={{ minWidth: 260, width: 280, flexShrink: 0 }}>
              <div
                style={{
                  padding: 16,
                  background: '#e8eef8',
                  borderTop: `3px solid ${['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#172554'][i]}`,
                  marginBottom: 12,
                }}
              >
                <Space>
                  <strong>{name}</strong>
                  <Tag>本页 {list.length}</Tag>
                </Space>
                <div style={{ color: '#64748b', marginTop: 8 }}>
                  ¥{money(list.reduce((n, r) => n + Number(r.amount), 0))}
                </div>
              </div>
              {list.map((r) => (
                <Card key={r.id} size="small" style={{ marginBottom: 12 }}>
                  <Button type="link" style={{padding:0,height:'auto',whiteSpace:'normal',textAlign:'left',fontWeight:600}} onClick={()=>navigate(`/opportunities?id=${r.id}`)}>{String(r.name)}</Button>
                  <div style={{marginTop:8,fontWeight:500}}>客户：{canCustomer?<Button type="link" style={{padding:0,height:'auto',whiteSpace:'normal',textAlign:'left'}} onClick={()=>navigate(`/customers?id=${String(r.customerId)}`)}>{String(r.customerName??'客户名字待核实')}</Button>:String(r.customerName??'客户名字待核实')}</div>
                  <Typography.Paragraph style={{ marginTop: 12 }}>我方金额：{r.amount===null?'待核实':'¥'+money(r.amount)}</Typography.Paragraph>{r.projectQuoteAmount!==undefined&&<Typography.Paragraph type="secondary">原整包报价 ¥{money(r.projectQuoteAmount)} · 厂商产品部分 ¥{money(r.vendorProductAmount)}</Typography.Paragraph>}
                  <Tag color={r.status==='lost'?'red':r.status==='won'?'green':'blue'}>{({won:'已赢单',lost:'已掉单',cancelled:'已取消',on_hold:'暂缓'} as Record<string,string>)[String(r.status)]??'进行中'}</Tag>
                  <Typography.Paragraph type="secondary" style={{marginTop:8,marginBottom:0}}>{String(r.ownerName??'')} · {String(r.expectedCloseDate??'').slice(0,10)}</Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{marginTop:4,marginBottom:0}}>跟进 {Number(r.followCount??0)} 次 · 最近 {r.lastFollowAt?String(r.lastFollowAt).slice(0,10):'待记录'}</Typography.Paragraph>
                  {String(r.remark??'').includes('[日期估算]') && <Tag>日期估算</Tag>}
                  {Boolean(r.nextAction) && <Typography.Paragraph style={{marginTop:8,marginBottom:0}}>下一步：{String(r.nextAction)}</Typography.Paragraph>}
                  <Space wrap style={{marginTop:8}}><Button size="small" onClick={()=>navigate(`/opportunities?id=${r.id}`)}>商机详情</Button>{has('follow_up:read')&&<Button size="small" onClick={()=>navigate(`/opportunities?id=${r.id}&tab=followups`)}>查看跟进</Button>}</Space>
                  {canEdit && r.status === 'open' && (
                    <Button type="link" onClick={() => void advance(r)}>
                      推进下一阶段 →
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
