import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import axios from 'axios';
import CampaignWizard from './CampaignWizard';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
const proposal={summary:'Começar com um teste de catálogo',reason:'Usar disponibilidade e dados reais.',productSelection:'Catálogo elegível agrupado por aplicação.',audience:'Brasil; excluir compradores pagos.',platforms:[{platform:'google_ads',objective:'Vendas',reason:'Demanda existente.'}],creativeBriefs:[{title:'Oferta Aerion',format:'Imagem 4:5',prompt:'Usar logo oficial Aerion, fonte Montserrat e paleta cadastrada.',brandChecklist:['Logo real']}],unknowns:['Margem não informada'],evaluation:'Conferir compras pagas e custo.',nextAction:'Escolher as peças do Hub.'};
const base={assistant:{configured:true},products:[{id:'1',name:'Mini 7',eligible:true,availability:'in_stock'}],contents:[]};
beforeEach(()=>jest.clearAllMocks());
test('uncertain users and general catalog campaigns do not require choosing a product or trigger media generation',async()=>{
  axios.post.mockResolvedValue({data:{}});render(<CampaignWizard data={base} isAdmin/>);
  expect(screen.getByRole('radio',{name:/Me ajude a decidir/})).toBeChecked();expect(screen.queryByLabelText('Produto')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio',{name:/Vender o catálogo/}));fireEvent.click(screen.getByRole('button',{name:'Analisar nossa loja e recomendar'}));
  await waitFor(()=>expect(axios.post).toHaveBeenCalledTimes(1));expect(axios.post).toHaveBeenCalledWith('/api/ecommerce/marketing/assistant/plan',expect.objectContaining({scope:'catalog'}));expect(axios.post.mock.calls[0][1].productIds).toBeUndefined();
});
test('a contextual recommendation leads to brand briefings and the complete brand library without a generation request',async()=>{
  axios.get.mockResolvedValue({data:{total:1,offset:0,limit:24,items:[{filename:'minha-arte.png',dir:'assets',label:'Arte feita no meu workflow',url:'https://hub.test/a.png',contentType:'image/png',origin:'recebido',stage:'escolhido'}]}});
  render(<CampaignWizard data={{...base,assistant:{configured:true,latestPlan:{products:[{id:'1'}],advice:{proposal}}}}} isAdmin/>);
  fireEvent.click(screen.getByRole('button',{name:'2. Recomendação'}));expect(screen.getByText(proposal.summary)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Ver os briefings e escolher mídias'}));expect(screen.getByLabelText('Briefing Oferta Aerion')).toHaveValue(proposal.creativeBriefs[0].prompt);
  fireEvent.click(screen.getByRole('button',{name:'Consultar acervo'}));expect(await screen.findByText('Arte feita no meu workflow')).toBeInTheDocument();expect(axios.post).not.toHaveBeenCalled();
});
test('branding checks gate creative approval',()=>{
  render(<CampaignWizard data={{...base,assistant:{configured:true,latestPlan:{advice:{proposal}}},contents:[{id:'draft',kind:'creative',status:'draft',data:{name:'Peça Aerion',contentHub:{selectedAsset:{url:'https://hub.test/a.png',contentType:'image/png'}}}}]}} isAdmin/>);
  fireEvent.click(screen.getByRole('button',{name:'4. Revisar'}));expect(screen.getByRole('button',{name:'Aprovar esta peça'})).toBeDisabled();
  for(const checkbox of screen.getAllByRole('checkbox'))fireEvent.click(checkbox);
  expect(screen.getByRole('button',{name:'Aprovar esta peça'})).toBeEnabled();expect(axios.post).not.toHaveBeenCalled();
});
test('rules fallback is labelled and does not claim the model finished its analysis',()=>{
 render(<CampaignWizard data={{...base,assistant:{configured:true,latestPlan:{advice:{proposal,rulesBased:true,providerPending:true}}}}} isAdmin/>);
 fireEvent.click(screen.getByRole('button',{name:'2. Recomendação'}));expect(screen.getByRole('status')).toHaveTextContent('Proposta inicial por regras');expect(screen.getByRole('status')).toHaveTextContent('continua pendente');
});
