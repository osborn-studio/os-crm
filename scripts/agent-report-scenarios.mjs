import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
export async function verifyAgentReports({ db, url, actors, owner, outsider, password, hash, tenantId, deptId, alienToken }) {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_/);
  let checks = 0;
  const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
  async function call(path, token, body, expected = 200) {
    const r = await fetch(url + path, {method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const out = await r.json(); eq(r.status,expected,path); return out.data;
  }
  const grant = (token,capabilities=['report.sales.forecast','report.cash.collections'],maxCalls=100) => call('/agent-control/grants',token,{requestKey:randomUUID(),name:'【测试】销售回款只读',purpose:'【测试】隔离范围验证',minutes:20,maxCalls,capabilities},201);
  const invoke = (g,id='report.sales.forecast',input={year:2059,ownerId:owner.id},expected=201,requestKey=randomUUID()) => call('/agent-runtime/invoke',g.token,{requestKey,capabilityId:id,input},expected);
  const grants=[];
  for (const actor of actors) {
    const g=await grant(actor.token);grants.push(g);
    const f=await invoke(g);eq(f.result.result.summary.open,'100.01','four role delegation matches original scope');
    const cash=await invoke(g,'report.cash.collections',{year:2059,ownerId:owner.id});eq(cash.result.result.summary.received,'50.00','four role cash read matches human filters');
    eq(cash.executor,'agent');eq(cash.result.capabilityId,'report.cash.collections');
  }
  for (let i=0;i<grants.length;i++) {
    eq((await invoke(grants[i],'report.sales.forecast',{year:2059})).result.result.summary.open,i<2?'100.01':'1000099.01','delegated role default');
    if(i<2)await invoke(grants[i],'report.sales.forecast',{year:2059,personRange:'company'},403);
    else eq((await invoke(grants[i],'report.sales.forecast',{year:2059,personRange:'company'})).result.result.summary.open,'1000099.01','authorized delegated company');
  }
  const g=grants[0], userToken=actors[0].token;
  const foreignGrant=await grant(alienToken,['report.sales.forecast']);
  await invoke(foreignGrant,undefined,undefined,403);
  eq((await invoke(foreignGrant,'report.sales.forecast',{year:2059})).result.result.summary.open,'777777.00','foreign grant sees only its own company');
  await invoke(g,'report.sales.forecast',{year:2059,ownerId:outsider.id},403);
  await invoke(grants[1],'report.sales.forecast',{year:2059,deptId:outsider.deptId},403);
  await invoke(g,'report.sales.forecast',{year:2059,tenantId:999},400);
  await invoke(g,'report.cash.collections',{year:2059,sql:'SELECT 1'},400);
  await invoke(g,'report.sales.forecast',{year:'2059'},400);
  await invoke(g,'report.sales.forecast',{year:2059,pageSize:101},400);
  const readKey=randomUUID();await invoke(g,undefined,undefined,201,readKey);await invoke(g,undefined,undefined,409,readKey);
  const execution=await invoke(g);const receipt=await call('/agent-runtime/receipts/'+execution.executionId,g.token);
  eq(receipt.capabilityId,'report.sales.forecast');eq(receipt.status,'succeeded');
  const audit=await db.auditLog.findFirstOrThrow({where:{objectNo:execution.result.executionId,action:'capability.succeeded'}});
  eq(audit.afterData.agentExecutionId,execution.executionId);eq(audit.afterData.grantId,g.id);
  const stored=await db.agentExecution.findUniqueOrThrow({where:{id:execution.executionId}});eq(Object.keys(stored.result),['businessExecutionId']);
  const old=await grant(userToken,['customer.search']);await invoke(old,undefined,undefined,403);
  eq((await call('/agent-runtime/capabilities',old.token)).capabilities.map(c=>c.id),['customer.search']);
  const role=await db.role.create({data:{tenantId,code:'report_'+randomUUID().slice(0,8),name:'【测试】仅商机只读',dataScope:'self',permissions:['opportunity:read','finance:read']}});
  const limited=await db.user.create({data:{tenantId,username:'report_'+randomUUID().slice(0,8),name:'【测试】受限报表人员',deptId,passwordHash:hash,roles:{create:{tenantId,roleId:role.id}}}});
  const limitedToken=(await call('/auth/login',undefined,{tenantCode:'ANALYTICSTEST',username:limited.username,password})).accessToken;
  await call('/agent-control/grants',limitedToken,{requestKey:randomUUID(),name:'【测试】拒绝财务',purpose:'【测试】',minutes:5,maxCalls:2,capabilities:['report.cash.collections']},403);
  const limitedGrant=await grant(limitedToken,['report.sales.forecast']);await invoke(limitedGrant,undefined,undefined,403);
  const apiRequire=createRequire(new URL('../apps/api/package.json',import.meta.url));
  const {Client}=await import(apiRequire.resolve('@modelcontextprotocol/sdk/client/index.js'));
  const {StreamableHTTPClientTransport}=await import(apiRequire.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
  for(const delegated of [true,false]) {
    const client=new Client({name:'synthetic-report-verifier',version:'1.0.0'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url+(delegated?'/agent-runtime/mcp':'/mcp')),{requestInit:{headers:{Authorization:'Bearer '+(delegated?g.token:userToken)}}}));
      const tools=(await client.listTools()).tools;
      for(const id of ['report.sales.forecast','report.cash.collections']) {const tool=tools.find(t=>t.name===id);eq(!!tool,true);eq(tool.annotations.readOnlyHint,true);}
      if(delegated)eq(tools.map(t=>t.name).sort(),['agent.receipt','report.cash.collections','report.sales.forecast']);
      const result=await client.callTool({name:'report.sales.forecast',arguments:{year:2059,ownerId:owner.id,...(delegated?{requestKey:randomUUID()}:{})}});
      eq(!!result.isError,false);const out=JSON.parse(result.content[0].text);eq((delegated?out.result.result:out.result).summary.open,'100.01');
      const invalid=await client.callTool({name:'report.sales.forecast',arguments:{year:2059,tenantId:99,...(delegated?{requestKey:randomUUID()}:{})}});eq(invalid.isError,true);
    } finally {await client.close();}
  }
  const small=await grant(userToken,['report.sales.forecast'],1);
  const statuses=await Promise.all([1,2].map(async()=>{
    const r=await fetch(url+'/agent-runtime/invoke',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+small.token},body:JSON.stringify({requestKey:randomUUID(),capabilityId:'report.sales.forecast',input:{year:2059}})});await r.text();return r.status;
  }));eq(statuses.sort(),[201,403]);eq((await db.agentGrant.findUniqueOrThrow({where:{id:small.id}})).usedCalls,1);
  function sql(statement) {
    const u=new URL(process.env.DATABASE_URL), binary=process.env.MYSQL_BIN_DIR?join(process.env.MYSQL_BIN_DIR,'mysql'):'mysql';
    const r=spawnSync(binary,['--protocol=TCP','--host='+u.hostname,'--port='+(u.port||3306),'--user='+decodeURIComponent(u.username),u.pathname.slice(1),'--delimiter=//','--execute',statement+'//'],{env:{...process.env,MYSQL_PWD:decodeURIComponent(u.password)},encoding:'utf8'});
    if(r.status!==0)throw Error('Synthetic report SQL fault fixture failed');
  }
  const trigger='report_fault_'+randomUUID().replaceAll('-','').slice(0,8), guarded=await grant(userToken,['report.sales.forecast']);
  try {
    sql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW BEGIN IF NEW.action='capability.succeeded' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.after_data,'$.capabilityId'))='report.sales.forecast' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic report audit fault'; END IF; END`);
    await invoke(guarded,undefined,undefined,500);
    eq((await db.agentExecution.findFirstOrThrow({where:{grantId:guarded.id},orderBy:{createdAt:'desc'}})).status,'failed');
    sql(`DROP TRIGGER ${trigger}`);
    sql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW BEGIN IF NEW.action='capability.succeeded' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.after_data,'$.capabilityId'))='report.sales.forecast' THEN SET @crm_report_lock=GET_LOCK('${trigger}',0); SET @crm_report_pause=SLEEP(2); SET @crm_report_unlock=RELEASE_LOCK('${trigger}'); END IF; END`);
    const pending=invoke(guarded,undefined,undefined,401);
    for(let i=0;i<100;i++){if(await db.agentExecution.count({where:{grantId:guarded.id,status:'running'}}))break;await delay(10);}
    await call('/agent-control/grants/'+guarded.id+'/revoke',userToken,{requestKey:randomUUID(),reason:'【测试】读取期间撤销'},201);
    await pending;eq((await db.agentExecution.findFirstOrThrow({where:{grantId:guarded.id},orderBy:{createdAt:'desc'}})).status,'failed');
    const human=new Client({name:'synthetic-report-human-revocation',version:'1.0.0'});
    try {
      await human.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+actors[3].token}}}));
      const read=human.callTool({name:'report.sales.forecast',arguments:{year:2059,ownerId:owner.id}});
      let inAudit=false;
      for(let i=0;i<150;i++) {const state=await db.$queryRawUnsafe(`SELECT IS_USED_LOCK('${trigger}') AS holder`);if(state[0].holder!==null){inAudit=true;break;}await delay(10);}
      eq(inAudit,true,'human read paused inside success audit');
      await db.authSession.updateMany({where:{tenantId,userId:actors[3].userId,revokedAt:null},data:{revokedAt:new Date()}});
      const result=await read;eq(result.isError,true,'human read denied after logout during audit');
      eq(JSON.parse(result.content[0].text).statusCode,403);
    } finally {await human.close();}

  } finally {sql(`DROP TRIGGER IF EXISTS ${trigger}`);}
  const visible=await db.opportunity.findFirstOrThrow({where:{tenantId,ownerId:owner.id,status:'open',expectedCloseDate:{not:null}}});
  try{await db.opportunity.update({where:{id:visible.id},data:{amount:'110.02'}});eq((await invoke(g)).result.result.summary.open,'110.02','reports are freshly read, never cached');}
  finally{await db.opportunity.update({where:{id:visible.id},data:{amount:visible.amount}});}
  await db.role.update({where:{id:role.id},data:{permissions:[]}});await call('/agent-runtime/capabilities',limitedGrant.token,undefined,401);
  await call('/analytics/forecast',g.token,undefined,401);
  return {result:'PASS',checks,officialMcpClientKinds:2,reportReadsOnly:true,auditFailureDeniesResult:true,revocationDuringRead:true,concurrentBudget:true};
}
