import { Alert, Button, Card, Col, Row, Space, Tag, Typography } from 'antd';
export default function FinancePage() {
  return <div>
    <div className="page-heading"><div><div className="eyebrow">FINANCIAL SERVICES</div><h1>财务服务</h1><Typography.Text type="secondary">收款管理、应收分析与外部财务连接。</Typography.Text></div></div>
    <Row gutter={[16,16]}>
      <Col xs={24} lg={12}><Card title="本地收款台账" extra={<Tag color="blue">已开通</Tag>}><p>登记到账凭据、独立复核、核销、撤销与更正。</p><Button type="primary" href="/finance/ledger">进入收款台账</Button></Card></Col>
      <Col xs={24} lg={12}><Card title="回款与应收分析" extra={<Tag color="blue">已开通</Tag>}><p>回款统计、待收款与逾期账龄、负责人汇总和合同每月收款表。</p><Button type="primary" href="/analytics?tab=collections">查看回款分析</Button></Card></Col>
    </Row>
    <Alert type="info" style={{margin:'20px 0'}} showIcon message="银行、税务与会计连接尚未开通" description="当前台账不发起转账、退款、税务开票或会计记账。" />
    <Space wrap>{['银行流水与自动对账','税务开票','会计凭证及总账'].map(name=><Card key={name} size="small" title={name}><Tag>未开通</Tag><p>配置相应平台接口并验证后启用。</p></Card>)}</Space>
  </div>;
}
