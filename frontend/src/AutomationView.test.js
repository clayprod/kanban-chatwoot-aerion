import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import AutomationView from './AutomationView';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
test('prospecção mostra falha do ciclo mesmo sem novas decisões e distingue entrega de fila',async()=>{
 axios.get.mockImplementation(async url=>({data:url.startsWith('/api/prospeccao')?{
  config:{enabled:true,dry_run:false},hoje:{},
  runtime:{started_at:'2026-10-27T18:20:00Z',finished_at:'2026-10-27T18:21:00Z',summary:{avaliados:0,falhas:3,errosBusca:['Verificação de WhatsApp indisponível']}},
  decisoes:[{id:1,contact_name:'Empresa A',status:'abordado'},{id:2,contact_name:'Empresa B',status:'falhou',error:'Número não verificado'}],
 }:{config:{enabled:true},hoje:{},decisoes:[]}}));
 render(<AutomationView/>);
 fireEvent.click(await screen.findByRole('tab',{name:/Prospecção ativa/i}));
 expect(await screen.findByText('Verificação de WhatsApp indisponível')).toBeVisible();
 expect(screen.getByText(/0 empresas avaliadas · 0 abordagens preparadas · 3 falhas/)).toBeVisible();
 expect(screen.getByText('enviado')).toBeVisible();expect(screen.getByText('Número não verificado')).toBeVisible();
});
