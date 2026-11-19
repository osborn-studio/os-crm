import { Button, DatePicker, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
export interface StatisticsRange { from: string; to: string }
export function defaultStatisticsRange(): StatisticsRange {
  const now = dayjs();
  return { from: now.startOf('year').format('YYYY-MM-DD'), to: now.endOf('year').format('YYYY-MM-DD') };
}
export default function StatisticsPeriod({ value, onChange }: { value: StatisticsRange; onChange: (v: StatisticsRange) => void }) {
  const [mode, setMode] = useState<'date' | 'month'>('month');
  const preset = (kind: 'month' | 'year') => onChange({ from: dayjs().startOf(kind).format('YYYY-MM-DD'), to: dayjs().endOf(kind).format('YYYY-MM-DD') });
  return <Space wrap style={{ marginBottom: 16 }}>
    <strong>查看时间</strong>
    <Select aria-label="日期精度" value={mode} options={[{ value: 'month', label: '按月份选择' }, { value: 'date', label: '按日期选择' }]} onChange={setMode} />
    <DatePicker.RangePicker aria-label="统计起止区间" picker={mode} allowClear={false} value={[dayjs(value.from), dayjs(value.to)]}
      minDate={dayjs('2010-01-01')} maxDate={dayjs('2060-12-31')}
      onChange={dates => { if (dates?.[0] && dates[1]) onChange({ from: (mode === 'month' ? dates[0].startOf('month') : dates[0]).format('YYYY-MM-DD'), to: (mode === 'month' ? dates[1].endOf('month') : dates[1]).format('YYYY-MM-DD') }); }} />
    <Button onClick={() => preset('month')}>本月</Button><Button onClick={() => preset('year')}>本年</Button>
    <span style={{ color: '#64748b' }}>{value.from} 至 {value.to}</span>
  </Space>;
}
