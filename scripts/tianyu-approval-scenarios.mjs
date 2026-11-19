/** Explicit fictional TIANYU enrichment through authenticated application services. No real-company data. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {resolve} from 'node:path';
const args=process.argv.slice(2),at=args.indexOf('--company-config');
assert(args.includes('--confirm-fictional-tianyu'),'Pass --confirm-fictional-tianyu');assert(at>=0&&args[at+1],'Pass --company-config');
const cfg=JSON.parse(fs.readFileSync(resolve(args[at+1]))),spec=JSON.parse(fs.readFileSync(new URL('../demo/tianyu/approval-scenarios.json',import.meta.url)));
assert.equal(cfg.TENANT_CODE,'TIANYU');assert.equal(cfg.ACCOUNT_PURPOSE,'test');assert.match(new URL(cfg.DATABASE_URL).pathname,/^\/tbcrm_c_[a-f0-9]{16}$/);
const base=args.includes('--base-url')?args[args.indexOf('--base-url')+1]:'http://127.0.0.1:3000';const u=new URL(base);assert(['127.0.0.1','localhost'].includes(u.hostname));assert.equal(u.protocol,'http:');
const users={1:'admin',1010:'ty_mgr_east',1011:'ty_mgr_south',1001:'ty_boss',1200:'ty_pm',1400:'ty_finance',1100:'ty_sales01'},tokens={},prefix='tianyu-approval-scenarios-v1';
async function call(path,id,body){const r=await fetch(base+'/api/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Company-Code':'TIANYU',...(tokens[id]?{Authorization:'Bearer '+tokens[id]}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok)throw Error(path+' '+JSON.stringify(j));return j.data;}
for(const [id,username]of Object.entries(users))tokens[id]=(await call('auth/login',id,{tenantCode:'TIANYU',username,password:'12345'})).accessToken;
const proof={flows:[],approvals:[],externalMessages:0};
async function decide(id,mode,key){let d=await call('approvals/'+id,1);if(mode==='pending')return d;
 if(mode==='withdrawn'){if(d.status==='pending')await call('approvals/'+id+'/withdraw',1100,{requestKey:key+'-withdraw',reason:'供货方案调整后重新提交'});return call('approvals/'+id,1);}
 for(let step=0;d.status==='pending'&&step<12;step++){const node=d.nodes.find(n=>n.id===d.currentNodeId);assert(node&&tokens[node.approverId]);await call('approvals/'+id+'/nodes/'+node.id+'/'+(mode==='rejected'?'reject':'approve'),node.approverId,{requestKey:key+'-'+step,comment:mode==='rejected'?'图纸/付款依据待补，退回补充后重新发起':'已核对申请及本节点职责范围，同意本次事项'});d=await call('approvals/'+id,1);}
 assert.equal(d.status,mode);return d;
}
for(const [i,f]of spec.flows.entries()){
 const key=prefix+'-'+f.key;
 const flow=await call('approvals/flows',1,{requestKey:key+'-draft',name:f.name,bizType:'general',condition:'always',priority:100,nodes:f.reviewers.map(id=>({name:id===1400?'财务核对':id===1200?'技术与交付核对':id===1001?'经营审批':'销售主管审批',approverType:'user',approverValue:String(id),condition:'always'})),fields:spec.fields});
 const published=await call('approvals/flows/'+flow.id+'/publish',1,{requestKey:key+'-publish',expectedUpdatedAt:flow.updatedAt});proof.flows.push({id:published.id,name:f.name});
 for(const [j,state]of spec.states.entries()){
  const form={customer:['清源装备（天雨示例）','云澜化工（天雨示例）','慕源电力（天雨示例）'][i%3],customerCode:'TY-KH-'+String(i%3+1).padStart(6,'0'),relatedDocument:'TY-SJ-'+String(i%3+1).padStart(5,'0'),businessType:i%2?'定制高温阀门':'标准球阀',channel:i%3?'直销':'经销渠道',currentStage:j?'方案提供':'前期拜访',targetStage:f.nextStage,reason:'虚构业务申请：核对客户归属、技术资料、供货范围及商务条款；本次申请为'+f.name,evidence:'关联客户与商机档案；技术确认单、报价版本及当前付款条件见业务记录',plannedDate:'2026-11-'+String(16+(i%10)).padStart(2,'0')};
  const a=await call('capabilities/approval.request/invoke',1100,{kind:'form',requestKey:key+'-'+state,flowId:published.id,title:f.name+'｜'+form.customer+'｜'+(['待审','通过','退回','撤回'][j]),amount:String(120000+i*10000),form});
  const approvalId=a.result?.id??a.id;if(!approvalId)throw Error('Missing approval ID');
  const d=await decide(approvalId,state,key+'-'+state);proof.approvals.push({id:d.id,flowId:published.id,status:d.status});
  if(state==='rejected'){
    const again=await call('capabilities/approval.request/invoke',1100,{kind:'form',requestKey:key+'-resubmit',flowId:published.id,title:f.name+'｜补充资料后重提',amount:String(120000+i*10000),form:{...form,reason:form.reason+'；承接原退回申请 #'+d.id+'，补齐图纸及付款依据后重新提交。'}});
    const resubmitted=await call('approvals/'+(again.result?.id??again.id),1);
    proof.approvals.push({id:resubmitted.id,flowId:published.id,status:resubmitted.status,resubmissionOf:d.id});
  }
 }
}
// Persist receipts privately or explicitly chosen output; never include configuration secrets.
const out=args.includes('--receipt')?args[args.indexOf('--receipt')+1]:'.local/tianyu-approval-scenarios-receipt.json';fs.mkdirSync(resolve(out,'..'),{recursive:true});fs.writeFileSync(out,JSON.stringify(proof,null,2),{mode:0o600});
console.log(JSON.stringify({status:'PASS',flows:proof.flows.length,approvals:proof.approvals.length,states:proof.approvals.reduce((s,a)=>(s[a.status]=(s[a.status]??0)+1,s),{}),externalMessages:0}));
