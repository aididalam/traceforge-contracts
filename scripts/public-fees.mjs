import {parseEther,parseGwei} from 'viem';
export function publicPolicy(env=process.env) {
 const decimal=(key,fallback,parse)=>{const value=env[key]||fallback;if(!/^\d+(\.\d{1,9})?$/.test(value)||parse(value)<=0n)throw Error('Invalid '+key);return parse(value);};
 const mode=env.TRACEFORGE_FEE_MODE||'auto',retry=Number(env.TRACEFORGE_FEE_RETRY_SECONDS||120);
 if(!['auto','legacy','eip1559'].includes(mode)||!Number.isSafeInteger(retry)||retry<15)throw Error('Invalid public fee policy');
 return {mode,retry,maxFee:decimal('TRACEFORGE_MAX_FEE_GWEI','1000',parseGwei),maxCost:decimal('TRACEFORGE_MAX_TRANSACTION_FEE','2',parseEther)};
}
export function policyError(code){return Object.assign(Error(code),{code});}
export async function publicFees(client,policy,previous) {
 const block=await client.getBlock({blockTag:'latest'}),max=(a,b)=>a>b?a:b,bump=v=>(v*113n+99n)/100n+1n;
 let fees;
 if(previous?.type==='eip1559'||(policy.mode!=='legacy'&&(policy.mode==='eip1559'||(block.baseFeePerGas??0n)>0n))){
  let estimate;
  try{estimate=await client.estimateFeesPerGas({type:'eip1559'});}catch{
   const price=await client.getGasPrice(),base=block.baseFeePerGas??0n,tip=price>base?price-base:1_000_000_000n;
   estimate={maxFeePerGas:base*2n+tip,maxPriorityFeePerGas:tip};
  }
  let tip=estimate.maxPriorityFeePerGas,cap=estimate.maxFeePerGas;
  if(previous?.type==='eip1559'){tip=max(tip,bump(previous.maxPriorityFeePerGas));cap=max(cap,bump(previous.maxFeePerGas));}
  fees={type:'eip1559',maxFeePerGas:max(cap,(block.baseFeePerGas??0n)*2n+tip),maxPriorityFeePerGas:tip};
 }else{
  let price=await client.getGasPrice();if(previous?.type==='legacy')price=max(price,bump(previous.gasPrice));
  fees={type:'legacy',gasPrice:price};
 }
 if((fees.gasPrice??fees.maxFeePerGas)<=0n||(fees.gasPrice??fees.maxFeePerGas)>policy.maxFee)throw policyError('fee_limit_exceeded');
 return fees;
}
export async function checkFunding(client,address,gas,fees,value,policy){
 const cost=gas*(fees.gasPrice??fees.maxFeePerGas);
 if(cost>policy.maxCost)throw policyError('fee_limit_exceeded');
 if(await client.getBalance({address})<cost+value)throw policyError('insufficient_gas_balance');
}
