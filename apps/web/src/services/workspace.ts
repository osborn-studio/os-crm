import request from './request';
export type RecordRow = Record<string, unknown> & { id: number; updatedAt?: string };
export interface Field {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  reference?: string;
}
export interface Resource {
  key: string;
  title: string;
  name: string;
  fields: Field[];
  actions: string[];
  canCreate: boolean;
  canEdit: boolean;
  readonly?: boolean;
}
export const get = <T>(path: string, params?: Record<string, unknown>) => request.get<never, T>(path, { params });
export const post = <T>(path: string, data: unknown) => request.post<never, T>(path, data);
export const put = <T>(path: string, data: unknown) => request.put<never, T>(path, data);
export const key = () => crypto.randomUUID();
export function errorText(e: unknown) {
  return e && typeof e === 'object' && 'message' in e ? String(e.message) : '请求失败，请重试';
}
export const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const statusNames: Record<string, string> = {
  draft: '草稿',
  software_sale: '软件销售',
  implementation: '实施服务',
  maintenance: '运维服务',
  outsource: '外包服务',
  ai_fde: 'AI场景交付',
  saas_sub: 'SaaS订阅',
  channel: '渠道合同',
  website: '官网',
  referral: '转介绍',
  exhibition: '展会',
  partner: '伙伴',
  import: '导入',
  software: '软件',
  service: '服务',
  subscription: '订阅',
  invoiced: '已开票',
  pending_approval: '待审批',
  approved: '已批准',
  rejected: '已驳回',
  signed: '已签约',
  executing: '执行中',
  completed: '已完成',
  active: '进行中',
  pending: '待处理',
  confirmed: '已确认',
  delivered: '已交付',
  new: '新建',
  assigned: '已分配',
  converted: '已转化',
  open: '进行中',
  won: '赢单',
  lost: '输单',
  cancelled: '已取消',
  private: '私海',
  public: '公海',
  overdue: '逾期',
  partial: '部分完成',
  todo: '待办',
  done: '完成',
  in_progress: '进行中',
  withdrawn: '已撤回',
  terminated: '已终止',
  not_requested: '未提交',
  accepted: '已验收',
  legacy_completed: '历史完成（无新版验收记录）',
};
export const actionNames: Record<string, string> = {
  claim: '领取',
  return: '退回公海',
  assign: '分配销售',
  follow: '记录跟进',
  convert: '转为客户',
  advance: '推进阶段',
  quote: '产品报价',
  lose: '标记输单',
  submit: '提交审批',
  sign: '确认签约',
  order: '创建订单',
  project: '创建项目',
  confirm: '确认订单',
  deliver: '确认交付',
  start: '启动项目',
  request_acceptance: '提交验收',
  reject_acceptance: '拒收并整改',
  accept: '确认验收',
  start_task: '开始任务',
  reopen_task: '发起整改',
  assign_task: '转派任务',
  handover_pm: '交接项目经理',
  complete: '完成',
};
