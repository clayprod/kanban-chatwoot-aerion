import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import PncpSearchDialog from './PncpSearchDialog';
test('creation is a dialog with an Escape exit and restored body scrolling',()=>{
  const onClose=jest.fn();document.body.style.overflow='auto';
  const {unmount}=render(<PncpSearchDialog onClose={onClose}><label>Objetivo<input /></label></PncpSearchDialog>);
  const dialog=screen.getByRole('dialog',{name:'Nova busca de editais'});
  expect(dialog).toHaveFocus();expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(dialog,{key:'Escape'});expect(onClose).toHaveBeenCalledTimes(1);
  unmount();expect(document.body.style.overflow).toBe('auto');
});
