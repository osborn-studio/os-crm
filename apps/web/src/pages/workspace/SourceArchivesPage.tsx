import Table from '../../components/BusinessTable';
import BusinessSort,{type BusinessSortValue} from '../../components/BusinessSort';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Select, Space, Tag, Typography, message } from 'antd';
import { get, errorText } from '../../services/workspace';
type Archive = { id: string; filename: string; sha256: string; rowCount: number; createdAt: string; summary?: { note?: string; issues?: string[] } };
type SourceRow = { sourceRow: number; cells: (string | number | boolean | null)[] };
type Preview = { archive: Archive; sheets: { name: string; count: number }[]; headers: string[]; items: SourceRow[]; meta: { page: number; pageSize: number; total: number } };
export default function SourceArchivesPage() {
  const [sorting,setSorting]=useState<BusinessSortValue>({sortBy:'sourceRow',sortOrder:'asc'});
  const [archives, setArchives] = useState<Archive[]>([]), [id, setId] = useState(''), [sheet, setSheet] = useState(0), [keyword, setKeyword] = useState(''), [page, setPage] = useState(1), [data, setData] = useState<Preview>(), [detail, setDetail] = useState<SourceRow>(), [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => { void get<{ items: Archive[] }>('/source-archives').then(r => { setArchives(r.items); setId(r.items[0]?.id ?? ''); }).catch(e => message.error(errorText(e))); }, []);
  useEffect(() => {
    const current = ++revision.current; setData(undefined); setDetail(undefined);
    if (!id) return;
    setBusy(true);
    void get<Preview>(`/source-archives/${id}/rows`, { sheet, page, keyword,...sorting }).then(r => { if (current === revision.current) setData(r); }).catch(e => { if (current === revision.current) void message.error(errorText(e)); }).finally(() => { if (current === revision.current) setBusy(false); });
    return () => { revision.current++; };
  }, [id, sheet, page, keyword,sorting.sortBy,sorting.sortOrder]);
  async function download() {
    if (!id) return;
    try { const r = await get<{ filename: string; contentBase64: string }>(`/source-archives/${id}/content`); const bytes = Uint8Array.from(atob(r.contentBase64), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { void message.error(errorText(e)); }
  }
  return <div>
    <div className="page-heading"><div><h1>历史资料与补录来源</h1><Typography.Text type="secondary">查看原始表格、来源行及核对事项；补录后的合同、开票、回款在对应业务页面查询。</Typography.Text></div></div>
    <Alert type="info" showIcon message="原始资料保持不变，完整联系及财务信息仅管理员可读；业务单据按客户、人员和公司权限显示。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="资料文件" style={{ minWidth: 240 }} value={id || undefined} placeholder="选择资料" options={archives.map(a => ({ value: a.id, label: `${a.filename}（${a.rowCount}条）` }))} onChange={v => { setId(v); setSheet(0); setSorting({sortBy:'sourceRow',sortOrder:'asc'}); setPage(1); setKeyword(''); }} />
      <Select aria-label="原表工作表" style={{ minWidth: 220 }} value={sheet} options={(data?.sheets ?? []).map((s, i) => ({ value: i, label: `${s.name}（${s.count}条）` }))} onChange={v => { setSheet(v); setSorting({sortBy:'sourceRow',sortOrder:'asc'}); setPage(1); }} />
      <Input.Search aria-label="检索原始资料" placeholder="检索公司、合同编号、阶段等" allowClear onSearch={v => { setKeyword(v); setPage(1); }} />
      <Button disabled={!id} onClick={() => void download()}>下载原始文件</Button>
    </Space>
    {data?.archive.summary?.note && <Alert style={{ marginBottom: 16 }} type="info" message={data.archive.summary.note} />}
    {!!data?.archive.summary?.issues?.length && <Card size="small" title="导入核对事项" style={{ marginBottom: 16 }}>{data.archive.summary.issues.map((issue, i) => <p key={i}>{issue}</p>)}</Card>}
    <BusinessSort value={sorting} fields={[{key:'sourceRow',label:'原表行号'},...(data?.headers??[]).map((label,i)=>({key:'cell:'+i,label}))]} onChange={v=>{setPage(1);setSorting(v);}}/>
    {!id ? <Empty description="当前公司尚未导入历史资料" /> : <Table<SourceRow> serverSorted size="small" loading={busy} rowKey="sourceRow" dataSource={data?.items ?? []} scroll={{ x: Math.max(1000, (data?.headers.length ?? 0) * 180) }}
      columns={[{ title: '原表行号', dataIndex: 'sourceRow', width: 90, fixed: 'left' }, ...(data?.headers ?? []).map((h, i) => ({ title: h, key: `${i}`, width: 180, render: (_: unknown, r: SourceRow) => <span>{r.cells[i] === null || r.cells[i] === undefined ? '—' : String(r.cells[i])}</span> })), { title: '详情', key: 'detail', width: 90, fixed: 'right', render: (_: unknown, r: SourceRow) => <Button type="link" onClick={() => setDetail(r)}>查看</Button> }]}
      pagination={{ current: page, pageSize: 30, total: data?.meta.total ?? 0, showSizeChanger: false, showTotal: n => `共 ${n} 条`, onChange: setPage }} />}
    <Drawer title={`原始资料 · 第${detail?.sourceRow ?? ''}行`} open={!!detail} width={Math.min(760, window.innerWidth)} onClose={() => setDetail(undefined)}>
      <Tag>来源：{data?.archive.filename} / {data?.sheets[sheet]?.name}</Tag>
      <Descriptions bordered column={1} size="small" style={{ marginTop: 16 }} items={(data?.headers ?? []).map((h, i) => ({ key: i, label: h, children: String(detail?.cells[i] ?? '—') }))} />
    </Drawer>
  </div>;
}
