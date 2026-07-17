/** Espelho amigável do catálogo de notificações (backend/notifications.js). */

export const NOTIFICATION_CATEGORIES = [
  {
    id: 'funil',
    label: 'Funil e leads',
    description: 'Importações B2B, marcos do funil, ganhos/perdas e leads parados.',
  },
  {
    id: 'disparo',
    label: 'Disparo WhatsApp',
    description: 'Campanhas iniciadas, pausadas, canceladas ou com falha.',
  },
  {
    id: 'licitacoes',
    label: 'Licitações',
    description: 'Sinais de watchlist, buscas PNCP e prazos do pipeline.',
  },
  {
    id: 'metas',
    label: 'Metas',
    description: 'Alterações nas metas de receita.',
  },
  {
    id: 'dados',
    label: 'Dados e base',
    description: 'Importações RFB e manutenção da base local.',
  },
  {
    id: 'sistema',
    label: 'Sistema',
    description: 'Avisos técnicos e testes de push.',
  },
];

export const NOTIFICATION_TYPES = [
  {
    type: 'funil.lead_imported',
    category: 'funil',
    label: 'Leads importados (B2B)',
    description: 'Resumo ao importar contatos da Busca Lead B2B / CNPJ.',
  },
  {
    type: 'funil.won',
    category: 'funil',
    label: 'Lead ganho / novo cliente',
    description: 'Quando um lead vai para Fechado-Ganho ou Novos Clientes.',
  },
  {
    type: 'funil.lost',
    category: 'funil',
    label: 'Lead perdido ou descartado',
    description: 'Quando um lead vai para Fechado-Perdido ou Descartado.',
  },
  {
    type: 'funil.milestone',
    category: 'funil',
    label: 'Marcos do funil',
    description: 'Qualificado (SQL), Demo realizada ou Proposta enviada.',
  },
  {
    type: 'funil.stale_inbox',
    category: 'funil',
    label: 'Leads parados no Inbox',
    description: 'Digest diário de leads no Inbox (Novos) sem avanço.',
  },
  {
    type: 'disparo.started',
    category: 'disparo',
    label: 'Campanha iniciada',
    description: 'Quando um disparo WhatsApp é enfileirado com sucesso.',
  },
  {
    type: 'disparo.failed',
    category: 'disparo',
    label: 'Falha no disparo',
    description: 'Quando o envio da campanha falha ou nenhuma instância envia.',
  },
  {
    type: 'disparo.paused',
    category: 'disparo',
    label: 'Campanha pausada',
    description: 'Quando uma campanha em andamento é pausada.',
  },
  {
    type: 'disparo.cancelled',
    category: 'disparo',
    label: 'Campanha cancelada',
    description: 'Quando uma campanha é cancelada.',
  },
  {
    type: 'watchlist.edital_match',
    category: 'licitacoes',
    label: 'Novo edital na assinatura',
    description: 'Quando um edital PNCP casa com uma busca monitorada.',
  },
  {
    type: 'watchlist.pca_match',
    category: 'licitacoes',
    label: 'Novo item de PCA na assinatura',
    description: 'Quando um item de PCA casa com uma busca monitorada.',
  },
  {
    type: 'search.job_completed',
    category: 'licitacoes',
    label: 'Busca de editais concluída',
    description: 'Quando uma busca profunda PNCP termina.',
  },
  {
    type: 'pipeline.due_48h',
    category: 'licitacoes',
    label: 'Prazo de recurso em 3 dias úteis',
    description: 'Oportunidades com data limite de recurso (PNCP) nos próximos 3 dias úteis (calendário nacional BR).',
  },
  {
    type: 'pipeline.due_today',
    category: 'licitacoes',
    label: 'Prazo vence hoje',
    description: 'Oportunidades com prazo de envio de proposta (vencimento) no dia de hoje.',
  },
  {
    type: 'pipeline.opportunity_created',
    category: 'licitacoes',
    label: 'Nova oportunidade no pipeline',
    description: 'Quando uma licitação é criada no board de oportunidades.',
  },
  {
    type: 'metas.updated',
    category: 'metas',
    label: 'Meta de receita alterada',
    description: 'Quando um admin salva ou altera a meta mensal.',
  },
  {
    type: 'dados.rfb_import_done',
    category: 'dados',
    label: 'Import RFB concluído',
    description: 'Base da Receita Federal atualizada com sucesso.',
  },
  {
    type: 'dados.rfb_import_failed',
    category: 'dados',
    label: 'Import RFB falhou',
    description: 'A importação da base RFB terminou com erro.',
  },
  {
    type: 'system.test',
    category: 'sistema',
    label: 'Teste de push',
    description: 'Notificação de teste enviada pela página de configurações.',
  },
];

export const typesByCategory = (categoryId) =>
  NOTIFICATION_TYPES.filter((t) => t.category === categoryId);

export const typeLabel = (type) =>
  NOTIFICATION_TYPES.find((t) => t.type === type)?.label || type;
