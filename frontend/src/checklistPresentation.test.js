import {consecutiveSections,referenceFor} from './checklistPresentation';
import {technicalChecklistProposal} from './technicalChecklistBridge';
test('sections are consecutive blocks and never pull a later criterion ahead of another source clause',()=>{
 const rows=[{id:'1',section:'Câmera'},{id:'2',section:'Segurança'},{id:'3',section:'Câmera'}];
 expect(consecutiveSections(rows,r=>r.section).map(([title,items])=>[title,items.map(r=>r.id)])).toEqual([['Câmera',['1']],['Segurança',['2']],['Câmera',['3']]]);
});
test('reference numbers persist through import, with source order across technical and supplier conditions',()=>{
 const requirement={id:'r',label:'RTH',section:'Segurança'},document_reference={number:'4.3.2',automatic:false,ordinal:2},obligation={id:'o',label:'Entrega',section:'Fornecimento'},first={number:'01',automatic:true,ordinal:1};
 const product={product_id:'p',requirements:[{requirement,status:'ok',document_reference}]},item={number:'1',obligations:[obligation],requirement_references:{o:first}};
 expect(referenceFor(product.requirements[0],item)).toBe(document_reference);
 const imported=technicalChecklistProposal(item,product).requirements;expect(imported.map(r=>r.requisito)).toEqual(['Entrega','RTH']);expect(imported[1].technical_reference.document_reference).toEqual(document_reference);expect(imported.map(r=>r.ordem)).toEqual([0,1]);
});
