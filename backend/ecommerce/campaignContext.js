const { dateRange, shiftDay, saoPauloDay, buildReport } = require('./domain');
const { publicConnection } = require('./store');
const { chatgptReport }=require('./chatgptReport');
const {eligibleProducts}=require('./marketingDomain');
function groupedMetrics(rows,keys,fields){const map=new Map();for(const row of rows){const id=JSON.stringify(keys.map(k=>row[k]));if(!map.has(id))map.set(id,{...Object.fromEntries(keys.map(k=>[k,row[k]])),...Object.fromEntries(fields.map(k=>[k,0]))});const value=map.get(id);for(const field of fields){if(row[field]==null){value[field]=null;continue;}if(value[field]!=null)value[field]+=Number(row[field])||0;}}return [...map.values()];}
async function campaignContext(db) {
  const to=shiftDay(saoPauloDay(),-1),range=dateRange({from:shiftDay(to,-27),to});
  const [records,connections,states,products]=await Promise.all([
    db.query(`SELECT provider,kind,data FROM ecommerce_records r WHERE (date BETWEEN $1 AND $2 OR kind='merchant_catalog') AND NOT EXISTS (SELECT 1 FROM ecommerce_order_exclusions e WHERE r.provider='woocommerce' AND r.kind='order' AND e.order_id=r.record_id AND e.excluded)`,[range.previousFrom,to]),
    db.query('SELECT * FROM ecommerce_connections'),
    db.query("SELECT name,data FROM ecommerce_marketing_state WHERE name IN ('meta_audiences','google_audiences','customer_audiences','seo_weekly','campaign_plan') OR name LIKE 'chatgpt_ads_snapshot:%'"),
    db.query('SELECT data FROM ecommerce_marketing_products ORDER BY product_id')
  ]);
  const rows=records.rows,report=buildReport({range,orders:rows.filter(r=>r.kind==='order').map(r=>r.data),links:[],visits:[],metrics:rows.filter(r=>r.kind==='metric').map(r=>({...r.data,provider:r.provider})),connections:connections.rows.map(publicConnection)});
  const safeStates=Object.fromEntries(states.rows.map(r=>[r.name,r.data]));
  const search=rows.filter(r=>r.provider==='search_console'&&r.kind==='metric'&&r.data.date>=range.from&&r.data.date<=range.to).map(r=>r.data);
  const audiences=Object.fromEntries(states.rows.filter(r=>['meta_audiences','google_audiences','customer_audiences'].includes(r.name)).map(r=>[r.name,{observedAt:r.data.observedAt,lists:[...(r.data.store||[]),...(r.data.lists||[])].map(a=>({id:a.id,source:a.source,segment:a.segment,status:a.status,size:a.size??null,eligible:a.eligible??null,days:a.days,excludePaidDays:a.excludePaidDays}))}]));
  return { period:{...range,timezone:'America/Sao_Paulo',completedCalendarDays:28,coverage:'see_source_import_dates'},
    sources:connections.rows.map(r=>({provider:r.provider,status:r.status,lastSuccessAt:r.last_success_at,historyFrom:r.info?.history_from||r.info?.import_from||null,error:r.error?'connection_requires_attention':null})),
    sales:{source:'WooCommerce',paidOrders:report.summary.orders,revenue:report.summary.revenue,previousRevenue:report.summary.previousRevenue,averageTicket:report.summary.ticket,currency:'BRL',products:report.products.slice(0,30)},
    catalog:eligibleProducts(products.rows.map(r=>r.data)).map(p=>({sku:p.sku,name:p.name,group:p.group,price:p.price,currency:p.currency,availability:p.availability,eligible:p.eligible,issues:p.issues})),
    navigation:{source:'GA4',sessions:report.summary.sessions,recordedPurchases:report.summary.purchases,funnel:groupedMetrics(report.traffic.filter(r=>r.kind==='funnel'),['event'],['events'])},
    paidMedia:[...report.platforms,...states.rows.filter(r=>r.name.startsWith('chatgpt_ads_snapshot:')).map(r=>{const {rows,...summary}=chatgptReport({configured:true,snapshot:r.data,account:r.data.account},range);return summary;})],
    campaigns:groupedMetrics(report.ads,['provider','campaignId','campaign','currency','timezone','attribution'],['spend','impressions','clicks','conversions','conversionValue']).slice(0,30),
    organic:{source:'Search Console',totals:groupedMetrics(search.filter(r=>r.kind==='search_total'),['kind'],['impressions','clicks']),pages:groupedMetrics(search.filter(r=>r.kind==='search_page'),['landing'],['impressions','clicks']).sort((a,b)=>(b.impressions||0)-(a.impressions||0)).slice(0,20)},
    audiences,approvedBudget:safeStates.campaign_plan?{total:safeStates.campaign_plan.total,google:safeStates.campaign_plan.google,meta:safeStates.campaign_plan.meta,automaticTransfer:false}:null,containsPersonalIdentifiers:false,
    limitations:['28 dias de calendário completos não comprovam cobertura completa de cada integração.','Conversões atribuídas pelas plataformas não são vendas pagas adicionais e não podem ser somadas à receita WooCommerce.','Ausência de métricas não significa zero. Sem margem informada, não definir CAC/ROAS rentável.'] };
}
module.exports={campaignContext};
