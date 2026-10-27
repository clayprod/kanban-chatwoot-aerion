'use strict';
const {extrairPerfis}=require('./prospeccao');
async function loadProspectingProfiles({pool,readToday,sanitize,sourceAllowed}){
 const current=extrairPerfis(await readToday());if(current.length)return current;
 // Business profiles remain useful across days. A stale news cache must not
 // silently switch off active prospecting, nor trigger paid Radar generation.
 const rows=(await pool.query("SELECT intel_json,trends_json,meta_json FROM trends_intel_cache WHERE updated_at>=NOW()-INTERVAL '14 days' ORDER BY day_key DESC LIMIT 7")).rows;
 for(const row of rows){if(!sourceAllowed(row.meta_json?.source))continue;const intel=await sanitize(row.intel_json,row.trends_json || []),profiles=extrairPerfis({intel});if(profiles.length)return profiles;}
 return [];
}
module.exports={loadProspectingProfiles};
