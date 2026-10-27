'use strict';
// Reviewed against the consolidated official text on 2026-10-27. Summaries
// are deliberately labelled as summaries, not purported verbatim quotations.
const source='https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
const corpus=require('./legal/lei14133Articles.json');
const articles={
 '5':'Princípios aplicáveis incluem legalidade, igualdade, motivação, vinculação ao edital, julgamento objetivo, razoabilidade, competitividade, proporcionalidade e economicidade.',
 '9':'Art. 9º, I, a e c: ressalvados os casos legais, são vedadas situações que comprometam, restrinjam ou frustrem a competitividade, ou sejam impertinentes ou irrelevantes para o objeto específico.',
 '11':'O processo licitatório busca proposta mais vantajosa, tratamento isonômico e justa competição, além dos demais objetivos previstos no artigo.',
 '18':'A fase preparatória deve enfrentar considerações técnicas, mercadológicas e de gestão. O ETP contempla requisitos e levantamento de mercado; sua extensão e eventuais omissões exigem exame das regras do próprio artigo. Não presumir inexistência de justificativa por ela não estar entre os arquivos disponíveis.',
 '40':'No planejamento de compras, observar requisitos de qualidade, rendimento, compatibilidade, durabilidade e segurança, bem como padronização e parcelamento quando técnica e economicamente adequados. Não impor parcelamento ou padronização sem analisar as exceções legais.',
 '41':'Art. 41, I: a indicação de marca ou modelo é excepcional e exige justificativa formal. É admitida por necessidade de padronização (a); compatibilidade com plataformas e padrões já adotados (b); quando marca/modelo comercializados por mais de um fornecedor forem os únicos capazes de atender à necessidade (c); ou para servir apenas como referência que facilite a descrição do objeto (d). Não afirmar que toda referência a marca é ilegal, nem que a única exceção é um laudo de exclusividade. O artigo também disciplina amostras/prova de conceito, vedação de produto e carta de solidariedade, com suas condições específicas.',
 '42':'A prova de qualidade de produto apresentado como similar ao das marcas eventualmente indicadas admite os meios previstos no artigo, incluindo conformidade técnica, declaração de atendimento satisfatório e certificação/laudo/documento similar emitido por entidade competente.',
 '55':'Art. 55, § 1º: modificações do edital implicam nova divulgação e cumprimento dos mesmos prazos originais, exceto quando não comprometerem a formulação das propostas. Não pedir reabertura automática em toda e qualquer alteração.',
 '164':'Qualquer pessoa pode impugnar edital por irregularidade na aplicação da Lei ou solicitar esclarecimento. O protocolo deve ocorrer até três dias úteis antes da abertura do certame. A resposta tem prazo de até três dias úteis, limitado ao último dia útil anterior à abertura. Não declarar tempestividade sem conferir a data da abertura, o protocolo e o calendário aplicável; não confundir com recurso do art. 165.'
};
const normalize=v=>String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const words=v=>new Set((normalize(v).match(/[a-z]{5,}/g) || []).map(w=>w.slice(0,6)));
const indexed=Object.entries(corpus.articles).filter(([id])=>Number(id)<178||['184','184-A'].includes(id)).map(([id,body])=>({id,body,tokens:words(body)}));
const frequency=new Map();for(const row of indexed)for(const token of row.tokens)frequency.set(token,(frequency.get(token) || 0)+1);
function contextFor(points){
 const query=normalize(points.map(p=>`${p.topic} ${p.note || ''} ${p.requirement?.label || ''} ${p.requirement?.quote || ''}`).join(' ')),forced=['5','9','11','164'];
 for(const [pattern,ids]of [
  [/habilit|qualific|atestado|capacidade tecnica/,['63','64','65','66','67','68','69','70']],
  [/amostra|prova de conceito/,['17','41']],
  [/garantia contratual|garantia de execucao|seguro.garantia/,['96','97','98','99','100','101','102']],
  [/consorcio/,['15']], [/microempresa|pequeno porte/,['4']],
  [/inexequiv|desclassific/,['59']], [/parcelamento|lote|agrupamento/,['40','47']],
  [/preco|orcamento|estimativa de valor/,['23','24','40']],
  [/entrega|recebimento|assistencia|manutencao/,['40','92','140']],
  [/subcontrat/,['122']], [/vistoria/,['63']], [/sancao|penalidade|multa/,['155','156']],
  [/pagamento|reajuste|reequilibrio/,['92','124','141']],
 ])if(pattern.test(query))forced.push(...ids);
 forced.push('18','40','41','42','43','55');
 const tokens=words(query),ranked=indexed.map(row=>({...row,score:[...tokens].reduce((score,t)=>score+(row.tokens.has(t)?Math.log(1+indexed.length/(frequency.get(t) || 1)):0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 const ids=[...new Set([...forced,...ranked.slice(0,6).map(r=>r.id)])],selected={};let characters=0;
 for(const id of ids){const body=corpus.articles[id];if(!body||characters+body.length>32000)continue;selected[id]=body;characters+=body.length;}
 return {version:'lei14133-full-reviewed-2026-10-27',source,consolidated_source:corpus.source,reviewed_at:corpus.checked_at,articles:selected,guidance:Object.fromEntries(Object.entries(articles).filter(([id])=>Object.hasOwn(selected,id))),notice:'articles contém texto normativo oficial; guidance contém notas de aplicação. Conferir atualizações e regime aplicável.'};
}
module.exports={version:'lei14133-full-reviewed-2026-10-27',source,consolidated_source:corpus.source,reviewed_at:corpus.checked_at,articles:corpus.articles,guidance:articles,contextFor};
