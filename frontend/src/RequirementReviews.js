import React,{createContext,useContext,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import axios from 'axios';
import {invalidateTechnicalResultCache} from './technicalResultCache';
const Context=createContext(null);
export const useRequirementReviews=()=>useContext(Context);
const key=r=>`${r.item_number}::${r.product_id}::${r.requirement_id}`;
export function RequirementReviewProvider({children}){
 const [analysis,setAnalysis]=useState(null),[reviews,setReviews]=useState([]),[saving,setSaving]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false),chain=useRef(Promise.resolve()),latest=useRef(new Map()),failures=useRef(new Map()),sequence=useRef(0);
 const registerAnalysis=useCallback(a=>{if(a?.id&&!a.summary_only)setAnalysis(current=>current?.id===a.id&&current?.updated_at===a.updated_at?current:a);},[]);
 const base=analysis?.id?`/api/licitacoes/technical/jobs/${analysis.id}/reviews`:null;
 useEffect(()=>{if(!base||saving>0)return;let active=true;setLoading(true);axios.get(base).then(r=>{if(active){setReviews(r.data.reviews || []);setError([...failures.current.values()].join(' '));}}).catch(e=>{if(active)setError(e.response?.data?.error || 'Não foi possível carregar os ajustes manuais.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[base,analysis?.updated_at,saving]);
 const update=useCallback((reference,status)=>{
  if(!base||loading)return;
  const id=key(reference),version=++sequence.current;latest.current.set(id,version);failures.current.delete(id);
  setError([...failures.current.values()].join(' '));setSaving(v=>v+1);setReviews(rows=>[...rows.filter(r=>key(r)!==id),{...reference,status,pending:true}]);
  chain.current=chain.current.catch(()=>{}).then(async()=>{const r=await axios.put(base,{...reference,status});invalidateTechnicalResultCache();if(latest.current.get(id)===version){setReviews(rows=>[...rows.filter(row=>key(row)!==id),{...r.data.review,pending:false}]);failures.current.delete(id);setError([...failures.current.values()].join(' '));}}).catch(async e=>{if(latest.current.get(id)!==version)return;failures.current.set(id,e.response?.data?.error || 'O ajuste não foi salvo. Confira a conexão e tente novamente.');setError([...failures.current.values()].join(' '));try{const r=await axios.get(base);if(latest.current.get(id)===version)setReviews(rows=>[...rows.filter(row=>key(row)!==id),...(r.data.reviews || []).filter(row=>key(row)===id)]);}catch(_){};}).finally(()=>setSaving(v=>Math.max(0,v-1)));
 },[base,loading]);
 const value=useMemo(()=>({base,reviews,loading,saving,error,registerAnalysis,update,forProduct:(number,id)=>Object.fromEntries(reviews.filter(r=>String(r.item_number)===String(number)&&String(r.product_id)===String(id)).map(r=>[r.requirement_id,r.status]))}),[base,reviews,loading,saving,error,registerAnalysis,update]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
