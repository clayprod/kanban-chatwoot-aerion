export const technicalResultCache=new Map();
export function loadTechnicalResult(key,request){
 const entry=technicalResultCache.get(key);if(entry&&Date.now()-entry.at<15000)return entry.promise;
 const promise=request().then(r=>r.data).catch(e=>{technicalResultCache.delete(key);throw e;});technicalResultCache.set(key,{at:Date.now(),promise});return promise;
}
const listeners=new Set();
export const technicalNoticeIdentity=item=>String(item?.numero_controle_pncp || item?.id || item?.url || '');
export const subscribeTechnicalResults=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
export const invalidateTechnicalResultCache=change=>{technicalResultCache.clear();if(change)listeners.forEach(listener=>listener(change));};
