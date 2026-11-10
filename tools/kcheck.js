'use strict';
const ROOT='/home/ubuntu/oqt-quant-node';
const KS=require(ROOT+'/modules/okx/engines/kstore');
const U=require(ROOT+'/modules/okx/engines/universe');
(async()=>{
  const u=await U.universe();
  const list=(u.list||[]).filter(x=>x.instId&&x.instId.endsWith('SWAP'));
  let withData=0, earliest=Infinity, latest=0;
  const samples=[];
  for(const x of list){
    let ch; try{ch=KS.readChain('1m',x.instId,0,9999);}catch(e){continue;}
    if(!ch.length) continue;
    withData++;
    let mn=Infinity,mx=0,cnt=0;
    for(const f of ch){ try{const db=KS.roOpen(f); if(!db)continue; const r=db.prepare('SELECT min(ts) a,max(ts) b,count(*) c FROM kline').get(); if(r){cnt+=r.c; if(r.a<mn)mn=r.a; if(r.b>mx)mx=r.b;}}catch(e){} }
    if(mn<earliest)earliest=mn;
    if(mx>latest)latest=mx;
    if(samples.length<6) samples.push({inst:x.instId,min:new Date(mn).toISOString(),max:new Date(mx).toISOString(),cnt});
  }
  console.log('universe SWAP=',list.length,' with 1m kstore=',withData);
  console.log('earliest 1m ts across all=',earliest!==Infinity?new Date(earliest).toISOString():'?');
  console.log('latest 1m ts across all=',latest?new Date(latest).toISOString():'?');
  console.log('samples=',JSON.stringify(samples,null,1));
})().then(()=>process.exit(0)).catch(e=>{console.log('FATAL',e.message);process.exit(1);});
