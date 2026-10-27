import React from 'react';
import {useObjection,adjustedCompatibility} from './ObjectionContext';
export default function ChecklistScenarioSummary({itemNumber,requirements=[]}){
 const ctx=useObjection();if(!ctx)return null;
 const rows=requirements.filter(r=>!['supply','administrative'].includes(r.technical_reference?.category)).map(r=>({requirement:{id:`manual:${r.id}`},status:r.status})),scenario=adjustedCompatibility(rows,id=>ctx.isSelected(String(itemNumber),id));
 if(!scenario.excluded)return null;
 return <p className="mb-3 text-xs text-primary">{scenario.percent==null?'Sem requisitos restantes':`${scenario.percent}% no cenário ajustado`} · {scenario.excluded} requisito(s) impugnado(s). As exigências continuam vigentes até eventual alteração do edital.</p>;
}
