import {technicalChecklistProposal,applyTechnicalChecklistsToDraft,prepareReviewImportChoices} from './technicalChecklistBridge';
const requirement={id:'r1',section:'Autonomia',label:'Voo mínimo de 41 minutos',source_id:'edital',location:'Página 4',quote:'Voo mínimo de 41 minutos'};
const product={product_id:'2',product_version:3,product_name:'Modelo B',requirements:[{requirement,status:'nao_ok',reason:'40 minutos não atende mínimo de 41.',evidence:[{id:'s1',source_id:'spec',location:'Página 10',key:'flight_time',kind:'numeric',value:40,unit:'min',quote:'Autonomia: 40 minutos'}]}]};
const item={number:'1',in_scope:true,products:[product]};
test('pre-analysis becomes the existing assistant/checklist format with sections, model, verdict and both citations',()=>{
 const proposal=technicalChecklistProposal(item,product);
 expect(proposal.modelo_produto).toBe('Modelo B');expect(proposal.requirements[0]).toMatchObject({secao:'Autonomia',status:'nao_ok',requisito:requirement.label,ordem:0,custo_subitem:null});
 expect(proposal.requirements[0].observacao).toContain('40 min');expect(proposal.requirements[0].observacao).toContain('[fonte edital]');expect(proposal.requirements[0].observacao).toContain('[fonte spec]');
});
test('import preserves current preview product and manual decision with the automatic verdict for audit',()=>{
 const better={...product,product_id:'3',product_name:'Modelo C'};
 const analysis={id:'job',result:{items:[{...item,products:[better,product],potential_product:better}]}};
 const choice={product_id:'2',analysis_id:'job',product_version:3,requirements_signature:JSON.stringify(product.requirements),overrides:{r1:'verificar'}};
 const result=applyTechnicalChecklistsToDraft([{numero_item:'1',requirements:[]},{numero_item:'99',descricao:'Outro item'}],analysis,{'1':choice});
 expect(result[0].modelo_produto).toBe('Modelo B');expect(result[0].requirements[0].status).toBe('verificar');expect(result[0].requirements[0].observacao).toContain('Resultado automático: Não atende');expect(result[1]).toEqual({numero_item:'99',descricao:'Outro item'});
 const changed={...choice,product_version:2};expect(applyTechnicalChecklistsToDraft([{numero_item:'1'}],analysis,{'1':changed})[0].requirements[0].status).toBe('nao_ok');
});
test('an obsolete document/specification cannot silently import old approvals',()=>{
 expect(technicalChecklistProposal(item,{...product,evidence_current:false})).toBeNull();
 expect(technicalChecklistProposal({...item,review_invalidated:true},product)).toBeNull();
});
test('supplier obligations follow the import as pending conditions, without being marked compliant by product specs',()=>{
 const proposal=technicalChecklistProposal({...item,obligations:[{...requirement,id:'warranty',label:'Garantia de 12 meses',section:'Garantia'}]},product);
 expect(proposal.requirements).toHaveLength(2);expect(proposal.requirements[1]).toMatchObject({requisito:'Garantia de 12 meses',secao:'Garantia',status:'verificar',ordem:1});expect(proposal.requirements[1].observacao).toContain('Não integra o percentual técnico');
});
test('import uses authoritative saved reviews and objections instead of stale local verdicts',()=>{
 const saved={...product,requirements:[{...product.requirements[0],status:'ok',automatic_status:'nao_ok',manual_review:{reviewer_id:7}}]},analysis={id:'job',result:{items:[{...item,products:[saved]}]}};
 const choices=prepareReviewImportChoices(analysis,{'1':{product_id:'2',overrides:{r1:'nao_ok'}}},[{item_number:'1',requirement_id:'r1',topic:'contradicao',note:'Motivo salvo'}]);
 const [draft]=applyTechnicalChecklistsToDraft([{numero_item:'1'}],analysis,choices);expect(draft.requirements[0]).toMatchObject({status:'ok',impugnar:true,impugnacao_tema:'contradicao',impugnacao_motivo:'Motivo salvo'});expect(draft.requirements[0].technical_reference.manual_review.reviewer_id).toBe(7);
});
