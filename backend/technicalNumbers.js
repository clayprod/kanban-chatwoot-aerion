'use strict';
const words={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezassete:17,dezoito:18,dezenove:19,dezanove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,duzentas:200,trezentos:300,trezentas:300,quatrocentos:400,quatrocentas:400,quinhentos:500,quinhentas:500,seiscentos:600,seiscentas:600,setecentos:700,setecentas:700,oitocentos:800,oitocentas:800,novecentos:900,novecentas:900};
const clean=v=>String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/−/g,'-').toLowerCase();
function numberMentions(value){
 const input=clean(value),out=[];
 for(const m of input.matchAll(/-?\d+(?:[.,]\d+)*/g))out.push({value:/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(m[0])?Number(m[0].replace(/\./g,'').replace(',','.')):Number(m[0].replace(',','.')),start:m.index,end:m.index+m[0].length});
 const tokens=[...input.matchAll(/[a-z]+/g)];
 for(let i=0;i<tokens.length;i++){
  if(!Object.hasOwn(words,tokens[i][0])&&tokens[i][0]!=='mil')continue;
  let amount=0,group=0,j=i;
  for(;j<tokens.length;j++){
   const token=tokens[j][0];
   if(j>i && !/^\s+$/.test(input.slice(tokens[j-1].index+tokens[j-1][0].length,tokens[j].index)))break;
   if(token==='e'&&j+1<tokens.length&&(Object.hasOwn(words,tokens[j+1][0])||tokens[j+1][0]==='mil'))continue;
   if(token==='mil'){amount+=(group || 1)*1000;group=0;}
   else if(Object.hasOwn(words,token))group+=words[token];else break;
  }
  const last=tokens[j-1];out.push({value:amount+group,start:tokens[i].index,end:last.index+last[0].length});i=j-1;
 }
 return out.sort((a,b)=>a.start-b.start);
}
function measurements(value){
 const raw=String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,''),input=raw.toLowerCase();
 return numberMentions(value).flatMap(n=>{
  // A parenthetical spelling duplicates the numeral; it does not change units.
  const unit=/^\s*(?:\([^)]*\)\s*)?([a-z%°]+(?:[²³23])?(?:\/[a-z]+)?)/.exec(input.slice(n.end));
  return unit?[{...n,unit:raw.slice(n.end+unit[0].length-unit[1].length,n.end+unit[0].length)}]:[];
 });
}
module.exports={numberMentions,measurements};
