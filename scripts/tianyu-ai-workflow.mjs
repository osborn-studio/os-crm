/** Fixed fictional workflow installer. All writes use authenticated application services. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildWorkflow, VERSION } from '../demo/tianyu/ai-workflow/generate.mjs';
import { VERSION as BASE_VERSION, DEMO_PASSWORD } from '../demo/tianyu/generate.mjs';
export function validateTianyuTarget(env) {
  assert.equal(env.TENANT_CODE, 'TIANYU');
  assert.equal(env.ACCOUNT_PURPOSE, 'test');
  assert.equal(env.TIANYU_ALLOW_WORKFLOW, 'true');
  const u = new URL(env.DATABASE_URL);
  assert(['127.0.0.1', 'localhost'].includes(u.hostname));
  assert.match(u.pathname, /^\/(tbcrm_c_[a-f0-9]{16}|tb_crm_test_tianyu_[a-z0-9_]+)$/);
}
const day = (n) => {
  const d = new Date(Date.parse('2026-11-17T00:00:00Z') + n * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
export function prepareManifest(pack, customers, archiveId) {
  const newCases = pack.cases.filter((c) => c.kind !== 'reference');
  return {
    batchKey: 'tianyu-ai-workflow-' + VERSION,
    sourceHash: pack.sha256,
    customers: pack.cases.map((c) => {
      const r = customers.get(c.customerId);
      assert.equal(r.code, c.customerKey);
      assert.equal(r.name, c.customerName);
      return {
        key: c.customerKey,
        name: r.name,
        existingId: r.id,
        expectedUpdatedAt: r.updatedAt,
        channel: 'direct',
        identityStatus: 'fictional_verified',
        notes: '【演示数据】天雨公开虚构客户；保留原负责人，不读取任何真实公司。',
      };
    }),
    cases: newCases.map((c) => ({
      key: c.key,
      customerKey: c.customerKey,
      name: '【演示数据】' + c.name,
      kind: c.kind === 'lead' ? 'lead' : c.kind === 'draft' ? 'contract' : 'quote',
      amount: c.amount,
      amountBasis: c.amountBasis,
      forecastEligible: c.forecastEligible,
      outcome: c.kind === 'lost' ? 'lost' : 'open',
      ownerId: c.ownerId,
      sourceDate: c.events[0].occurredAt.slice(0, 10),
      sourceIds: c.sourceIds,
      notes: c.issue + '；全部来源独立虚构，仅供演示。',
      nextAction: c.steps[0],
      ...(c.kind === 'lost'
        ? {
            lossReason: '项目交付窗口内人员和技能资源不足，主动放弃',
            lossGroup: 'confirmed',
            lossConfirmedAt: '2026-11-16',
          }
        : {}),
      ...(c.versions.length ? { quoteVersions: c.versions } : {}),
      ...(c.kind === 'draft'
        ? {
            draft: {
              name: '【演示数据】非标试制与测试服务合同草稿',
              signingCompany: '天雨阀门科技有限公司（示例）',
              type: 'implementation',
              taxRate: 13,
              paymentTerms: '签署后50%，试制测试确认后50%；具体签章和收款日待核。',
              remark: '虚构未签草稿，不新增正式债权、发票或收款。',
              items: [{ name: '非标阀组试制与测试服务', manDays: 12, unitPrice: '1450.00', amount: '17400.00' }],
            },
          }
        : {}),
    })),
    followups: newCases.flatMap((c) =>
      c.events
        .filter((e) => ['authorized_chat', 'meeting_summary', 'quotation', 'quotation_revision'].includes(e.sourceType))
        .map((e) => ({
          key: 'TY-FOLLOW-' + e.id,
          caseKey: c.key,
          kind: e.internalWork ? 'revision' : 'communication',
          occurredAt: e.occurredAt,
          content: '【演示数据】' + e.title + '\n' + e.text + '\n资料授权：' + e.authorization,
          sourceId: e.id,
        })),
    ),
    actions: [],
    archiveIds: [archiveId],
  };
}
export async function applyWorkflow({ call, state = {}, save = () => {}, pack = buildWorkflow() }) {
  const command = async (label, path, body) => {
    if (state[label]?.receipt) return state[label].receipt;
    if (state[label]) assert.deepEqual(state[label].body, body, 'Uncertain request body changed');
    state[label] = { body };
    save(state);
    const receipt = await call(path, body);
    state[label].receipt = receipt;
    save(state);
    return receipt;
  };
  const customers = new Map();
  for (const c of pack.cases) {
    const r = await call('workspace/customers/' + c.customerId);
    assert.equal(r.code, c.customerKey);
    assert.equal(r.name, c.customerName);
    assert.match(r.name, /（(?:天雨示例|示例)）$/);
    customers.set(r.id, r);
  }
  if (!state.manifest) {
    const data = Buffer.from(JSON.stringify({ version: VERSION, fictional: true, sources: pack.sources })),
      hash = createHash('sha256').update(data).digest('hex');
    const archive = await command('archive', 'sales-intake/archives', {
      requestKey: 'ty-ai-source-' + hash.slice(0, 40),
      filename: '天雨_AI工作流_虚构授权资料.json',
      description: '公开合成演示资料；无真实企业记录、无外部消息发送。',
      contentBase64: data.toString('base64'),
    });
    state.manifest = prepareManifest(pack, customers, archive.id);
    save(state);
  }
  if (!state.businessReceipt) {
    const preview = await command('preview', 'sales-intake/preview', {
      requestKey: 'ty-ai-preview-' + VERSION,
      manifest: state.manifest,
    });
    state.businessReceipt = preview.alreadyImported
      ? preview.receipt
      : await command('commit', 'sales-intake/commit', {
          requestKey: 'ty-ai-commit-' + VERSION,
          previewId: preview.previewId,
          digest: preview.digest,
          confirm: true,
        });
    save(state);
  }
  for (let i = 0; i < pack.knowledge.length; i += 40) {
    const entries = pack.knowledge.slice(i, i + 40);
    const p = await command('knowledge-preview-' + i, 'business-knowledge/preview', {
      requestKey: 'ty-ai-knowledge-p-' + VERSION + '-' + i,
      entries,
    });
    await command('knowledge-commit-' + i, 'business-knowledge/commit', {
      requestKey: 'ty-ai-knowledge-c-' + VERSION + '-' + i,
      previewId: p.previewId,
      digest: p.digest,
      confirm: true,
    });
  }
  if (!state.activities) {
    const items = [];
    for (const [n, c] of pack.cases.entries()) {
      const oppId = state.businessReceipt.ids.opportunities[c.key] ?? c.existingOpportunityId,
        leadId = state.businessReceipt.ids.leads[c.key];
      const target = oppId
        ? { targetType: 'opportunity', targetId: oppId }
        : leadId
          ? { targetType: 'lead', targetId: leadId }
          : { targetType: 'customer', targetId: c.customerId };
      if (c.kind === 'reference')
        for (const e of c.events.filter((e) => ['authorized_chat', 'meeting_summary'].includes(e.sourceType)))
          items.push({
            key: 'tianyu:ai:source:' + e.id,
            expectedVersion: 1,
            ...target,
            followup: { content: '【演示数据】历史授权资料整理\n' + e.title + '\n' + e.text, occurredAt: e.occurredAt },
          });
      for (const [j, step] of c.steps.entries())
        items.push({
          key: 'tianyu:ai:plan:' + c.key + '-' + (j + 1),
          expectedVersion: 1,
          ...target,
          action: {
            title: '【演示数据】' + c.customerName + '｜' + step,
            content:
              'AI依据虚构授权资料形成的未来行动。\n事项：' +
              c.name +
              '\n当前问题：' +
              c.issue +
              '\n完成标准：取得资料核对、处理回执或实际确认；未完成前保持待办。',
            dueDate: day((n % 4) + j),
            priority: c.kind === 'lost' ? 'medium' : 'high',
          },
        });
    }
    state.activities = items;
    save(state);
  }
  const links = [];
  for (let i = 0; i < state.activities.length; i += 20) {
    const r = await command('activities-' + i, 'business-knowledge/activities', {
      requestKey: 'ty-ai-activities-' + VERSION + '-' + i,
      items: state.activities.slice(i, i + 20),
    });
    links.push(...r.items);
  }
  // Current source dates and stage histories are repaired through the existing application boundary.
  if (!state.activityRepairs) {
    const repairs = [];
    for (const [n, c] of pack.cases.entries()) {
      if (c.kind === 'reference' || c.kind === 'lost') continue;
      const opportunity = state.businessReceipt.ids.opportunities[c.key],
        id = opportunity ?? state.businessReceipt.ids.leads[c.key],
        kind = opportunity ? 'opportunities' : 'leads';
      const row = await call('workspace/' + kind + '/' + id);
      const plan = links.find((x) => x.key === 'tianyu:ai:plan:' + c.key + '-1');
      const action = await call('workspace/actions/' + plan.actionId);
      repairs.push({
        kind,
        id,
        caseKey: c.key,
        expectedUpdatedAt: row.updatedAt,
        dateBasis: '天雨虚构资料的明确事件日期；下一步为内部拟定日期，不是客户承诺或已成交事实。',
        nextAction: c.steps[0],
        nextActionDate: day(n % 4),
        actionId: action.id,
        actionVersion: action.updatedAt,
      });
    }
    state.activityRepairs = repairs;
    save(state);
  }
  if (state.activityRepairs.length)
    await command('repair-source-dates', 'sales-intake/activities', {
      requestKey: 'ty-ai-repair-' + VERSION,
      items: state.activityRepairs,
    });
  const plans = links.filter((x) => x.actionId);
  for (const [i, p] of plans.entries()) {
    const label = 'calendar-' + p.actionId;
    if (state[label]?.receipt) continue;
    if (!state[label]) {
      const a = await call('workspace/actions/' + p.actionId);
      const slot = i % 12,
        hour = slot < 6 ? 9 + Math.floor(slot / 2) : 13 + Math.floor((slot - 6) / 2),
        minute = slot % 2 ? '30' : '00';
      state[label] = {
        actionId: a.id,
        actionVersion: a.updatedAt,
        startsAt: day(Math.floor(i / 12)) + 'T' + String(hour).padStart(2, '0') + ':' + minute + ':00+08:00',
      };
      save(state);
    }
    const spec = state[label];
    let receipt;
    for (let attempt = 0; attempt < 60; attempt++) {
      const requestKey = 'ty-ai-calendar-' + VERSION + '-' + p.actionId + '-' + attempt,
        startsAt = new Date(Date.parse(spec.startsAt) + attempt * 1800000).toISOString();
      try {
        receipt = await call('sales-intake/action-calendar', {
          requestKey,
          items: [{ id: spec.actionId, expectedUpdatedAt: spec.actionVersion, startsAt }],
        });
        break;
      } catch (e) {
        if (!String(e).includes('工作时段冲突')) throw e;
      }
    }
    assert(receipt, 'No available demo planning slot');
    spec.receipt = receipt;
    save(state);
  }
  const result = {
    status: 'PASS',
    version: VERSION,
    fictional: true,
    companyCode: 'TIANYU',
    stories: pack.cases.length,
    sourceMaterials: pack.sources.length,
    newCases: state.businessReceipt.counts.leads,
    newOpportunities: state.businessReceipt.counts.opportunities,
    importedFollowups: state.businessReceipt.counts.followups,
    referenceFollowups: links.filter((x) => x.followupId).length,
    knowledge: pack.knowledge.length,
    aiActions: plans.length,
    localCalendarEntries: plans.length,
    draftContracts: state.businessReceipt.counts.newDraftContracts,
    newInvoices: 0,
    newReceipts: 0,
    externalEffects: 0,
  };
  state.result = result;
  save(state);
  return result;
}
async function main() {
  const args = process.argv.slice(2),
    at = args.indexOf('--company-config');
  assert(args.includes('--confirm-fictional-tianyu'));
  assert(at >= 0 && args[at + 1]);
  const cfg = JSON.parse(fs.readFileSync(resolve(args[at + 1])));
  const env = { ...cfg, TIANYU_ALLOW_WORKFLOW: 'true' };
  validateTianyuTarget(env);
  const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const t = await db.tenant.findUniqueOrThrow({ where: { code: 'TIANYU' } });
    assert.equal(await db.tenant.count(), 1);
    assert.equal(t.config?.tianyuDemoVersion, BASE_VERSION);
  } finally {
    await db.$disconnect();
  }
  const base = args.includes('--base-url') ? args[args.indexOf('--base-url') + 1] : 'http://127.0.0.1:3000';
  const u = new URL(base);
  assert.equal(u.protocol, 'http:');
  assert(['localhost', '127.0.0.1'].includes(u.hostname));
  let token;
  const call = async (path, body) => {
    const r = await fetch(base + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Company-Code': 'TIANYU',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    if (!r.ok) throw Error(path + ' ' + JSON.stringify(j));
    return j.data;
  };
  token = (await call('auth/login', { tenantCode: 'TIANYU', username: 'admin', password: DEMO_PASSWORD })).accessToken;
  const file = resolve(
    args.includes('--receipt') ? args[args.indexOf('--receipt') + 1] : '.local/tianyu-ai-workflow-receipts.json',
  );
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const save = (s) => {
    fs.mkdirSync(resolve(file, '..'), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  console.log(JSON.stringify(await applyWorkflow({ call, state, save })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
