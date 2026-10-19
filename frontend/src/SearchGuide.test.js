import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import SearchGuide from './SearchGuide';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
const profile = { version: 1, description: 'Somente AUTEL', objective: 'Marca AUTEL', terms: ['AUTEL'],
  related_terms: [], excluded_terms: [], match_mode: 'literal', item_kind: 'material' };
const sample = { items: [{ id: '1', titulo: 'Drone AUTEL', search_quality: { term: 'AUTEL', snippet: 'Compra de Drone AUTEL', status: 'accepted' } }], warning: 'Esta é uma amostra, não uma varredura completa.' };
beforeEach(() => { jest.clearAllMocks(); axios.get.mockResolvedValue({ data: [] }); });
test.each(['edital', 'pca'])('service exclusion is visible before defining a %s search and survives description edits', async source => {
  render(<SearchGuide source={source} onActivate={jest.fn()} />);
  const kind = screen.getByLabelText('Tipo de item');
  expect(kind).toBeVisible();
  expect(screen.getByRole('option', { name: 'Somente materiais — excluir serviços' })).toBeInTheDocument();
  fireEvent.change(kind, { target: { value: 'material' } });
  const description = screen.getByLabelText('Que oportunidades você procura?');
  fireEvent.change(description, { target: { value: 'AUTEL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir manualmente' }));
  fireEvent.change(description, { target: { value: 'Agulhas cirúrgicas' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir manualmente' }));
  await preview();
  expect(axios.post).toHaveBeenLastCalledWith('/api/licitacoes/search/guide/preview', expect.objectContaining({
    source, profile: expect.objectContaining({ item_kind: 'material', terms: ['Agulhas cirúrgicas'] }),
  }), expect.anything());
});

test('interpretation preserves explicit service exclusion and does not ask the same item type again', async () => {
  axios.post.mockResolvedValueOnce({ data: { profile: { ...profile, item_kind: 'all' }, questions: [{
    id: 'item_kind', question: 'Materiais ou serviços?', options: [],
  }] } });
  render(<SearchGuide onActivate={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Tipo de item'), { target: { value: 'material' } });
  fireEvent.change(screen.getByLabelText('Que oportunidades você procura?'), { target: { value: 'AUTEL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir minha busca' }));
  await screen.findByText('O que vamos procurar');
  expect(screen.queryByLabelText('Materiais ou serviços?')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Tipo de item')).toHaveValue('material');
  await preview();
  expect(axios.post).toHaveBeenLastCalledWith('/api/licitacoes/search/guide/preview', expect.objectContaining({
    profile: expect.objectContaining({ item_kind: 'material' }),
  }), expect.anything());
});
test('optional product selection is preserved in the reviewed preview', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/products') ? [{ id: '15', name: 'Produto da busca', active: true }] : [] }));
  render(<SearchGuide onActivate={jest.fn()} />);
  fireEvent.click(await screen.findByLabelText('Produto da busca'));
  fireEvent.change(screen.getByLabelText('Que oportunidades você procura?'), { target: { value: 'Monitor cardíaco' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir manualmente' }));
  await preview();
  expect(axios.post).toHaveBeenLastCalledWith('/api/licitacoes/search/guide/preview', expect.objectContaining({ profile: expect.objectContaining({ product_ids: ['15'] }) }), expect.anything());
});

const preview = async () => {
  axios.post.mockResolvedValueOnce({ data: sample });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir amostra real' }));
  await screen.findByText('Drone AUTEL');
};

test('activation requires a real preview and explicit confirmation, sending the reviewed profile', async () => {
  const onActivate = jest.fn();
  render(<SearchGuide initialProfile={profile} onActivate={onActivate} />);
  expect(screen.queryByRole('button', { name: 'Salvar critérios confirmados' })).not.toBeInTheDocument();
  await preview();
  const activate = screen.getByRole('button', { name: 'Salvar critérios confirmados' });
  expect(activate).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(activate);
  expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ terms: ['AUTEL'], item_kind: 'material', confirmed_at: expect.any(String) }));
});
test('criteria edits and external filter changes invalidate the preview', async () => {
  const { rerender } = render(<SearchGuide initialProfile={profile} filters={{ uf: 'SP' }} onActivate={jest.fn()} />);
  await preview();
  fireEvent.change(screen.getByLabelText('Tipo de item'), { target: { value: 'all' } });
  expect(screen.queryByText('Drone AUTEL')).not.toBeInTheDocument();
  await preview();
  rerender(<SearchGuide initialProfile={profile} filters={{ uf: 'RJ' }} onActivate={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText('Drone AUTEL')).not.toBeInTheDocument());
});
test('stale interpretation cannot replace a newer description', async () => {
  let resolve;
  axios.post.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<SearchGuide onActivate={jest.fn()} />);
  const description = screen.getByLabelText('Que oportunidades você procura?');
  fireEvent.change(description, { target: { value: 'AUTEL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir minha busca' }));
  fireEvent.change(description, { target: { value: 'Agulhas cirúrgicas' } });
  await act(async () => resolve({ data: { profile } }));
  expect(description).toHaveValue('Agulhas cirúrgicas');
  expect(screen.queryByText('O que vamos procurar')).not.toBeInTheDocument();
});
test('manual fallback works without AI and draft saving never activates a search', async () => {
  const onActivate = jest.fn();
  render(<SearchGuide onActivate={onActivate} />);
  fireEvent.change(screen.getByLabelText('Que oportunidades você procura?'), { target: { value: 'Cadeiras odontológicas' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir manualmente' }));
  expect(screen.getByLabelText('Objetivo')).toHaveValue('Cadeiras odontológicas');
  axios.post.mockResolvedValueOnce({ data: { id: 1 } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await screen.findByText('Rascunho salvo. Nenhuma busca ou notificação foi ativada.');
  expect(onActivate).not.toHaveBeenCalled();
  expect(axios.post.mock.calls[0][0]).toBe('/api/licitacoes/search/guide/drafts');
});
test('irrelevant sample requires an explicit criteria adjustment, never an assumed exclusion', async () => {
  render(<SearchGuide initialProfile={profile} onActivate={jest.fn()} />);
  await preview();
  fireEvent.click(screen.getByRole('button', { name: 'Fora do interesse' }));
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Salvar critérios confirmados' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Expressão a excluir'), { target: { value: 'manutenção preventiva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao resumo e refazer a amostra' }));
  expect(screen.getByLabelText('O que deve ficar de fora')).toHaveValue('manutenção preventiva');
  expect(screen.queryByText('Drone AUTEL')).not.toBeInTheDocument();
});

test('an ambiguous sector or application is selected by the user before consulting the sample', async () => {
  axios.post.mockResolvedValueOnce({ data: { profile: { ...profile, terms: ['monitor'] }, questions: [{
    id: 'context_0', question: 'Que tipo de monitor?', options: [
      { value: 'computer', label: 'Tela de computador', criteria: { terms: ['monitor de computador'] } },
      { value: 'medical', label: 'Sinais vitais', criteria: { terms: ['monitor de sinais vitais'] } },
    ],
  }] } });
  render(<SearchGuide onActivate={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Que oportunidades você procura?'), { target: { value: 'monitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Definir minha busca' }));
  await screen.findByLabelText('Que tipo de monitor?');
  expect(screen.getByRole('button', { name: 'Conferir amostra real' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Que tipo de monitor?'), { target: { value: 'medical' } });
  expect(screen.getByLabelText(/Termos e modelos/)).toHaveValue('monitor de sinais vitais');
  expect(screen.getByRole('button', { name: 'Conferir amostra real' })).toBeEnabled();
});
