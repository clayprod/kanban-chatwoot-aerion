import React from 'react';
import { render,screen,fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PncpNoticePage from './PncpNoticePage';
jest.mock('axios',()=>({get:jest.fn().mockResolvedValue({data:{selected:[],reviews:[]}}),put:jest.fn(),post:jest.fn()}));
import {createPncpOpportunityPreview} from './pncpPreview';
import {pncpInterestTotals} from './pncpPreview';
jest.mock('./OpportunityPreview',()=>()=> <p>Exigências e evidências por item</p>);
test('opening a notice is read only; importing is a separate explicit action',()=>{
  const onImport=jest.fn(),onBack=jest.fn(),onSearches=jest.fn();
  const opportunity=createPncpOpportunityPreview({titulo:'Edital 351',orgao:{nome:'Órgão'}},{});
  render(<PncpNoticePage opportunity={opportunity} jobName="DRONE" items={[]} onImport={onImport} onBack={onBack} onSearches={onSearches} canImport />);
  expect(screen.getByRole('navigation',{name:'Breadcrumb'})).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Exigências e evidências por item')).toBeVisible();
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'← Voltar aos resultados'}));expect(onBack).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Importar para o pipeline'}));expect(onImport).toHaveBeenCalledTimes(1);
});

test('header totals only selected interest items and never substitutes the whole notice value',()=>{
 const opportunity=createPncpOpportunityPreview({titulo:'Edital',valor_total_estimado:999999});
 render(<PncpNoticePage opportunity={opportunity} items={[{quantidade:2,valor_referencia:10},{quantidade:3,valor_referencia:20}]} />);
 expect(screen.getByText('Valor dos itens de interesse')).toBeVisible();expect(screen.getByText(/80,00/)).toBeVisible();
 expect(screen.queryByText(/999\.999/)).not.toBeInTheDocument();
});

test('missing prices produce an explicit subtotal instead of treating unknown amounts as zero',()=>{
 expect(pncpInterestTotals([{quantidade:2,valor_referencia:10},{quantidade:1,valor_referencia:null}])).toEqual({total:20,known:1,missing:1});
 render(<PncpNoticePage opportunity={createPncpOpportunityPreview({titulo:'Edital'})} items={[{quantidade:2,valor_referencia:10},{quantidade:1}]} />);
 expect(screen.getByText('Subtotal dos itens de interesse')).toBeVisible();expect(screen.getByText('1 item sem valor informado')).toBeVisible();
});
