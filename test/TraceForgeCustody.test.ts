import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {network} from 'hardhat';
import {keccak256,stringToHex,zeroHash,encodeFunctionData} from 'viem';
const id=(s:string)=>keccak256(stringToHex(s));
async function scenario(quantity=1n) {
 const {viem}=await network.create();
 const wallets=await viem.getWalletClients(),rpc=await viem.getPublicClient(),contract=await viem.deployContract('TraceForge');
 const clients=await Promise.all(wallets.slice(1,5).map(wallet=>viem.getContractAt('TraceForge',contract.address,{client:{wallet}})));
 const orgs=['A','B','C','D'].map(id),tenant=id('TENANT'),role=id('ROLE'),entity=id('PRODUCT');
 const wait=(hash:`0x${string}`)=>rpc.waitForTransactionReceipt({hash});
 for(let i=0;i<clients.length;i++)await wait(await clients[i].write.registerBusiness([orgs[i],id('PROFILE')]));
 await wait(await clients[0].write.createBusinessWorkspace([tenant,id('WORKSPACE'),role]));
 await wait(await clients[0].write.createProduct([tenant,role,entity,id('METADATA'),quantity]));
 const root=(await contract.read.getProduct([tenant,entity])).rootRouteId;
 let sequence=0;
 const input=async(receiver=1,overrides:Record<string,unknown>={})=>({tenantId:tenant,entityId:entity,sourceRouteId:root,
  receivedRouteId:quantity>1n?id('CHILD_'+(++sequence)):zeroHash,requestId:id('REQUEST_'+(++sequence)),receiverWallet:wallets[receiver+1].account.address,
  expectedVersion:0n,quantity:1n,expiresAt:(await rpc.getBlock()).timestamp+3600n,evidenceHash:id('EVIDENCE'),...overrides} as any);
 return {viem,wallets,rpc,contract,clients,orgs,tenant,role,entity,root,wait,input};
}
describe('Current-owner receipt approval',()=>{
 it('permits independently registered receivers without origin-workspace membership',async()=>{
  const s=await scenario();assert.equal(await s.contract.read.isActiveTenantMember([s.tenant,s.orgs[1]]),false);
  assert.equal((await s.contract.read.getOrganization([s.orgs[1]])).active,true);
  await s.wait(await s.clients[0].write.approveReceipt([await s.input()]));
  assert.equal((await s.contract.read.getEntity([s.tenant,s.entity])).currentCustodian,s.orgs[1]);
 });
 it('rejects receiver and unrelated business approvals without changing ownership or quantity',async()=>{
  const s=await scenario();const a=await s.input();
  for(const client of [s.clients[1],s.clients[2]])await assert.rejects(()=>client.write.approveReceipt([a]),/NotCurrentCustodian/);
  assert.equal((await s.contract.read.getEntity([s.tenant,s.entity])).currentCustodian,s.orgs[0]);
  assert.equal((await s.contract.read.getProduct([s.tenant,s.entity])).availableQuantity,1n);
  assert.equal(await s.contract.read.approvedReceiptRequests([a.requestId]),false);
 });
 it('removes legacy unrestricted claim selectors',async()=>{
  const s=await scenario();
  for(const name of ['claimCustody','claimBatch'])assert.equal(s.contract.abi.some((v:any)=>v.type==='function'&&v.name===name),false);
  const abi=[{type:'function',name:'claimCustody',stateMutability:'nonpayable',inputs:[{type:'bytes32'},{type:'bytes32'},{type:'uint64'},{type:'bytes32'},{type:'bytes32'}],outputs:[]}] as const;
  const data=encodeFunctionData({abi,functionName:'claimCustody',args:[s.tenant,s.entity,0n,id('RECEIVED'),id('E')]});
  await assert.rejects(()=>s.rpc.call({account:s.wallets[2].account.address,to:s.contract.address,data}));
 });
 it('emits auditable requester and owner wallet addresses',async()=>{
  const s=await scenario(),a=await s.input();const receipt=await s.wait(await s.clients[0].write.approveReceipt([a]));
  const events=await s.rpc.getContractEvents({address:s.contract.address,abi:s.contract.abi,eventName:'ReceiptApproved',fromBlock:receipt.blockNumber,toBlock:receipt.blockNumber});
  assert.equal(events.length,1);assert.equal(events[0].args.requestId,a.requestId);
  assert.equal(events[0].args.fromOrganizationId,s.orgs[0]);assert.equal(events[0].args.toOrganizationId,s.orgs[1]);
  assert.equal(events[0].args.requesterWallet?.toLowerCase(),s.wallets[2].account.address.toLowerCase());
  assert.equal(events[0].args.approverWallet?.toLowerCase(),s.wallets[1].account.address.toLowerCase());
  assert.equal(await s.contract.read.approvedReceiptRequests([a.requestId]),true);
 });
 it('prevents replay and stale approval after custody returns to an earlier holder',async()=>{
  const s=await scenario(),a=await s.input();await s.wait(await s.clients[0].write.approveReceipt([a]));
  await s.wait(await s.clients[1].write.approveReceipt([await s.input(0,{expectedVersion:1n})]));
  await assert.rejects(()=>s.clients[0].write.approveReceipt([a]),/ReceiptRequestAlreadyApproved/);
  await assert.rejects(async()=>s.clients[0].write.approveReceipt([await s.input(2,{expectedVersion:0n})]),/StaleCustody/);
 });
 it('rejects expired, empty, self and unbound-recipient requests',async()=>{
  const s=await scenario();
  for(const [overrides,error] of [[{expiresAt:1n},/ReceiptRequestExpired/],[{requestId:zeroHash},/InvalidReceiptRequest/],
   [{evidenceHash:zeroHash},/InvalidEvidenceHash/],[{receiverWallet:s.wallets[1].account.address},/InvalidCustodyRecipient/],
   [{receiverWallet:s.wallets[8].account.address},/WalletNotBound/],[{quantity:0n},/InvalidQuantity/],[{quantity:2n},/InsufficientQuantity/]] as const){
    await assert.rejects(async()=>s.clients[0].write.approveReceipt([await s.input(1,overrides)]),error);
  }
 });
 it('rejects inactive recipient wallets and businesses',async()=>{
  const s=await scenario();await s.wait(await s.contract.write.setWalletActive([s.wallets[2].account.address,false]));
  await assert.rejects(async()=>s.clients[0].write.approveReceipt([await s.input()]),/WalletNotBound/);
  await s.wait(await s.contract.write.setWalletActive([s.wallets[2].account.address,true]));
  await s.wait(await s.contract.write.setOrganizationActive([s.orgs[1],false]));
  await assert.rejects(async()=>s.clients[0].write.approveReceipt([await s.input()]),/OrganizationInactive/);
 });
 it('enforces source ownership and quantity across competing batch approvals',async()=>{
  const s=await scenario(10n),first=await s.input(1,{quantity:6n});
  await assert.rejects(()=>s.clients[1].write.approveReceipt([first]),/NotRouteOwner/);
  await s.wait(await s.clients[0].write.approveReceipt([first]));
  await assert.rejects(async()=>s.clients[0].write.approveReceipt([await s.input(2,{quantity:6n,expectedVersion:1n})]),/InsufficientQuantity/);
  assert.equal((await s.contract.read.getBatchRoute([s.tenant,s.entity,s.root])).availableQuantity,4n);
  await s.wait(await s.clients[0].write.approveReceipt([await s.input(2,{quantity:4n,expectedVersion:1n})]));
  assert.equal((await s.contract.read.getBatchRoute([s.tenant,s.entity,s.root])).availableQuantity,0n);
  assert.equal((await s.contract.read.getProduct([s.tenant,s.entity])).availableQuantity,10n);
 });
 it('allows only the new holder to remove stock and prevents later receipts',async()=>{
  const s=await scenario();await s.wait(await s.clients[0].write.approveReceipt([await s.input()]));
  const args=[s.tenant,s.entity,zeroHash,1n,1n,0,'',id('REMOVAL')] as const;
  await assert.rejects(()=>s.clients[0].write.removeProduct(args),/NotCurrentCustodian/);
  await s.wait(await s.clients[1].write.removeProduct(args));
  await assert.rejects(async()=>s.clients[1].write.approveReceipt([await s.input(2,{expectedVersion:2n})]),/EntityIsClosed/);
 });
});
