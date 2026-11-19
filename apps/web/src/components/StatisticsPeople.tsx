import { useEffect, useState } from 'react';
import { Alert, Select, Space } from 'antd';
import { get, errorText } from '../services/workspace';
import { useAuthStore } from '../stores/useAuthStore';

export interface StatisticsPeopleRange {
  personRange: 'self' | 'person' | 'company' | 'department';
  ownerId?: number;
  deptId?: number;
}
interface PeopleOptions {
  selfId: number;
  canCompany: boolean;
  owners: { id: number; name: string; employeeNo: string | null; status: string; managedDepartmentIds?:number[] }[];
  departments: { id: number; name: string }[];
}
export const ownStatistics = (): StatisticsPeopleRange => ({ personRange: 'self' });
export function defaultStatisticsPeople(): StatisticsPeopleRange {
  const user = useAuthStore.getState().user;
  if (user?.roles.some(r => ['super_admin', 'gm'].includes(r)) || user?.dataScope === 'all') return { personRange: 'company' };
  if (user && ['dept', 'team'].includes(user.dataScope ?? '') && user.dept?.id) return { personRange: 'department', deptId: user.dept.id };
  return ownStatistics();
}
export function statisticsPeopleFromParams(params: URLSearchParams): StatisticsPeopleRange {
  const range = params.get('personRange');
  // The server, never the URL, decides whether these selections are permitted.
  if (range === 'company') return { personRange: range };
  if (range === 'person') return { personRange: range, ownerId: Number(params.get('ownerId')) };
  if (range === 'department') return { personRange: range, deptId: Number(params.get('deptId')) };
  if (range === 'self') return ownStatistics();
  return defaultStatisticsPeople();
}
export function statisticsQuery(period: { from: string; to: string }, people: StatisticsPeopleRange) {
  return new URLSearchParams(Object.entries({ ...period, ...people }).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])).toString();
}
export default function StatisticsPeople({ value, onChange }: { value: StatisticsPeopleRange; onChange: (v: StatisticsPeopleRange) => void }) {
  const [options, setOptions] = useState<PeopleOptions>(), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void get<PeopleOptions>('/workspace/statistics-options').then(o => { if(active) setOptions(o); }).catch(e => { if(active) setError(errorText(e)); });
    return () => { active = false; };
  }, []);
  const selected = value.personRange === 'person' ? value.ownerId === options?.selfId ? 'self' : 'person:' + value.ownerId : value.personRange === 'department' ? 'department:' + value.deptId : value.personRange;
  return <Space wrap style={{ marginBottom: 16 }}>
    <strong>人员范围</strong>
    <Select aria-label="统计人员范围" showSearch optionFilterProp="label" style={{ minWidth: 220, maxWidth: '100%' }} value={selected} loading={!options && !error} disabled={!options}
      options={[
        { value: 'self', label: '本人' },
        ...(options?.canCompany ? [{ value: 'company', label: '全公司（当前帐套）' }] : []),
        ...(options?.owners.filter(u => u.id !== options.selfId).map(u => ({ value: 'person:' + u.id, label: `${u.name} · ${u.employeeNo || '#' + u.id}${u.managedDepartmentIds?.length?'（含下属团队）':''}${u.status !== 'active' ? '（已停用）' : ''}` })) ?? []),
        ...(options?.departments.map(d => ({ value: 'department:' + d.id, label: '部门：' + d.name })) ?? []),
      ]}
      onChange={(v: string) => onChange(v === 'self' || v === 'company' ? { personRange: v } : v.startsWith('person:') ? { personRange: 'person', ownerId: Number(v.slice(7)) } : { personRange: 'department', deptId: Number(v.slice(11)) })} />
    <span style={{ color: '#64748b' }}>仅展示数据权限内的范围</span>
    {error && <Alert type="error" message={error} />}
  </Space>;
}
