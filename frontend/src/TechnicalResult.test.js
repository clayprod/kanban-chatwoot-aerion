import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import TechnicalResult,{ProductMatchSummary,TechnicalItem} from './TechnicalResult';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
const match=(id,ok,price,status='uncertain')=>({product_id:id,product_name:`Produto ${id}`,sale_price:price,status,counts:{ok,total:10,verificar:10-ok,nao_ok:0},requirements:[]});
test('compact card shows the first ranked candidate, item and honest percentage',()=>{
  const onSelect=jest.fn();
  render(<ProductMatchSummary compact onSelect={onSelect} items={[{number:'2',description:'Aeronave',in_scope:true,products:[match('A',9,100),match('B',8,10)]}]} />);
  expect(screen.getByText('Item 2 · Aeronave')).toBeVisible();
  expect(screen.getByText(/90% comprovado/)).toBeVisible();
  expect(screen.queryByText('Produto B')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Comparar Produto A no item 2'}));expect(onSelect).toHaveBeenCalledWith('2','A');
});
test('obsolete evidence never shows an old percentage as current',()=>{
  render(<ProductMatchSummary items={[{number:'1',in_scope:true,products:[{...match('A',10,100),evidence_current:false}]}]} />);
  expect(screen.queryByText(/100% comprovado/)).not.toBeInTheDocument();
});
test('technical item keeps supplier obligations outside the technical requirements and expands extra comparisons explicitly',()=>{
  const onCompareMore=jest.fn();
  render(<TechnicalItem item={{number:'1',in_scope:true,candidate_count:6,products:[match('A',9,100)],obligations:[{id:'training',label:'Treinamento presencial',quote:'Treinamento de 4 horas',source_id:'12',location:'Página 8'}]}} onCompareMore={onCompareMore} />);
  expect(screen.getByText(/90% comprovado/)).toBeVisible();
  expect(screen.getByText(/Obrigações de fornecimento e documentação/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Comparar mais produtos'}));expect(onCompareMore).toHaveBeenCalledWith('1');
});
test('notice page loads full technical evidence before import',async()=>{
  axios.post.mockResolvedValueOnce({data:{enabled:true,analysis:{id:'7',status:'completed',result:{score:80,base_score:80,technical_bonus:0,commercial_bonus:0,full_items:0,relevant_items:1,documents_complete:true,items:[{number:'1',in_scope:true,candidate_count:5,products:[match('A',8,100)]}],sources:[{id:'1',name:'Termo.pdf',pages:16,complete:true}]}}}});
  render(<TechnicalResult overview expanded item={{id:'notice-page-test'}} profile={{terms:['drone']}} />);
  expect(await screen.findByText(/80% comprovado/)).toBeVisible();
  expect(screen.getByText('Termo.pdf')).toBeVisible();
  expect(axios.post).toHaveBeenCalledWith('/api/licitacoes/technical/notice',expect.objectContaining({summary:false}));
});
