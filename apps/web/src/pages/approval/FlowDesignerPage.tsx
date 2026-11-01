import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { get, post, key, errorText, type RecordRow } from '../../services/workspace';
interface Node {
  nodeName: string;
  approverType: string;
  approverValue: string;
  conditionExpr: string;
}
interface Flow extends RecordRow {
  name: string;
  bizType: string;
  version: number;
  isActive: boolean;
  priority: number;
  conditionExpr: string;
  nodes: Node[];
  definition?: { fields: Record<string, unknown>[] };
}
export default function FlowDesignerPage() {
  const [flows, setFlows] = useState<Flow[]>([]),
    [people, setPeople] = useState<{ users: RecordRow[]; roles: RecordRow[] }>({ users: [], roles: [] }),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string>(''),
    [error, setError] = useState('');
  const [form] = Form.useForm();
  const load = async () => {
    try {
      const [f, p] = await Promise.all([get<Flow[]>('/approvals/flows'), get<typeof people>('/approvals/people')]);
      setFlows(f);
      setPeople(p);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const edit = (f?: Flow) => {
    form.resetFields();
    form.setFieldsValue(
      f
        ? {
            name: f.name,
            bizType: f.bizType,
            priority: f.priority,
            condition: f.conditionExpr,
            fields: f.definition?.fields ?? [],
            nodes: f.nodes.map((n) => ({
              name: n.nodeName,
              approverType: n.approverType,
              approverValue: n.approverValue,
              condition: n.conditionExpr ?? 'always',
            })),
          }
        : {
            bizType: 'general',
            condition: 'always',
            priority: 0,
            nodes: [{ name: '负责人审批', approverType: 'role', approverValue: 'sales_manager', condition: 'always' }],
            fields: [],
          },
    );
    setOpen(true);
  };
  const save = async () => {
    try {
      const body = await form.validateFields();
      setBusy(true);
      await post('/approvals/flows', { ...body, requestKey: key() });
      message.success('草稿版本已保存，发布后生效');
      setOpen(false);
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const publish = (f: Flow) =>
    Modal.confirm({
      title: `发布 ${f.name} v${f.version}？`,
      content: '同名旧版本将停用；正在进行的审批使用提交时的节点快照。',
      onOk: async () => {
        try {
          await post(`/approvals/flows/${f.id}/publish`, { requestKey: key(), expectedUpdatedAt: f.updatedAt });
          message.success('已发布');
          await load();
        } catch (e) {
          message.error(errorText(e));
          throw e;
        }
      },
    });
  const test = (f: Flow) => {
    let amount = 100000;
    Modal.confirm({
      title: '条件预演',
      content: (
        <div>
          <Typography.Paragraph>输入申请金额，预演流程命中和节点解析；不创建审批实例。</Typography.Paragraph>
          <InputNumber
            min={0}
            defaultValue={amount}
            onChange={(v) => {
              amount = Number(v ?? 0);
            }}
            style={{ width: '100%' }}
          />
        </div>
      ),
      onOk: async () => {
        try {
          const r = await post<{ matches: boolean; nodes: { name: string; approverId: number }[] }>(
            `/approvals/flows/${f.id}/preview`,
            { amount },
          );
          setPreview(
            `${r.matches ? '流程匹配' : '流程未匹配'}；节点：${r.nodes.map((n) => `${n.name}（${people.users.find((u) => u.id === n.approverId)?.name ?? n.approverId}）`).join(' → ')}`,
          );
        } catch (e) {
          message.error(errorText(e));
          throw e;
        }
      },
    });
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKFLOW STUDIO</div>
          <h1>通用审批设计器</h1>
          <Typography.Text type="secondary">配置表单、条件与审批节点，保存新版本后发布生效。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
          新建审批流
        </Button>
      </div>
      <Alert
        type="info"
        showIcon
        message="支持顺序审批与金额条件分支，支持指定人、角色和部门负责人"
        description="必需节点找不到审批人时会阻止提交；申请人不能审批自己的单据。并行会签与复杂嵌套表达式暂未开放。"
        style={{ marginBottom: 20 }}
      />
      {error && <Alert type="error" message={error} />}{' '}
      {preview && (
        <Alert type="success" message={preview} closable onClose={() => setPreview('')} style={{ marginBottom: 16 }} />
      )}
      <Card>
        <Table
          rowKey="id"
          dataSource={flows}
          columns={[
            { title: '流程名称', dataIndex: 'name' },
            { title: '业务', dataIndex: 'bizType' },
            { title: '版本', dataIndex: 'version', render: (v) => `v${v}` },
            {
              title: '状态',
              dataIndex: 'isActive',
              render: (v) => <Tag color={v ? 'success' : 'default'}>{v ? '已发布' : '草稿/已停用'}</Tag>,
            },
            {
              title: '节点',
              render: (_, f: Flow) => (
                <Steps
                  size="small"
                  items={f.nodes.map((n) => ({
                    title: n.nodeName,
                    description: n.conditionExpr === 'always' ? '' : n.conditionExpr,
                  }))}
                />
              ),
            },
            {
              title: '操作',
              render: (_, f: Flow) => (
                <Space>
                  <Button type="link" onClick={() => edit(f)}>
                    复制修改
                  </Button>
                  <Button type="link" onClick={() => test(f)}>
                    预演
                  </Button>
                  {!f.isActive && (
                    <Button type="link" onClick={() => publish(f)}>
                      发布
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          scroll={{ x: 1000 }}
        />
      </Card>
      <Modal
        open={open}
        width={960}
        title="审批流设计 · 保存为新草稿版本"
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Space align="start">
            <Form.Item name="name" label="流程名称" rules={[{ required: true }]}>
              <Input style={{ width: 260 }} />
            </Form.Item>
            <Form.Item name="bizType" label="业务类型" rules={[{ required: true }]}>
              <Select
                style={{ width: 180 }}
                options={[
                  'general',
                  'contract',
                  'contract_change',
                  'order',
                  'expense',
                  'leave',
                  'purchase',
                  'discount',
                  'project_initiation',
                ].map((v) => ({
                  value: v,
                  label: (
                    {
                      general: '通用事项',
                      contract: '合同',
                      contract_change: '合同变更 / 终止',
                      order: '订单',
                      expense: '费用申请',
                      leave: '请假',
                      purchase: '采购',
                      discount: '折扣',
                      project_initiation: '项目立项',
                    } as Record<string, string>
                  )[v],
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="匹配优先级">
              <InputNumber min={0} max={1000} />
            </Form.Item>
            <Form.Item name="condition" label="流程条件">
              <Input placeholder="always 或 amount >= 100000" />
            </Form.Item>
          </Space>
          <Typography.Title level={5}>申请表单字段</Typography.Title>
          <Form.List name="fields">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline">
                    <Form.Item name={[f.name, 'key']} rules={[{ required: true }]}>
                      <Input placeholder="字段编码（英文）" />
                    </Form.Item>
                    <Form.Item name={[f.name, 'label']} rules={[{ required: true }]}>
                      <Input placeholder="显示名称" />
                    </Form.Item>
                    <Form.Item name={[f.name, 'type']}>
                      <Select
                        style={{ width: 110 }}
                        options={['text', 'number', 'date'].map((v) => ({
                          value: v,
                          label: ({ text: '文本', number: '数字', date: '日期' } as Record<string, string>)[v],
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'required']}>
                      <Select
                        style={{ width: 90 }}
                        options={[
                          { value: true, label: '必填' },
                          { value: false, label: '选填' },
                        ]}
                      />
                    </Form.Item>
                    <Button danger onClick={() => remove(f.name)}>
                      删除
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add({ type: 'text', required: true })}>添加字段</Button>
              </>
            )}
          </Form.List>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            审批节点
          </Typography.Title>
          <Form.List name="nodes">
            {(fields, { add, remove, move }) => (
              <>
                {fields.map((f, i) => (
                  <Card
                    key={f.key}
                    size="small"
                    title={`节点 ${i + 1}`}
                    style={{ marginBottom: 12 }}
                    extra={
                      <Space>
                        <Button
                          size="small"
                          icon={<ArrowUpOutlined />}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        />
                        <Button
                          size="small"
                          icon={<ArrowDownOutlined />}
                          disabled={i === fields.length - 1}
                          onClick={() => move(i, i + 1)}
                        />
                        <Button danger size="small" onClick={() => remove(f.name)}>
                          删除
                        </Button>
                      </Space>
                    }
                  >
                    <Space align="baseline" wrap>
                      <Form.Item name={[f.name, 'name']} rules={[{ required: true }]}>
                        <Input placeholder="节点名称" />
                      </Form.Item>
                      <Form.Item name={[f.name, 'approverType']}>
                        <Select
                          style={{ width: 140 }}
                          options={[
                            { value: 'user', label: '指定审批人' },
                            { value: 'role', label: '按角色' },
                            { value: 'dept_leader', label: '部门负责人' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          const type = form.getFieldValue(['nodes', f.name, 'approverType']);
                          return (
                            type !== 'dept_leader' && (
                              <Form.Item name={[f.name, 'approverValue']} rules={[{ required: true }]}>
                                <Select
                                  style={{ width: 180 }}
                                  placeholder="选择审批人"
                                  options={(type === 'role' ? people.roles : people.users).map((p) => ({
                                    value: String(type === 'role' ? p.code : p.id),
                                    label: String(p.name),
                                  }))}
                                />
                              </Form.Item>
                            )
                          );
                        }}
                      </Form.Item>
                      <Form.Item name={[f.name, 'condition']}>
                        <Input placeholder="always 或 amount >= 100000" style={{ width: 240 }} />
                      </Form.Item>
                    </Space>
                  </Card>
                ))}
                <Button block onClick={() => add({ name: '审批节点', approverType: 'role', condition: 'always' })}>
                  添加审批节点
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
