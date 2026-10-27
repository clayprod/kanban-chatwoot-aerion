const properties={thermal_resolution:'Resolução da câmera térmica',thermal_camera_type:'Medição radiométrica',camera_resolution:'Resolução fotográfica',video_resolution:'Resolução de vídeo',photo_formats:'Formatos de fotografia',video_formats:'Formatos de vídeo',camera_sensor:'Sensor',flight_time:'Autonomia de voo',hover_time:'Autonomia em voo estacionário'};
export function clausePresentation(rows){
 const groups=new Map();for(const row of rows){const r=row.requirement,key=JSON.stringify([r.source_id,r.quote || r.label,r.component || '']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const result=new Map();for(const group of groups.values())if(group.length>1&&new Set(group.map(r=>r.requirement.label)).size===1){for(const [index,row]of group.entries())result.set(row.requirement.id,{clause:group[0].requirement.label,first:index===0,label:properties[row.requirement.key] || String(row.requirement.value ?? `Critério ${index+1}`)});}
 return result;
}
