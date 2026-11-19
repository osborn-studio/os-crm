import { Button, Select, Space } from 'antd';
export interface BusinessSortValue {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}
export default function BusinessSort({
  value,
  fields,
  onChange,
}: {
  value: BusinessSortValue;
  fields: { key: string; label: string }[];
  onChange: (v: BusinessSortValue) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}><Space wrap>
      <strong>排序</strong>
      <Select
        aria-label="排序依据"
        style={{ minWidth: 150 }}
        value={value.sortBy}
        options={fields.map((f) => ({ value: f.key, label: f.label }))}
        onChange={(sortBy) => onChange({ ...value, sortBy })}
      />
      <Space.Compact>
        <Button
          aria-label="正序排列"
          aria-pressed={value.sortOrder === 'asc'}
          type={value.sortOrder === 'asc' ? 'primary' : 'default'}
          onClick={() => onChange({ ...value, sortOrder: 'asc' })}
        >
          正序 ↑
        </Button>
        <Button
          aria-label="倒序排列"
          aria-pressed={value.sortOrder === 'desc'}
          type={value.sortOrder === 'desc' ? 'primary' : 'default'}
          onClick={() => onChange({ ...value, sortOrder: 'desc' })}
        >
          倒序 ↓
        </Button>
      </Space.Compact>
    </Space></div>
  );
}
