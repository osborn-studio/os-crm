import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
import { statisticsFilter, statisticsScope } from './statistics-scope';
import { departmentSubtree, teamIds } from './access';
const self: Actor = { tenantId: 1, userId: 2, deptId: 3, roles: ['sales'], permissions: ['opportunity:read'], dataScope: 'self' };
const tx = {
  user: { findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'Synthetic A', deptId: 3, roles:[{role:{code:'sales_manager'}}] }, { id: 4, name: 'Synthetic B', deptId: 4 }]) },
  department: { findMany: jest.fn().mockResolvedValue([{ id: 3, name: 'Root', parentId: null },{id:4,name:'Child',parentId:3}]) },
} as unknown as Tx;
describe('statistics role and relationship scope', () => {
  it('defaults sales to self, administrators/boss to company, managers to the department subtree', async () => {
    expect(await statisticsScope(tx,self,{})).toEqual({personRange:'self',ownerIds:[2]});
    for(const role of ['super_admin','gm']) expect(await statisticsScope(tx,{...self,roles:[role],dataScope:'all'},{})).toEqual({personRange:'company',ownerIds:null});
    expect(await statisticsScope(tx,{...self,roles:['sales_manager'],dataScope:'dept'},{})).toEqual({personRange:'department',ownerIds:[2,4]});
    expect(await statisticsScope(tx,{...self,roles:['super_admin'],dataScope:'all'},{personRange:'self'})).toEqual({personRange:'self',ownerIds:[2]});
  });
  it('rejects elevation and contradictory selections', async () => {
    for (const q of ([{personRange:'company'}, {deptId:'9'}, {personRange:'self',ownerId:'4'}, {personRange:'person'}, {personRange:'company',deptId:'3'}, {ownerId:'0'}] as Record<string,string>[])) await expect(statisticsScope(tx,self,q)).rejects.toThrow();
  });
  it('permits a child department but not its parent or sibling', async () => {
    const manager={...self,dataScope:'dept' as const};
    expect((await statisticsScope(tx,manager,{deptId:'4'})).ownerIds).toEqual([4]);
    await expect(statisticsScope(tx,manager,{ownerId:'999'})).rejects.toThrow();
    expect((await statisticsScope(tx,manager,{ownerId:'4'})).ownerIds).toEqual([4]);
    expect(departmentSubtree([{id:3,parentId:null},{id:4,parentId:3},{id:5,parentId:null}],3)).toEqual([3,4]);
    expect(departmentSubtree([{id:3,parentId:4},{id:4,parentId:3}],3)).toEqual([3,4]);
    expect(departmentSubtree([{id:3,parentId:null}],99)).toEqual([]);
    expect(await teamIds(tx,manager)).toEqual([2,4]);
    expect((await statisticsScope(tx,{...self,roles:['super_admin'],dataScope:'all'},{personRange:'person',ownerId:'2'})).ownerIds).toEqual([2,4]);
  });
  it('uses the parent customer for followups and the contract for finance', () => {
    const scope={personRange:'self' as const,ownerIds:[2]};
    expect(statisticsFilter('receipts',scope,[11])).toEqual({contractId:{in:[11]}});
    expect(statisticsFilter('followups',scope,[12])).toEqual({customerId:{in:[12]}});
    expect(()=>statisticsFilter('followups',scope)).toThrow();
    expect(statisticsFilter('actions',scope)).toEqual({assigneeId:{in:[2]}});
    expect(statisticsFilter('projects',scope)).toEqual({OR:[{salesOwnerId:{in:[2]}},{pmId:{in:[2]}}]});
  });
});
