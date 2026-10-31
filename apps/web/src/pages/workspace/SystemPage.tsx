import { useEffect, useState, useRef } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Table, Tag, Tabs, Typography, message } from 'antd';
import { get, post, put, key, errorText, type RecordRow } from '../../services/workspace';
export default function SystemPage() {
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
        get<{ items: RecordRow[]; meta: { total: number } }>('/system/users', { page, pageSize: 20, keyword }),
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
  }, [page, keyword]);
  const edit = (u?: RecordRow) => {
    setEditing(u);
    userKey.current = key();
    form.resetFields();
    if (u)
      form.setFieldsValue({
        name: u.name,
        username: u.username,
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
        items={[
          {
            key: 'users',
            label: '用户账号',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={users}
                  pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }}
                  columns={[
                    { title: '账号', dataIndex: 'username' },
                    { title: '姓名', dataIndex: 'name' },
                    { title: '部门', dataIndex: 'dept', render: (v) => v?.name ?? '—' },
                    {
                      title: '角色',
                      dataIndex: 'roles',
                      render: (v: RecordRow[]) => v.map((r) => <Tag key={r.id}>{String(r.name)}</Tag>),
                    },
                    { title: '状态', dataIndex: 'status' },
                    {
                      title: '操作',
                      render: (_, r) => (
                        <Button type="link" onClick={() => edit(r)}>
                          编辑 / 停用
                        </Button>
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
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={roles}
                  columns={[
                    { title: '角色', dataIndex: 'name' },
                    { title: '编码', dataIndex: 'code' },
                    { title: '数据范围', dataIndex: 'dataScope' },
                    {
                      title: '权限',
                      dataIndex: 'permissions',
                      render: (v: string[]) => v?.map((p) => <Tag key={p}>{p}</Tag>),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'departments',
            label: '组织部门',
            children: (
              <Card extra={<Button onClick={() => editDepartment()}>新建部门</Button>}>
                <Table
                  rowKey="id"
                  dataSource={depts}
                  pagination={false}
                  columns={[
                    { title: '部门', dataIndex: 'name' },
                    { title: '编码', dataIndex: 'code' },
                    { title: '负责人编号', dataIndex: 'leaderId' },
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
            label: '业务审计',
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
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="deptId" label="部门">
            <Select
              options={depts.filter((d) => d.status === 1).map((d) => ({ value: d.id, label: String(d.name) }))}
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
    </div>
  );
}
