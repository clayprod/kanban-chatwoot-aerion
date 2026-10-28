'use strict';
function normalizeLead(input={}){
 if(!input || typeof input!=='object' || Array.isArray(input))input={};
 const lead={...input};
 lead.razao_social=String(input.razao_social || input.company_name || '').trim();
 lead.nome_fantasia=String(input.nome_fantasia || '').trim();
 lead.email=input.email || input.correio_eletronico || null;
 const join=(ddd,num)=>ddd&&num?`${ddd}${num}`:null;
 lead.ddd_telefone_1=input.telefone_verificado || input.ddd_telefone_1 || join(input.ddd1,input.telefone1) || input.telefone || null;
 lead.ddd_telefone_2=input.ddd_telefone_2 || join(input.ddd2,input.telefone2) || null;
 lead.municipio=input.municipio || input.municipio_nome || '';
 lead.cnae_fiscal=input.cnae_fiscal || input.cnae_fiscal_principal;
 lead.cnae_fiscal_descricao=input.cnae_fiscal_descricao || input.cnae_descricao;
 lead.data_inicio_atividade=input.data_inicio_atividade || input.data_de_inicio_da_atividade;
 lead.descricao_porte=input.descricao_porte || input.porte_da_empresa;
 lead.descricao_situacao_cadastral=input.descricao_situacao_cadastral || input.situacao_cadastral;
 const qsa=Array.isArray(input.qsa)&&input.qsa.length?input.qsa:Array.isArray(input.socios)?input.socios:[];
 lead.qsa=qsa.map(s=>({...s,nome:s.nome_socio || s.nome_do_socio || s.nome || ''})).filter(s=>s.nome);
 if(!lead.qsa.length && input.socios_nomes)lead.qsa=String(input.socios_nomes).split(' · ').map(nome=>({nome:nome.replace(/\s*\([^)]*\)\s*$/,'').trim()})).filter(s=>s.nome);
 if(!lead.qsa.length && input.primeiro_socio)lead.qsa=[{nome:String(input.primeiro_socio).trim()}];
 return lead;
}
function attributesFor(lead){
 const company=lead.nome_fantasia || lead.razao_social;
 return {company_name:company.slice(0,255),rfb_company:{razao_social:lead.razao_social,nome_fantasia:lead.nome_fantasia,cnpj:lead.cnpj,qsa:lead.qsa},...(lead.telefone_origem?{phone_provenance:lead.telefone_origem}:{})};
}
async function resolveImportContact(pool,{accountId,cnpj,phone}){
 const existing=(await pool.query(`SELECT id FROM contacts WHERE account_id=$1 AND UPPER(regexp_replace(COALESCE(custom_attributes->>'CNPJ_CPF',custom_attributes->>'CNPJ',custom_attributes->>'cnpj',''),'[./[:space:]-]','','g'))=$2 LIMIT 1`,[accountId,cnpj])).rows[0];
 if(phone){
  const owner=(await pool.query(`SELECT id FROM contacts WHERE account_id=$1 AND regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g')=regexp_replace($2,'[^0-9]','','g') LIMIT 1`,[accountId,phone])).rows[0];
  if(owner && String(owner.id)!==String(existing?.id))throw Object.assign(Error('Telefone já vinculado a outro contato. Confira a titularidade antes de associar esta empresa.'),{code:'PHONE_CONTACT_CONFLICT',contactId:owner.id});
 }
 return existing;
}
async function enrichLeadFromRfb(pool,lead,cnpj){
 const basic=cnpj.slice(0,8);
 if(!lead.razao_social || !lead.nome_fantasia){
  const row=(await pool.query(`SELECT emp.razao_social,e.nome_fantasia FROM rfb_empresas emp
    LEFT JOIN rfb_estabelecimentos e ON e.cnpj_basico=emp.cnpj_basico AND e.cnpj_ordem=$2 AND e.cnpj_dv=$3
    WHERE emp.cnpj_basico=$1 LIMIT 1`,[basic,cnpj.slice(8,12),cnpj.slice(12)])).rows[0];
  if(row){lead.razao_social ||= row.razao_social || '';lead.nome_fantasia ||= row.nome_fantasia || '';}
 }
 const socios=(await pool.query('SELECT nome_do_socio,qualificacao_do_socio FROM rfb_socios WHERE cnpj_basico=$1 ORDER BY nome_do_socio',[basic])).rows;
 const known=new Set(lead.qsa.map(s=>s.nome.trim().toUpperCase()));
 for(const socio of socios){const nome=String(socio.nome_do_socio || '').trim();if(nome&&!known.has(nome.toUpperCase())){lead.qsa.push({nome,qualificacao:socio.qualificacao_do_socio || null});known.add(nome.toUpperCase());}}
 return lead;
}
async function repairMissingMetadata(pool,accountId,{apply=false}={}){
 const rows=(await pool.query(`SELECT id,name,custom_attributes,additional_attributes FROM contacts WHERE account_id=$1
  AND created_at>NOW()-INTERVAL '7 days' AND COALESCE(custom_attributes->>'CNPJ_CPF',custom_attributes->>'CNPJ',custom_attributes->>'cnpj','')<>''
  AND (COALESCE(custom_attributes->>'Socios','')='' OR COALESCE(additional_attributes->>'company_name','')='') ORDER BY id DESC LIMIT 100`,[accountId])).rows;
 const result={examined:rows.length,changed:0,partners_filled:0,companies_filled:0,source_unavailable:0,applied:0,concurrent_skipped:0};
 for(const row of rows){
  const custom={...(row.custom_attributes || {})},extra={...(row.additional_attributes || {})};
  const cnpj=String(custom.CNPJ_CPF || custom.CNPJ || custom.cnpj || '').replace(/[.\s/-]/g,'').toUpperCase();
  if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj))continue;
  const lead=await enrichLeadFromRfb(pool,normalizeLead({cnpj}),cnpj);
  let changed=false;
  if(!custom.Socios && lead.qsa.length){custom.Socios=lead.qsa.map(s=>s.nome).join('; ').slice(0,500);result.partners_filled++;changed=true;}
  if(!extra.company_name && (lead.nome_fantasia || lead.razao_social)){extra.company_name=lead.nome_fantasia || lead.razao_social;result.companies_filled++;changed=true;}
  if(!lead.razao_social){result.source_unavailable++;continue;}
  if(changed){custom.Razao_Social ||= lead.razao_social;custom.Nome_Fantasia ||= lead.nome_fantasia;extra.rfb_company=attributesFor(lead).rfb_company;result.changed++;
   if(apply){const updated=await pool.query(`UPDATE contacts SET custom_attributes=$3::jsonb,additional_attributes=$4::jsonb,updated_at=NOW()
    WHERE account_id=$1 AND id=$2 AND custom_attributes IS NOT DISTINCT FROM $5::jsonb AND additional_attributes IS NOT DISTINCT FROM $6::jsonb`,[accountId,row.id,JSON.stringify(custom),JSON.stringify(extra),row.custom_attributes==null?null:JSON.stringify(row.custom_attributes),row.additional_attributes==null?null:JSON.stringify(row.additional_attributes)]);
    if(updated.rowCount)result.applied++;else result.concurrent_skipped++;
   }
  }
 }
 return result;
}
module.exports={normalizeLead,attributesFor,resolveImportContact,enrichLeadFromRfb,repairMissingMetadata};
