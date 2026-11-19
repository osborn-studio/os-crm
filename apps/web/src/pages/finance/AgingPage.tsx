import Table from '../../components/BusinessTable';
import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Tag, Progress, Typography, Space } from 'antd';
import { AlertOutlined } from '@ant-design/icons';
import request from '../../services/request';

const { Title, Text } = Typography;

export default function AgingPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [subjects, setSubjects] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      request.get('/finance/aging') as any,
      request.get('/finance/aging/subjects') as any,
    ]).then(([s, sub]) => { setSummary(s); setSubjects(sub || []); }).finally(() => setLoading(false));
  }, []);

  if (loading || !summary) return <Card loading />;

  const bucketColors: Record<string, string> = { not_due: '#16a34a', d1_30: '#d97706', d31_60: '#ea580c', d60_plus: '#dc2626' };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>账龄分析</Title>

      {/* 四桶概览 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {summary.buckets?.map((b: any) => (
          <Col span={6} key={b.bucket}>
            <Card size="small">
              <Statistic
                title={<Space><div style={{ width: 8, height: 8, borderRadius: '50%', background: bucketColors[b.bucket] }} />{b.label}</Space>}
                value={b.amount}
                precision={0}
                prefix="¥"
                valueStyle={{ color: bucketColors[b.bucket], fontSize: 20 }}
                suffix={<Text type="secondary" style={{ fontSize: 12 }}>({b.count}笔 · {b.percent}%)</Text>}
              />
              <Progress percent={b.percent} showInfo={false} strokeColor={bucketColors[b.bucket]} size="small" style={{ marginTop: 8 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 汇总KPI */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card size="small"><Statistic title="应收总额" value={summary.totalOutstanding} prefix="¥" precision={0} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="逾期总额" value={summary.buckets?.slice(1).reduce((s: number, b: any) => s + b.amount, 0) || 0} prefix="¥" precision={0} valueStyle={{ color: '#dc2626' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="逾期率" value={summary.totalOutstanding > 0 ? ((summary.buckets?.slice(1).reduce((s: number, b: any) => s + b.amount, 0) || 0) / summary.totalOutstanding * 100).toFixed(1) : 0} suffix="%" valueStyle={{ color: '#d97706' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="风险客户数" value={subjects.filter((s: any) => s.riskLevel === 'high').length} prefix={<AlertOutlined />} valueStyle={{ color: '#dc2626' }} /></Card></Col>
      </Row>

      {/* 客户风险榜 */}
      <Card title="客户账龄风险榜" size="small">
        <Table
          dataSource={subjects}
          rowKey="customerId"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '客户', dataIndex: 'customerName', ellipsis: true },
            { title: '未收金额', dataIndex: 'outstanding', render: (v: number) => `¥${v.toLocaleString()}`, sorter: (a: any, b: any) => a.outstanding - b.outstanding, defaultSortOrder: 'descend' },
            { title: '最长逾期', dataIndex: 'maxOverdueDays', render: (v: number) => v > 0 ? <Tag color={v > 60 ? 'red' : v > 30 ? 'orange' : 'gold'}>{v}天</Tag> : '—', sorter: (a: any, b: any) => a.maxOverdueDays - b.maxOverdueDays },
            { title: '未结笔数', dataIndex: 'planCount' },
            { title: '风险等级', dataIndex: 'riskLevel', render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'green'}>{v === 'high' ? '高' : v === 'medium' ? '中' : '低'}</Tag> },
          ]}
        />
      </Card>
    </div>
  );
}
