import React from 'react';
import {render,screen,fireEvent,act} from '@testing-library/react';
import '@testing-library/jest-dom';
import PncpSearchDialog from './PncpSearchDialog';
import SearchGuide from './SearchGuide';
jest.mock('axios',()=>({get:()=>Promise.resolve({data:[]}),post:jest.fn()}));
test('creation is a dialog with an Escape exit and restored body scrolling',()=>{
  const onClose=jest.fn();document.body.style.overflow='auto';
  const {unmount}=render(<PncpSearchDialog onClose={onClose}><label>Objetivo<input /></label></PncpSearchDialog>);
  const dialog=screen.getByRole('dialog',{name:'Nova busca de editais'});
  expect(dialog).toHaveFocus();expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(dialog,{key:'Escape'});expect(onClose).toHaveBeenCalledTimes(1);
  unmount();expect(document.body.style.overflow).toBe('auto');
});
test('embedded search has one close control and keeps optional filters collapsed',async()=>{
  const onClose=jest.fn();await act(async()=>render(<PncpSearchDialog onClose={onClose}><SearchGuide hideHeader onCancel={onClose} filtersPanel={<details><summary>Filtros da consulta</summary><input aria-label="Estado" /></details>} /></PncpSearchDialog>));
  expect(screen.getAllByRole('button',{name:'Fechar'})).toHaveLength(1);
  expect(screen.getByText('Filtros da consulta').closest('details')).not.toHaveAttribute('open');
});
