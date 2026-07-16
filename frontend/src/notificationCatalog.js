/** Espelho amigável do catálogo de notificações (backend/notifications.js). */

export const NOTIFICATION_CATEGORIES = [
  {
    id: 'licitacoes',
    label: 'Licitações',
    description: 'Sinais de watchlist, buscas PNCP e prazos do pipeline.',
  },
  {
    id: 'sistema',
    label: 'Sistema',
    description: 'Avisos técnicos e testes de push.',
  },
];

export const NOTIFICATION_TYPES = [
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
    type: 'pipeline.overdue',
    category: 'licitacoes',
    label: 'Licitação atrasada',
    description: 'Oportunidades no pipeline com prazo de proposta vencido.',
  },
  {
    type: 'pipeline.due_48h',
    category: 'licitacoes',
    label: 'Prazo nas próximas 48h',
    description: 'Oportunidades com prazo de envio de proposta em até 48 horas.',
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
