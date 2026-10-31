import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message, Typography, Segmented } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/useAuthStore';
import { authApi } from '../../services/auth.api';

const { Title, Text } = Typography;

export default function LoginPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onFinish = async (values: { tenantCode: string; username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      setAuth(res.accessToken, res.refreshToken, res.user);
      message.success(`欢迎回来，${res.user.name}`);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const msg = err?.response?.data?.message || '登录失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f1f5f9',
    }}>
      <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(15,23,42,.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={4} style={{ marginBottom: 4 }}>伴圆 CRM</Title>
          <Text type="secondary">AI 原生 · 客户经营与销售协同</Text>
        </div>
        <Text type="secondary">演示账号快捷填入</Text>
        <Segmented block style={{ marginBottom: 24 }} options={[{label:"admin",value:"admin"},{label:"销售主管",value:"manager"},{label:"销售",value:"sales"},{label:"老板",value:"boss"}]} onChange={username => form.setFieldsValue({username})}/><Form form={form} initialValues={{tenantCode:"TINGMENG",username:"admin"}} name="login" onFinish={onFinish} size="large" autoComplete="on">
          <Form.Item name="tenantCode" rules={[{ required: true, message: '请输入企业编码' }, { pattern: /^[A-Z][A-Z0-9_-]{1,29}$/, message: '企业编码为2至30位大写字母、数字、下划线或短横线' }]}>
            <Input placeholder="企业编码（安装时设置）" aria-label="企业编码" autoComplete="organization" />
          </Form.Item>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            伴圆 CRM · 本地安装与企业协同
          </Text>
        </div>
      </Card>
    </div>
  );
}
