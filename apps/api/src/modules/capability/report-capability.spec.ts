import type { Actor } from '../../common/types/actor';
import { reportInput } from './report-capability.service';
import { reportMcpInput } from './report-mcp-schema';
import { allowedReportCapabilities } from '../workspace/analytics.contract';
import { agentCatalog } from './agent.catalog';
import { grantInput } from './agent-policy';
import { randomUUID } from 'node:crypto';
const actor = (permissions: string[]): Actor => ({userId:1,tenantId:1,sessionId:randomUUID(),deptId:1,roles:['sales'],permissions,dataScope:'self'});
describe('delegated report contract', () => {
  it('passes explicit date ranges through both transports',()=>{
    const v={from:'2010-01-01',to:'2060-12-31'};expect(reportInput(v)).toEqual(v);expect(reportMcpInput.parse(v)).toEqual(v);
    for(const bad of [{year:2061},{from:'2009-12-31'},{from:'2026-02-31'}])expect(()=>reportInput(bad)).toThrow();
  });
  it('requires independent opportunity read, or finance and contract read together', () => {
    expect(allowedReportCapabilities(actor(['customer:read']))).toHaveLength(0);
    expect(allowedReportCapabilities(actor(['opportunity:read'])).map(c=>c.id)).toEqual(['report.sales.forecast']);
    expect(allowedReportCapabilities(actor(['finance:read']))).toHaveLength(0);
    expect(allowedReportCapabilities(actor(['contract:read']))).toHaveLength(0);
    expect(allowedReportCapabilities(actor(['finance:read','contract:read'])).map(c=>c.id)).toEqual(['report.business.cash','report.cash.collections']);
    expect(agentCatalog(actor(['opportunity:read'])).tools.map(c=>c.id)).toEqual(['report.sales.forecast']);
  });
  it('converts typed transport parameters without accepting identity or arbitrary objects', () => {
    expect(reportInput({year:2026,month:0,detail:'receipts',pageSize:100})).toEqual({detail:'receipts',month:'0',pageSize:'100',year:'2026'});
    for (const input of [null, [], {year:'2026'}, {year:1999}, {year:Infinity}, {month:-1}, {ownerId:0}, {pageSize:101}, {page:1000001}, {tenantId:9}, {actorId:1}, {sql:'SELECT 1'}, {source:'arbitrary'}, {detail:'credentials'}, {ownerId:{id:1}}, {'__proto__':null, unsafe:true}]) expect(()=>reportInput(input)).toThrow();
  });
  it('MCP and HTTP adapters reject the same malformed numeric, enum and identity input', () => {
    for (const input of [{year:'2026'}, {month:13}, {pageSize:0}, {ownerId:2147483648}, {source:'all'}, {tenantId:2}]) {
      expect(()=>reportInput(input)).toThrow(); expect(()=>reportMcpInput.parse(input)).toThrow();
    }
    expect(reportMcpInput.parse({})).toEqual({}); expect(reportInput({})).toEqual({});
  });
  it('only explicitly selected reports expand a grant; financial writes remain forbidden', () => {
    const base={requestKey:randomUUID(),name:'【测试】报表委托',purpose:'【测试】只读核对',minutes:10,maxCalls:5};
    expect(grantInput({...base,capabilities:['report.sales.forecast','report.cash.collections']}).capabilities).toHaveLength(2);
    expect(()=>grantInput({...base,capabilities:['finance.receipt.register']})).toThrow();
    expect(()=>grantInput({...base,capabilities:['report.cash.collections','report.cash.collections']})).toThrow();
  });
});
