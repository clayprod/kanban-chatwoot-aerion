import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import TechnicalResult,{ProductMatchSummary,ProductMatchChips,TechnicalItem,ItemCompatibilitySummary,ExtractionCoverage,analysisLabel} from './TechnicalResult';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
const match=(id,ok,price,status='uncertain')=>({product_id:id,product_name:`Produto ${id}`,sale_price:price,status,counts:{ok,total:10,verificar:10-ok,nao_ok:0},requirements:[]});

test('incomplete coverage shows its actual pause without promising paid automatic recovery',()=>{
 render(<ExtractionCoverage analysis={{status:'queued',execution_status:'paused'}} result={{documents_complete:false,coverage:{read_complete:false,chunks:109,complete:96,blocks:120,audited_blocks:118,requirements:60,comparisons:180}}} />);
 expect(screen.getByText('96/109')).toBeVisible();expect(screen.getByText('118/120')).toBeVisible();
 expect(screen.getByRole('status')).toHaveTextContent(/Análise pausada/);
 expect(screen.getByRole('status')).not.toHaveTextContent(/Retomada prevista|em andamento/);
});

test('pending, blocked and partial analyses have distinct honest labels',()=>{
 expect(analysisLabel({status:'queued'})).toBe('Análise na fila');
 expect(analysisLabel({status:'queued',execution_status:'blocked'})).toMatch(/bloqueada/);
 expect(analysisLabel({status:'partial'})).toMatch(/revisão necessária/);
 expect(analysisLabel({status:'running',stage_label:'Extraindo exigências'})).toBe('Extraindo exigências');
});

test('a reviewed item shows the concrete document issue without pretending extraction is still running',()=>{
 render(<TechnicalItem item={{number:'1',in_scope:true,reviewed:true,documents_complete:false,document_issues:['TR separado não localizado.'],products:[match('A',2,100)],requirements:[],obligations:[]}} />);
 expect(screen.getByText(/TR separado não localizado/)).toBeVisible();
 expect(screen.queryByText(/conferindo as exigências restantes/)).not.toBeInTheDocument();
});

test('complete reading with a documentary contradiction is distinguished from missing extraction',()=>{
 render(<ExtractionCoverage analysis={{status:'partial'}} result={{documents_complete:false,coverage:{read_complete:true,chunks:10,complete:10}}} />);
 expect(screen.getByText(/Há divergências que precisam de revisão/)).toBeVisible();
 expect(screen.queryByText(/reler os trechos pendentes/)).not.toBeInTheDocument();
});
test('item summary shows the model without expansion and never promotes uncertain evidence to full compliance',()=>{
  render(<ItemCompatibilitySummary item={{documents_complete:false,products:[match('A',10,100,'full')]}} />);
  expect(screen.getByText('Produto A')).toBeVisible();expect(screen.getByText('100% comprovado')).toBeVisible();
  expect(screen.getByText('? — Verificar')).toBeVisible();expect(screen.queryByText('Atende plenamente')).not.toBeInTheDocument();
});
test('result card only exposes a compact product chip and opens the exact item',()=>{
  const onSelect=jest.fn();render(<ProductMatchChips items={[{number:'2',in_scope:true,products:[match('A',9,100)]}]} onSelect={onSelect} />);
  expect(screen.getByText('90%')).toBeVisible();
  expect(screen.queryByText(/exigências|Compatibilidade com|Pacote para/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Comparar Produto A no item 2'}));expect(onSelect).toHaveBeenCalledWith('2','A');
});
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
  expect(screen.getByText('90%')).toBeVisible();
  expect(screen.getByText(/Fornecimento e documentação/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Comparar outros produtos'}));expect(onCompareMore).toHaveBeenCalledWith('1');
});
test('notice page loads full technical evidence before import',async()=>{
  axios.post.mockResolvedValueOnce({data:{enabled:true,analysis:{id:'7',status:'completed',result:{score:80,base_score:80,technical_bonus:0,commercial_bonus:0,full_items:0,relevant_items:1,documents_complete:true,items:[{number:'1',in_scope:true,candidate_count:5,products:[match('A',8,100)]}],sources:[{id:'1',name:'Termo.pdf',pages:16,complete:true}]}}}});
  render(<TechnicalResult overview expanded item={{id:'notice-page-test'}} profile={{terms:['drone']}} />);
  expect(await screen.findByText('Comparação disponível nos itens abaixo.')).toBeVisible();
  expect(screen.queryByText('Termo.pdf')).not.toBeInTheDocument();
  expect(axios.post).toHaveBeenCalledWith('/api/licitacoes/technical/notice',expect.objectContaining({summary:false}));
});
