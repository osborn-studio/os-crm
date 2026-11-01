import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Table, Tabs, Upload, message } from 'antd';
import { get, post, key, errorText } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Preview {
  previewId: string;
  digest: string;
  ready: number;
  duplicates: number;
  errors: number;
  expiresAt: string;
  rows: { row: number; data: { name: string }; status: string; error: string }[];
}
interface Options {
  customers: { id: number; name: string; ownerName: string }[];
  recipients: { id: number; name: string }[];
}
interface Handover {
  customerId: number;
  expectedUpdatedAt: string;
  digest: string;
  counts: Record<string, number>;
  toName: string;
  deliveryNotice: string;
}
const countNames: Record<string, string> = {
  opportunities: '商机',
  contracts: '合同',
  orders: '订单',
  projects: '项目销售归属',
  leads: '已转化线索',
  actions: '未完成行动',
};
export default function CustomerOperationsPage() {
  const isAdmin = useAuthStore((s) => s.user?.roles.includes('super_admin'));
  const [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [receipt, setReceipt] = useState<{ imported: number; skippedDuplicates: number }>(),
    [busy, setBusy] = useState(false),
    [options, setOptions] = useState<Options>({ customers: [], recipients: [] }),
    [handover, setHandover] = useState<Handover>();
  const previewKey = useRef(key()),
    commitKey = useRef(key()),
    handoverKey = useRef(key());
  const [form] = Form.useForm();
  const load = async (keyword = '') => {
    try {
      setOptions(await get<Options>('/commercial/customers/handover/options', { keyword }));
    } catch (e) {
      message.error(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const changeCsv = (text: string) => {
    setCsv(text);
    setPreview(undefined);
    setReceipt(undefined);
    previewKey.current = key();
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <h1>客户导入与销售交接</h1>
          <span>先核对范围，再提交；不自动合并已有客户，也不改写历史人员记录。</span>
        </div>
      </div>
      <Tabs
        items={[
          ...(isAdmin
            ? [
                {
                  key: 'import',
                  label: '客户导入',
                  children: (
                    <Card>
                      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Alert
                          type="info"
                          message="UTF-8 CSV：最多200条、1MiB。新客户进入公海；重复记录明确跳过，错误记录需修正后重新预检。"
                        />
                        <Space>
                          <Button
                            onClick={() => {
                              const url = URL.createObjectURL(
                                new Blob(
                                  [
                                    '\uFEFF客户名称,行业,级别,地区,地址,官网,备注\r\n示例企业（请替换）,制造/工业,普通客户,上海,,,首次导入\r\n',
                                  ],
                                  { type: 'text/csv;charset=utf-8' },
                                ),
                              );
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = '客户导入模板.csv';
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            下载模板
                          </Button>
                          <Upload
                            accept=".csv,text/csv"
                            showUploadList={false}
                            beforeUpload={async (file) => {
                              if (file.size > 1024 * 1024) {
                                message.error('CSV不能超过1MiB');
                                return false;
                              }
                              changeCsv(await file.text());
                              return false;
                            }}
                          >
                            <Button>选择CSV文件</Button>
                          </Upload>
                        </Space>
                        <Input.TextArea
                          rows={7}
                          value={csv}
                          onChange={(e) => changeCsv(e.target.value)}
                          placeholder="也可在此粘贴带表头的CSV内容"
                        />
                        <Space>
                          <Button
                            loading={busy}
                            disabled={!csv}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                if (preview) previewKey.current = key();
                                const p = await post<Preview>('/commercial/customers/import/preview', {
                                  requestKey: previewKey.current,
                                  csv,
                                });
                                setPreview(p);
                                setReceipt(undefined);
                                commitKey.current = key();
                              } catch (e) {
                                message.error(errorText(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {preview ? '重新预检' : '预检数据'}
                          </Button>
                          <Button
                            type="primary"
                            loading={busy}
                            disabled={!preview || !!preview.errors || !preview.ready || !!receipt}
                            onClick={async () => {
                              if (!preview) return;
                              setBusy(true);
                              try {
                                const r = await post<{ imported: number; skippedDuplicates: number }>(
                                  '/commercial/customers/import/commit',
                                  {
                                    requestKey: commitKey.current,
                                    previewId: preview.previewId,
                                    digest: preview.digest,
                                  },
                                );
                                setReceipt(r);
                                message.success('导入已完成');
                                await load();
                              } catch (e) {
                                message.error(errorText(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            确认导入{preview?.ready ?? 0}条，跳过重复{preview?.duplicates ?? 0}条
                          </Button>
                        </Space>
                        {receipt && (
                          <Alert
                            type="success"
                            message={`已导入${receipt.imported}条公海客户，跳过${receipt.skippedDuplicates}条重复记录。`}
                          />
                        )}
                        {preview && (
                          <>
                            <Alert
                              type={preview.errors ? 'error' : 'info'}
                              message={`可导入${preview.ready}条 / 重复${preview.duplicates}条 / 错误${preview.errors}条。预检有效至${new Date(preview.expiresAt).toLocaleTimeString()}。`}
                            />
                            <Table
                              rowKey="row"
                              dataSource={preview.rows}
                              columns={[
                                { title: '记录序号', dataIndex: 'row' },
                                { title: '客户', render: (_, r) => r.data.name },
                                {
                                  title: '预检结果',
                                  dataIndex: 'status',
                                  render: (s) =>
                                    ({ ready: '可导入', duplicate: '重复，跳过', error: '需修正' })[s as string] ?? s,
                                },
                                { title: '说明', dataIndex: 'error' },
                              ]}
                            />
                          </>
                        )}
                      </Space>
                    </Card>
                  ),
                },
              ]
            : []),
          {
            key: 'handover',
            label: '销售归属交接',
            children: (
              <Card>
                <Alert
                  type="info"
                  message="支持本部门停用或离职人员的客户交接。若关联销售业务跨部门，需管理员处理。待处理审批须先完成或撤回。"
                />
                <Form
                  form={form}
                  layout="vertical"
                  style={{ maxWidth: 720, marginTop: 20 }}
                  onValuesChange={(changed) => {
                    if ('customerId' in changed || 'userId' in changed) setHandover(undefined);
                    handoverKey.current = key();
                  }}
                >
                  <Form.Item name="customerId" label="交接客户" rules={[{ required: true }]}>
                    <Select
                      showSearch
                      filterOption={false}
                      onSearch={(s) => void load(s)}
                      options={options.customers.map((c) => ({
                        value: c.id,
                        label: `${c.name} · 原负责人：${c.ownerName}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="userId" label="接收销售" rules={[{ required: true }]}>
                    <Select options={options.recipients.map((u) => ({ value: u.id, label: u.name }))} />
                  </Form.Item>
                  <Form.Item name="reason" label="交接原因" rules={[{ required: true }]}>
                    <Input.TextArea maxLength={1000} />
                  </Form.Item>
                  <Space>
                    <Button
                      loading={busy}
                      onClick={async () => {
                        try {
                          const v = await form.validateFields(['customerId', 'userId']);
                          setBusy(true);
                          setHandover(
                            await post<Handover>(`/commercial/customers/${v.customerId}/handover/preview`, {
                              userId: v.userId,
                            }),
                          );
                          handoverKey.current = key();
                        } catch (e) {
                          if (!(e && typeof e === 'object' && 'errorFields' in e)) message.error(errorText(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      预检交接范围
                    </Button>
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={!handover}
                      onClick={async () => {
                        if (!handover) return;
                        try {
                          const v = await form.validateFields();
                          setBusy(true);
                          await post(`/commercial/customers/${v.customerId}/handover`, {
                            requestKey: handoverKey.current,
                            expectedUpdatedAt: handover.expectedUpdatedAt,
                            digest: handover.digest,
                            userId: v.userId,
                            reason: v.reason,
                          });
                          message.success('关联销售归属已整体交接');
                          setHandover(undefined);
                          await load();
                        } catch (e) {
                          if (!(e && typeof e === 'object' && 'errorFields' in e)) message.error(errorText(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      确认交接
                    </Button>
                  </Space>
                </Form>
                {handover && (
                  <>
                    <Alert
                      style={{ marginTop: 20 }}
                      type="warning"
                      message={
                        `交给${handover.toName}：` +
                        Object.entries(handover.counts)
                          .map(([k, v]) => `${countNames[k] ?? k}${v}条`)
                          .join('、')
                      }
                    />
                    <Alert style={{ marginTop: 12 }} type="info" message={handover.deliveryNotice} />
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
