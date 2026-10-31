import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, message } from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  current: boolean;
}
export default function AccountPage() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [version, setVersion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate(),
    logout = useAuthStore((s) => s.logout);
  const load = async () => {
    try {
      const [me, rows] = await Promise.all([get<{ updatedAt: string }>('/auth/me'), get<Session[]>('/auth/sessions')]);
      setVersion(me.updatedAt);
      setSessions(rows);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const leave = () => {
    logout();
    navigate('/login', { replace: true });
  };
  return (
    <div>
      <div className="page-heading">
        <h1>账号与安全</h1>
        <Button onClick={() => void load()}>刷新</Button>
      </div>
      {error && <Alert type="error" message={error} />}
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="修改密码">
          <Alert type="info" message="修改密码后全部设备会话失效，请使用新密码重新登录。" />
          <Form
            layout="vertical"
            style={{ maxWidth: 480, marginTop: 16 }}
            onFinish={async (values: { currentPassword: string; newPassword: string }) => {
              setBusy(true);
              try {
                await post('/auth/password', {
                  requestKey: key(),
                  expectedUpdatedAt: version,
                  currentPassword: values.currentPassword,
                  newPassword: values.newPassword,
                });
                message.success('密码已更新，请重新登录');
                leave();
              } catch (e) {
                message.error(errorText(e));
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item name="currentPassword" label="原密码" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, min: 12 },
                { pattern: /(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/, message: '需要大小写字母和数字' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator(_, value: string) {
                    return value === getFieldValue('newPassword')
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次输入不一致'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button htmlType="submit" type="primary" loading={busy} disabled={!version}>
              修改密码并重新登录
            </Button>
          </Form>
        </Card>
        <Card
          title="有效会话"
          extra={
            <Button
              danger
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post('/auth/sessions/revoke-all', {});
                  message.success('全部会话已撤销');
                  leave();
                } catch (e) {
                  message.error(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              退出全部设备
            </Button>
          }
        >
          <Table
            rowKey="id"
            dataSource={sessions}
            pagination={false}
            columns={[
              {
                title: '会话',
                dataIndex: 'current',
                render: (current: boolean) => (current ? <Tag color="green">当前会话</Tag> : <Tag>其他会话</Tag>),
              },
              { title: '登录时间', dataIndex: 'createdAt', render: (s: string) => new Date(s).toLocaleString() },
              { title: '最近刷新', dataIndex: 'updatedAt', render: (s: string) => new Date(s).toLocaleString() },
              { title: '最长有效期', dataIndex: 'expiresAt', render: (s: string) => new Date(s).toLocaleString() },
            ]}
          />
        </Card>
      </Space>
    </div>
  );
}
