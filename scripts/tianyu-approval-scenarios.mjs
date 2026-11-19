/** Fictional application flows and decisions only; never sends DingTalk/Feishu messages. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { accounts, DEMO_PASSWORD } from '../demo/tianyu/generate.mjs';
import { validateTianyuTarget } from './tianyu-ai-workflow.mjs';
const comments = (id) =>
  id === 1400
    ? '财务核对：已逐项检查付款节点、原单据金额、税口径及渠道甲方，不将计划或申请视为已经到账。'
    : id === 1200
      ? '技术与交付核对：已检查介质、温压、口径材质、图纸版本、验证资源及交付窗口，批准范围以本申请为限。'
      : id === 1001
        ? '经营核准：已核对商务收益、资源承接、付款风险和责任人，批准后由执行人留存实际完成依据。'
        : '销售主管核对：已确认客户归属、报价版本和推进依据，执行后补充实际反馈；未确认项继续单列。';
export async function installApprovalScenarios({ call, spec, state = {}, save = () => {} }) {
  assert.equal(spec.companyCode, 'TIANYU');
  assert.equal(spec.fictional, true);
  const prefix = 'ty-rich-approval-v' + spec.version;
  const command = async (label, path, actor, body) => {
    if (state[label]?.receipt) return state[label].receipt;
    if (state[label]) assert.deepEqual(state[label].body, body);
    state[label] = { body, actor };
    save(state);
    const receipt = await call(path, actor, body);
    state[label].receipt = receipt;
    save(state);
    return receipt;
  };
  const proof = { fictional: true, version: spec.version, flows: [], approvals: [], externalEffects: 0 };
  const current = (d) => {
    const anchor = d.nodes.find((n) => n.id === d.currentNodeId);
    assert(anchor, 'Missing current approval step');
    return anchor.action === 'pending'
      ? anchor
      : d.nodes.find((n) => n.action === 'pending' && n.nodeOrder === anchor.nodeOrder);
  };
  async function decide(id, mode, key, applicant) {
    let d = await call('approvals/' + id, 1);
    if (mode === 'pending') return d;
    if (mode === 'withdrawn') {
      if (d.status === 'pending')
        await command(key + '-withdraw', 'approvals/' + id + '/withdraw', applicant, {
          requestKey: key + '-withdraw',
          reason: '【演示数据】客户调整停机窗口，当前申请撤回；改版后独立重提，历史保留。',
        });
      return call('approvals/' + id, 1);
    }
    for (let step = 0; d.status === 'pending' && step < 12; step++) {
      const node = current(d);
      assert(node);
      const approved = mode !== 'rejected';
      await command(
        key + '-decision-' + step,
        'approvals/' + id + '/nodes/' + node.id + '/' + (approved ? 'approve' : 'reject'),
        node.approverId,
        {
          requestKey: key + '-decision-' + step,
          comment: approved
            ? comments(node.approverId)
            : '【演示数据】退回：图纸版本与参数表不一致，付款触发条件缺少签收/验收依据；请补齐对照和责任人后重新申请。',
        },
      );
      d = await call('approvals/' + id, 1);
      if (mode === 'partial') break;
    }
    assert.equal(d.status, mode === 'partial' ? 'pending' : mode);
    return d;
  }
  for (const [i, f] of spec.flows.entries()) {
    const key = prefix + '-' + f.key,
      ids = f.reviewers;
    assert(ids.length && new Set(ids).size === ids.length);
    assert(!ids.includes(f.applicantId));
    const nodes =
      f.mode === 'single'
        ? ids.map((id) => ({
            name:
              id === 1400
                ? '财务核对'
                : id === 1200
                  ? '技术与交付评审'
                  : id === 1001
                    ? '经营负责人核准'
                    : '销售主管核对',
            approverType: 'user',
            approverValue: String(id),
            condition: 'always',
          }))
        : [
            {
              name: f.mode === 'all' ? '相关负责人会签' : '管理人员或签',
              approverType: f.mode === 'all' ? 'users_all' : 'users_any',
              approverValue: ids.join(','),
              condition: 'always',
            },
          ];
    const flow = await command(key + '-draft', 'approvals/flows', 1, {
      requestKey: key + '-draft',
      name: '【演示数据】' + f.name,
      bizType: 'general',
      condition: 'always',
      priority: 100,
      nodes,
      fields: spec.fields,
    });
    const published = await command(key + '-publish', 'approvals/flows/' + flow.id + '/publish', 1, {
      requestKey: key + '-publish',
      expectedUpdatedAt: flow.updatedAt,
    });
    proof.flows.push({ id: published.id, key: f.key, name: f.name, mode: f.mode, applicantId: f.applicantId });
    const customerId = f.applicantId === 1103 ? 10024 : 10000 + (i % 3),
      customer = await call('workspace/customers/' + customerId, f.applicantId);
    assert.match(customer.name, /（(?:天雨示例|示例)）$/);
    assert.equal(customer.ownerId, f.applicantId);
    const before = 120000 + i * 11350,
      after = before - 2500 - (i % 4) * 500;
    const form = {
      customer: customer.name,
      customerCode: customer.code,
      relatedDocument: 'TY-SJ-' + String(customerId - 9999).padStart(5, '0'),
      businessType: i % 2 ? '定制调节阀及现场联调' : '标准球阀与分批供货',
      channel: i % 3 ? '直销' : '经销商为付款甲方，终端项目另列',
      currentStage: ['初步洽谈', '需求确认', '方案与商务核对'][i % 3],
      targetStage: f.nextStage,
      reason: f.reasonTemplate,
      evidence: f.evidenceTemplate,
      plannedDate: '2026-11-' + String(17 + (i % 10)).padStart(2, '0'),
      specification: [
        'DN80 PN40 CF8M，气动定位器；图纸B版→C版',
        'DN150 PN16 WCB，法兰连接；水压试验记录待补',
        'DN50 PN64 316L，高温密封；材质及试验要求逐项核对',
      ][i % 3],
      quantity: 20 + i * 2 + '台，首批' + (8 + i) + '台，其余按审批后确认的交期发运',
      commercialTerms: '首付30%，供货50%，验收15%，质保5%；付款方与开票抬头分别核对；产品奖励单列。',
      changeComparison:
        '变更前：' +
        before +
        '元、图纸B版、一次供货；拟变更后：' +
        after +
        '元、图纸C版、分批供货。仅申请数据，不自动改写原合同。',
      riskAndMitigation:
        '重点风险：' +
        [
          '技术参数和试验样本未完全确认；由技术负责人做样件回归',
          '交期与驻场人员有冲突；先排期再承诺',
          '渠道付款主体与终端不同；财务逐单核对',
          '历史发票未找到合同；先补证据，不虚构签署',
        ][i % 4],
      completionEvidence: '执行人补充实际处理记录、版本文件、客户确认或真实单据后标完成；本审批仅代表内部决定。',
    };
    const request = async (label, title, extra = {}) => {
      const a = await command(key + '-' + label, 'capabilities/approval.request/invoke', f.applicantId, {
        kind: 'form',
        requestKey: key + '-' + label,
        flowId: published.id,
        title: '【演示数据】' + f.topic + '｜' + customer.name + '｜' + title,
        amount: String(after),
        form: { ...form, ...extra },
      });
      return a.result?.id ?? a.id;
    };
    let rejectedId;
    for (const [mode, label] of [
      ['pending', '待审核'],
      ['approved', '已通过'],
      ['rejected', '退回补充'],
      ['withdrawn', '已撤回'],
    ]) {
      const id = await request(mode, label);
      assert(id);
      const d = await decide(id, mode, key + '-' + mode, f.applicantId);
      proof.approvals.push({ id: d.id, flowId: published.id, status: d.status, scenario: mode });
      if (mode === 'rejected') rejectedId = id;
    }
    for (const mode of ['pending', 'approved']) {
      const id = await request('resubmit-' + mode, mode === 'pending' ? '补齐资料后重提待审' : '补齐资料后重提通过', {
        reason:
          form.reason +
          ' 补充原退回申请 #' +
          rejectedId +
          '：图纸版本、付款触发与风险负责人均已补齐，原退回历史不删除。',
      });
      const d = await decide(id, mode, key + '-resubmit-' + mode, f.applicantId);
      proof.approvals.push({
        id: d.id,
        flowId: published.id,
        status: d.status,
        scenario: 'resubmit-' + mode,
        resubmissionOf: rejectedId,
      });
    }
    if (f.mode !== 'any' && ids.length > 1) {
      const id = await request('partial', '部分已审仍在流转');
      const d = await decide(id, 'partial', key + '-partial', f.applicantId);
      assert(d.nodes.some((n) => n.action === 'approved'));
      assert(d.nodes.some((n) => n.action === 'pending'));
      proof.approvals.push({ id: d.id, flowId: published.id, status: d.status, scenario: 'partial' });
    }
    if (f.mode === 'single' && i % 5 === 0) {
      const id = await request('transfer', '转审后继续处理'),
        d = await call('approvals/' + id, 1),
        node = current(d),
        targetUserId = node.approverId === 1400 ? 1200 : 1400;
      await command(key + '-transfer', 'approvals/' + id + '/nodes/' + node.id + '/transfer', node.approverId, {
        requestKey: key + '-transfer-node',
        targetUserId,
        reason: '【演示数据】原审核人暂时出差，由具备本事项核对权限的同公司负责人接续；保留原节点和转审历史。',
      });
      proof.approvals.push({ id, flowId: published.id, status: 'pending', scenario: 'transferred' });
    }
  }
  proof.counts = {
    flows: proof.flows.length,
    approvals: proof.approvals.length,
    states: proof.approvals.reduce((s, a) => ((s[a.status] = (s[a.status] ?? 0) + 1), s), {}),
    modes: proof.flows.reduce((s, f) => ((s[f.mode] = (s[f.mode] ?? 0) + 1), s), {}),
  };
  state.result = proof;
  save(state);
  return proof;
}
async function main() {
  const args = process.argv.slice(2),
    at = args.indexOf('--company-config');
  assert(args.includes('--confirm-fictional-tianyu'));
  assert(at >= 0 && args[at + 1]);
  const cfg = JSON.parse(fs.readFileSync(resolve(args[at + 1])));
  validateTianyuTarget({ ...cfg, TIANYU_ALLOW_WORKFLOW: 'true' });
  const spec = JSON.parse(fs.readFileSync(new URL('../demo/tianyu/approval-scenarios.json', import.meta.url)));
  const base = args.includes('--base-url') ? args[args.indexOf('--base-url') + 1] : 'http://127.0.0.1:3000';
  const u = new URL(base);
  assert.equal(u.protocol, 'http:');
  assert(['127.0.0.1', 'localhost'].includes(u.hostname));
  const tokens = {};
  const call = async (path, id, body) => {
    const r = await fetch(base + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Company-Code': 'TIANYU',
        ...(tokens[id] ? { Authorization: 'Bearer ' + tokens[id] } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (!r.ok) throw Error(path + ' ' + JSON.stringify(j));
    return j.data;
  };
  for (const a of accounts)
    tokens[a.id] = (
      await call('auth/login', a.id, { tenantCode: 'TIANYU', username: a.username, password: DEMO_PASSWORD })
    ).accessToken;
  const file = resolve(
    args.includes('--receipt') ? args[args.indexOf('--receipt') + 1] : '.local/tianyu-approval-scenarios-receipt.json',
  );
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const save = (s) => {
    fs.mkdirSync(resolve(file, '..'), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  const r = await installApprovalScenarios({ call, spec, state, save });
  console.log(JSON.stringify({ status: 'PASS', ...r.counts, externalEffects: 0 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
