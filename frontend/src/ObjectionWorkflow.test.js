import React from 'react';import {render,screen,fireEvent,waitFor} from '@testing-library/react';import '@testing-library/jest-dom';import axios from 'axios';import RequirementStatusControl from './RequirementStatusControl';import {ObjectionContext,adjustedCompatibility} from './ObjectionContext';import {ObjectionProvider,ObjectionPanel} from './ObjectionWorkflow';import TechnicalChecklist from './TechnicalChecklist';import {ItemCompatibilitySummary} from './TechnicalResult';
jest.mock('axios',()=>({get:jest.fn(),put:jest.fn(),post:jest.fn()}));
test('excludes contested criteria, retains original statuses, and never reports 100% after excluding all',()=>{
 const rows=[{requirement:{id:'a'},status:'ok'},{requirement:{id:'b'},status:'nao_ok'}];expect(adjustedCompatibility(rows,id=>id==='b')).toEqual({excluded:1,total:1,percent:100});expect(adjustedCompatibility(rows,()=>true)).toEqual({excluded:2,total:0,percent:null});expect(rows[1].status).toBe('nao_ok');
});
test('the gavel toggles independently of OK/X/? and a hypothetical result is labelled in both detail and header',()=>{
 const update=jest.fn(),selected=[{item_number:'1',requirement_id:'b'}],ctx={base:'/x',selected,update,isSelected:(_,id)=>id==='b'};
 const requirements=[{requirement:{id:'a',label:'A',key:'other',section:'Técnica'},status:'ok',evidence:[]},{requirement:{id:'b',label:'B',section:'Técnica'},status:'nao_ok',evidence:[]}],product={product_id:'p',product_name:'Modelo',sale_price:100,status:'failed',counts:{ok:1,nao_ok:1,total:2},requirements};
 render(<ObjectionContext.Provider value={ctx}><ItemCompatibilitySummary item={{number:'1',products:[product]}}/><TechnicalChecklist item={{number:'1',in_scope:true,products:[product]}}/></ObjectionContext.Provider>);
 expect(screen.getByText('100% no cenário ajustado')).toBeVisible();expect(screen.getByText(/original 50%/)).toBeVisible();expect(screen.queryByText('Atende plenamente')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retirar da impugnação'}));expect(update).toHaveBeenCalledWith(expect.objectContaining({requirement_id:'b'}),{selected:false});expect(requirements[1].status).toBe('nao_ok');
});
test('grouping one thermal clause preserves distinct resolution and radiometry checks without duplicating the clause title',()=>{
 const quote='térmica 640x512 radiométrica',requirements=['thermal_resolution','thermal_camera_type'].map((key,i)=>({requirement:{id:String(i),key,label:quote,quote,source_id:'s',component:'thermal_camera',section:'Câmera'},status:'verificar',evidence:[]}));
 render(<TechnicalChecklist item={{number:'1',in_scope:true,products:[{product_id:'p',product_name:'640T',sale_price:100,counts:{total:2,ok:0,verificar:2},requirements}]}}/>);
 expect(screen.getAllByText(quote)).toHaveLength(1);expect(screen.getByText('Resolução da câmera térmica')).toBeVisible();expect(screen.getByText('Medição radiométrica')).toBeVisible();
});
test('selected model is used by the item summary instead of its first recommendation',()=>{
 render(<ItemCompatibilitySummary item={{products:[{product_id:'6k',product_name:'6K',counts:{ok:1,total:2}},{product_id:'640t',product_name:'640T',counts:{ok:2,total:2}}]}} highlightProductId="640t"/>);expect(screen.getByText('640T')).toBeVisible();expect(screen.queryByText('6K')).not.toBeInTheDocument();
});
test('manual pipeline selections load/save, and only an explicit click invokes draft generation',async()=>{
 axios.get.mockResolvedValue({data:{selected:[{item_number:'1',requirement_id:'manual:1',label:'Exigência',topic:'restricao',note:''}],notice:{regime:'14133'}}});axios.put.mockResolvedValue({data:{ok:true}});axios.post.mockResolvedValue({data:{draft:{addressee:'Órgão',reference:'Edital',sections:[{title:'Fundamentos',paragraphs:['Texto da minuta']}],place_date:'Cidade',signature:'Empresa'}}});
 render(<ObjectionProvider opportunityId="9"><ObjectionPanel/></ObjectionProvider>);expect(await screen.findByRole('button',{name:'Preparar impugnação (1)'})).toBeEnabled();expect(axios.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Preparar impugnação (1)'}));fireEvent.click(screen.getByRole('button',{name:'Gerar minuta com IA'}));expect(await screen.findByDisplayValue('Texto da minuta')).toBeVisible();expect(axios.post).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Baixar Word (.docx)'})).toBeVisible();
});
