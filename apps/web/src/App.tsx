import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Result, Spin } from 'antd';
import { useAuthStore } from './stores/useAuthStore';
import BasicLayout from './layouts/BasicLayout';
const Login = lazy(() => import('./pages/login/LoginPage'));
const Dashboard = lazy(() => import('./pages/dashboard/DashboardPage'));
const Workspace = lazy(() => import('./pages/workspace/WorkspacePage'));
const Approval = lazy(() => import('./pages/approval/ApprovalCenterPage'));
const Designer = lazy(() => import('./pages/approval/FlowDesignerPage'));
const Integration = lazy(() => import('./pages/workspace/IntegrationPage'));
const System = lazy(() => import('./pages/workspace/SystemPage'));
const Account = lazy(() => import('./pages/workspace/AccountPage'));
const CustomerOperations = lazy(() => import('./pages/workspace/CustomerOperationsPage'));
const Ai = lazy(() => import('./pages/workspace/AiPage'));
const Notifications = lazy(() => import('./pages/notification/NotificationCenterPage'));
const Finance = lazy(() => import('./pages/workspace/FinancePage'));
const Board = lazy(() => import('./pages/workspace/BoardPage'));
function Private({ children }: { children: React.ReactNode }) {
  return useAuthStore((s) => s.accessToken) ? <>{children}</> : <Navigate to="/login" replace />;
}
function Admin({ children }: { children: React.ReactNode }) {
  return useAuthStore((s) => s.user?.roles.includes('super_admin')) ? (
    <>{children}</>
  ) : (
    <Result status="403" title="无权访问" subTitle="此功能仅限管理员" />
  );
}
function Supervisor({ children }: { children: React.ReactNode }) {
  return useAuthStore((s) => s.user?.roles.some((r) => ['super_admin', 'sales_manager'].includes(r))) ? (
    <>{children}</>
  ) : (
    <Result status="403" title="此功能仅限管理员或销售主管" />
  );
}
const routes: Record<string, string> = {
  customers: 'customers',
  contacts: 'contacts',
  leads: 'leads',
  followups: 'followups',
  actions: 'actions',
  opportunities: 'opportunities',
  contracts: 'contracts',
  orders: 'orders',
  projects: 'projects',
  tasks: 'tasks',
  products: 'products',
  'finance/payment-plans': 'payment-plans',
  invoices: 'invoices',
  receipts: 'receipts',
};
export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div style={{ padding: 80, textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Private>
                <BasicLayout />
              </Private>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            {Object.entries(routes).map(([path, kind]) => (
              <Route key={path} path={path} element={<Workspace key={kind} kind={kind} />} />
            ))}
            <Route path="pool/public" element={<Workspace key="public" kind="customers" poolType="public" />} />
            <Route path="pool/private" element={<Workspace key="private" kind="customers" poolType="private" />} />
            <Route path="opportunities/board" element={<Board />} />
            <Route
              path="customer-operations"
              element={
                <Supervisor>
                  <CustomerOperations />
                </Supervisor>
              }
            />
            <Route path="notifications" element={<Notifications />} />
            <Route path="approvals" element={<Approval />} />
            <Route
              path="approval-designer"
              element={
                <Admin>
                  <Designer />
                </Admin>
              }
            />
            <Route
              path="integrations"
              element={
                <Admin>
                  <Integration />
                </Admin>
              }
            />
            <Route
              path="system"
              element={
                <Admin>
                  <System />
                </Admin>
              }
            />
            <Route path="ai" element={<Ai />} />
            <Route path="account" element={<Account />} />
            <Route path="finance/aging" element={<Finance />} />
            <Route path="*" element={<Result status="404" title="页面不存在" />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
