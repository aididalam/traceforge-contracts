import {readFile,writeFile,mkdir,rename,unlink,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPublicClient,createWalletClient,defineChain,http,keccak256,parseEther,parseTransaction,recoverTransactionAddress} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {publicPolicy,publicFees,checkFunding,policyError} from './public-fees.mjs';
async function readJson(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function save(file,value,first=false){
 const text=JSON.stringify(value,null,2)+'\n';
 if(first)return writeFile(file,text,{mode:0o600,flag:'wx'});
 const temporary=file+'.tmp';await writeFile(temporary,text,{mode:0o600});await rename(temporary,file);
}
// Run one bootstrap container per deployment. Persist every signed attempt before
// broadcasting, then reconcile all hashes before replacing its original nonce.
export async function publicBootstrap(env=process.env) {
 const directory=env.TRACEFORGE_BOOTSTRAP_DATA_DIR||'/data',action=env.TRACEFORGE_PUBLIC_ACTION||'deploy';
 if(!['wallet','deploy','fund'].includes(action))throw policyError('invalid_public_action');
 const keyFile=resolve(directory,'secrets/deployer.key');await mkdir(resolve(directory,'secrets'),{recursive:true,mode:0o700});
 let key;
 try{key=(await readFile(keyFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;key=generatePrivateKey();await writeFile(keyFile,key+'\n',{mode:0o600,flag:'wx'});}
 if((await stat(keyFile)).mode&0o077)throw policyError('deployer_key_permissions');
 const account=privateKeyToAccount(key),chainId=Number(env.TRACEFORGE_CHAIN_ID),symbol=env.TRACEFORGE_NATIVE_SYMBOL||'ETH';
 if(action==='wallet')return {walletAddress:account.address,chainId,symbol};
 const chain=defineChain({id:chainId,name:'TraceForge public EVM',nativeCurrency:{name:symbol,symbol,decimals:18},rpcUrls:{default:{http:[env.TRACEFORGE_RPC_URL]}}});
 const client=createPublicClient({chain,transport:http(env.TRACEFORGE_RPC_URL)}),wallet=createWalletClient({chain,account,transport:http(env.TRACEFORGE_RPC_URL)}),policy=publicPolicy(env);
 if(await client.getChainId()!==chainId)throw policyError('bootstrap_chain_mismatch');
 const genesisHash=(await client.getBlock({blockNumber:0n})).hash;
 const finalized=await client.getBlock({blockTag:'finalized'});if(finalized.number==null)throw policyError('finality_unavailable');
 let payload,attemptFile,recordFile,artifact;
 if(action==='deploy'){
  artifact=JSON.parse(await readFile(env.TRACEFORGE_BOOTSTRAP_ARTIFACT||'/app/contract.json','utf8'));
  payload={data:artifact.bytecode,value:0n};attemptFile=resolve(directory,'contract-attempt.json');recordFile=resolve(directory,'contract-deployment.json');
 }else{
  if(!/^0x[0-9a-fA-F]{40}$/.test(env.ADDRESS||'')||!/^\d+(\.\d{1,18})?$/.test(env.AMOUNT||'')||parseEther(env.AMOUNT)<=0n||! /^[A-Za-z0-9_-]{8,64}$/.test(env.FUNDING_ID||''))throw policyError('invalid_funding_request');
  await mkdir(resolve(directory,'funding'),{recursive:true,mode:0o700});
  payload={to:env.ADDRESS,data:'0x',value:parseEther(env.AMOUNT)};
  attemptFile=resolve(directory,'funding',env.FUNDING_ID+'.attempt.json');recordFile=resolve(directory,'funding',env.FUNDING_ID+'.json');
 }
 const identity=keccak256(new TextEncoder().encode(JSON.stringify({chainId,genesisHash,action,fundingId:action==='fund'?env.FUNDING_ID:null,sender:account.address,...payload,value:payload.value.toString()})));
 const record=await readJson(recordFile);
 if(record){
  if(record.identity!==identity)throw policyError('bootstrap_request_conflict');
  if(record.status==='failed')throw policyError('bootstrap_transaction_reverted');
  if(action==='deploy'&&record.runtimeHash!==keccak256(await client.getBytecode({address:record.address})))throw policyError('bootstrap_runtime_mismatch');
  const unfinished=await readJson(resolve(directory,'bootstrap-active.json'));
  if(unfinished?.identity===identity)await unlink(resolve(directory,'bootstrap-active.json'));
  return record;
 }
 const activeFile=resolve(directory,'bootstrap-active.json'),active=await readJson(activeFile);
 if(active&&active.identity!==identity)throw policyError('bootstrap_previous_transaction_pending');
 let attempt=await readJson(attemptFile);
 if(attempt?.identity!==identity&&attempt)throw policyError('bootstrap_request_conflict');
 if(!attempt){
  const fees=await publicFees(client,policy);await checkFunding(client,account.address,1n,fees,payload.value,policy);
  // Estimate execution independently of balance, then enforce its full fee budget.
  const estimate=await client.estimateGas({account:account.address,...payload}),gas=(estimate*120n+99n)/100n;
  await checkFunding(client,account.address,gas,fees,payload.value,policy);
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  if(!active)await save(activeFile,{identity},true);
  const signed=await wallet.signTransaction({...payload,nonce,gas,...fees});
  attempt={identity,attempts:[{signed,hash:keccak256(signed),at:Date.now()}]};await save(attemptFile,attempt,true);
 }
 const deadline=Date.now()+Number(env.TRACEFORGE_BOOTSTRAP_WAIT_MS||40000);
 do{
  let awaitingFinality=false;
  for(const item of attempt.attempts){
   let receipt;try{receipt=await client.getTransactionReceipt({hash:item.hash});}catch{continue;}
   const block=await client.getBlock({blockNumber:receipt.blockNumber});
   if(block.hash!==receipt.blockHash)continue;
   const final=await client.getBlock({blockTag:'finalized'});if(final.number==null)throw policyError('finality_unavailable');
   if(final.number<receipt.blockNumber){awaitingFinality=true;continue;}
   if(receipt.status!=='success'){
    await save(recordFile,{identity,status:'failed',transactionHash:item.hash},true);
    await unlink(activeFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
    throw policyError('bootstrap_transaction_reverted');
   }
   const result={identity,chainId,genesisHash,transactionHash:item.hash,deploymentBlock:receipt.blockNumber.toString()};
   if(action==='deploy'){
    if(!receipt.contractAddress)throw policyError('bootstrap_contract_missing');
    const code=await client.getBytecode({address:receipt.contractAddress});
    if(!code||keccak256(code)!==keccak256(artifact.deployedBytecode))throw policyError('bootstrap_runtime_mismatch');
    result.address=receipt.contractAddress;result.runtimeHash=keccak256(code);
   }else{result.address=payload.to;result.amount=env.AMOUNT;result.symbol=symbol;}
   await save(recordFile,result,true);
   await unlink(activeFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
   await save(attemptFile,{...attempt,attempts:attempt.attempts.map(a=>({...a,signed:null}))});
   return result;
  }
  let latest=attempt.attempts.at(-1),tx=parseTransaction(latest.signed);
  if(tx.chainId!==chainId||tx.to?.toLowerCase()!==payload.to?.toLowerCase()||(tx.data||'0x')!==payload.data||(tx.value??0n)!==payload.value||(await recoverTransactionAddress({serializedTransaction:latest.signed})).toLowerCase()!==account.address.toLowerCase())throw policyError('bootstrap_transaction_mismatch');
  if(!awaitingFinality&&Date.now()-latest.at>=policy.retry*1000){
   const previous=tx.type==='eip1559'?{type:'eip1559',maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas}:{type:'legacy',gasPrice:tx.gasPrice};
   const fees=await publicFees(client,policy,previous);await checkFunding(client,account.address,tx.gas,fees,payload.value,policy);
   const signed=await wallet.signTransaction({...payload,nonce:tx.nonce,gas:tx.gas,...fees});
   latest={signed,hash:keccak256(signed),at:Date.now()};attempt.attempts.push(latest);await save(attemptFile,attempt);
  }
  try{await client.sendRawTransaction({serializedTransaction:latest.signed});}catch{}
  if(Date.now()<deadline)await new Promise(done=>setTimeout(done,1000));
 }while(Date.now()<deadline);
 return {pending:true,transactionHash:attempt.attempts.at(-1).hash,walletAddress:account.address};
}
