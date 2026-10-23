import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import PipelineOpportunityPage from './PipelineOpportunityPage';
test('pipeline detail is a page with a return action and retains editable content',()=>{
  const onBack=jest.fn();
  render(<PipelineOpportunityPage title="Edital 351" onBack={onBack}><label>Título<input defaultValue="Compra de aeronaves" /></label></PipelineOpportunityPage>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('navigation',{name:'Breadcrumb'})).toBeVisible();
  const field=screen.getByLabelText('Título');fireEvent.change(field,{target:{value:'Título revisado'}});expect(field).toHaveValue('Título revisado');
  fireEvent.click(screen.getByRole('button',{name:'← Voltar ao pipeline'}));expect(onBack).toHaveBeenCalledTimes(1);
});
