'use strict';
function splitMappingTask(task) {
  const {requirements,specifications}=task;
  const splitRequirements=requirements.length>1 && (specifications.length<2 || JSON.stringify(requirements).length>=JSON.stringify(specifications).length);
  if(splitRequirements){const middle=Math.ceil(requirements.length/2);return [{requirements:requirements.slice(0,middle),specifications},{requirements:requirements.slice(middle),specifications}];}
  if(specifications.length>1){const middle=Math.ceil(specifications.length/2);return [{requirements,specifications:specifications.slice(0,middle)},{requirements,specifications:specifications.slice(middle)}];}
  return null;
}
function mergeMappings(existing,incoming,requirements,specifications) {
  const result=new Map(existing.map(row=>[row.requirement_id,{...row,spec_ids:[...row.spec_ids]}]));
  for(const row of incoming){
    if(row.same_metric!==true || !requirements.some(r=>r.id===row.requirement_id) || !Array.isArray(row.spec_ids) || !row.spec_ids.every(id=>specifications.some(s=>s.id===id)))continue;
    const previous=result.get(row.requirement_id);
    result.set(row.requirement_id,{requirement_id:row.requirement_id,same_metric:true,spec_ids:[...new Set([...(previous?.spec_ids || []),...row.spec_ids])]});
  }
  return [...result.values()];
}
module.exports={splitMappingTask,mergeMappings};
