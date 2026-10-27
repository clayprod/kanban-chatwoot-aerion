import React,{useState} from 'react';
import axios from 'axios';
import {invalidateTechnicalResultCache,technicalNoticeIdentity} from './technicalResultCache';
export default function ManualTechnicalAnalysis({item,profile={},opportunityId}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const run=async()=>{
  setBusy(true);setError('');setMessage('');
  try{
   const {data}=await axios.post(opportunityId?`/api/licitacoes/opportunities/${opportunityId}/technical/analyze`:'/api/licitacoes/technical/notice/analyze',opportunityId?{}:{item,profile});
   invalidateTechnicalResultCache({opportunityId,noticeIdentity:technicalNoticeIdentity(item)});
   setMessage(data.analysis?.execution_status==='blocked'?data.analysis.error || 'Análise na fila, aguardando liberação do provedor.':['queued','running'].includes(data.analysis?.status)?'Análise solicitada. Acompanhe o progresso e a comparação nos itens abaixo.':data.analysis?.result?'A análise salva foi reaproveitada. Confira a comparação e as pendências nos itens abaixo.':'Solicitação registrada. Acompanhe o progresso abaixo.');
  }catch(e){setError(e.response?.data?.error || 'Não foi possível solicitar a análise. Tente novamente.');}
  finally{setBusy(false);}
 };
 return <section aria-label="Solicitar análise técnica" className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
  <div><p className="text-sm font-medium">Análise técnica</p><p className="mt-1 text-xs text-muted">Analise esta oportunidade mesmo fora da faixa verde. Reaproveita dados salvos e respeita o teto de consumo.</p></div>
  <button type="button" onClick={run} disabled={busy||(!opportunityId&&!item)} className="rounded-lg border border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">{busy?'Solicitando análise…':'Analisar oportunidade'}</button>
  {message&&<p role="status" className="w-full text-xs text-muted">{message}</p>}{error&&<p role="alert" className="w-full text-sm text-status-danger">{error}</p>}
 </section>;
}
