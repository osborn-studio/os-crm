/** Fictional TIANYU only. Reproducible business forms and proposed local calendars via application services. */
import fs from'node:fs';import assert from'node:assert/strict';import{resolve}from'node:path';
const args=process.argv.slice(2),at=args.indexOf('--company-config');assert(args.includes('--confirm-fictional-tianyu'));assert(at>=0&&args[at+1]);const cfg=JSON.parse(fs.readFileSync(resolve(args[at+1])));assert.equal(cfg.TENANT_CODE,'TIANYU');assert.equal(cfg.ACCOUNT_PURPOSE,'test');assert.match(new URL(cfg.DATABASE_URL).pathname,/^\/tbcrm_c_[a-f0-9]{16}$/);
const base=args.includes('--base-url')?args[args.indexOf('--base-url')+1]:'http://127.0.0.1:3000',url=new URL(base);assert.equal(url.protocol,'http:');assert(['127.0.0.1','localhost'].includes(url.hostname));const h={'Content-Type':'application/json','X-Company-Code':'TIANYU'};
async function call(path,body){const r=await fetch(base+'/api/v1/'+path,{method:body?'POST':'GET',headers:h,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(!r.ok)throw Error(path+' '+JSON.stringify(j));return j.data;}
h.Authorization='Bearer '+(await call('auth/login',{tenantCode:'TIANYU',username:'admin',password:'12345'})).accessToken;
async function list(kind){const rows=[];for(let page=1;;page++){const v=await call('workspace/'+kind+'?pageSize=100&page='+page+'&personRange=company');rows.push(...v.items);if(page*100>=v.meta.total)break;}return rows;}
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),anchor=today<'2026-11-15'?'2026-11-15':today;
function future(offset){const d=new Date(anchor+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1+offset);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
const contracts=(await list('contracts')).filter(c=>['signed','executing','completed'].includes(c.status)).sort((a,b)=>a.id-b.id),forms=[];
for(let i=0;i<contracts.length;i+=80){forms.push(await call('sales-intake/contract-plans',{requestKey:'ty-contract-path-v1-'+anchor+'-'+i,contracts:contracts.slice(i,i+80).map((c,n)=>({id:c.id,expectedUpdatedAt:c.updatedAt,dueDate:future(i+n<12?n:4+(i+n)*7%150),nextAction:Number(c.totalOutstanding)>0?'核对本批阀门的图纸/技术确认、预付款、分批供货签收与验收依据；按当前合同未收分期逐项确认付款触发条件、开票材料及客户付款安排。定制件先关闭技术澄清，质保尾款按约定条件单列。':'核对分批供货、累计开票、收款及核销结果，整理验收归档；检查质保、渠道复购和下期采购机会。',sourceIds:['crm:contract:'+c.id,'synthetic:tianyu:contract-lifecycle-v1']}))}));}
const pending=(await list('actions')).filter(a=>['pending','in_progress','overdue'].includes(a.status)).sort((a,b)=>a.id-b.id),counts=new Map(),entries=[];
for(const [i,a]of pending.entries()){
 let day=future(i<36?Math.floor(i/12):4+i*7%150),startsAt;
 for(;;){const k=a.assigneeId+':'+day,n=counts.get(k)??0;if(n>=10){const d=new Date(day);d.setUTCDate(d.getUTCDate()+1);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10);continue;}counts.set(k,n+1);const min=n<4?600+n*30:780+(n-4)*30;startsAt=day+'T'+String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0')+':00+08:00';break;}
 // Each action has a stable identity. On a conflicting synthetic slot, try the next half hour.
 let result;for(let attempt=0;attempt<30;attempt++){
  try{result=await call('sales-intake/action-calendar',{requestKey:'ty-calendar-v1-'+anchor+'-'+a.id+'-'+attempt,items:[{id:a.id,expectedUpdatedAt:a.updatedAt,startsAt}]});break;}
  catch(e){if(!String(e).includes('工作时段冲突'))throw e;const d=new Date(Date.parse(startsAt)+30*60000+8*3600000);startsAt=d.toISOString().slice(0,19)+'+08:00';}
 }
 assert(result,'No free proposed slot');entries.push(...result.entries);
}
const receipt={status:'PASS',company:'TIANYU',anchor,contractForms:forms.flatMap(f=>f.actions).length,calendarEntries:entries.length,externalEffects:0,forms,entries};const output=args.includes('--receipt')?args[args.indexOf('--receipt')+1]:'.local/tianyu-business-plans-receipt.json';fs.mkdirSync(resolve(output,'..'),{recursive:true});fs.writeFileSync(output,JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify({status:'PASS',contractForms:receipt.contractForms,calendarEntries:receipt.calendarEntries,externalEffects:0}));
