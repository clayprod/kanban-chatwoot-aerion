export const technicalResultCache=new Map();
export function loadTechnicalResult(key,request){
 const entry=technicalResultCache.get(key);if(entry&&Date.now()-entry.at<15000)return entry.promise;
 const promise=request().then(r=>r.data).catch(e=>{technicalResultCache.delete(key);throw e;});technicalResultCache.set(key,{at:Date.now(),promise});return promise;
}
export const invalidateTechnicalResultCache=()=>technicalResultCache.clear();
