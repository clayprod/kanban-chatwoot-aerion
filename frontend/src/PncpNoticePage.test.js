import React from 'react';
import { render,screen,fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PncpNoticePage from './PncpNoticePage';
import {createPncpOpportunityPreview} from './pncpPreview';
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
