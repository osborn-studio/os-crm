import Table from '../../components/BusinessTable';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Modal, Select, Space, Typography, message } from 'antd';
import { errorText, get, key, post } from '../../services/workspace';
interface PolicyRole {
  id: number;
  name: string;
  code: string;
  dataScope: string;
  configuredPoints: string[];
  updatedAt: string;
  editable: boolean;
  _count: { userRoles: number };
}
interface State {
  catalog: { code: string; label: string; module: string }[];
  scopes: { code: string; name: string }[];
  roles: PolicyRole[];
}
export default function AccessPolicyPanel({ initialRoleId }: { initialRoleId?: number }) {
  const [state, setState] = useState<State>(),
    [roleId, setRoleId] = useState<number | undefined>(initialRoleId),
    [points, setPoints] = useState<string[]>([]),
    [scope, setScope] = useState('self'),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const requestKey = useRef(key());
  const refresh = async () => {
    try {
      setState(await get<State>('/system/access-policy'));
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const role = state?.roles.find((r) => r.id === roleId);
  useEffect(() => {
    if (role) {
      setPoints(role.configuredPoints);
      setScope(role.dataScope);
      requestKey.current = key();
    }
  }, [role]);
  const save = async () => {
    if (!role) return;
    setSaving(true);
    try {
      const r = await post<{ affectedPeople: number }>('/system/access-policy/roles/' + role.id, {
        requestKey: requestKey.current,
        expectedUpdatedAt: role.updatedAt,
        permissions: points,
        dataScope: scope,
      });
      message.success(`已更新，${r.affectedPeople}位成员需重新登录`);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      message.error(errorText(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };
  type Point = State['catalog'][number];
  type Group = { module: string; label: string; points: Point[] };
  const groups: Group[] = [...new Set(state?.catalog.map((p) => p.module) ?? [])].map((module) => {
    const entries = state?.catalog.filter((p) => p.module === module) ?? [];
    return {
      module,
      label: module === 'pool' ? '公海与回收' : (entries[0]?.label.split('：')[0] ?? module),
      points: entries,
    };
  });
  const check = (point: Point | undefined) =>
    point ? (
      <Checkbox
        aria-label={point.label}
        checked={points.includes(point.code)}
        disabled={!role?.editable || (role.code === 'sales' && point.code === 'customer:assign')}
        onChange={(e) => {
          setPoints((old) => (e.target.checked ? [...old, point.code] : old.filter((p) => p !== point.code)));
          requestKey.current = key();
        }}
      />
    ) : (
      '—'
    );
  return (
    <Card title="角色功能与数据权限" extra={<Button onClick={() => void refresh()}>刷新</Button>}>
      <Alert
        type="info"
        showIcon
        message="权限由角色分配给人员，修改影响该角色的全部成员"
        description="销售及主管可配置下列业务功能和数据范围。管理员/老板保留预置职责；审批、财务复核等职责还需满足业务规则。公海及显式指派的协作按各业务规则处理，部门范围不自动包含下级部门。保存后旧会话撤销，员工重新登录后使用新权限。"
        style={{ marginBottom: 16 }}
      />
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择要配置的角色"
          value={roleId}
          style={{ width: 220 }}
          options={state?.roles.map((r) => ({ value: r.id, label: `${r.name} · ${r._count.userRoles}人` }))}
          onChange={setRoleId}
        />
        <Select
          aria-label="角色数据范围"
          disabled={!role?.editable}
          value={scope}
          style={{ width: 270 }}
          options={state?.scopes.map((s) => ({ value: s.code, label: s.name }))}
          onChange={(v) => {
            setScope(v);
            requestKey.current = key();
          }}
        />
        <Button
          type="primary"
          disabled={!role?.editable}
          loading={saving}
          onClick={() =>
            Modal.confirm({
              title: '保存角色功能及数据范围？',
              content: `将影响${role?._count.userRoles ?? 0}位人员，其旧会话将撤销。未完成审批或交付责任可能需要先交接。`,
              okText: '确认保存',
              cancelText: '返回',
              onOk: save,
            })
          }
        >
          保存权限
        </Button>
      </Space>
      {role && !role.editable && (
        <Typography.Paragraph type="secondary">
          该角色使用固定职责，不能通过此表移除管理员或改变老板的只读业务定位。
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type="secondary">
        新增/编辑需要查看权限；关联销售业务需要客户查看，回款统计还需要合同查看。敏感业务操作仍需符合审批及管理职责。
      </Typography.Paragraph>
      <Table<Group>
        rowKey="module"
        size="small"
        pagination={false}
        dataSource={groups}
        scroll={{ x: 800 }}
        columns={[
          { title: '业务模块', dataIndex: 'label', width: 180 },
          ...(['read', 'create', 'update'] as const).map((action) => ({
            title: { read: '查看', create: '新增', update: '编辑/业务操作' }[action],
            width: action === 'update' ? 130 : 80,
            render: (_: unknown, row: Group) =>
              check(row.points.find((point) => point.code === row.module + ':' + action)),
          })),
          {
            title: '专项操作',
            render: (_, row) => (
              <Space wrap>
                {row.points
                  .filter((point) => !['read', 'create', 'update'].includes(point.code.split(':')[1]))
                  .map((point) => (
                    <Space key={point.code}>
                      {check(point)}
                      <span>{point.label.split('：').slice(1).join('：')}</span>
                    </Space>
                  ))}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
