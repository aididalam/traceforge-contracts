// Disposable paid-gas EVM fixture. Never connects to a real blockchain.
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {network} from 'hardhat';
export async function publicRpcFixture(chainId=80002,port=0){
 const connection=await network.create({network:'integration',override:{chainId,initialBaseFeePerGas:1_000_000_000}});
 let finalityLag=0,rejectFinality=false;const methods=[];
 const server=createServer(async(req,res)=>{
  let input='';for await(const chunk of req)input+=chunk;
  try{
   const message=JSON.parse(input);methods.push(message.method);
   let result;
   if(message.method==='traceforge_test_setFinalityLag'){finalityLag=Number(message.params[0]);result=true;}
   else if(message.method==='traceforge_test_rejectFinality'){rejectFinality=message.params[0];result=true;}
   else{
    if(message.method==='eth_getBlockByNumber'&&message.params[0]==='finalized'){
     if(rejectFinality)throw Error('Finality unsupported');
     const head=BigInt(await connection.provider.request({method:'eth_blockNumber'}));
     message.params[0]='0x'+(head>BigInt(finalityLag)?head-BigInt(finalityLag):0n).toString(16);
    }
    result=await connection.provider.request({method:message.method,params:message.params});
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(input).id,error:{code:-32000,message:error.message}}));}
 });
 await new Promise(done=>server.listen(port,'127.0.0.1',done));
 return {connection,methods,url:'http://127.0.0.1:'+server.address().port,close:async()=>{await new Promise(done=>server.close(done));await connection.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const fixture=await publicRpcFixture(Number(process.env.TRACEFORGE_TEST_CHAIN_ID||80002),Number(process.env.TRACEFORGE_TEST_RPC_PORT||18645));
 const timer=setInterval(()=>fixture.connection.provider.request({method:'evm_mine'}).catch(()=>{}),1000);
 console.log('Disposable public-mode RPC ready on '+fixture.url);
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{clearInterval(timer);await fixture.close();process.exit(0);});
}
