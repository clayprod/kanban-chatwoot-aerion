import React from 'react';import {render,screen,fireEvent,waitFor} from '@testing-library/react';import '@testing-library/jest-dom';import axios from 'axios';
import ManualTechnicalAnalysis from './ManualTechnicalAnalysis';import TechnicalResult from './TechnicalResult';import {invalidateTechnicalResultCache} from './technicalResultCache';
jest.mock('axios',()=>({post:jest.fn(),get:jest.fn()}));
beforeEach(()=>{jest.clearAllMocks();invalidateTechnicalResultCache();});
test('only an explicit manual click requests analysis below green and immediately refreshes the on-page progress',async()=>{
 const item={id:'manual-low',score:45},profile={terms:['drone']};let requested=false;
 const analysis={id:'j',status:'queued',stage_label:'Na fila'};
 axios.post.mockImplementation(async url=>{if(url.endsWith('/analyze')){requested=true;return{data:{analysis}};}return{data:{enabled:true,analysis:requested?analysis:null}};});
 render(<><ManualTechnicalAnalysis item={item} profile={profile}/><TechnicalResult overview item={item} profile={profile}/></>);
 await screen.findByText('Análise automática: aguardando elegibilidade e catálogo.');expect(axios.post.mock.calls.some(([url])=>url.endsWith('/analyze'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Analisar oportunidade'}));expect(await screen.findByText('Análise na fila')).toBeVisible();
 expect(axios.post).toHaveBeenCalledWith('/api/licitacoes/technical/notice/analyze',{item,profile});expect(item.score).toBe(45);
});
test('pipeline analysis uses the saved opportunity and reports errors without pretending it was queued',async()=>{
 axios.post.mockRejectedValue({response:{data:{error:'A análise está pausada. Retome em Produtos.'}}});
 render(<ManualTechnicalAnalysis opportunityId="9"/>);fireEvent.click(screen.getByRole('button',{name:'Analisar oportunidade'}));expect(await screen.findByRole('alert')).toHaveTextContent('Retome em Produtos');expect(axios.post).toHaveBeenCalledWith('/api/licitacoes/opportunities/9/technical/analyze',{});await waitFor(()=>expect(screen.getByRole('button',{name:'Analisar oportunidade'})).toBeEnabled());
});
