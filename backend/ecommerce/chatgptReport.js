function chatgptReport(connection,range){
  const data=connection?.snapshot?.datasets?.performance;
  const covered=Boolean(connection?.configured&&data?.available&&range.from>=data.from&&range.to<=data.to);
  const rows=(data?.rows||[]).filter(r=>r.date>=range.from&&r.date<=range.to);
  const total=key=>rows.some(r=>r[key]==null)?null:rows.reduce((n,r)=>n+Number(r[key]),0);
  const spend=covered?total('spend'):null,clicks=covered?total('clicks'):null,impressions=covered?total('impressions'):null;
  return {provider:'chatgpt_ads',available:covered,currency:data?.currency||connection?.account?.currency,timezone:data?.timezone||connection?.account?.timezone,observedAt:data?.observedAt||null,coverage:{from:data?.from,to:data?.to,preserved:!!data?.preserved},rows:covered?rows:[],spend,clicks,impressions,conversions:null,conversionValue:null,cpc:clicks&&spend!=null?spend/clicks:null,cpm:impressions&&spend!=null?spend/impressions*1000:null,ctr:impressions&&clicks!=null?clicks/impressions*100:null,attribution:'Conversões atribuídas ainda não importadas; tráfego e investimento da API OpenAI Ads.'};
}
function includeChatgptMedia(report, connection){
  if(!connection?.configured)return report;
  const performance=connection.performance,brl=performance.currency==='BRL';
  report.platforms=[...(report.platforms||[]).filter(p=>p.provider!=='chatgpt_ads'),{...performance,rows:undefined,available:performance.available&&brl,cpa:null,roas:null}];
  if(!brl)for(const key of ['spend','clicks','impressions','cpc','ctr','cpm'])report.platforms.at(-1)[key]=null;
  const rows=(performance.rows||[]).map(r=>({...r,provider:'chatgpt_ads',currency:performance.currency,timezone:performance.timezone,attribution:performance.attribution,conversions:null,conversionValue:null}));
  report.ads=[...(report.ads||[]).filter(r=>r.provider!=='chatgpt_ads'),...rows];
  const total=(list,key)=>list.some(r=>r[key]==null)?null:list.reduce((sum,r)=>sum+Number(r[key]),0);
  const platforms=report.platforms.filter(p=>p.available&&p.currency==='BRL');
  const sum=key=>platforms.length?total(platforms,key):null;
  const spend=sum('spend'),clicks=sum('clicks'),impressions=sum('impressions');
  report.summary={...report.summary,spend,revenuePerAdSpend:report.summary.revenue!=null&&spend?report.summary.revenue/spend:null,
    mediaPartial:report.summary.mediaPartial||!performance.available||!brl,
    media:{spend,clicks,impressions,cpc:clicks&&spend!=null?spend/clicks:null,ctr:impressions&&clicks!=null?clicks/impressions*100:null,cpm:impressions&&spend!=null?spend/impressions*1000:null,conversions:null,conversionValue:null,cpa:null,roas:null}};
  for(const day of report.daily||[]){
    for(const [provider,prefix]of [['google_ads','google'],['meta_ads','meta']])day[prefix+'ConversionValue']=report.platforms.some(p=>p.provider===provider&&p.available)?total(report.ads.filter(r=>r.provider===provider&&r.currency==='BRL'&&r.date===day.date),'conversionValue'):null;
    const current=rows.filter(r=>r.date===day.date),covered=performance.available&&brl;
    for(const [key,name]of[['spend','chatgptSpend'],['clicks','chatgptClicks'],['impressions','chatgptImpressions']]){
      day[name]=covered?total(current,key):null;
      if(covered)day[key]=day[name]==null?null:(day[key]||0)+day[name];
    }
    day.conversionValue=null;
  }
  const activeDays=rows.filter(r=>r.spend>0||r.impressions>0).map(r=>r.date).sort();
  report.adActivity={...report.adActivity,chatgpt_ads:activeDays.at(-1)||null};
  return report;
}
module.exports={chatgptReport,includeChatgptMedia};
