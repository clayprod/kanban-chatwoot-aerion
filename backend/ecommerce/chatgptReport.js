function chatgptReport(connection,range){
  const data=connection?.snapshot?.datasets?.performance;
  const covered=Boolean(connection?.configured&&data?.available&&range.from>=data.from&&range.to<=data.to);
  const rows=(data?.rows||[]).filter(r=>r.date>=range.from&&r.date<=range.to);
  const total=key=>rows.some(r=>r[key]==null)?null:rows.reduce((n,r)=>n+Number(r[key]),0);
  const spend=covered?total('spend'):null,clicks=covered?total('clicks'):null,impressions=covered?total('impressions'):null;
  return {provider:'chatgpt_ads',available:covered,currency:data?.currency||connection?.account?.currency,timezone:data?.timezone||connection?.account?.timezone,observedAt:data?.observedAt||null,coverage:{from:data?.from,to:data?.to,preserved:!!data?.preserved},rows:covered?rows:[],spend,clicks,impressions,conversions:null,conversionValue:null,cpc:clicks&&spend!=null?spend/clicks:null,cpm:impressions&&spend!=null?spend/impressions*1000:null,ctr:impressions&&clicks!=null?clicks/impressions*100:null,attribution:'Conversões atribuídas ainda não importadas; tráfego e investimento da API OpenAI Ads.'};
}
module.exports={chatgptReport};
