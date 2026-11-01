import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Space, Table, Tag, message } from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
type Attachment = {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
};
export default function AttachmentPanel({
  subjectKind,
  subjectId,
  parentUpdatedAt,
  writable = true,
  onChanged,
}: {
  subjectKind: string;
  subjectId: number;
  parentUpdatedAt: string;
  writable?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const user = useAuthStore((s) => s.user),
    admin = !!user?.roles.includes('super_admin');
  const canWrite = writable && !!user?.roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r));
  const [rows, setRows] = useState<Attachment[]>([]),
    [upload, setUpload] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [ack, setAck] = useState(false);
  const [withdraw, setWithdraw] = useState<Attachment | null>(null),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  const requestKey = useRef(key());
  const fail = (e: unknown) => {
    void message.error(errorText(e));
  };
  const load = async () => setRows(await get('/evidence-attachments', { subjectKind, subjectId }));
  useEffect(() => {
    void load().catch(fail);
  }, [subjectKind, subjectId]);
  async function save() {
    if (!file || !ack || !file.size || file.size > 1024 * 1024) {
      void message.error('请选择不超过1MiB的附件并确认来源');
      return;
    }
    setBusy(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
      });
      await post('/evidence-attachments', {
        requestKey: requestKey.current,
        subjectKind,
        subjectId,
        expectedParentUpdatedAt: parentUpdatedAt,
        filename: file.name,
        contentBase64,
        acknowledged: true,
      });
      setUpload(false);
      setFile(null);
      setAck(false);
      await load();
      await onChanged?.();
      void message.success('附件已保存');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function download(row: Attachment) {
    const result = await get<Attachment & { contentBase64: string }>(`/evidence-attachments/${row.id}/content`);
    const binary = Uint8Array.from(atob(result.contentBase64), (v) => v.charCodeAt(0));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', binary))]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== result.sha256 || binary.length !== result.size) throw new Error('下载内容完整性不符');
    const url = URL.createObjectURL(new Blob([binary], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function remove() {
    const values: { reason: string } = await form.validateFields();
    if (!withdraw) return;
    setBusy(true);
    try {
      await post(`/evidence-attachments/${withdraw.id}/withdraw`, {
        requestKey: requestKey.current,
        expectedUpdatedAt: withdraw.updatedAt,
        expectedParentUpdatedAt: parentUpdatedAt,
        ...values,
      });
      setWithdraw(null);
      await load();
      await onChanged?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      size="small"
      title="私有证据附件"
      extra={
        <Space>
          <Button onClick={() => void load().catch(fail)}>刷新附件</Button>
          {canWrite && (
            <Button
              onClick={() => {
                requestKey.current = key();
                setFile(null);
                setAck(false);
                setUpload(true);
              }}
            >
              上传附件
            </Button>
          )}
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 5 }}
        dataSource={rows}
        columns={[
          {
            title: '文件',
            dataIndex: 'filename',
            render: (v: string, row: Attachment) => (
              <Space direction="vertical">
                <span>
                  {v} {row.withdrawnAt && <Tag>已撤回</Tag>}
                </span>
                <small title={row.sha256}>
                  SHA256 {row.sha256.slice(0, 12)}… · {Math.ceil(row.size / 1024)}KiB
                </small>
                {row.withdrawalReason && <small>撤回原因：{row.withdrawalReason}</small>}
              </Space>
            ),
          },
          {
            title: '时间',
            dataIndex: 'createdAt',
            render: (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false }),
          },
          {
            title: '操作',
            render: (_, row) => (
              <Space wrap>
                {(!row.withdrawnAt || admin) && (
                  <Button size="small" onClick={() => void download(row).catch(fail)}>
                    下载
                  </Button>
                )}
                {canWrite && !row.withdrawnAt && (admin || row.createdBy === user?.id) && (
                  <Button
                    size="small"
                    onClick={() => {
                      form.resetFields();
                      requestKey.current = key();
                      setWithdraw(row);
                    }}
                  >
                    撤回
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="上传私有证据附件"
        open={upload}
        confirmLoading={busy}
        onCancel={() => !busy && setUpload(false)}
        onOk={() => void save()}
        destroyOnHidden
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert
            type="info"
            message="PDF、PNG、JPEG；单文件1MiB，企业历史保留16MiB。文件随加密数据库备份恢复，撤回保留原件。"
          />
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setAck(false);
              requestKey.current = key();
            }}
          />
          <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)}>
            确认文件来源可信且有权上传；当前系统未进行病毒扫描，下载后请按本地安全规范检查。
          </Checkbox>
        </Space>
      </Modal>
      <Modal
        title="撤回附件（保留历史原件）"
        open={!!withdraw}
        confirmLoading={busy}
        onCancel={() => !busy && setWithdraw(null)}
        onOk={() => void remove().catch(fail)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="reason" label="撤回原因" rules={[{ required: true, max: 1000 }]}>
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
