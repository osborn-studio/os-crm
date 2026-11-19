import Table from '../../components/BusinessTable';
import BusinessSort,{type BusinessSortValue} from '../../components/BusinessSort';
import AccessPolicyPanel from './AccessPolicyPanel';
import { useEffect, useState, useRef } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post, put, key, errorText, type RecordRow } from '../../services/workspace';
type DepartmentNode = RecordRow & { children?: DepartmentNode[] };
interface PersonPolicy {
  user: { id: number; name: string; username: string; status: string; department: { id: number; name: string } | null };
  roles: { id: number; name: string; code: string }[];
  dataScope: string;
  configuredPoints: string[];
  catalog: { code: string; label: string }[];
  assignedCustomers: number;
  notice: string;
}
function departmentTree(rows: RecordRow[]): DepartmentNode[] {
  const nodes = new Map(rows.map((r) => [r.id, { ...r } as DepartmentNode]));
  const roots: DepartmentNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const seen = new Set([row.id]);
    let parentId = Number(row.parentId),
      cyclic = false;
    while (parentId && nodes.has(parentId)) {
      if (seen.has(parentId)) {
        cyclic = true;
        break;
      }
      seen.add(parentId);
      parentId = Number(nodes.get(parentId)!.parentId);
    }
    const parent = nodes.get(Number(row.parentId));
    if (parent && !cyclic) (parent.children ??= []).push(node);
    else roots.push(node);
  }
  return roots;
}
export default function SystemPage() {
  const navigate = useNavigate();
  const [sorting,setSorting]=useState<BusinessSortValue>({sortBy:'id',sortOrder:'asc'});
  const [activeTab, setActiveTab] = useState('users'),
    [personPolicy, setPersonPolicy] = useState<PersonPolicy>(),
    [policyTarget, setPolicyTarget] = useState<number>(),
    [policyPanelKey, setPolicyPanelKey] = useState(0);
  const inspect = async (personId: number) => {
    try {
      setPersonPolicy(await get<PersonPolicy>('/system/access-policy/people/' + personId));
    } catch (e) {
      message.error(errorText(e));
    }
  };
  const [users, setUsers] = useState<RecordRow[]>([]),
    [roles, setRoles] = useState<RecordRow[]>([]),
    [depts, setDepts] = useState<RecordRow[]>([]),
    [audit, setAudit] = useState<RecordRow[]>([]),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<RecordRow>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [resetUser, setResetUser] = useState<RecordRow>();
  const [password, setPassword] = useState('');
  const userKey = useRef(key()),
    departmentKey = useRef(key()),
    resetKey = useRef(key());
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [keyword, setKeyword] = useState(''),
    [activeUsers, setActiveUsers] = useState<RecordRow[]>([]);
  const [departmentOpen, setDepartmentOpen] = useState(false),
    [department, setDepartment] = useState<RecordRow>();
  const [departmentForm] = Form.useForm();
  const [form] = Form.useForm();
  const load = async () => {
    try {
      const [u, r, d, a, active] = await Promise.all([
        get<{ items: RecordRow[]; meta: { total: number } }>('/system/users', { page, pageSize: 20, keyword, ...sorting }),
        get<RecordRow[]>('/system/roles'),
        get<RecordRow[]>('/system/departments/tree'),
        get<{ items: RecordRow[] }>('/system/audit-logs', { pageSize: 50 }),
        get<{ items: RecordRow[] }>('/system/users', { pageSize: 100, status: 'active' }),
      ]);
      setUsers(u.items);
      setTotal(u.meta.total);
      setActiveUsers(active.items);
      setRoles(r.filter((role) => ['super_admin', 'sales_manager', 'sales', 'gm'].includes(String(role.code))));
      setDepts(d);
      setAudit(a.items);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, [page, keyword,sorting.sortBy,sorting.sortOrder]);
  const edit = (u?: RecordRow) => {
    setEditing(u);
    userKey.current = key();
    form.resetFields();
    if (u)
      form.setFieldsValue({
        name: u.name,
        username: u.username,
        phone: u.phone,
        deptId: (u.dept as RecordRow)?.id,
        roleIds: (u.roles as RecordRow[]).map((r) => r.id),
        status: u.status,
      });
    setOpen(true);
  };
  const save = async () => {
    try {
      const data = await form.validateFields();
      setBusy(true);
      if (editing) {
        delete data.username;
        delete data.password;
        await put(`/system/users/${editing.id}`, {
          requestKey: userKey.current,
          expectedUpdatedAt: editing.updatedAt,
          data,
        });
      } else await post('/system/users', { requestKey: userKey.current, data });
      setOpen(false);
      message.success('用户已保存');
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const editDepartment = (row?: RecordRow) => {
    setDepartment(row);
    departmentKey.current = key();
    departmentForm.resetFields();
    departmentForm.setFieldsValue(
      row
        ? { name: row.name, code: row.code, parentId: row.parentId, leaderId: row.leaderId, status: row.status }
        : { status: 1, parentId: null, leaderId: null },
    );
    setDepartmentOpen(true);
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRATION</div>
          <h1>系统管理</h1>
          <Typography.Text type="secondary">管理员维护账号与组织，权限变更在后续请求中生效。</Typography.Text>
        </div>
        <Button type="primary" onClick={() => edit()}>
          新建用户
        </Button>
      </div>
      <Input.Search
        style={{ maxWidth: 360, marginBottom: 16 }}
        placeholder="查找账号或姓名"
        allowClear
        onSearch={(value) => {
          setPage(1);
          setKeyword(value);
        }}
      />
      <Button style={{ marginLeft: 12 }} onClick={() => void load()}>
        刷新
      </Button>
      {error && <Alert message={error} type="error" showIcon />}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'network',
            label: '公司帐套 / 外网配置',
            children: (
              <Card title="本地、局域网与外网访问配置">
                <Typography.Paragraph>
                  系统当前支持本机和局域网。服务器管理员可配置HTTPS域名或VPN入口、生成反向代理配置，并检查公司服务状态。
                </Typography.Paragraph>
                <Alert
                  type="info"
                  showIcon
                  message="外网配置影响整台服务器上的公司帐套，须在服务器本机使用独立管理口令操作。公司业务密码不能代替本机管理口令。"
                  style={{ marginBottom: 16 }}
                />
                <Button
                  type="primary"
                  href="/__accounts#remote"
                  target="_blank"
                  rel="noopener noreferrer"
                  disabled={!['localhost', '127.0.0.1'].includes(window.location.hostname)}
                >
                  打开外网配置页面
                </Button>
                {!['localhost', '127.0.0.1'].includes(window.location.hostname) && (
                  <Typography.Paragraph style={{ marginTop: 12 }}>
                    请在服务器本机浏览器打开 http://localhost:{window.location.port || '3000'}/__accounts#remote。
                  </Typography.Paragraph>
                )}
              </Card>
            ),
          },
          {
            key: 'users',
            label: '用户账号',
            children: (
              <Card>
                <BusinessSort value={sorting} fields={[{key:'id',label:'录入顺序'},{key:'createdAt',label:'录入日期'},{key:'name',label:'姓名'},{key:'username',label:'登录账号'},{key:'employeeNo',label:'人员编号'},{key:'status',label:'状态'}]} onChange={v=>{setPage(1);setSorting(v);}}/>
                <Table
                  rowKey="id"
                  scroll={{ x: 1000 }}
                  dataSource={users}
                  serverSorted pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                  columns={[
                    { title: '人员编号', dataIndex: 'employeeNo' },
                    { title: '手机号', dataIndex: 'phone' },
                    { title: '姓名', dataIndex: 'name' },
                    { title: '部门', dataIndex: 'dept', render: (v) => v?.name ?? '—' },
                    {
                      title: '角色',
                      dataIndex: 'roles',
                      render: (v: RecordRow[]) => v.map((r) => <Tag key={r.id}>{String(r.name)}</Tag>),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      render: (value: string) => (
                        <Tag color={value === 'active' ? 'processing' : 'default'}>
                          {{ active: '启用', inactive: '停用', resigned: '离职' }[value] ?? value}
                        </Tag>
                      ),
                    },
                    {
                      title: '操作',
                      render: (_, r) => (
                        <Space>
                          <Button type="link" onClick={() => edit(r)}>
                            编辑 / 停用
                          </Button>
                          <Button type="link" onClick={() => void inspect(r.id)}>
                            有效权限
                          </Button>
                          <Button type="link" onClick={() => navigate('/customer-allocation?ownerId=' + r.id)}>
                            名下客户
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (r) => (
                      <Button
                        onClick={() => {
                          setResetUser(r);
                          resetKey.current = key();
                          setPassword('');
                        }}
                      >
                        重置密码并撤销全部会话
                      </Button>
                    ),
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'roles',
            label: '角色权限',
            children: <AccessPolicyPanel key={policyPanelKey} initialRoleId={policyTarget} />,
          },
          {
            key: 'departments',
            label: '组织部门',
            children: (
              <Card title="公司组织架构" extra={<Button onClick={() => editDepartment()}>新建部门</Button>}>
                <Typography.Paragraph type="secondary">
                  当前公司内建立部门层级、负责人和人员归属。主管默认查看本部门团队，销售查看本人及公海；角色决定功能权限。停用/调岗前须交接客户、业务、审批与交付责任。
                </Typography.Paragraph>
                <Table
                  rowKey="id"
                  dataSource={departmentTree(depts)}
                  expandable={{ defaultExpandAllRows: true }}
                  pagination={false}
                  columns={[
                    { title: '部门', dataIndex: 'name' },
                    { title: '编码', dataIndex: 'code' },
                    {
                      title: '部门负责人',
                      dataIndex: 'leaderId',
                      render: (v: number | null) =>
                        (activeUsers.find((u) => u.id === v)?.name as string) ?? (v ? `人员#${v}` : '未设置'),
                    },
                    { title: '状态', dataIndex: 'status', render: (s: number) => (s === 1 ? '有效' : '停用') },
                    {
                      title: '操作',
                      render: (_, row) => (
                        <Button type="link" onClick={() => editDepartment(row)}>
                          编辑 / 停用
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'audit',
            label: '业务审计（最近50条）',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={audit}
                  columns={[
                    { title: '操作', dataIndex: 'action' },
                    { title: '对象', dataIndex: 'objectType' },
                    { title: '操作人', dataIndex: 'userId' },
                    { title: '时间', dataIndex: 'createdAt', render: (v) => String(v).replace('T', ' ').slice(0, 19) },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => {
            userKey.current = key();
          }}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="phone" label="手机号（可登录）"><Input maxLength={30} /></Form.Item>
          <Form.Item name="name" label="真实姓名（仅展示）" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="deptId" label="部门">
            <Select
              options={depts
                .filter((d) => d.status === 1)
                .map((d) => ({
                  value: d.id,
                  label: `${depts.find((p) => p.id === d.parentId)?.name ? String(depts.find((p) => p.id === d.parentId)?.name) + ' / ' : ''}${String(d.name)}`,
                }))}
            />
          </Form.Item>
          <Form.Item name="roleIds" label="角色（四选一）" rules={[{ required: true }]}>
            <Select mode="multiple" maxCount={1} options={roles.map((r) => ({ value: r.id, label: String(r.name) }))} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'active', label: '有效' },
                  { value: 'inactive', label: '停用' },
                  { value: 'resigned', label: '离职' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Modal
        title={department ? '编辑部门' : '新建部门'}
        open={departmentOpen}
        onCancel={() => setDepartmentOpen(false)}
        confirmLoading={busy}
        onOk={async () => {
          try {
            const data = await departmentForm.validateFields();
            setBusy(true);
            if (department)
              await put(`/system/departments/${department.id}`, {
                requestKey: departmentKey.current,
                expectedUpdatedAt: department.updatedAt,
                data,
              });
            else await post('/system/departments', { requestKey: departmentKey.current, data });
            setDepartmentOpen(false);
            message.success('部门已保存');
            await load();
          } catch (e) {
            if (!(e && typeof e === 'object' && 'errorFields' in e)) message.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form
          form={departmentForm}
          layout="vertical"
          onValuesChange={() => {
            departmentKey.current = key();
          }}
        >
          <Form.Item name="name" label="部门名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="编码">
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="上级部门">
            <Select
              allowClear
              onChange={(v) => departmentForm.setFieldValue('parentId', v ?? null)}
              options={depts
                .filter((d) => d.id !== department?.id && d.status === 1)
                .map((d) => ({ value: d.id, label: String(d.name) }))}
            />
          </Form.Item>
          {department && (
            <Form.Item name="leaderId" label="负责人（先将用户分配到本部门）">
              <Select
                allowClear
                onChange={(v) => departmentForm.setFieldValue('leaderId', v ?? null)}
                options={activeUsers
                  .filter((u) => u.deptId === department.id && u.status === 'active')
                  .map((u) => ({ value: u.id, label: String(u.name) }))}
              />
            </Form.Item>
          )}
          {department && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 1, label: '有效' },
                  { value: 0, label: '停用（须先迁移成员和子部门）' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Modal
        title="重置用户密码"
        open={!!resetUser}
        onCancel={() => setResetUser(undefined)}
        onOk={async () => {
          if (!resetUser || busy) return;
          setBusy(true);
          try {
            await post(`/system/users/${resetUser.id}/reset-password`, {
              requestKey: resetKey.current,
              expectedUpdatedAt: resetUser.updatedAt,
              data: { password },
            });
            setResetUser(undefined);
            message.success('密码已重置，该用户全部会话已撤销');
            await load();
          } catch (e) {
            message.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
        confirmLoading={busy}
      >
        <Alert type="info" message="密码至少12位，含大小写字母和数字；重置后所有设备需要重新登录。" />
        <Input.Password
          style={{ marginTop: 16 }}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            resetKey.current = key();
          }}
          autoComplete="new-password"
          placeholder="新密码"
        />
      </Modal>
      <Modal
        title="人员有效权限与客户归属"
        open={!!personPolicy}
        onCancel={() => setPersonPolicy(undefined)}
        footer={
          personPolicy ? (
            <Space>
              <Button onClick={() => navigate('/customer-allocation?ownerId=' + personPolicy.user.id)}>
                查看名下客户
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  setPolicyTarget(personPolicy.roles[0]?.id);
                  setPolicyPanelKey((v) => v + 1);
                  setActiveTab('roles');
                  setPersonPolicy(undefined);
                }}
              >
                配置所属角色权限
              </Button>
            </Space>
          ) : null
        }
        width={800}
      >
        {personPolicy && (
          <>
            <Alert type="info" showIcon message={personPolicy.notice} />
            <Descriptions
              column={1}
              style={{ marginTop: 16 }}
              items={[
                { key: 'user', label: '人员', children: personPolicy.user.name + ' / ' + personPolicy.user.username },
                { key: 'department', label: '所属部门', children: personPolicy.user.department?.name ?? '未分配' },
                { key: 'roles', label: '所属角色', children: personPolicy.roles.map((r) => r.name).join('、') },
                {
                  key: 'scope',
                  label: '数据范围',
                  children: (
                    {
                      self: '本人及显式协作',
                      dept: '本部门（含停用人员名下资料，不含下级）',
                      all: '当前公司',
                      team: '本部门',
                      custom: '本人（未开放自定义组）',
                    } as Record<string, string>
                  )[personPolicy.dataScope],
                },
                { key: 'customers', label: '名下客户', children: personPolicy.assignedCustomers },
              ]}
            />
            <Typography.Paragraph>
              修改角色矩阵会影响同一角色的全部人员；人员角色调整请使用“编辑 / 停用”。
            </Typography.Paragraph>
            <Space wrap>
              {personPolicy.catalog
                .filter((p) => personPolicy.configuredPoints.includes(p.code))
                .map((p) => (
                  <Tag key={p.code}>{p.label}</Tag>
                ))}
            </Space>
          </>
        )}
      </Modal>
    </div>
  );
}
