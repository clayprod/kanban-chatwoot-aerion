'use strict';
// Run inside the image published by CI. Read secrets from stdin, never argv.
const {Pool}=require('pg');
const {randomBytes}=require('node:crypto');
const {criarCofre}=require('../segredos');
const {parseNodes}=require('../researchEgress');
async function main(){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Entrada excessiva');}
 const payload=JSON.parse(input || '{}');
 const nodes=Array.isArray(payload)?payload:payload.nodes;
 if(nodes!==undefined&&(!Array.isArray(nodes)||parseNodes(JSON.stringify(nodes)).length!==nodes.length))throw Error('Dispositivos inválidos');
 const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:undefined);
 try{
  const cofre=criarCofre({pool});
  if(nodes!==undefined)await cofre.gravar('RESEARCH_EGRESS_NODES',JSON.stringify(nodes),'operator:research-egress');
  if(typeof payload.pending_action==='string')await require('../aiSettings').gravarSetting(pool,'research_egress_setup_blocker',payload.pending_action.slice(0,500),'operator:research-egress');
  if(!await cofre.ler('RESEARCH_EGRESS_TOKEN'))await cofre.gravar('RESEARCH_EGRESS_TOKEN',randomBytes(32).toString('hex'),'operator:research-egress');
  console.log(JSON.stringify({ok:true,devices:nodes?.map(n=>n.id) || 'preserved'}));
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Não foi possível registrar a saída protegida.');process.exitCode=1;});
