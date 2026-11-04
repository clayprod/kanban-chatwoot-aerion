const { dateRange, shiftDay, saoPauloDay, buildReport } = require('./domain');
const { publicConnection } = require('./store');
const { chatgptReport }=require('./chatgptReport');
async function campaignContext(db) {
  const to=shiftDay(saoPauloDay(),-1),range=dateRange({from:shiftDay(to,-27),to});
  const [records,connections,states]=await Promise.all([
    db.query(`SELECT provider,kind,data FROM ecommerce_records r WHERE (date BETWEEN $1 AND $2 OR kind='merchant_catalog') AND NOT EXISTS (SELECT 1 FROM ecommerce_order_exclusions e WHERE r.provider='woocommerce' AND r.kind='order' AND e.order_id=r.record_id AND e.excluded)`,[range.previousFrom,to]),
    db.query('SELECT * FROM ecommerce_connections'),
    db.query("SELECT name,data FROM ecommerce_marketing_state WHERE name IN ('meta_audiences','google_audiences','customer_audiences','seo_weekly') OR name LIKE 'chatgpt_ads_snapshot:%'")
  ]);
  const rows=records.rows,report=buildReport({range,orders:rows.filter(r=>r.kind==='order').map(r=>r.data),links:[],visits:[],metrics:rows.filter(r=>r.kind==='metric').map(r=>({...r.data,provider:r.provider})),connections:connections.rows.map(publicConnection)});
  const safeStates=Object.fromEntries(states.rows.map(r=>[r.name,r.data]));
  return { period:{...range,timezone:'America/Sao_Paulo',completedCalendarDays:28,coverage:'see_source_import_dates'},
    sources:connections.rows.map(r=>({provider:r.provider,status:r.status,lastSuccessAt:r.last_success_at,historyFrom:r.info?.history_from||r.info?.import_from||null,error:r.error?'connection_requires_attention':null})),
    sales:{source:'WooCommerce',paidOrders:report.summary.orders,revenue:report.summary.revenue,previousRevenue:report.summary.previousRevenue,averageTicket:report.summary.ticket,currency:'BRL',products:report.products.slice(0,30)},
    navigation:{source:'GA4',sessions:report.summary.sessions,recordedPurchases:report.summary.purchases,funnel:report.traffic.filter(r=>r.kind==='funnel').map(r=>({date:r.date,event:r.event,events:r.events})).slice(0,200)},
    paidMedia:[...report.platforms,...states.rows.filter(r=>r.name.startsWith('chatgpt_ads_snapshot:')).map(r=>chatgptReport({configured:true,snapshot:r.data,account:r.data.account},range))],
    campaigns:report.ads.slice(0,150).map(r=>({provider:r.provider,date:r.date,campaignId:r.campaignId,campaign:r.campaign,currency:r.currency,timezone:r.timezone,spend:r.spend,impressions:r.impressions,clicks:r.clicks,conversions:r.conversions,conversionValue:r.conversionValue,attribution:r.attribution})),
    organic:rows.filter(r=>r.provider==='search_console'&&r.kind==='metric'&&['search_total','search_page'].includes(r.data.kind)).slice(0,250).map(r=>({date:r.data.date,kind:r.data.kind,page:r.data.landing,impressions:r.data.impressions,clicks:r.data.clicks,position:r.data.position})),
    audiences:safeStates,containsPersonalIdentifiers:false,
    limitations:['28 dias de calendário completos não comprovam cobertura completa de cada integração.','Conversões atribuídas pelas plataformas não são vendas pagas adicionais e não podem ser somadas à receita WooCommerce.','Ausência de métricas não significa zero. Sem margem informada, não definir CAC/ROAS rentável.'] };
}
module.exports={campaignContext};
