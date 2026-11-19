/** Authenticated import client. Input files stay local. Never logs credentials or contents. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [input,receiptFile]=process.argv.slice(2);
if(!input||!receiptFile)throw Error('Usage: CRM_URL=... CRM_COMPANY=... CRM_ACCESS_TOKEN=... KNOWLEDGE_COMMIT=true node scripts/import-knowledge.mjs entries.json receipt.json');
const base=new URL(process.env.CRM_URL||'http://127.0.0.1:3000/api/v1/');
if(base.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(base.hostname))throw Error('Remote imports require HTTPS');
if(!process.env.CRM_ACCESS_TOKEN||!process.env.CRM_COMPANY)throw Error('Authenticated company context is required');
const entries=JSON.parse(fs.readFileSync(input,'utf8'));if(!Array.isArray(entries)||!entries.length)throw Error('Expected nonempty entry array');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');const inputHash=digest(entries);
async function call(path,body){const r=await fetch(new URL(path,base.href.endsWith('/')?base:base.href+'/'),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Company-Code':process.env.CRM_COMPANY,Authorization:'Bearer '+process.env.CRM_ACCESS_TOKEN},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});const j=await r.json();if(!r.ok)throw Error('Import HTTP '+r.status+' '+path+'; preserve receipt file for reconciliation');return j.data??j;}
const state=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile)): {inputHash,batches:[]};if(state.inputHash!==inputHash)throw Error('Input changed; choose a separate receipt file');
const save=()=>fs.writeFileSync(receiptFile,JSON.stringify(state,null,2),{mode:0o600});
let versionMap;async function versions(){const map=new Map();for(let p=1;;p++){const d=await call('business-knowledge?pageSize=100&page='+p);for(const r of d.items)map.set(r.sourceKey,r.version);if(p*100>=d.total)break;if(p>1000)throw Error('Knowledge read budget exceeded');}return map;}
if(!state.batches.length){versionMap=await versions();let group=[];for(const row of entries){const e={...row,expectedVersion:versionMap.get(row.key)||0};if(group.length&&(group.length>=50||Buffer.byteLength(JSON.stringify([...group,e]))>1200000)){state.batches.push({entries:group});group=[];}group.push(e);}if(group.length)state.batches.push({entries:group});save();}
for(const b of state.batches){if(b.receipt)continue;const stamp=digest(b.entries).slice(0,40);if(!b.preview){b.previewBody={requestKey:'knowledge-preview-'+stamp,entries:b.entries};save();b.preview=await call('business-knowledge/preview',b.previewBody);save();}if(process.env.KNOWLEDGE_COMMIT!=='true')continue;b.commitBody??={requestKey:'knowledge-commit-'+stamp,previewId:b.preview.previewId,digest:b.preview.digest,confirm:true};save();b.receipt=await call('business-knowledge/commit',b.commitBody);save();}
console.log(JSON.stringify({mode:process.env.KNOWLEDGE_COMMIT==='true'?'commit':'preview',batches:state.batches.length,committed:state.batches.filter(b=>b.receipt).length,entries:entries.length,financialEffects:false,externalEffects:false}));
