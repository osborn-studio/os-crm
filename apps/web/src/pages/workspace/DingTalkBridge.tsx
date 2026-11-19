import Table from '../../components/BusinessTable';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { errorText, get, post, key } from '../../services/workspace';
interface Department {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  depth: number;
}
interface Person {
  externalId: string;
  name: string;
  departmentIds: string[];
  position: string | null;
}
interface Snapshot {
  companyName: string;
  readerName: string;
  capturedAt: string;
  complete: boolean;
  hasMore: boolean;
  failures: string[];
  departments: Department[];
  people: Person[];
}
interface Run {
  id: string;
  status: string;
  createdAt: string;
  snapshot: Snapshot | null;
  summary: Record<string, unknown> | null;
}
interface Mapping {
  kind: string;
  externalId: string;
  localId: number;
  externalName: string;
  bindingHash: string;
}
interface State {
  bound: boolean;
  bindingHash: string | null;
  connection: { enabled: boolean; updatedAt: string } | null;
  mappings: Mapping[];
  runs: Run[];
  departments: { id: number; name: string; parentId: number | null; status: number }[];
  users: { id: number; name: string; username: string; status: string }[];
}
type Choice = number | 'new' | 'skip';
const base = '/integrations/dingtalk-bridge';
const names: Record<string, string> = {
  reading: '读取中',
  ready: '待核对导入',
  applied: '已导入',
  partial: '读取不完整',
  failed: '读取失败',
  interrupted: '重启中断',
};
export default function DingTalkBridge() {
  const [state, setState] = useState<State>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [departments, setDepartments] = useState<Record<string, Choice>>({}),
    [people, setPeople] = useState<Record<string, Choice>>({}),
    [primary, setPrimary] = useState<Record<string, string>>({});
  const refresh = async () => {
    try {
      const next = await get<State>(base);
      setState(next);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  const run = state?.runs[0],
    snapshot = run?.snapshot;
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!state?.runs.some((r) => r.status === 'reading')) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(() => {
    if (!snapshot || !state) return;
    const initial = (kind: string, id: string, name: string): Choice =>
      state.mappings.find((m) => m.kind === kind && m.externalId === id)?.localId ??
      ((kind === 'user' ? state.users : state.departments).some((r) => r.name === name) ? 'skip' : 'new');
    setDepartments(
      Object.fromEntries(
        snapshot.departments
          .filter((d) => d.externalId !== '1')
          .map((d) => [d.externalId, initial('department', d.externalId, d.name)]),
      ),
    );
    setPeople(Object.fromEntries(snapshot.people.map((p) => [p.externalId, initial('user', p.externalId, p.name)])));
    setPrimary(
      Object.fromEntries(
        snapshot.people.filter((p) => p.departmentIds.length === 1).map((p) => [p.externalId, p.departmentIds[0]]),
      ),
    );
    // Reset choices only for a different completed preview, not on each status poll.
  }, [run?.id, run?.status, !!snapshot]);
  const act = async (name: string, path: string, body: object) => {
    setBusy(name);
    try {
      await post(base + path, { requestKey: key(), ...body });
      message.success(name === 'apply' ? '导入完成；新人员为停用状态，请到人员管理核对权限后启用' : '操作已提交');
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const enabled = state?.connection?.enabled ?? false;
  const choose = (kind: 'user' | 'department', externalId: string, value: Choice | undefined) => {
    const mapped = state?.mappings.some((m) => m.kind === kind && m.externalId === externalId);
    return (
      <Select
        style={{ minWidth: 190 }}
        value={value}
        disabled={!!mapped || run?.status !== 'ready'}
        options={[
          { value: 'new', label: kind === 'user' ? '新建（停用的销售账号）' : '新建部门' },
          { value: 'skip', label: '本次跳过' },
          ...(kind === 'user' ? (state?.users ?? []) : (state?.departments.filter((d) => d.status === 1) ?? [])).map(
            (r) => ({ value: r.id, label: `${r.name} · #${r.id}` }),
          ),
        ]}
        onChange={(v: Choice) =>
          kind === 'user'
            ? setPeople((old) => ({ ...old, [externalId]: v }))
            : setDepartments((old) => ({ ...old, [externalId]: v }))
        }
      />
    );
  };
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}
      <Card title="本机钉钉同步配置" extra={<Button onClick={() => void refresh()}>刷新状态</Button>}>
        <Alert
          type="info"
          showIcon
          message="企业通讯录 → CRM组织与人员"
          description="本机授权账号只能用于安装管理员绑定的公司。先读取、再核对对照表、最后导入；不向钉钉修改部门或人员。缺失记录不会自动删除或停用本地人员。"
          style={{ marginBottom: 16 }}
        />
        <Descriptions
          column={1}
          items={[
            {
              key: 'bound',
              label: '服务器授权',
              children: (
                <Tag color={state?.bound ? 'blue' : 'default'}>
                  {state?.bound ? '已绑定此公司，读取后验证企业身份' : '未绑定：请由服务器安装管理员配置'}
                </Tag>
              ),
            },
            {
              key: 'enabled',
              label: '组织同步',
              children: (
                <Switch
                  checked={enabled}
                  disabled={!state?.bound || !!busy}
                  loading={busy === 'settings'}
                  onChange={(value) =>
                    void act('settings', '/settings', {
                      enabled: value,
                      ...(state?.connection ? { expectedUpdatedAt: state.connection.updatedAt } : {}),
                    })
                  }
                  checkedChildren="已启用"
                  unCheckedChildren="已停用"
                />
              ),
            },
            {
              key: 'identity',
              label: '本次读取身份',
              children: snapshot ? `${snapshot.companyName} / ${snapshot.readerName}` : '尚未成功读取',
            },
            {
              key: 'scope',
              label: '权限规则',
              children:
                '已有人员只建立对应关系，保留角色、密码、状态与客户归属；新人员默认销售角色且停用，管理员核对后设置密码并启用。',
            },
          ]}
        />
        <Button
          type="primary"
          disabled={!enabled || !!busy || state?.runs.some((r) => r.status === 'reading')}
          loading={busy === 'preview' || state?.runs.some((r) => r.status === 'reading')}
          onClick={() => void act('preview', '/directory/preview', {})}
        >
          读取企业组织与人员
        </Button>
      </Card>
      {snapshot && (
        <Card
          title="导入前对照表"
          extra={
            <Tag color={snapshot.complete ? 'blue' : 'red'}>
              {snapshot.complete ? '本次读取完整' : '读取不完整，禁止导入'}
            </Tag>
          }
        >
          <Typography.Paragraph>
            读取时间：{new Date(snapshot.capturedAt).toLocaleString('zh-CN')}
            。根部门代表公司，不创建重复的公司部门。多部门人员须选择一个CRM归属部门，或明确暂不分配并保持停用；同名记录默认跳过，请核对后手动关联。
          </Typography.Paragraph>
          {!!snapshot.failures.length && <Alert type="error" message={snapshot.failures.join('；')} />}
          <Typography.Title level={5}>部门对照</Typography.Title>
          <Table
            size="small"
            rowKey="externalId"
            dataSource={snapshot.departments.filter((d) => d.externalId !== '1')}
            pagination={{ pageSize: 15 }}
            scroll={{ x: 700 }}
            columns={[
              {
                title: '钉钉部门',
                dataIndex: 'name',
                render: (name, row) => <span style={{ paddingLeft: (row.depth - 1) * 16 }}>{name}</span>,
              },
              {
                title: '钉钉上级',
                render: (_, row) =>
                  snapshot.departments.find((d) => d.externalId === row.parentExternalId)?.name ?? '公司',
              },
              {
                title: 'CRM对应部门',
                render: (_, row) => choose('department', row.externalId, departments[row.externalId]),
              },
            ]}
          />
          <Typography.Title level={5}>人员对照</Typography.Title>
          <Table
            size="small"
            rowKey="externalId"
            dataSource={snapshot.people}
            pagination={{ pageSize: 15 }}
            scroll={{ x: 850 }}
            columns={[
              { title: '钉钉人员', dataIndex: 'name' },
              { title: 'CRM对应人员', render: (_, row) => choose('user', row.externalId, people[row.externalId]) },
              {
                title: '新人员CRM归属部门',
                render: (_, row) => (
                  <Select
                    style={{ minWidth: 210 }}
                    placeholder="请选择一个所属部门"
                    value={primary[row.externalId]}
                    disabled={people[row.externalId] !== 'new' || run?.status !== 'ready'}
                    options={[
                      { value: '__unassigned__', label: '暂不分配部门（保持停用）' },
                      ...row.departmentIds.map((id) => ({
                        value: id,
                        label: snapshot.departments.find((d) => d.externalId === id)?.name ?? id,
                      })),
                    ]}
                    onChange={(v) => setPrimary((old) => ({ ...old, [row.externalId]: v }))}
                  />
                ),
              },
            ]}
          />
          <Button
            type="primary"
            loading={busy === 'apply'}
            disabled={
              !enabled ||
              run?.status !== 'ready' ||
              !snapshot.complete ||
              !!busy ||
              snapshot.people.some((p) => people[p.externalId] === 'new' && !primary[p.externalId])
            }
            onClick={() =>
              Modal.confirm({
                title: '按当前对照表导入？',
                content:
                  '部门和人员在同一事务导入。已有人员保留权限；新账号保持停用，不向员工发送通知。跳过上级部门时须同时跳过下级部门。',
                okText: '确认导入',
                cancelText: '返回核对',
                onOk: () =>
                  act('apply', '/directory/apply', {
                    runId: run?.id,
                    departments: snapshot.departments
                      .filter((d) => d.externalId !== '1')
                      .map((d) => ({
                        externalId: d.externalId,
                        localId: departments[d.externalId] === 'new' ? null : departments[d.externalId],
                      })),
                    people: snapshot.people.map((p) => ({
                      externalId: p.externalId,
                      localId: people[p.externalId] === 'new' ? null : people[p.externalId],
                      departmentExternalId:
                        primary[p.externalId] === '__unassigned__' ? null : (primary[p.externalId] ?? null),
                    })),
                  }),
              })
            }
          >
            核对完成，导入组织人员
          </Button>
        </Card>
      )}
      <Card title="已建立的对应关系">
        <Table
          size="small"
          rowKey="id"
          dataSource={state?.mappings}
          scroll={{ x: 600 }}
          columns={[
            { title: '对象', dataIndex: 'kind', render: (v) => (v === 'user' ? '人员' : '部门') },
            { title: '钉钉名称', dataIndex: 'externalName' },
            {
              title: '本地记录',
              render: (_, row) =>
                `${(row.kind === 'user' ? state?.users : state?.departments)?.find((r) => r.id === row.localId)?.name ?? '记录不可用'} · #${row.localId}`,
            },
          ]}
        />
      </Card>
      <Card title="同步记录">
        <Table
          size="small"
          rowKey="id"
          dataSource={state?.runs}
          columns={[
            { title: '时间', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString('zh-CN') },
            { title: '状态', dataIndex: 'status', render: (v) => <Tag>{names[v] ?? v}</Tag> },
            {
              title: '结果',
              render: (_, row) =>
                row.status === 'applied'
                  ? `新增部门${row.summary?.createdDepartments ?? 0}，人员${row.summary?.createdPeople ?? 0}，关联人员${row.summary?.linkedPeople ?? 0}，跳过${row.summary?.skipped ?? 0}`
                  : String(
                      row.summary?.message ??
                        (row.snapshot
                          ? `部门${row.snapshot.departments.length}，人员${row.snapshot.people.length}`
                          : ''),
                    ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
