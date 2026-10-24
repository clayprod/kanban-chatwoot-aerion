'use strict';
const {text}=require('./technicalRules');
const {literalEvidenceQuote}=require('./technicalExtraction');
const section={type:'object',additionalProperties:false,required:['id','kind','title','quote'],properties:{id:{type:'string'},kind:{type:'string',enum:['technical','administrative','uncertain']},title:{type:'string'},quote:{type:'string'}}};
const SECTION_FORMAT={type:'json_schema',json_schema:{name:'technical_sections',strict:true,schema:{type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',items:section}}}}};
function hasTechnicalEvidence(value){
  const s=text(value);
  return /\b(?:especificacoes tecnicas|caracteristicas tecnicas|requisitos tecnicos|ficha tecnica|anexo\s+[a-z0-9]+.*especific|autonomia|sensor|resolucao|gimbal|rtk|gnss|baterias|processador|capacidade de armazenamento|dimensoes|composicao do kit|conteudo da embalagem|garantia do equipamento|treinamento operacional)\b/.test(s) || /\d\s*(?:mp|mah|wh|ghz|gb|tb|m\/s|km\/h|pixels|polegadas|rpm)\b/.test(s);
}
function validateSections(value,chunks){
  return chunks.map(({c},i)=>{
    const entries=value?.sections?.filter(s=>s.id===String(i)) || [],entry=entries.length===1?entries[0]:null;
    const quote=entry?.quote ? literalEvidenceQuote(entry.quote,c.text):null;
    const skip=entry?.kind==='administrative' && quote && !hasTechnicalEvidence(c.text);
    return {technical:!skip,title:entry?.title || 'Especificações técnicas',quote:quote || '',reason:skip?'Seção administrativa conferida':'Seção técnica ou conteúdo a conferir'};
  });
}
async function classifySections(ask,job,config,chunks){
  const schema=JSON.parse(JSON.stringify(SECTION_FORMAT));
  const entry={...section,required:['kind','title','source_line'],properties:{kind:section.properties.kind,title:section.properties.title,source_line:{type:'string'}}};
  schema.json_schema.schema.properties.sections={type:'object',properties:Object.fromEntries(chunks.map(({c},i)=>[String(i),{...entry,properties:{...entry.properties,source_line:{type:'string',enum:c.text.split('\n').map((_,n)=>`l${n}`)}}}])),required:chunks.map((_,i)=>String(i)),additionalProperties:false};
  const value=await ask(job,config,'Classifique CADA trecho recebido. Responda sections como um objeto com uma propriedade por id, exatamente conforme o schema. Localize as seções de exigências técnicas nos documentos de uma contratação de QUALQUER setor. Leia todo o texto recebido. Marque technical se houver características do produto, componentes, certificações, acessórios, garantia, treinamento, instalação, entrega, assistência ou referências para anexos com essas exigências. Marque administrative SOMENTE para regras de disputa, habilitação fiscal/jurídica, pagamentos, capas e assinaturas sem especificações do objeto. Na dúvida use uncertain. Nunca invente fatos. Para cada id, retorne uma única classificação do trecho inteiro, título curto e source_line com o identificador lN da linha que justifica sua classificação. Não reescreva o texto. Mesmo quando houver vários assuntos, escolha technical se algum deles contiver exigência técnica.',JSON.stringify({chunks:chunks.map(({s,c},i)=>({id:String(i),document:s.name,location:c.location,text:c.text.split('\n').map((line,n)=>`[l${n}] ${line}`).join('\n')}))}),2400,schema);
  if(value?.sections && !Array.isArray(value.sections))value.sections=Object.entries(value.sections).map(([id,s])=>({...s,id}));
  for(const s of value?.sections || [])if(/^l\d+$/.test(s.source_line || ''))s.quote=chunks[Number(s.id)]?.c.text.split('\n')[Number(s.source_line.slice(1))] || '';
  return validateSections(value,chunks);
}
module.exports={SECTION_FORMAT,hasTechnicalEvidence,validateSections,classifySections};
