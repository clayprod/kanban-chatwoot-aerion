import {createContext,useContext} from 'react';
export const ObjectionContext=createContext(null);
export const useObjection=()=>useContext(ObjectionContext);
export const objectionKey=(number,id)=>`${number}::${id}`;
export function adjustedCompatibility(rows,selected){
 const remaining=rows.filter(r=>!selected(r.requirement.id)),excluded=rows.length-remaining.length;
 return {excluded,total:remaining.length,percent:remaining.length?Math.floor(100*remaining.filter(r=>r.status==='ok').length/remaining.length):null};
}
