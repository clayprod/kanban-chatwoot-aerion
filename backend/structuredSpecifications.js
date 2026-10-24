'use strict';
const {hash,text}=require('./technicalRules');
const {metricKey,componentOf}=require('./technicalMetrics');
function flattenSpecifications(specs){
  const result=[];
  function walk(value,path=[]){
    if(value && typeof value==='object'){for(const [key,child] of Object.entries(value))walk(child,[...path,key]);return;}
    if(value==null || !String(value).trim())return;
    const label=path.at(-1),section=path.slice(0,-1).join(' · ') || 'Especificações';
    result.push({section,label,value:String(value)});
  }
  walk(specs);return result;
}
function inferKey(label,section=''){
  const s=text(label),scope=text(section);
  if(/\brth\b|retorno.*(?:automatic|origem|decolagem)|return.*home/.test(s))return 'return_to_home';
  if(/gimbal.*eixos|eixos.*gimbal|camera.*\d+ eixos/.test(s))return 'gimbal_axes';
  if(/camera.*\d+(?:[.,]\d+)?k\b/.test(s))return 'video_resolution';
  if(/tempo.*voo|autonomia.*voo|max.*flight.*time/.test(s))return 'flight_time';
  if(/tempo.*pairar|hovering.*time/.test(s))return 'hover_time';
  if(/velocidade.*subida|ascent.*speed/.test(s))return 'ascent_speed';
  if(/velocidade.*descida|descent.*speed/.test(s))return 'descent_speed';
  if(/velocidade.*(?:voo|horizontal)|horizontal.*speed/.test(s))return 'flight_speed';
  if(/teto.*servico|service ceiling/.test(s))return 'flight_ceiling';
  if(/altitude.*decolagem/.test(s))return 'takeoff_altitude';
  if(/resistencia.*vento|wind.*resistance/.test(s))return 'wind_resistance';
  if(/distancia.*transmissao|transmission.*distance/.test(s))return 'transmission_distance';
  if(/formato.*foto|photo.*format/.test(s))return 'photo_formats';
  if(/formato.*video|video.*format/.test(s))return 'video_formats';
  if(/resolucao.*termica|thermal.*resolution/.test(s))return 'thermal_resolution';
  if(/resolucao.*video|video.*resolution/.test(s))return 'video_resolution';
  if(/gnss/.test(s))return 'gnss_systems';
  if(/tipo.*gimbal|estabilizacao|stable system/.test(s)&&/gimbal|camera/.test(scope))return 'gimbal_stabilization';
  if(/resolucao.*(?:fotograf|efetiva)|megapixel|effective.*pixel/.test(s))return 'camera_resolution';
  if(/sensor.*imagem|image.*sensor/.test(s))return 'camera_sensor';
  if(/zoom.*optico/.test(s))return 'optical_zoom';
  if(/zoom.*digital/.test(s))return 'digital_zoom';
  if(/zoom.*hibrido/.test(s))return 'hybrid_zoom';
  if(/capacidade/.test(s)&&/bateria/.test(scope))return 'battery_capacity';
  return metricKey(`${section}_${label}`);
}
function structuredFacts(rows,source){
  return rows.filter(r=>!/^nota\b/i.test(r.label)&&!/^n[aã]o especificado$/i.test(r.value)).flatMap((row,index)=>{
    const quote=`${row.section}\n${row.label}: ${row.value}${row.note ? '\n'+row.note:''}`;
    const key=inferKey(row.label,row.section);
    const component=componentOf({label:row.section,key});
    const base={id:`structured:${source.id}:${hash(quote).slice(0,20)}`,item_number:'all',section:row.section,label:row.label,key,component,category:'equipment',kind:'categorical',value:row.value,upper:null,unit:'',operator:'eq',conditions:'',quote,source_id:String(source.id),location:'Ficha estruturada',structured:true};
    const simple=/^(?:at[eé]\s+|menos de\s+)?(-?\d+(?:[.,]\d+)?)\s*(minutos|min|m\/s|km\/h|km|m|g|kg|MP|mAh|Wh|V|W|GB|TB|rpm|eixos)\s*$/i.exec(row.value);
    if(simple){base.kind='numeric';base.value=Number(simple[1].replace(',','.'));base.unit=simple[2];
      const conditions=[];if(/sem vento/.test(text(quote)))conditions.push('sem vento');if(/sem carga/.test(text(quote)))conditions.push('sem carga');if(/\bfcc\b/i.test(quote))conditions.push('FCC');if(/\bce\b/i.test(quote))conditions.push('CE');base.conditions=conditions.join(';');
    }
    const derived=[];
    const axes=/(\d+)\s*eixos/i.exec(row.value);
    if(key==='gimbal_stabilization' && axes)derived.push({...base,id:base.id+':axes',label:'Eixos do gimbal',key:'gimbal_axes',kind:'numeric',value:Number(axes[1]),unit:'eixos'});
    if(key==='thermal_resolution' && /^\d+\s*[x×]\s*\d+$/i.test(row.value))base.kind='compound';
    if(/camera/i.test(text(row.section)) && /sensor/i.test(row.label)){
      const mp=/(\d+(?:[.,]\d+)?)\s*MP\b/i.exec(row.value);
      if(mp)derived.push({...base,id:base.id+':mp',label:'Resolução efetiva da câmera',key:'camera_resolution',kind:'numeric',value:Number(mp[1].replace(',','.')),unit:'MP'});
    }
    // Keep every row, including complex/multi-condition values. Those require
    // explicit evidence before a numeric verdict; no "first number" shortcut.
    return [base,...derived];
  });
}
module.exports={flattenSpecifications,inferKey,structuredFacts};
