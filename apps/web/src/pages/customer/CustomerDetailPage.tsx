import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tabs, Tag, Button, Space, Spin, Row, Col, Statistic, Empty } from 'antd';
import { ArrowLeftOutlined, EditOutlined, UserOutlined, PhoneOutlined } from '@ant-design/icons';
import { customerApi } from '../../services/customer.api';
import dayjs from 'dayjs';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    if (id) {
      setLoading(true);
      customerApi.detail(+id).then((res: any) => setCustomer(res)).finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (!customer) return <Empty description="客户不存在" />;

  const stats = customer._stats || {};

  return (
    <div>
      {/* 页头 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate(-1)} />
          <h2 style={{ margin: 0 }}>{customer.name}</h2>
          {customer.level && <Tag color={customer.level === '重点客户' ? 'blue' : 'default'}>{customer.level}</Tag>}
          <Tag color={customer.status === 'active' ? 'green' : 'red'}>{customer.status === 'active' ? '活跃' : customer.status === 'churned' ? '流失' : '停用'}</Tag>
        </Space>
        <Space>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/customers/${id}/edit`)}>编辑</Button>
        </Space>
      </div>

      {/* KPI卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Statistic title="合同总额" value={customer.contractAmount || 0} prefix="¥" precision={0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="已回款" value={stats.totalReceived || 0} prefix="¥" precision={0} valueStyle={{ color: '#16a34a' }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="未回款" value={stats.totalOutstanding || 0} prefix="¥" precision={0} valueStyle={{ color: stats.totalOutstanding > 0 ? '#d97706' : undefined }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="活跃商机" value={stats.openOpportunities || 0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="在建项目" value={stats.activeProjects || 0} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="联系人" value={stats.contactCount || 0} /></Card></Col>
      </Row>

      {/* Tab详情 */}
      <Card>
        <Tabs defaultActiveKey="basic" items={[
          { key: 'basic', label: '基本信息', children: <BasicInfo customer={customer} /> },
          { key: 'contacts', label: `联系人(${stats.contactCount || 0})`, children: <Contacts contacts={customer.contacts || []} /> },
          { key: 'opportunities', label: '商机', children: <Empty description="S4上线" /> },
          { key: 'contracts', label: '合同', children: <Empty description="S6上线" /> },
          { key: 'finance', label: '发票回款', children: <Empty description="S9上线" /> },
          { key: 'projects', label: '项目', children: <Empty description="S10上线" /> },
          { key: 'followups', label: '跟进记录', children: <Empty description="S3上线" /> },
          { key: 'ai', label: 'AI画像', children: customer.aiProfile ? <pre style={{ fontSize: 12 }}>{JSON.stringify(JSON.parse(customer.aiProfile), null, 2)}</pre> : <Empty description="暂无AI画像（S11上线）" /> },
        ]} />
      </Card>
    </div>
  );
}

function BasicInfo({ customer }: { customer: any }) {
  return (
    <Descriptions column={3} bordered size="small">
      <Descriptions.Item label="客户编码">{customer.code}</Descriptions.Item>
      <Descriptions.Item label="客户全称">{customer.name}</Descriptions.Item>
      <Descriptions.Item label="客户简称">{customer.shortName || '—'}</Descriptions.Item>
      <Descriptions.Item label="行业">{customer.industry || '—'}</Descriptions.Item>
      <Descriptions.Item label="级别">{customer.level || '—'}</Descriptions.Item>
      <Descriptions.Item label="来源">{customer.source || '—'}</Descriptions.Item>
      <Descriptions.Item label="区域">{customer.region || '—'}</Descriptions.Item>
      <Descriptions.Item label="地址" span={2}>{customer.address || '—'}</Descriptions.Item>
      <Descriptions.Item label="纳税类别">{customer.taxType || '—'}</Descriptions.Item>
      <Descriptions.Item label="交易币种">{customer.currency || 'CNY'}</Descriptions.Item>
      <Descriptions.Item label="用友编码">{customer.yonyouCode || '—'}</Descriptions.Item>
      <Descriptions.Item label="用友产品">{customer.yonyouProduct || '—'}</Descriptions.Item>
      <Descriptions.Item label="用友模块" span={2}>{customer.yonyouModules || '—'}</Descriptions.Item>
      <Descriptions.Item label="服务结束日期">{customer.serviceExpiry ? dayjs(customer.serviceExpiry).format('YYYY-MM-DD') : '—'}</Descriptions.Item>
      <Descriptions.Item label="信用代码">{customer.creditCode || '—'}</Descriptions.Item>
      <Descriptions.Item label="法人代表">{customer.legalPerson || '—'}</Descriptions.Item>
      <Descriptions.Item label="池类型"><Tag>{customer.poolType}</Tag></Descriptions.Item>
      <Descriptions.Item label="保护期至">{customer.protectUntil ? dayjs(customer.protectUntil).format('YYYY-MM-DD') : '—'}</Descriptions.Item>
      <Descriptions.Item label="创建时间">{dayjs(customer.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
      <Descriptions.Item label="备注" span={3}>{customer.remark || '—'}</Descriptions.Item>
    </Descriptions>
  );
}

function Contacts({ contacts }: { contacts: any[] }) {
  if (!contacts.length) return <Empty description="暂无联系人" />;
  return (
    <div>
      {contacts.map((c: any) => (
        <Card key={c.id} size="small" style={{ marginBottom: 8 }}>
          <Space>
            <UserOutlined />
            <strong>{c.name}</strong>
            {c.isPrimary && <Tag color="blue">主要联系人</Tag>}
            {c.decisionRole && <Tag>{c.decisionRole}</Tag>}
            {c.title && <span style={{ color: '#64748b' }}>{c.title}</span>}
            {c.phone && <span><PhoneOutlined /> {c.phone}</span>}
            {c.email && <span>{c.email}</span>}
          </Space>
        </Card>
      ))}
    </div>
  );
}
