import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Tag, Typography, message } from 'antd';
import { authApi } from '../services/auth.api';
import {
  DashboardOutlined,
  TeamOutlined,
  FunnelPlotOutlined,
  FileTextOutlined,
  AccountBookOutlined,
  ProjectOutlined,
  AuditOutlined,
  SettingOutlined,
  RobotOutlined,
  LogoutOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/useAuthStore';
const { Header, Sider, Content } = Layout;
export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false),
    navigate = useNavigate(),
    location = useLocation();
  const { user, logout } = useAuthStore();
  const roles = user?.roles ?? [],
    isAdmin = roles.includes('super_admin'),
    roleName = isAdmin
      ? 'admin'
      : roles.includes('gm')
        ? '老板'
        : roles.includes('sales_manager')
          ? '销售主管'
          : '销售';
  const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '经营工作台' },
    {
      key: 'customer',
      icon: <TeamOutlined />,
      label: '客户经营',
      children: [
        { key: '/customers', label: '客户档案' },
        ...(isAdmin || roles.includes('sales_manager')
          ? [{ key: '/customer-operations', label: '客户导入 / 销售交接' }]
          : []),
        { key: '/contacts', label: '联系人' },
        { key: '/pool/public', label: '公海客户' },
        { key: '/pool/private', label: '私海客户' },
        { key: '/leads', label: '线索管理' },
        { key: '/followups', label: '跟进记录' },
        { key: '/actions', label: '行动计划' },
      ],
    },
    {
      key: 'sales',
      icon: <FunnelPlotOutlined />,
      label: '销售管理',
      children: [
        { key: '/opportunities', label: '商机与报价' },
        { key: '/opportunities/board', label: '商机看板' },
        { key: '/products', label: '产品目录' },
      ],
    },
    {
      key: 'contracts',
      icon: <FileTextOutlined />,
      label: '合同与订单',
      children: [
        { key: '/contracts', label: '合同管理' },
        { key: '/orders', label: '订单管理' },
      ],
    },
    {
      key: 'projects',
      icon: <ProjectOutlined />,
      label: '项目交付',
      children: [
        { key: '/projects', label: '项目总览' },
        { key: '/tasks', label: '项目任务' },
      ],
    },
    {
      key: 'finance',
      icon: <AccountBookOutlined />,
      label: '财务中心',
      children: [
        { key: '/finance/ledger', label: '收款登记与核销' },
        { key: '/finance/payment-plans', label: '回款计划 · 演示' },
        { key: '/invoices', label: '发票记录 · 演示' },
        { key: '/receipts', label: '收款记录 · 演示' },
        { key: '/finance/aging', label: '财务功能展示' },
      ],
    },
    { key: '/notifications', icon: <AuditOutlined />, label: '站内通知' },
    { key: '/approvals', icon: <AuditOutlined />, label: '审批中心' },
    { key: '/ai', icon: <RobotOutlined />, label: 'AI与智能体' },
    ...(isAdmin
      ? [
          { key: '/approval-designer', icon: <AuditOutlined />, label: '审批设计器' },
          { key: '/integrations', icon: <ApiOutlined />, label: '钉钉 / 飞书' },
          { key: '/system', icon: <SettingOutlined />, label: '系统管理' },
        ]
      : []),
  ];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={232}
        theme="light"
        style={{ borderRight: '1px solid #e2e8f0' }}
      >
        <div className="brand" onClick={() => navigate('/dashboard')}>
          <div className="brand-mark">伴</div>
          {!collapsed && (
            <div>
              <strong>伴圆 CRM</strong>
              <div style={{ fontSize: 10, letterSpacing: 2, color: '#64748b' }}>TB · CUSTOMER OS</div>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['customer', 'sales']}
          items={items}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
          style={{ border: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
            height: 64,
            padding: '0 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <Typography.Text strong>客户经营与销售协同</Typography.Text>
            <Tag style={{ marginLeft: 12 }} color="blue">
              商用建设预览
            </Tag>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'account', label: '账号与安全' },
                { key: 'logout', label: '退出登录', icon: <LogoutOutlined /> },
              ],
              onClick: async ({ key }) => {
                if (key === 'account') {
                  navigate('/account');
                  return;
                }
                try {
                  await authApi.logout();
                  logout();
                  navigate('/login');
                } catch {
                  message.error('服务器未确认退出，请重试或在账号与安全中撤销全部会话');
                }
              },
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <Tag>{roleName}</Tag>
              <Avatar style={{ background: '#1e40af' }}>{user?.name?.slice(0, 1)}</Avatar>
              <span>{user?.name}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ padding: 28, background: '#f5f7fb', minWidth: 0 }}>
          <Outlet key={user?.id} />
        </Content>
      </Layout>
    </Layout>
  );
}
