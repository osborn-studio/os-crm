import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Typography, message } from 'antd';
import { get, post, errorText, type RecordRow } from '../../services/workspace';
import AgentControlPanel from './AgentControlPanel';
export default function AiPage() {
  const [rows, setRows] = useState<RecordRow[]>([]),
    [selected, setSelected] = useState<number>(),
    [summary, setSummary] = useState(''),
    [result, setResult] = useState(''),
    [keyword, setKeyword] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ items: RecordRow[] }>('/workspace/customers', { pageSize: 100 })
      .then((r) => setRows(r.items))
      .catch((e) => message.error(errorText(e)));
  }, []);
  const summarize = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const c = await get<RecordRow>(`/workspace/customers/${selected}`);
      const related = (c.related ?? {}) as Record<string, RecordRow[]>;
      setSummary(
        `${c.name}\n行业：${c.industry ?? '待补充'}；地区：${c.region ?? '待补充'}。\n关联商机 ${related.opportunities?.length ?? 0} 个，合同 ${related.contracts?.length ?? 0} 份，跟进 ${related.followups?.length ?? 0} 条。\n建议：${related.followups?.length ? '根据最近跟进确认下一步负责人和时间。' : '先记录需求访谈和下一步行动。'}\n来源：当前账号可见的客户与关联记录；仅为规则摘要，未调用大模型。`,
      );
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const invoke = async () => {
    setBusy(true);
    try {
      const r = await post('/capabilities/customer.search/invoke', { keyword, page: 1, pageSize: 5 });
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AI NATIVE CRM</div>
          <h1>AI与智能体工作台</h1>
          <Typography.Text type="secondary">业务数据由权限约束的能力接口提供，调用生成审计执行编号。</Typography.Text>
        </div>
      </div>
      <Alert
        type="info"
        showIcon
        message="当前摘要为规则生成，未调用大模型"
        description="可创建独立限时委托，智能体提出行动建议，人工核对后才能执行；查询和执行均保留回执。规则摘要仍未接大模型。"
        style={{ marginBottom: 20 }}
      />
      <Card title="客户摘要与跟进建议">
        <Space wrap>
          <Select
            style={{ width: 350 }}
            placeholder="选择客户"
            showSearch
            optionFilterProp="label"
            options={rows.map((c) => ({ value: c.id, label: String(c.name) }))}
            onChange={setSelected}
          />
          <Button type="primary" loading={busy} disabled={!selected} onClick={() => void summarize()}>
            生成规则摘要
          </Button>
        </Space>
        {summary && (
          <Typography.Paragraph style={{ whiteSpace: 'pre-line', marginTop: 20 }}>{summary}</Typography.Paragraph>
        )}
      </Card>
      <Card title="真实能力接口调用" style={{ marginTop: 20 }}>
        <Typography.Paragraph>
          <Typography.Text code>customer.search@1.0</Typography.Text> ·
          查询当前账号有权访问的客户，返回受限字段与执行编号。
        </Typography.Paragraph>
        <Space>
          <Input placeholder="客户关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button loading={busy} onClick={() => void invoke()}>
            调用能力
          </Button>
        </Space>
        {result && (
          <pre style={{ maxHeight: 400, overflow: 'auto', marginTop: 16, background: '#f8fafc', padding: 16 }}>
            {result}
          </pre>
        )}
      </Card>
      <AgentControlPanel />
    </div>
  );
}
