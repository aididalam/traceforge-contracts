import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPublicClient,http,keccak256,parseEther} from 'viem';
import {publicBootstrap} from './public-bootstrap.mjs';
import {publicRpcFixture} from './public-rpc-fixture.mjs';
test('paid-gas deployment and explicit funding work on Ethereum, Polygon and BNB EVM identities',async()=>{
 for(const chainId of [1,137,56]){
  const fixture=await publicRpcFixture(chainId),directory=await mkdtemp(join(tmpdir(),'traceforge-public-'));
  const env={TRACEFORGE_CHAIN_ID:String(chainId),TRACEFORGE_RPC_URL:fixture.url,TRACEFORGE_BOOTSTRAP_DATA_DIR:directory,TRACEFORGE_BOOTSTRAP_ARTIFACT:resolve('artifacts/contracts/TraceForge.sol/TraceForge.json'),TRACEFORGE_BOOTSTRAP_WAIT_MS:'2000'};
  const client=createPublicClient({transport:http(fixture.url)});
  try{
   const wallet=await publicBootstrap({...env,TRACEFORGE_PUBLIC_ACTION:'wallet'});
   await assert.rejects(publicBootstrap(env),{code:'insufficient_gas_balance'});
   await fixture.connection.provider.request({method:'hardhat_setBalance',params:[wallet.walletAddress,'0x'+parseEther('10').toString(16)]});
   const record=await publicBootstrap(env);assert(record.address);assert.equal(record.chainId,chainId);
   assert.equal(keccak256(await client.getBytecode({address:record.address})),record.runtimeHash);
   const receipt=await client.getTransactionReceipt({hash:record.transactionHash});assert(receipt.effectiveGasPrice>0n);
   assert.deepEqual(await publicBootstrap(env),record);
   const target='0x1111111111111111111111111111111111111111',fund={...env,TRACEFORGE_PUBLIC_ACTION:'fund',ADDRESS:target,AMOUNT:'0.1',FUNDING_ID:'fund-test-0001'};
   const funded=await publicBootstrap(fund);assert.equal(await client.getBalance({address:target}),parseEther('0.1'));
   assert.deepEqual(await publicBootstrap(fund),funded);assert.equal(await client.getBalance({address:target}),parseEther('0.1'));
   await assert.rejects(publicBootstrap({...fund,AMOUNT:'0.2'}),{code:'bootstrap_request_conflict'});
   await client.request({method:'traceforge_test_setFinalityLag',params:[1]});
   const pendingFund={...fund,FUNDING_ID:'fund-test-0002'},pending=await publicBootstrap(pendingFund);assert.equal(pending.pending,true);
   await assert.rejects(publicBootstrap({...fund,FUNDING_ID:'fund-test-0003'}),{code:'bootstrap_previous_transaction_pending'});
   await fixture.connection.provider.request({method:'evm_mine'});
   const completed=await publicBootstrap(pendingFund);assert.equal(completed.pending,undefined);
   assert.equal(await client.getBalance({address:target}),parseEther('0.2'));
   const attempt=JSON.parse(await readFile(join(directory,'funding/fund-test-0002.attempt.json'),'utf8'));assert(attempt.attempts.every(a=>a.signed===null));
   assert(!fixture.methods.some(method=>method.startsWith('qbft_')));
  }finally{await fixture.close();await rm(directory,{recursive:true,force:true});}
 }
});
