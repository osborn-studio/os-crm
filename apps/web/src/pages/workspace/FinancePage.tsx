import { Alert, Button, Card, Space, Table, Tabs, Tag, Typography } from 'antd';
export default function FinancePage() {
  const features = [
    { name: '税务开票', description: '开票申请、电子发票、红字与作废、税务平台联动' },
    { name: '会计凭证', description: '凭证生成、科目映射、总账接口' },
    { name: '财务对账', description: '银行流水、往来对账、余额差异核查' },
    { name: '账龄分析', description: '应收分桶、逾期趋势与催收策略' },
  ];
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FINANCE DEMONSTRATION</div>
          <h1>财务功能展示</h1>
          <Typography.Text type="secondary">展示规划中的财务模块结构。</Typography.Text>
        </div>
      </div>
      <Alert
        type="info"
        showIcon
        message="收款登记与核销已有独立本地台账入口"
        description="支持登记、另一管理员复核、核销及撤销；不连接银行、不退款。以下税务、会计等仍为功能展示。"
        action={<Button href="/finance/ledger">进入收款台账</Button>}
        style={{ marginBottom: 20 }}
      />
      <Alert
        type="warning"
        showIcon
        message="演示系统，暂无功能"
        description="以下功能仅为前端展示，不会执行真实财务处理。回款计划等合成数据可在对应列表查看。"
        style={{ marginBottom: 20 }}
      />
      <Tabs
        items={features.map((f) => ({
          key: f.name,
          label: f.name,
          children: (
            <Card
              title={
                <Space>
                  {f.name}
                  <Tag>暂无功能</Tag>
                </Space>
              }
            >
              <Typography.Paragraph>{f.description}</Typography.Paragraph>
              <Space>
                <Button disabled type="primary">
                  新建处理
                </Button>
                <Button disabled>导入数据</Button>
                <Button disabled>提交审批</Button>
              </Space>
              <Table
                style={{ marginTop: 24 }}
                dataSource={[]}
                columns={[
                  { title: '单据编号', dataIndex: 'code' },
                  { title: '往来单位', dataIndex: 'customer' },
                  { title: '金额', dataIndex: 'amount' },
                  { title: '状态', dataIndex: 'status' },
                ]}
                locale={{ emptyText: '演示系统，暂无功能' }}
              />
            </Card>
          ),
        }))}
      />
    </div>
  );
}
