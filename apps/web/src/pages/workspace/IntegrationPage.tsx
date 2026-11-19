import Table from '../../components/BusinessTable';
import NativeApprovalPanel from './NativeApprovalPanel';
import ActivitySyncPanel from './ActivitySyncPanel';
import DingTalkBridge from './DingTalkBridge';
import { useState, useEffect } from 'react';
import { Alert, Button, Card, Input, Space, Tag, Tabs, Typography, message } from 'antd';
import { get, post, errorText, type RecordRow } from '../../services/workspace';
interface Platform {
  code: string;
  name: string;
  configured: boolean;
  message: string;
  connected: boolean | null;
}
function AppIntegrations() {
  const [platforms, setPlatforms] = useState<Platform[]>([]),
    [rows, setRows] = useState<RecordRow[]>([]),
    [dept, setDept] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  useEffect(() => {
    get<Platform[]>('/integrations')
      .then(setPlatforms)
      .catch((e) => setError(errorText(e)));
  }, []);
  const run = async (code: string, type: string) => {
    setBusy(code);
    try {
      if (type === 'test') {
        const r = await post<{ message: string }>(`/integrations/${code}/test`, {});
        message.success(r.message);
      } else {
        const r = await get<{ items: RecordRow[]; hasMore: boolean }>(`/integrations/${code}/${type}`, {
          ...(dept ? (type === 'directory' ? { departmentId: dept } : { parentId: dept }) : {}),
        });
        setRows(r.items);
        if (r.hasMore) message.info('本次预览为第一页；接口支持cursor分页，完整导入尚未开放');
      }
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTED WORKSPACE</div>
          <h1>钉钉与飞书集成</h1>
          <Typography.Text type="secondary">真实应用令牌、部门与成员接口。未配置凭证时明确显示未连接。</Typography.Text>
        </div>
      </div>
      <Alert
        type="info"
        showIcon
        message="需在本机服务器环境配置应用凭证与所属CRM租户"
        description="应用需获得相应通讯录权限和可见范围。当前支持连接测试及只读预览，不会自动创建CRM用户、发送消息或同步审批。"
        style={{ marginBottom: 20 }}
      />
      {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {platforms.map((p) => (
          <Card
            key={p.code}
            title={
              <Space>
                {p.name}
                <Tag color={p.configured ? 'processing' : 'default'}>{p.configured ? '已配置，待验证' : '未配置'}</Tag>
              </Space>
            }
          >
            <Typography.Paragraph>{p.message}</Typography.Paragraph>
            <Space wrap>
              <Button
                disabled={!p.configured}
                loading={busy === p.code}
                type="primary"
                onClick={() => void run(p.code, 'test')}
              >
                真实连接测试
              </Button>
              <Input
                placeholder="部门ID（可选）"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                style={{ width: 200 }}
              />
              <Button disabled={!p.configured} onClick={() => void run(p.code, 'departments')}>
                部门预览
              </Button>
              <Button disabled={!p.configured} onClick={() => void run(p.code, 'directory')}>
                成员预览
              </Button>
            </Space>
          </Card>
        ))}
      </Space>
      <Card title="平台返回数据预览" style={{ marginTop: 24 }}>
        <Table
          rowKey="externalId"
          dataSource={rows}
          columns={[
            { title: '平台编号', dataIndex: 'externalId' },
            { title: '名称', dataIndex: 'name' },
            { title: '部门', dataIndex: 'departmentIds', render: (v) => v?.join(', ') ?? '—' },
          ]}
        />
      </Card>
    </div>
  );
}

export default function IntegrationPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTED WORKSPACE</div>
          <h1>集成与同步</h1>
        </div>
      </div>
      <Tabs
        items={[
          { key: 'bridge', label: '钉钉组织同步', children: <DingTalkBridge /> },
          {key:'native-approval',label:'钉钉原生审批（局域网）',children:<NativeApprovalPanel/>},
          { key: 'activities', label: '本人日程与审批提醒', children: <ActivitySyncPanel /> },
          { key: 'apps', label: '企业应用接口（高级）', children: <AppIntegrations /> },
        ]}
      />
    </div>
  );
}
