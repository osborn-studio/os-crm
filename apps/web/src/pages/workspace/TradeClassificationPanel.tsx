import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Typography, message } from 'antd';
import { errorText, get, key, post, money } from '../../services/workspace';
type Classification = {
  category: 'business' | 'software_commission';
  ownAmount?: string | null;
  vendorProductAmount?: string;
  reason: string;
  sourceIds: string[];
};
type Detail = {
  originalAmount: string;
  updatedAt: string;
  classification: Classification | null;
  canClassify: boolean;
};
export default function TradeClassificationPanel({
  kind,
  id,
  version,
  onChanged,
}: {
  kind: string;
  id: number;
  version: unknown;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Detail>(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [form] = Form.useForm();
  const category = Form.useWatch('category', form);
  useEffect(() => {
    let active = true;
    void get<Detail>(`/trade/${kind}/${id}`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => message.error(errorText(e)));
    return () => {
      active = false;
    };
  }, [kind, id, version]);
  if (!data) return null;
  const edit = () => {
    form.setFieldsValue({
      category: data.classification?.category ?? 'business',
      ownAmount: data.classification?.ownAmount ?? data.originalAmount,
      vendorProductAmount: data.classification?.vendorProductAmount ?? '0.00',
      reason: data.classification?.reason ?? '',
    });
    setUnknown(data.classification?.ownAmount === null);
    setOpen(true);
  };
  const save = async () => {
    try {
      const v = await form.validateFields();
      setBusy(true);
      await post('/trade/classify', {
        requestKey: key(),
        items: [
          {
            kind,
            id,
            expectedUpdatedAt: data.updatedAt,
            category: v.category,
            reason: v.reason,
            sourceIds: ['manual:administrator-trade-review'],
            ...(kind === 'opportunities'
              ? { ownAmount: unknown ? null : v.ownAmount, vendorProductAmount: v.vendorProductAmount }
              : {}),
          },
        ],
      });
      setOpen(false);
      message.success('已保存交易性质，原报价与合同金额保留');
      onChanged();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      size="small"
      title="交易性质与业绩口径"
      style={{ marginTop: 16 }}
      extra={data.canClassify ? <Button onClick={edit}>确认分类 / 金额口径</Button> : null}
    >
      <Typography.Paragraph>
        原始{kind === 'contracts' ? '合同' : '整包报价'}：¥{money(data.originalAmount)}。
        {data.classification?.category === 'software_commission'
          ? '软件返佣，单独统计，不计入业务业绩。'
          : data.classification
            ? '我方业务，包含渠道作为甲方付给我们的服务费用。'
            : '交易性质待核实，当前按我方业务统计。'}
      </Typography.Paragraph>
      {kind === 'opportunities' && data.classification && (
        <p>
          我方业务金额：{data.classification.ownAmount === null ? '待核实' : '¥' + money(data.classification.ownAmount)}
          ；厂商产品部分：¥{money(data.classification.vendorProductAmount)}
        </p>
      )}
      {data.classification?.reason && (
        <Typography.Paragraph type="secondary">依据：{data.classification.reason}</Typography.Paragraph>
      )}
      <Modal
        title="确认交易性质与金额口径"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Alert
          type="info"
          message="渠道服务费用计入我方业务；软件返佣除外。分类仅调整统计口径，不修改原合同、原报价或收款单。"
        />
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="category" label="交易性质" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'business', label: '我方业务（含甲方渠道的实施/外包）' },
                { value: 'software_commission', label: '软件返佣（单列，不计业务业绩）' },
              ]}
            />
          </Form.Item>
          {kind === 'opportunities' && category !== 'software_commission' && (
            <>
              <Checkbox checked={unknown} onChange={(e) => setUnknown(e.target.checked)}>
                我方金额尚待核实，暂不计金额预测
              </Checkbox>
              <Form.Item
                name="ownAmount"
                label="我方业务金额"
                rules={
                  unknown ? [] : [{ required: true }, { pattern: /^\d+(\.\d{1,2})?$/, message: '请填最多两位小数金额' }]
                }
              >
                <Input disabled={unknown} />
              </Form.Item>
              <Form.Item
                name="vendorProductAmount"
                label="厂商产品报价部分"
                rules={[{ required: true }, { pattern: /^\d+(\.\d{1,2})?$/ }]}
              >
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="reason" label="核对依据" rules={[{ required: true, min: 5, max: 1500 }]}>
            <Input.TextArea rows={4} placeholder="说明付款方、交易性质及报价拆分依据" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
