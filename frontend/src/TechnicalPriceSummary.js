import React from 'react';
const amount=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const money=v=>v==null?'Não informado':v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function TechnicalPriceSummary({product,item}){
 if(!product)return null;
 const positive=v=>{const n=amount(v);return n>0?n:null;};
 const cfg=product.configuration || {},base=positive(cfg.base_price ?? product.sale_price),offered=base==null?null:positive(product.sale_price),extras=amount(cfg.extra_price) ?? 0,reference=positive(product.price_comparison?.reference ?? item?.reference_price),quantity=amount(item?.quantity),comparable=!!product.price_comparison;
 const difference=comparable&&offered!=null&&reference!=null?offered-reference:null;
 const missing=cfg.missing || [];
 return <section className="mb-4 border-y border-line py-3" aria-label="Composição e comparação de preços">
  <dl className="grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-muted">Produto + complementos · por unidade/conjunto</dt><dd className="mt-1 text-base font-semibold tabular-nums">{money(offered)}</dd><p className="mt-1 text-xs text-muted">Produto: {money(base)}{extras>0?` + complementos: ${money(extras)}`:''}</p></div><div><dt className="text-xs text-muted">Referência do edital · por unidade/conjunto</dt><dd className="mt-1 text-base font-semibold tabular-nums">{money(reference)}</dd><p className="mt-1 text-xs text-muted">Valor estimado pelo órgão para este item.</p></div><div><dt className="text-xs text-muted">Diferença por unidade/conjunto</dt><dd className={`mt-1 text-base font-semibold tabular-nums ${difference!=null&&difference<0?'text-status-success':'text-ink'}`}>{difference==null?'Comparação pendente':difference===0?'Mesmo valor':`${money(Math.abs(difference))} ${difference<0?'abaixo':'acima'}`}</dd><p className="mt-1 text-xs text-muted">{comparable?'Comparação entre unidades de fornecimento equivalentes.':'É necessário confirmar unidades e composição para comparar.'}</p></div></dl>
  {!!cfg.additions?.length&&<div className="mt-3 text-xs"><p className="font-medium">Complementos já somados ao preço:</p><ul className="mt-1 space-y-1 text-muted">{cfg.additions.map((a,index)=><li key={a.product_id || index}>{a.quantity} × {a.name}{amount(a.unit_price)!=null?` · ${money(Number(a.unit_price)*Number(a.quantity))}`:''}</li>)}</ul></div>}
  {quantity>1&&offered!=null&&<p className="mt-3 text-xs text-muted">Quantidade do item: <span className="font-medium text-ink">{quantity}</span> · Total estimado dos produtos e complementos: <span className="font-medium text-ink">{money(Math.round(offered*quantity*100)/100)}</span>{reference!=null?` · Referência total do item: ${money(Math.round(reference*quantity*100)/100)}`:''}</p>}
  <p className="mt-2 text-xs text-muted">{missing.length?'Estimativa provisória: há complementos ou quantidades ainda não confirmados. ':''}O preço cadastrado e os complementos não representam uma proposta final com frete, tributos e serviços eventualmente adicionais. Preço inferior não comprova atendimento técnico.</p>
 </section>;
}
