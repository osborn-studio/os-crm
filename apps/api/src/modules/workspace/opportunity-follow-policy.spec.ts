import { opportunityFollowInput } from './opportunity-follow-policy';
describe('opportunity followup input',()=>{
 it('requires an actual record and explicit next-step fields for action scheduling',()=>{
  expect(opportunityFollowInput({content:'Actual synthetic work record'}).method).toBe('other');
  expect(opportunityFollowInput({content:'Actual synthetic work record',nextAction:'Confirm scope',nextFollowAt:'2059-07-02',createAction:true}).createAction).toBe(true);
  for(const value of [{content:''},{content:'x',customerId:2},{content:'x',createAction:true},{content:'x',nextAction:'Next',nextFollowAt:'2059-02-30',createAction:true}])expect(()=>opportunityFollowInput(value)).toThrow();
 });
});
