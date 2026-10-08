// Explicit first deployment only; persist the exact transaction before broadcast.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createPublicClient,createWalletClient,defineChain,http,keccak256} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
const directory='/data',recordFile=directory+'/contract-deployment.json',attemptFile=directory+'/contract-attempt.json';
const artifact=JSON.parse(await readFile('/app/contract.json','utf8'));
const chainId=Number(process.env.TRACEFORGE_CHAIN_ID);
const chain=defineChain({id:chainId,name:'TraceForge',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[process.env.TRACEFORGE_RPC_URL]}}});
const client=createPublicClient({chain,transport:http(process.env.TRACEFORGE_RPC_URL)});
if(await client.getChainId()!==chainId)throw Error('Bootstrap chain mismatch');
const genesis=(await client.getBlock({blockNumber:0n})).hash;
try{const record=JSON.parse(await readFile(recordFile,'utf8'));if(record.genesisHash!==genesis||record.runtimeHash!==keccak256(await client.getBytecode({address:record.address})))throw Error('Existing deployment mismatch');console.log(JSON.stringify(record));process.exit(0);}catch(error){if(error.code!=='ENOENT')throw error;}
const keyFile=directory+'/secrets/deployer.key';
try{await stat(keyFile);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(keyFile,generatePrivateKey()+'\n',{mode:0o600,flag:'wx'});}
const account=privateKeyToAccount((await readFile(keyFile,'utf8')).trim());
const wallet=createWalletClient({chain,account,transport:http(process.env.TRACEFORGE_RPC_URL)});
let attempt;
try{attempt=JSON.parse(await readFile(attemptFile,'utf8'));if(attempt.genesisHash!==genesis||attempt.creationHash!==keccak256(artifact.bytecode))throw Error('Prepared deployment mismatch');}catch(error){
 if(error.code!=='ENOENT')throw error;
 const gas=await client.estimateGas({account,data:artifact.bytecode,gasPrice:0n});
 const signed=await wallet.signTransaction({data:artifact.bytecode,nonce:await client.getTransactionCount({address:account.address,blockTag:'pending'}),gas:gas*120n/100n,gasPrice:0n,type:'legacy'});
 attempt={genesisHash:genesis,creationHash:keccak256(artifact.bytecode),signed,hash:keccak256(signed)};
 await writeFile(attemptFile,JSON.stringify(attempt)+'\n',{mode:0o600,flag:'wx'});
}
try{await client.sendRawTransaction({serializedTransaction:attempt.signed});}catch{}
const receipt=await client.waitForTransactionReceipt({hash:attempt.hash,timeout:120000});
if(receipt.status!=='success'||!receipt.contractAddress)throw Error('Bootstrap transaction failed');
const code=await client.getBytecode({address:receipt.contractAddress});
if(keccak256(code)!==keccak256(artifact.deployedBytecode))throw Error('Bootstrap runtime mismatch');
const record={chainId,address:receipt.contractAddress,deploymentBlock:receipt.blockNumber.toString(),runtimeHash:keccak256(code),genesisHash:genesis,transactionHash:attempt.hash};
await writeFile(recordFile,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
await writeFile(attemptFile,JSON.stringify({...attempt,signed:null})+'\n',{mode:0o600});
console.log(JSON.stringify(record));
