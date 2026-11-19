import { salesActivityBody, followupTime } from './sales-activity-policy';
const item={kind:'opportunities',id:1,expectedUpdatedAt:'2026-11-15T00:00:00.000Z',caseKey:'synthetic',expectedCloseDate:'2026-12-01',closeDateEstimated:true,dateBasis:'Estimated planning date',nextAction:'Verify quote',nextActionDate:'2026-11-20',actionId:1,actionVersion:'2026-11-15T00:00:00.000Z'};
describe('historical activity planning boundary',()=>{
 it('requires a date estimate marker, real calendar dates and unique business/action IDs',()=>{
  expect(salesActivityBody.safeParse({requestKey:'test',items:[item]}).success).toBe(true);
  for(const rows of [[{...item,closeDateEstimated:undefined}],[{...item,expectedCloseDate:'2026-02-30'}],[item,item],[{...item,tenantId:2}],[{...item,kind:'leads'}]]) expect(salesActivityBody.safeParse({requestKey:'test',items:rows}).success).toBe(false);
 });
 it('does not turn the import date into a historical contact time',()=>{
  const createdAt=new Date('2026-11-15T00:00:00Z');
  expect(followupTime({createdAt,aiStructured:{salesIntake:{occurredAt:null}}})).toBeNull();
  expect(followupTime({createdAt,aiStructured:{salesIntake:{occurredAt:'2026-10-01T00:00:00Z'}}})?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  expect(followupTime({createdAt,aiStructured:{knowledge:{occurredAt:null}}})).toBeNull();
  expect(followupTime({createdAt,aiStructured:{knowledge:{occurredAt:'2025-12-01T00:00:00Z'}}})?.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  expect(followupTime({createdAt,aiStructured:null})).toEqual(createdAt);
 });
});
