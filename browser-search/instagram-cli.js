'use strict';
(async()=>{
  let body='';for await(const c of process.stdin){body+=c;if(body.length>4096)throw Error('Excessive input');}
  const response=await fetch(`http://127.0.0.1:${process.env.PORT||3100}/instagram/auth`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.EGRESS_CONTROL_TOKEN}`},body,signal:AbortSignal.timeout(110000),
  });
  console.log(JSON.stringify(await response.json()));
})().catch(()=>{console.error('Instagram authentication unavailable');process.exitCode=1;});
