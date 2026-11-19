import { verifyAgentReports } from './agent-report-scenarios.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const db = new PrismaClient();
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const password = 'Analytics-' + randomBytes(12).toString('hex');
const env = { ...process.env, DEMO_MODE: 'false', TENANT_CODE: 'ANALYTICSTEST', TENANT_NAME: 'Analytics synthetic test', ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: password,
  APP_URL: 'http://localhost:3000', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), BACKUP_KEY: randomBytes(32).toString('hex') };
let api, checks = 0, log = '';
const ok = (value, label) => { assert(value, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const url = 'http://127.0.0.1:' + (process.env.ANALYTICS_SMOKE_PORT || '4137') + '/api/v1';
async function call(path, token, expected = 200, body) {
  const r = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if(r.status !== expected)console.error(log); eq(r.status, expected, path); return j.data;
}
try {
  if (!(await db.tenant.count())) await initializeProduction(db, env);
  const tenant = await db.tenant.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const tid = tenant.id;
  const deptA = await db.department.create({ data: { tenantId: tid, code: 'ARA' + suffix, name: 'Report A' } });
  const deptB = await db.department.create({ data: { tenantId: tid, code: 'ARB' + suffix, name: 'Report B' } });
  const hash = await bcrypt.hash(password, 10);
  async function user(code, deptId, username) {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: tid, code } });
    return db.user.create({ data: { tenantId: tid, username: username + suffix, name: username, deptId, passwordHash: hash, roles: { create: { tenantId: tid, roleId: role.id } } } });
  }
  const a = await user('sales', deptA.id, 'reportSales');
  const b = await user('sales', deptB.id, 'reportOther');
  const manager = await user('sales_manager', deptA.id, 'reportManager');
  const admin = await user('super_admin', deptA.id, 'reportAdmin');
  const boss = await user('gm', deptA.id, 'reportBoss');
  const customer = await db.customer.create({ data: { tenantId: tid, code: 'AC' + suffix, name: 'Synthetic analytics A', ownerId: a.id, poolType: 'private' } });
  const customerB = await db.customer.create({ data: { tenantId: tid, code: 'BC' + suffix, name: 'Synthetic analytics B', ownerId: b.id, poolType: 'private' } });
  const stage = await db.opportunityStage.create({ data: { tenantId: tid, code: 'astage' + suffix, name: 'Synthetic 50%', probability: 50, sortOrder: 999 } });
  const future = new Date('2059-07-01');
  const makeOpp = (code, ownerId, customerId, extra = {}) => db.opportunity.create({ data: { tenantId: tid, code: code + suffix, name: 'Synthetic ' + code, ownerId, customerId, amount: '100.01', stage: stage.code, expectedCloseDate: future, ...extra } });
  await makeOpp('AO', a.id, customer.id);
  await makeOpp('AW', a.id, customer.id, { status: 'won', amount: '200', closedAt: new Date('2059-06-01') });
  await makeOpp('AL', a.id, customer.id, { status: 'lost', amount: '999', closedAt: new Date('2059-06-01') });
  await makeOpp('AU', a.id, customer.id, { expectedCloseDate: null });
  await makeOpp('BO', b.id, customerB.id, { amount: '999999' });
  const contract = await db.contract.create({ data: { tenantId: tid, contractNo: 'AR' + suffix, name: 'Synthetic report contract', customerId: customer.id, ownerId: a.id, contractType: 'implementation', amount: '100', status: 'signed', signDate: future } });
  await db.paymentPlan.create({ data: { tenantId: tid, contractId: contract.id, planNo: 'AP' + suffix, amount: '100', receivedAmount: '40', outstandingAmount: '60', dueDate: future, status: 'partial' } });
  const usd = await db.contract.create({ data: { tenantId: tid, contractNo: 'AU' + suffix, name: 'Synthetic USD excluded', customerId: customer.id, ownerId: a.id, contractType: 'implementation', currency: 'USD', amount: '10000', status: 'signed' } });
  async function receipt(code, amount, extra = {}) {
    return db.receipt.create({ data: { tenantId: tid, customerId: customer.id, contractId: contract.id, receiptNo: code + suffix, amount, allocatedAmount: '0', unallocatedAmount: amount, receiptDate: future, status: 'confirmed', ledgerManaged: true, ...extra } });
  }
  await receipt('RC', '50', { allocatedAmount: '40', unallocatedAmount: '10' });
  await receipt('RD', '700', { status: 'draft' }); await receipt('RV', '800', { status: 'voided' });
  await receipt('RL', '900', { ledgerManaged: false }); await receipt('RU', '11', { contractId: null }); await receipt('RX', '10000', { contractId: usd.id });
  const otherTenant = await db.tenant.create({ data: { code: 'AX' + suffix, name: 'Other analytics tenant', status: 'active' } });
  const otherRole = await db.role.create({ data: { tenantId: otherTenant.id, code: 'super_admin', name: 'Synthetic admin', dataScope: 'all', permissions: ['*'] } });
  const alien = await db.user.create({ data: { tenantId: otherTenant.id, username: 'alien', name: 'Synthetic alien', passwordHash: hash, roles: { create: { tenantId: otherTenant.id, roleId: otherRole.id } } } });
  const foreignCustomer = await db.customer.create({ data: { tenantId: otherTenant.id, code: 'X', name: 'Foreign customer', ownerId: alien.id } });
  await db.opportunity.create({ data: { tenantId: otherTenant.id, code: 'X', name: 'Forbidden foreign record', customerId: foreignCustomer.id, ownerId: alien.id, amount: '777777', expectedCloseDate: future } });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env: { ...env, PORT: process.env.ANALYTICS_SMOKE_PORT || '4137', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', (b) => { log = (log + b).slice(-6000); }); api.stderr.on('data', (b) => { log = (log + b).slice(-6000); });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { ready = (await fetch(url + '/health/ready')).ok; } catch {} if (ready) break; if (api.exitCode !== null) throw new Error(log); await delay(150); }
  ok(ready, 'API ready');
  const login = async (u, tenantCode = tenant.code) => (await call('/auth/login', undefined, 200, { tenantCode, username: u.username, password })).accessToken;
  const [at, bt, mt, adt, gt, xt] = await Promise.all([login(a), login(b), login(manager), login(admin), login(boss), login(alien, otherTenant.code)]);
  await call('/analytics/forecast?year=2059', undefined, 401);
  const f = await call('/analytics/forecast?year=2059', at);
  eq(f.summary.open, '100.01', 'own open only'); eq(f.summary.weighted, '50.01', 'exact projection'); eq(f.summary.won, '200.00', 'won not double counted'); eq(f.summary.winRate, '50.0', 'won / closed');
  eq((await call('/analytics/forecast?year=2059&bucket=won', at)).details.items.length, 1, 'won drill');
  await call('/analytics/forecast?year=2059&ownerId=' + b.id, at, 403);
  await call('/analytics/forecast?year=2059&deptId=' + deptB.id, mt, 403);
  eq((await call('/analytics/forecast?year=2059&deptId=' + deptA.id, mt)).summary.open, '100.01', 'manager team');
  await call('/analytics/forecast?year=2059&ownerId=' + a.id, bt, 403);
  await call('/analytics/forecast?year=2059&ownerId=' + a.id, xt, 403);
  await call('/analytics/forecast?year=2059&tenantId=' + otherTenant.id, at, 400);
  await call('/analytics/forecast?year=2059&pageSize=101', at, 400);
  const cash = await call('/analytics/collections?year=2059', at);
  eq(cash.summary.received, '50.00', 'personal cash excludes unbound'); eq(cash.summary.currentAllocatedOfReceipts, '40.00', 'allocation separate'); eq(cash.summary.currentUnallocatedOfReceipts, '10.00', 'unallocated separate');
  eq(cash.summary.currentOutstanding, '60.00', 'balance not duplicate receipt'); eq(cash.summary.unboundReceived, '0.00', 'unbound excluded from personal reports'); eq(cash.excludedCurrencyContracts, 1, 'currency separation');
  eq(cash.matrix.items[0].months[6].received, '50.00', 'contract month cash'); eq(cash.monthly[6].received, '50.00', 'personal month excludes unbound');
  eq(cash.owners.find((u) => u.ownerId === a.id).received, '50.00', 'sales attribution excludes unbound');
  for (const token of [at, mt, adt, gt]) eq((await call('/analytics/collections?year=2059&ownerId=' + a.id, token)).summary.received, '50.00', 'four role scoped totals');
  eq((await call('/analytics/collections?year=2059&source=legacy', at)).summary.received, '900.00', 'legacy separate');
  await call('/analytics/collections?year=2059&ownerId=' + a.id, xt, 403);
  const schemas = await call('/analytics/schema', at); eq(schemas.length, 3, 'versioned report catalog');
  const options = await call('/analytics/options', mt); ok(!options.owners.some((u) => u.id === b.id), 'no other-team options');
  for (const [token, expected, range] of [[mt, '100.01', 'department'], [adt, '1000099.01', 'company'], [gt, '1000099.01', 'company']]) {
    const own = await call('/analytics/forecast?year=2059', token);
    eq(own.summary.open, expected, 'role default authorized scope');
    eq(own.audience.personRange, range);
    eq((await call('/workspace/overview?from=2059-01-01&to=2059-12-31', token)).openOpportunities, token === mt ? 1 : 2, 'dashboard role default');
  }
  for (const token of [adt, gt]) {
    eq((await call('/analytics/forecast?year=2059&personRange=company', token)).summary.open, '1000099.01', 'company explicitly authorized');
    eq((await call('/analytics/collections?year=2059&personRange=company', token)).summary.received, '61.00', 'company includes unbound once');
  }
  for (const path of ['/analytics/forecast?year=2059&personRange=company', '/analytics/collections?year=2059&personRange=company', '/workspace/overview?personRange=company', '/workspace/opportunities?personRange=company']) await call(path, at, 403);
  await call('/analytics/forecast?year=2059&personRange=person', adt, 400);
  await call('/analytics/forecast?year=2059&personRange=self&ownerId='+b.id, adt, 400);
  await call('/workspace/opportunities?personRange=person&ownerId='+b.id, at, 403);
  const list = await call('/workspace/opportunities?personRange=person&ownerId='+a.id+'&from=2059-01-01&to=2059-12-31', adt);
  eq(list.meta.total, 3, 'drilldown preserves selected owner/date');
  eq(list.items.every(r=>r.ownerId===a.id), true);
  eq((await call('/workspace/overview?personRange=person&ownerId='+a.id+'&from=2059-01-01&to=2059-12-31', adt)).pipeline, '100.01', 'dashboard person matches report');
  const selfOptions = await call('/workspace/statistics-options', at);
  eq(selfOptions.owners.map(u=>u.id), [a.id]);eq(selfOptions.canCompany,false);eq(selfOptions.departments,[]);
  const adminOptions = await call('/workspace/statistics-options', adt);
  eq(adminOptions.defaultRange,'company');eq(adminOptions.canCompany,true);
  const delegatedReports = await verifyAgentReports({db,url,actors:[{token:at,userId:a.id},{token:mt,userId:manager.id},{token:adt,userId:admin.id},{token:gt,userId:boss.id}],owner:a,outsider:b,password,hash,tenantId:tid,deptId:deptA.id,alienToken:xt});

  // Parent/child department and related records must share the same live access boundary.
  const childDept=await db.department.create({data:{tenantId:tid,name:'Synthetic child',parentId:deptA.id}});
  const child=await user('sales',childDept.id,'reportChild');
  const cc=await db.customer.create({data:{tenantId:tid,code:'CH'+suffix,name:'Synthetic child customer',ownerId:child.id,poolType:'private'}});
  const co=await makeOpp('CH',child.id,cc.id,{amount:'22.22'});
  const cf=await db.followUp.create({data:{tenantId:tid,targetType:'opportunity',targetId:co.id,customerId:cc.id,method:'other',content:'Synthetic history authored by admin',createdBy:admin.id}});
  const ca=await db.actionPlan.create({data:{tenantId:tid,targetType:'customer',targetId:cc.id,title:'Synthetic child plan',assigneeId:child.id,dueDate:future}});
  const chct=await db.contract.create({data:{tenantId:tid,contractNo:'CH'+suffix,name:'Synthetic child contract',customerId:cc.id,ownerId:child.id,contractType:'implementation',amount:'22.22',status:'signed',signDate:future}});
  const cp=await db.paymentPlan.create({data:{tenantId:tid,contractId:chct.id,planNo:'CH'+suffix,amount:'22.22',receivedAmount:'0',outstandingAmount:'22.22',dueDate:future}});
  const ct=await login(child), freshBoss=await login(boss);
  eq((await call('/workspace/statistics-options',mt)).owners.some(u=>u.id===child.id),true,'Child employee in manager options');
  eq((await call('/analytics/forecast?year=2059',mt)).summary.open,'122.23','Manager default includes child department');
  eq((await call('/analytics/forecast?year=2059&deptId='+childDept.id,mt)).summary.open,'22.22','Child department filter');
  await call('/analytics/forecast?year=2059&deptId='+deptA.id,ct,403);
  for(const [kind,id]of [['customers',cc.id],['opportunities',co.id],['contracts',chct.id],['payment-plans',cp.id],['actions',ca.id],['followups',cf.id]]) {
    for(const token of [mt,adt,freshBoss,ct]) eq((await call('/workspace/'+kind+'/'+id,token)).id,id,'Related object visible to permitted role');
    await call('/workspace/'+kind+'/'+id,bt,404);
  }
  eq((await call('/workspace/followups?personRange=department&deptId='+deptA.id,mt)).items.some(f=>f.id===cf.id),true,'Transferred customer history follows owner, not original author');

  const reviewFlow=await call('/approvals/flows',adt,201,{requestKey:randomUUID(),name:'Synthetic child review',bizType:'general',fields:[],nodes:[{name:'Manager',approverType:'user',approverValue:String(manager.id)}]});
  const activeFlow=await call('/approvals/flows/'+reviewFlow.id+'/publish',adt,201,{requestKey:randomUUID(),expectedUpdatedAt:reviewFlow.updatedAt});
  const review=await call('/capabilities/approval.request/invoke',ct,201,{kind:'form',requestKey:randomUUID(),flowId:activeFlow.id,title:'Synthetic child request',amount:'22.22',form:{}});
  for(const token of [mt,adt,freshBoss,ct]) eq((await call('/approvals/'+review.id,token)).id,review.id,'Approval history follows organization read scope');
  await call('/approvals/'+review.id,bt,404);
  const reviewDetail=await call('/approvals/'+review.id,adt);
  await call('/approvals/'+review.id+'/nodes/'+reviewDetail.currentNodeId+'/approve',freshBoss,403,{requestKey:randomUUID(),comment:'Must not decide for assigned manager'});

  for(const token of [adt,freshBoss]){
    eq((await call('/analytics/forecast?year=2059&personRange=person&ownerId='+manager.id,token)).summary.open,'122.23','Selecting manager includes the managed sales team');
    eq((await call('/workspace/opportunities?from=2059-01-01&to=2059-12-31&personRange=person&ownerId='+manager.id,token)).items.some(o=>o.id===co.id),true,'Board manager filter includes subordinate opportunity');
    eq((await call('/workspace/customers?personRange=person&ownerId='+manager.id,token)).items.some(c=>c.id===cc.id),true,'Customer owner legacy filter cannot erase managed selection');
    const team=(await call('/workspace/statistics-options',token)).owners.find(u=>u.id===manager.id);eq(team.managedDepartmentIds.includes(deptA.id),true,'Manager selection clearly declares team responsibility');
  }
  eq((await call('/analytics/forecast?year=2059&personRange=self',mt)).summary.open,'0.00','Explicit self is own records, separate from managed team');
  const smallRole=await db.role.create({data:{tenantId:tid,code:'customerOnly'+suffix,name:'Synthetic customer only',dataScope:'self',permissions:['customer:read']}});
  await db.userRole.deleteMany({where:{tenantId:tid,userId:child.id}});await db.userRole.create({data:{tenantId:tid,userId:child.id,roleId:smallRole.id}});
  const limited=await login(child),limitedDetail=await call('/workspace/customers/'+cc.id,limited);
  eq(Object.keys(limitedDetail.related),['contacts'],'Missing module permissions omit related content');
  await call('/workspace/opportunities/'+co.id,limited,403);
  // Sorting must cover every matching record before server pagination; permissions remain unchanged.
  const sortRows=await Promise.all(Array.from({length:47},(_,i)=>db.actionPlan.create({data:{tenantId:tid,targetType:'customer',targetId:customer.id,title:'Sort '+suffix+' '+i,assigneeId:a.id,dueDate:i<45?new Date(Date.UTC(2058,0,1+(i%17))):null}})));
  for(const direction of ['asc','desc']){
    const actual=[];
    for(let page=1;page<=3;page++)actual.push(...(await call('/workspace/actions?keyword=Sort%20'+suffix+'&pageSize=20&page='+page+'&sortBy=dueDate&sortOrder='+direction,at)).items);
    const expected=[...sortRows].sort((x,y)=>x.dueDate===null||y.dueDate===null?(x.dueDate===null&&y.dueDate===null?(x.id-y.id)*(direction==='asc'?1:-1):x.dueDate===null?1:-1):((x.dueDate-y.dueDate)||x.id-y.id)*(direction==='asc'?1:-1));
    eq(actual.map(r=>r.id),expected.map(r=>r.id),'All-page action dates '+direction+' with null dates last and stable ties');
    const r=await call('/analytics/forecast?year=2059&personRange=company&sortBy=amount&sortOrder='+direction+'&pageSize=2',adt);
    const values=r.details.items.map(x=>Number(x.amount));eq(values,[...values].sort((a,b)=>(a-b)*(direction==='asc'?1:-1)),'Report money sorted globally '+direction);
  }
  await call('/workspace/actions?sortBy=passwordHash',at,400);
  await call('/workspace/actions?sortOrder=sideways',at,400);
  await call('/analytics/forecast?sortBy=healthFactors',at,400);
  await call('/analytics/forecast?sortOrder=sideways',at,400);
  await call('/workspace/actions?personRange=person&ownerId='+b.id+'&sortBy=dueDate',at,403);
  // New business metrics: the channel can be the paying customer; only software commission is excluded.
  await db.customer.update({where:{id:customer.id},data:{customerCategory:'sales_channel',channelBrand:'用友'}});
  const tc=await db.contract.create({data:{tenantId:tid,contractNo:'TRADE'+suffix,name:'Synthetic channel service',customerId:customer.id,ownerId:a.id,contractType:'outsource',amount:'1000',totalReceived:'400',totalOutstanding:'600',status:'signed',signDate:new Date('2058-06-01')}});
  const ccTrade=await db.contract.create({data:{tenantId:tid,contractNo:'COMM'+suffix,name:'Synthetic commission',customerId:customer.id,ownerId:a.id,contractType:'channel',amount:'500',totalReceived:'100',totalOutstanding:'400',status:'signed',signDate:new Date('2058-06-01')}});
  const ti=await db.invoice.create({data:{tenantId:tid,invoiceNo:'TI'+suffix,contractId:tc.id,customerId:customer.id,invoiceTitle:'Synthetic',amount:'600',status:'invoiced'}});
  await db.paymentPlan.createMany({data:[{tenantId:tid,contractId:tc.id,planNo:'T1'+suffix,amount:'600',receivedAmount:'200',outstandingAmount:'400',invoiceId:ti.id,dueDate:new Date('2058-07-01'),status:'partial'},{tenantId:tid,contractId:tc.id,planNo:'T2'+suffix,amount:'200',receivedAmount:'0',outstandingAmount:'200',dueDate:null},{tenantId:tid,contractId:tc.id,planNo:'T3'+suffix,amount:'200',receivedAmount:'200',outstandingAmount:'0',status:'completed'}]});
  const to=await makeOpp('TRADEO',a.id,customer.id,{amount:'1000',expectedCloseDate:new Date('2058-07-01')});
  eq((await call('/trade/opportunities/'+to.id,at)).classification,null,'Unclassified quote is not an empty known-zero classification');
  const classify={requestKey:randomUUID(),items:[{kind:'contracts',id:ccTrade.id,expectedUpdatedAt:ccTrade.updatedAt.toISOString(),category:'software_commission',reason:'Synthetic documented software commission',sourceIds:['synthetic:commission']},{kind:'opportunities',id:to.id,expectedUpdatedAt:to.updatedAt.toISOString(),category:'business',ownAmount:'400',vendorProductAmount:'600',reason:'Synthetic service 400, vendor software 600',sourceIds:['synthetic:quote']}]};
  await call('/trade/classify',at,403,classify);
  const classified=await call('/trade/classify',adt,201,classify);eq(classified.items.length,2,'Atomic trade classifications');
  eq(await call('/trade/classify',adt,201,classify),classified,'Classification receipt replay, no duplicate writes');
  await call('/trade/classify',adt,409,{...classify,requestKey:randomUUID()});
  await call('/trade/classify',adt,400,{...classify,tenantId:tid,requestKey:randomUUID()});
  await call('/trade/opportunities/'+to.id,bt,404);
  eq((await call('/workspace/opportunities/'+to.id,at)).amount,'400','Own service projection replaces gross quote in board/detail');
  eq((await db.opportunity.findUniqueOrThrow({where:{id:to.id}})).amount.toFixed(2),'1000.00','Original quote amount unchanged');
  const reg={requestKey:randomUUID(),contracts:[{id:tc.id,expectedUpdatedAt:tc.updatedAt.toISOString(),stage:'acceptance',plannedEndDate:'2058-12-01',reason:'Synthetic historical delivery closing documented by operator',sourceIds:['synthetic:history']}]};
  await call('/trade/project-register',at,403,reg);
  const registered=await call('/trade/project-register',adt,201,reg);eq(registered.actualAcceptancesCreated,0,'Historical construction does not fake actual acceptance');
  eq(await call('/trade/project-register',adt,201,reg),registered,'Historical registration idempotent');
  eq(await db.project.count({where:{tenantId:tid,contractId:tc.id}}),1,'One existing contract project preserved');
  const pr=await db.project.findUniqueOrThrow({where:{id:registered.projects[0].projectId}});eq(pr.actualStartDate,null,'No fabricated actual start');eq(pr.acceptanceState,'not_requested','No fabricated acceptance');
  for(const token of [at,mt,adt,freshBoss]){
    const r=await call('/analytics/business?year=2058&ownerId='+a.id,token);
    eq(r.summary.signed,'1000.00','Channel-paying service included, commission excluded');eq(r.summary.contractReceived,'400.00','Contract received amount');eq(r.summary.invoiceReceived,'200.00','Invoice-linked received amount');eq(r.summary.unpaid,'600.00','Contract outstanding');eq(r.summary.invoiced,'600.00','Valid invoices');eq(r.summary.invoiceUnpaid,'400.00','Invoice-specific remaining amount');eq(r.summary.construction,'1000.00','Construction deduplicated by contract');eq(r.summary.commission,'500.00','Commission separate');eq(r.cashProjection.total,'600.00','Cash projection never double-counts invoice receivable');
  }
  eq((await call('/analytics/business?year=2058&metric=contractReceived',at)).contracts.meta.total,1,'Contract-received drilldown');
  eq((await call('/analytics/business?year=2058&metric=invoiceReceived',at)).contracts.items[0].invoiceReceived,'200.00','Invoice-received drilldown');
  await call('/analytics/business?year=2058&personRange=company',at,403);
  eq((await call('/analytics/business?year=2058',bt)).summary.signed,'0.00','Outsider business report is empty');
  await call('/analytics/business?year=2058&ownerId='+a.id,xt,403);
  const grant=await call('/agent-control/grants',at,201,{requestKey:randomUUID(),name:'Synthetic business report',purpose:'Synthetic shared report verification',minutes:5,maxCalls:3,capabilities:['report.business.cash']});
  const agentReport=await call('/agent-runtime/invoke',grant.token,201,{requestKey:randomUUID(),capabilityId:'report.business.cash',input:{year:2058,sortBy:'amount',sortOrder:'desc'}});
  eq(agentReport.result.result.summary.signed,'1000.00','Agent and web share business report');
  await call('/agent-runtime/invoke',grant.token,403,{requestKey:randomUUID(),capabilityId:'report.business.cash',input:{year:2058,personRange:'company'}});
  await db.opportunity.createMany({ data: Array.from({ length: 10001 }, (_, i) => ({ tenantId: tid, code: 'B' + suffix + i, name: 'Synthetic bounded query', ownerId: b.id, customerId: customerB.id, stage: stage.code, amount: '0.01', expectedCloseDate: future })) });
  await call('/analytics/forecast?year=2059', bt, 400);
  await db.user.update({ where: { id: a.id }, data: { status: 'inactive' } });
  const revoked = await fetch(url + '/analytics/forecast?year=2059', { headers: { Authorization: 'Bearer ' + at } }); ok([401, 403].includes(revoked.status), 'revoked principal denied');
  console.log(JSON.stringify({ result: 'PASS', checks, delegatedReports, database: new URL(process.env.DATABASE_URL).pathname, fixtures: 'synthetic only', port: process.env.ANALYTICS_SMOKE_PORT || '4137' }));
} finally { api?.kill('SIGTERM'); await db.$disconnect(); }
