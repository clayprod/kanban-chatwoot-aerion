'use strict';
const isCreditError = message => /no credits|insufficient[_ ](?:quota|credits)|requires more credits|credit balance|billing|sem cr[eé]dit|:402\b/i.test(message || '');
const isAuthError = message => /invalid.api.key|incorrect.api.key|:401\b/i.test(message || '');
function measuredTokens(result) {
  const tokens = result.usage?.total_tokens;
  if (tokens != null && Number.isSafeInteger(Number(tokens)) && Number(tokens) >= 0) return Number(tokens);
  // A rejected HTTP request did not generate tokens. Unknown transport outcomes
  // keep their reservation: absence of usage alone is not evidence of zero cost.
  if (!result.ok && [400,401,402,403,404,413,422,429].includes(result.http_status)) return 0;
  return null;
}
function executionState(job, config) {
  if (!['queued','running'].includes(job.status)) return {};
  if (job.kind === 'notice' && !config.enabled) return { execution_status:'paused', stage_label:'Análise pausada', error:config.provider_error || 'Análise automática desativada. O progresso foi preservado.' };
  if (config.provider_error) return { execution_status:'blocked', stage_label:'Análise aguardando provedor de IA', error:isCreditError(config.provider_error) ? 'Saldo insuficiente no provedor de IA.' : config.provider_error };
  if (job.error) return { execution_status:'waiting', stage_label:'Análise aguardando retomada', error:job.error };
  return { execution_status:job.status };
}
module.exports={isCreditError,isAuthError,measuredTokens,executionState};
