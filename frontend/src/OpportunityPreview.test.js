import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import OpportunityPreview from './OpportunityPreview';
import { createPncpOpportunityPreview } from './pncpPreview';
import { mergePncpItems } from './pncpPreview';
jest.mock('./TechnicalResult', () => ({ __esModule: true, default: ({ itemNumber, highlightProductId, onOpenMatch }) => itemNumber ? <p>Comparação item {itemNumber} produto {highlightProductId || 'todos'}</p> : <button onClick={() => onOpenMatch('2', '9')}>Produto recomendado · item 2</button> }));
const raw = { id: 123, titulo: 'Compra de drones', orgao: { nome: 'Órgão', cnpj: '12345678000195' }, numero_controle_pncp: '12345678000195-1-000001/2026', valor_total_estimado: 100, url: 'https://example.org/edital' };
const items = [{ id: 'a', numero_item: '1', descricao: 'Aeronave', quantidade: 1 }, { id: 'b', numero_item: '2', descricao: 'Bateria', quantidade: 3 }];
test('preview has no persistent identity or editing controls and opens the matched item/product', () => {
  const preview = createPncpOpportunityPreview(raw, { terms: ['drone'] });
  expect(preview.id).toBeNull(); expect(preview.__preview).toBe(raw);
  const { container } = render(<OpportunityPreview opportunity={preview} items={items} />);
  expect(screen.getByText(/só entra no pipeline após confirmar/)).toBeVisible();
  expect(container.querySelectorAll('input,textarea,select')).toHaveLength(0);
  expect(screen.queryByText('Comparação item 1 produto todos')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Produto recomendado · item 2' }));
  expect(screen.getByText('Comparação item 2 produto 9')).toBeVisible();
  expect(screen.getByText('Comparação item 2 produto 9').closest('details')).toHaveAttribute('open');
  expect(screen.queryByText('Comparação item 1 produto todos')).not.toBeInTheDocument();
});
test('card focus opens the selected comparison immediately, including when item data arrives later', () => {
  const preview = createPncpOpportunityPreview(raw, {}, { number: '2', productId: '9' });
  const { rerender } = render(<OpportunityPreview opportunity={preview} items={[]} loading />);
  expect(screen.getByRole('status')).toBeVisible();
  rerender(<OpportunityPreview opportunity={preview} items={items} />);
  expect(screen.getByText('Comparação item 2 produto 9')).toBeVisible();
});
test('unrelated items stay in a collapsed section, separate from the import selection',()=>{
  render(<OpportunityPreview opportunity={createPncpOpportunityPreview(raw,{terms:['drone']})} items={items.slice(0,1)} otherItems={[{numero_item:'99',descricao:'Papel sulfite'}]} />);
  expect(screen.getByText('Itens de interesse · 1')).toBeVisible();
  const unrelated=screen.getByText(/Papel sulfite/);
  expect(unrelated.closest('details')).not.toHaveAttribute('open');
  expect(unrelated).not.toBeVisible();
});
test('fetching a page never discards a previously identified relevant item beyond that page',()=>{
  const merged=mergePncpItems([{numeroItem:1,descricao:'Descrição completa'}],[{numero_item:'2200',descricao:'Drone'}, {numero_item:'1',descricao:'Resumo'}]);
  expect(merged).toHaveLength(2);
  expect(merged.find(i=>i.numero_item==='2200').descricao).toBe('Drone');
  expect(merged.find(i=>i.numeroItem===1).descricao).toBe('Descrição completa');
});
