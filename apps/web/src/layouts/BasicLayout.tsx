import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Tag, Typography, message, Button, Result } from 'antd';
import { menuAccess } from '../services/access';
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
  MenuOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/useAuthStore';
const { Header, Sider, Content } = Layout;
export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false),
    navigate = useNavigate(),
    location = useLocation();
  const [mobile, setMobile] = useState(false);
  const { user, logout } = useAuthStore();
  useEffect(() => {
    void authApi
      .getMe()
      .then((profile) => {
        const current = useAuthStore.getState();
        if (current.user?.id === profile.id && current.accessToken && current.refreshToken)
          current.setAuth(current.accessToken, current.refreshToken, {
            ...current.user,
            permissions: profile.permissions,
            dataScope: profile.dataScope,
          });
      })
      .catch(() => {
        /* Authentication handler manages revoked sessions. */
      });
  }, []);
  const fictionalDemo = user?.company?.code === 'TIANYU' && user?.company?.purpose === 'test';
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
    { key: '/calendar', icon: <AuditOutlined />, label: '日程与业务推进' },
    { key: '/analytics', icon: <DashboardOutlined />, label: '合同与收款统计' },
    {
      key: 'customer',
      icon: <TeamOutlined />,
      label: '客户经营',
      children: [
        { key: '/customers', label: '客户档案' },
        ...(isAdmin || roles.includes('sales_manager')
          ? [
              { key: '/customer-allocation', label: '客户分配工作台' },
              { key: '/customer-operations', label: '客户导入 / 销售交接' },
            ]
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
        ...(isAdmin ? [{ key: '/business-knowledge', label: '产品报价与项目知识' }] : []),
      ],
    },
    {
      key: 'contracts',
      icon: <FileTextOutlined />,
      label: '合同与订单',
      children: [
        { key: '/contracts', label: '合同管理' },
        { key: '/orders', label: '订单管理' },
        ...(isAdmin ? [{ key: '/business-rules', label: '内部提醒与审批规则' }] : []),
        ...(isAdmin ? [{ key: '/source-archives', label: '历史资料与补录来源' }] : []),
      ],
    },
    {
      key: 'projects',
      icon: <ProjectOutlined />,
      label: '项目交付',
      children: [
        { key: '/projects', label: '项目总览' },
        { key: '/tasks', label: '项目任务' },
        { key: '/service-tickets', label: '售后服务工单' },
      ],
    },
    {
      key: 'finance',
      icon: <AccountBookOutlined />,
      label: '财务中心',
      children: [
        { key: '/finance/ledger', label: '收款登记与核销' },
        { key: '/finance/payment-plans', label: '收款计划' },
        { key: '/invoices', label: '发票记录' },
        { key: '/receipts', label: '历史收款记录' },
        { key: '/finance/aging', label: '财务服务' },
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
        breakpoint="lg"
        collapsedWidth={mobile ? 0 : 80}
        onBreakpoint={(broken) => {
          setMobile(broken);
          setCollapsed(broken);
        }}
        theme="light"
        style={{
          borderRight: '1px solid #e2e8f0',
          ...(mobile ? { position: 'fixed', height: '100dvh', zIndex: 1000, overflow: 'auto' } : {}),
        }}
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
          items={items.flatMap<(typeof items)[number]>((item) => {
            if ('children' in item && item.children) {
              const children = item.children.filter((child) => menuAccess(child.key, user?.permissions ?? [], isAdmin));
              return children.length ? [{ ...item, children }] : [];
            }
            return menuAccess(item.key, user?.permissions ?? [], isAdmin) ? [item] : [];
          })}
          onClick={({ key }) => {
            if (mobile) setCollapsed(true);
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
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {mobile && (
              <Button
                aria-label="打开导航"
                icon={<MenuOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ marginRight: 8 }}
              />
            )}
            <Typography.Text strong>客户经营与销售协同</Typography.Text>
            <Tag
              className="company-badge"
              style={{
                marginLeft: 12,
                maxWidth: mobile ? 'calc(100vw - 120px)' : 360,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              color={user?.company?.purpose === 'test' ? 'orange' : 'blue'}
            >
              {fictionalDemo ? '虚构演示数据' : user?.company?.purpose === 'test' ? '测试帐套' : '正式帐套'} ·{' '}
              {user?.company?.name ?? sessionStorage.getItem('companyCode')}
            </Tag>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'account', label: '账号与安全' },
                { key: 'switch-company', label: '切换公司帐套' },
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
            <div
              aria-label="当前账号菜单"
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}
            >
              {!mobile && <Tag>{roleName}</Tag>}
              <Avatar style={{ background: '#1e40af' }}>{user?.name?.slice(0, 1)}</Avatar>
              {!mobile && <span>{user?.name}</span>}
            </div>
          </Dropdown>
        </Header>
        <Content style={{ padding: 28, background: '#f5f7fb', minWidth: 0 }}>
          {menuAccess(location.pathname, user?.permissions ?? [], isAdmin) ? (
            <Outlet key={`${sessionStorage.getItem('companyCode')}:${user?.id}`} />
          ) : (
            <Result status="403" title="当前角色未获此功能权限" subTitle="请由管理员在角色功能权限中配置" />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
