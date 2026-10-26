import React from 'react';
const options=[['ok','OK','Atende','bg-status-success'],['nao_ok','X','Não atende','bg-status-danger'],['verificar','?','Verificar','bg-status-warning']];
export default function RequirementStatusControl({status='verificar',onChange,label='Resultado do requisito'}){
 return <div role="group" aria-label={label} className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-bg2 p-0.5">{options.map(([value,symbol,title,color])=><button key={value} type="button" title={title} aria-label={title} aria-pressed={status===value||value==='verificar'&&status==='pendente'} disabled={!onChange} onClick={()=>onChange?.(value)} className={`h-7 min-w-[1.8rem] rounded px-1.5 text-[11px] font-bold transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default ${status===value||value==='verificar'&&status==='pendente'?`${color} text-bg`:'text-muted hover:bg-surf2'}`}>{symbol}</button>)}</div>;
}
