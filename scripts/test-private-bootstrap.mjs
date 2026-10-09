import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createPublicClient, createWalletClient, http, keccak256, defineChain} from 'viem';
import {publicRpcFixture} from './public-rpc-fixture.mjs';

// Exercise the real bootstrap entry point against mined bytecode and a persisted
// record: a release upgrade must never reuse a deployment of a different ABI.
test('private bootstrap reuses matching code and preserves a deployment when the artifact changes', async () => {
  const fixture=await publicRpcFixture(9009);
  const directory=await mkdtemp(join(tmpdir(),'traceforge-private-bootstrap-'));
  const artifact=JSON.parse(await readFile(resolve('artifacts/contracts/TraceForge.sol/TraceForge.json'),'utf8'));
  const artifactFile=join(directory,'artifact.json');
  const recordFile=join(directory,'contract-deployment.json');
  const chain=defineChain({id:9009,name:'Bootstrap fixture',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[fixture.url]}}});
  const client=createPublicClient({chain,transport:http(fixture.url)});
  const [account]=await client.request({method:'eth_accounts'});
  const wallet=createWalletClient({chain,account,transport:http(fixture.url)});
  const run=()=>new Promise((done,reject)=>{
    const child=spawn(process.execPath,['scripts/bootstrap.mjs'],{env:{...process.env,TRACEFORGE_NETWORK_KIND:'private',TRACEFORGE_CHAIN_ID:'9009',TRACEFORGE_RPC_URL:fixture.url,TRACEFORGE_BOOTSTRAP_DATA_DIR:directory,TRACEFORGE_BOOTSTRAP_ARTIFACT:artifactFile},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>done({code,stdout,stderr}));
  });
  try {
    const hash=await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode});
    const receipt=await client.waitForTransactionReceipt({hash});
    assert.equal(receipt.status,'success');
    const record={chainId:9009,address:receipt.contractAddress,deploymentBlock:receipt.blockNumber.toString(),runtimeHash:keccak256(await client.getBytecode({address:receipt.contractAddress})),genesisHash:(await client.getBlock({blockNumber:0n})).hash,transactionHash:hash};
    const original=JSON.stringify(record,null,2)+'\n';
    await writeFile(recordFile,original,{mode:0o600});await writeFile(artifactFile,JSON.stringify(artifact));
    const matched=await run();assert.equal(matched.code,0,matched.stderr);assert.deepEqual(JSON.parse(matched.stdout),record);
    const head=await client.getBlockNumber({cacheTime:0});
    await writeFile(artifactFile,JSON.stringify({...artifact,deployedBytecode:'0x6000'}));
    const incompatible=await run();assert.notEqual(incompatible.code,0);assert.match(incompatible.stderr,/different contract code.*new deployment data directory/);
    assert.equal(await readFile(recordFile,'utf8'),original);
    assert.equal(await client.getBlockNumber({cacheTime:0}),head,'Rejected upgrade must not send a transaction');
    assert.equal(keccak256(await client.getBytecode({address:record.address})),record.runtimeHash);
  } finally {await fixture.close();await rm(directory,{recursive:true,force:true});}
});
