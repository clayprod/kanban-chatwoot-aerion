import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';

import {
  DndContext,
  DragOverlay,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';
import './App.css';

// Configurar axios para enviar cookies em todas as requisições
axios.defaults.withCredentials = true;

const viewTabs = ['Overview', 'Board', 'Busca Lead B2B', 'Licitações', 'Processo'];
const leadColumns = [
  '1. Inbox (Novos)',
  '2. Em Contato',
  '3. Follow-up 1',
  '4. Follow-up 2',
  '5. Follow-up 3',
  '6. Qualificado (SQL)',
  '7. Agendamento Demo',
  '8. Demo Realizada',
  '9. Elaborando Proposta',
  '10. Proposta Enviada',
  '11. Em Negociação',
  '12. Aprovação Interna',
  '13. Fechado-Ganho',
  '14. Fechado-Perdido',
  '15. Pausado',
  '16. Descartado',
  '17. Nurturing',
];
const customerColumns = [
  '18. Novos Clientes',
  '19. Onboarding',
  '20. Ativo - Novo',
  '21. Ativo - Maduro (90d+)',
  '22. Oportunidade Upsell',
  '23. Oportunidade Recompra',
  '24. Em Risco',
  '25. Em Recompra',
  '26. Inativo',
];
const STAGE_GROUPS = [
  { id: 'topo',     label: 'Topo',            color: '#3B82F6', range: [1, 5] },
  { id: 'meio',     label: 'Meio',            color: '#8B5CF6', range: [6, 8] },
  { id: 'fundo',    label: 'Fundo',           color: '#F59E0B', range: [9, 12] },
  { id: 'outros',   label: 'Outros',          color: '#6B7280', range: [13, 17] },
  { id: 'recompra', label: 'Recompra/Upsell', color: '#10B981', range: [18, 26] },
];
const groupForStageNum = (n) => STAGE_GROUPS.find(g => n >= g.range[0] && n <= g.range[1]);
const colorForGroupLabel = (label) => (STAGE_GROUPS.find(g => g.label === label) || {}).color || '#6B7280';
const licitacaoColumns = [
  '1. Monitoramento de PCA',
  '2. Mapeamento de Áreas',
  '3. Apoio ao ETP / TR',
  '4. Cotação de Preços',
  '5. Gestão de ARPs',
  '6. Monitoramento de Edital',
  '7. Análise Técnica do Edital',
  '8. Impugnação',
  '9. Cadastro e Disputa',
  '10. Recurso',
  '11. Contrarazão',
  '12. Gestão de Contrato/Ata',
  '13. Perdido',
  '14. Não Atendido',
  '15. Descartado',
];

const processBlueprint = {
  stats: [
    { label: 'SQLs/mês', value: '240' },
    { label: 'Vendas/mês', value: '17' },
    { label: 'Receita/ano', value: 'R$ 6.2M' },
  ],
  map: [
    { title: 'Metas 2026', id: 'metas-2026' },
    { title: 'Visao geral', id: 'visao-geral' },
    { title: 'Pipeline ponta a ponta', id: 'pipeline' },
    { title: 'Checklist minimo', id: 'checklist' },
    { title: 'Prospecao (SDR)', id: 'prospeccao' },
    { title: 'Qualificacao', id: 'qualificacao' },
    { title: 'Vendas diretas (AE)', id: 'vendas-diretas' },
    { title: 'Gestao de canais', id: 'canais' },
    { title: 'Licitações públicas', id: 'licitacoes' },
    { title: 'Customer Success', id: 'customer-success' },
    { title: 'Rituais comerciais', id: 'rituais' },
    { title: 'Ferramentas e registros', id: 'ferramentas' },
    { title: 'ERP Sankhya', id: 'erp-sankhya' },
    { title: 'Documentacao complementar', id: 'documentacao' },
  ],
  pillars: [
    {
      title: 'Especializacao com clareza',
      text: 'Separar prospeccao, fechamento e pos-venda mesmo em time enxuto, mantendo a responsabilidade de cada etapa.'
    },
    {
      title: 'Processo previsivel e replicavel',
      text: 'Etapas, criterios e registros padronizados para facilitar onboarding e manter a consistencia.'
    },
    {
      title: 'Volume com qualidade',
      text: 'Cadencia estruturada e qualificacao rigorosa para concentrar esforco em oportunidades aderentes.'
    },
  ],
  overview: [
    'Todo lead precisa ter historico completo no CRM antes de avançar.',
    'BANT+U e ICP direcionam quem avanca e quem entra em nurturing.',
    'Handoff para CS acontece somente com contexto, riscos e proximos passos claros.'
  ],
  pipelineSteps: [
    {
      title: 'Recebimento e registro do lead',
      text: 'Consolidar dados, origem, etiquetas e responsavel no Chatwoot e registrar no pipeline.'
    },
    {
      title: 'Primeiro contato e cadencia inicial',
      text: 'Executar sequencia multicanal e registrar resultado, data e proximo passo.'
    },
    {
      title: 'Qualificacao BANT+U',
      text: 'Confirmar dor, decisor, orcamento e urgencia; decidir SQL ou nurture.'
    },
    {
      title: 'Agendamento com AE',
      text: 'Agendar demo, confirmar e transferir contexto completo para o AE.'
    },
    {
      title: 'Discovery e demo',
      text: 'Aprofundar diagnostico, mapear use case e definir criterios de sucesso.'
    },
    {
      title: 'Proposta e negociacao',
      text: 'Formalizar escopo, registrar condicoes e acompanhar objeções.'
    },
    {
      title: 'Fechamento e handoff',
      text: 'Registrar ganho/perda, iniciar fluxo no ERP e repassar contexto ao CS.'
    },
  ],
  checklist: [
    'Contato consolidado no Chatwoot com etiquetas e atributos atualizados.',
    'Etapa correta no funil, ultimo contato e proximo passo definidos.',
    'Registro de BANT+U e notas da conversa.',
    'Atividades e follow-ups agendados e confirmados.'
  ],
  streams: [
    {
      id: 'prospeccao',
      title: 'Prospeccao (SDR)',
      owner: 'SDR',
      objective: 'Transformar leads frios em SQLs prontos para AE.',
      inputs: 'Inbound, outbound e eventos.',
      outputs: 'Reunioes qualificadas e contexto registrado.',
      actions: [
        'Cadencia multicanal com registro de tentativas.',
        'Classificacao por ICP e sinais de interesse.',
        'Descartar ou nutrir quando nao houver fit.'
      ]
    },
    {
      id: 'qualificacao',
      title: 'Qualificacao de leads',
      owner: 'SDR/AE',
      objective: 'Garantir aderencia antes da demo.',
      inputs: 'Lead com historico e interacoes recentes.',
      outputs: 'Diagnostico documentado e decisao de avancar.',
      actions: [
        'Aplicar BANT+U e validar decisor.',
        'Documentar dores, urgencia e concorrentes.',
        'Definir proximos passos e risco principal.'
      ]
    },
    {
      id: 'vendas-diretas',
      title: 'Vendas diretas (AE)',
      owner: 'AE',
      objective: 'Converter SQL em cliente ativo.',
      inputs: 'SQL com contexto completo e agenda confirmada.',
      outputs: 'Proposta validada e handoff aprovado.',
      actions: [
        'Discovery estruturado e demo orientada a valor.',
        'Proposta com escopo, criterios e dependencias.',
        'Negociacao com registro de objeções.'
      ]
    },
    {
      id: 'canais',
      title: 'Gestao de canais',
      owner: 'Channel Manager',
      objective: 'Ativar parceiros e manter pipeline recorrente.',
      inputs: 'Parceiros com ICP e capacidade validada.',
      outputs: 'Parceiros ativos com planos de acao.',
      actions: [
        'Pre-qualificacao e onboarding rapido.',
        'Playbooks e check-ins regulares.',
        'Registro de performance e oportunidades.'
      ]
    },
    {
      id: 'licitacoes',
      title: 'Licitações públicas',
      owner: 'AE/Backoffice',
      objective: 'Competir de forma organizada e dentro do compliance.',
      inputs: 'Editais e requisitos mapeados.',
      outputs: 'Propostas formais e rastreabilidade completa.',
      actions: [
        'Checklist de documentos e prazos.',
        'Revisao tecnica e juridica quando aplicavel.',
        'Atualizacao do status no CRM.'
      ]
    },
    {
      id: 'customer-success',
      title: 'Customer Success',
      owner: 'CS',
      objective: 'Ativar, reter e expandir clientes.',
      inputs: 'Handoff completo do AE.',
      outputs: 'Plano de sucesso e rotina de acompanhamento.',
      actions: [
        'Onboarding com metas e indicadores de sucesso.',
        'Check-ins periodicos e registro de riscos.',
        'Plano de upsell e recompra quando houver fit.'
      ]
    },
  ],
  rituals: [
    {
      title: 'Daily comercial',
      cadence: 'Diario',
      focus: 'Prioridades, bloqueios e follow-ups criticos.'
    },
    {
      title: 'Revisao de pipeline',
      cadence: 'Semanal',
      focus: 'Qualidade das oportunidades e proximos passos.'
    },
    {
      title: 'Comite de propostas',
      cadence: 'Semanal',
      focus: 'Escopo, riscos e aprovacoes internas.'
    },
    {
      title: 'Revisao de canais',
      cadence: 'Mensal',
      focus: 'Performance de parceiros e planos de acao.'
    },
    {
      title: 'Handoff CS',
      cadence: 'Por fechamento',
      focus: 'Contexto completo, expectativas e riscos.'
    },
  ],
  tools: [
    { name: 'Chatwoot', purpose: 'Registro principal do contato e historico.' },
    { name: 'Trello', purpose: 'Pipeline e etapas visuais para time enxuto.' },
    { name: 'Google Sheets', purpose: 'Consolidacao e visao operacional.' },
    { name: 'n8n', purpose: 'Automacao de sincronizacoes e alertas.' },
    { name: 'Email/WhatsApp/LinkedIn', purpose: 'Canais de cadencia e follow-up.' },
    { name: 'ERP Sankhya', purpose: 'Fluxo administrativo apos fechamento.' },
  ],
  erp: [
    'Abrir cadastro do cliente com dados completos e validados.',
    'Registrar oportunidade ganha e documentos necessarios.',
    'Garantir que o CS tenha acesso a contratos e escopo.'
  ],
  documentation: [
    'Scripts de prospeccao e discovery por segmento.',
    'Modelos de email e proposta.',
    'Checklist de onboarding e health check.',
    'Playbooks de canais e licitacoes.'
  ],
  // Motor de Receita 2026
  revenueEngine: {
    formula: 'Receita = SQLs × Taxa de Conversão × Ticket Médio',
    annual: { revenue: 6200000, sales: 207, avgTicket: 30000 },
    monthly: { revenue: 516667, sales: 17, sqls: 240 },
    conversion: 0.07
  },
  // Metas SDR (2 SDRs)
  sdrGoals: {
    teamSize: 2,
    teamGoal: 240,
    individualGoal: 120,
    kpis: ['SQLs gerados', 'Taxa de contato']
  },
  // Metas AE (2 AEs)
  aeGoals: {
    teamSize: 2,
    teamGoal: 17,
    individualGoal: 9,
    revenueTeam: 510000,
    revenueIndividual: 255000,
    kpis: ['Taxa de conversão', 'Receita fechada']
  },
  // Funil
  funnel: [
    { stage: 'SQL', conversion: '100%', volume: 240 },
    { stage: 'Oportunidade', conversion: '50%', volume: 120 },
    { stage: 'Proposta', conversion: '30%', volume: 72 },
    { stage: 'Fechamento', conversion: '7%', volume: 17 }
  ]
};

const parseCurrency = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value)
    .replace(/[\sR$]/g, '')
    .trim();

  if (!raw) {
    return null;
  }

  let normalized = raw;
  if (raw.includes(',') && raw.includes('.')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const numeric = Number(normalized);
  if (Number.isNaN(numeric)) {
    return null;
  }
  return numeric;
};

const toPtBrDecimalInput = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const text = String(value).trim();
  if (!text || text.includes(',')) {
    return text;
  }
  if (/^-?\d+\.\d+$/.test(text)) {
    return text.replace('.', ',');
  }
  return text;
};

const toPtBrInputSafe = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    return value.replace(/\./g, ',');
  }
  return toPtBrDecimalInput(value);
};

const formatCurrency = (value) => {
  const numeric = parseCurrency(value);
  if (numeric === null) {
    return null;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(numeric);
};

const getBestEstimatedValue = (item) => {
  const values = [item?.valor_itens_pertinentes, item?.valor_total_estimado, item?.valor_global, item?.valor_total_homologado]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0);
  return values.length ? values[0] : null;
};

const toDateInputValue = (value) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
};

const toDateTimeLocalValue = (value) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const CHATWOOT_BASE_URL = 'https://chatwoot.tenryu.com.br';

const getChatwootContactUrl = (contact) => {
  if (!contact || !contact.id) {
    return null;
  }
  const accountId = contact.account_id || contact.accountId;
  if (!accountId) {
    return null;
  }
  return `${CHATWOOT_BASE_URL}/app/accounts/${accountId}/contacts/${contact.id}`;
};

const getFirstName = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.split(/\s+/)[0] || '';
};

const getCompanyContactDisplay = (companyName, personName, fallback = '') => {
  const company = String(companyName || '').trim();
  const firstName = getFirstName(personName);

  if (company) {
    if (firstName && normalizeText(firstName) !== normalizeText(company)) {
      return `${company} (${firstName})`;
    }
    return company;
  }

  if (String(personName || '').trim()) {
    return String(personName).trim();
  }

  return fallback;
};

const getContactSearchText = (contact) => {
  return normalizeText([
    contact?.company_name,
    contact?.name,
    getContactLabel(contact),
  ].filter(Boolean).join(' '));
};

const getContactLabel = (contact) => {
  const name = getCompanyContactDisplay(
    contact?.company_name,
    contact?.name,
    `Contato ${contact?.id || ''}`
  );
  return `${name} (#${contact?.id || ''})`;
};


const resolveContactIdFromInput = (inputValue, contactList = []) => {
  const text = String(inputValue || '').trim();
  if (!text) {
    return '';
  }

  const byTag = text.match(/#(\d+)/);
  if (byTag?.[1]) {
    return byTag[1];
  }

  const normalized = normalizeText(text);
  const exactMatch = contactList.find(contact => (
    normalizeText(getContactLabel(contact)) === normalized
    || normalizeText(contact?.company_name || contact?.name || '') === normalized
  ));

  return exactMatch ? String(exactMatch.id) : '';
};

const formatCompactNumber = (value) => {
  if (value === null || value === undefined) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value));
};

const formatCompactCurrency = (value) => {
  if (value === null || value === undefined) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value));
};

const truncateAxisLabel = (value, maxLength = 24) => {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
};

const getStageLabel = (stage) => {
  const text = String(stage || '');
  return text.replace(/^\d+\.\s*/, '').trim() || text;
};

const getStageNumber = (stage) => {
  const raw = String(stage || '').split('.')[0];
  const num = Number(raw.trim());
  return Number.isNaN(num) ? 999 : num;
};

const buildHistorySeries = (historyRows) => {
  if (!Array.isArray(historyRows) || historyRows.length === 0) {
    return [];
  }
  const periods = Array.from(new Set(historyRows.map(row => row.period_start))).sort();
  const stages = Array.from(new Set(historyRows.map(row => row.stage)))
    .sort((a, b) => getStageNumber(a) - getStageNumber(b));

  const counts = new Map();
  historyRows.forEach(row => {
    counts.set(`${row.stage}|${row.period_start}`, Number(row.count) || 0);
  });

  return stages.map(stage => ({
    id: stage,
    data: periods.map(period => ({
      x: period,
      y: counts.get(`${stage}|${period}`) || 0,
    })),
  }));
};

const buildGroupedHistorySeries = (historyRows) => {
  if (!Array.isArray(historyRows) || historyRows.length === 0) {
    return [];
  }
  const periods = Array.from(new Set(historyRows.map(row => row.period_start))).sort();
  const groupCounts = new Map();
  historyRows.forEach(row => {
    const num = getStageNumber(row.stage);
    const grp = groupForStageNum(num);
    if (!grp) return;
    const key = `${grp.id}|${row.period_start}`;
    groupCounts.set(key, (groupCounts.get(key) || 0) + (Number(row.count) || 0));
  });
  return STAGE_GROUPS.map(g => ({
    id: g.label,
    data: periods.map(period => ({
      x: period,
      y: groupCounts.get(`${g.id}|${period}`) || 0,
    })),
  }));
};

const normalizeText = (value) => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
};

const normalizePncpControlId = (value) => String(value || '').trim().toLowerCase();

const extractPncpPathKey = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    const parsed = new URL(text, 'https://pncp.gov.br');
    const match = parsed.pathname.match(/\/(?:app\/editais|editais|compras)\/([^/?#]+\/[^/?#]+\/[^/?#]+)/i);
    return String(match?.[1] || '').toLowerCase();
  } catch {
    return '';
  }
};

const extractUasgOptionsFromPncpItems = (items = []) => {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const codigo = String(item?.unidade?.codigo || item?.unidade_codigo || '').trim();
    if (!codigo) {
      return;
    }
    if (map.has(codigo)) {
      return;
    }
    const nome = String(item?.unidade?.nome || item?.unidade_nome || '').trim();
    const orgaoNome = String(item?.orgao?.nome || item?.orgao_nome || '').trim();
    map.set(codigo, {
      codigo,
      nome: nome || codigo,
      orgao_nome: orgaoNome || null,
    });
  });
  return Array.from(map.values()).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
};

const contactRoleOptions = [
  'Intermediário',
  'Contato técnico',
  'Contato administrativo',
  'Compras',
  'Jurídico',
  'Decisor',
  'Outro',
];

const getCookieValue = (name) => {
  const parts = String(document.cookie || '').split('; ').filter(Boolean);
  const match = parts.find(item => item.startsWith(`${name}=`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.split('=').slice(1).join('='));
};

const setCookieValue = (name, value, days) => {
  const maxAge = Number.isFinite(days) ? days * 86400 : 31536000;
  const encoded = encodeURIComponent(value);
  document.cookie = `${name}=${encoded}; max-age=${maxAge}; path=/; samesite=lax`;
};

const createEmptyOpportunityForm = () => ({
  titulo: '',
  fase: '1. Monitoramento de PCA',
  status: 'ativo',
  origem_oportunidade: 'direta',
  orgao_nome: '',
  orgao_cnpj: '',
  orgao_codigo: '',
  uasg_codigo: '',
  uasg_nome: '',
  modalidade: '',
  numero_edital: '',
  numero_processo_sei: '',
  numero_compra: '',
  item_tipo: 'material',
  codigo_item_catalogo: '',
  palavras_chave: '',
  valor_oportunidade: '',
  data_publicacao: '',
  data_sessao: '',
  data_envio_proposta_limite: '',
  data_assinatura_ata_limite: '',
  data_entrega_limite: '',
  prazo_entrega_dias_apos_assinatura: '',
  links_pncp: '',
  links_compras: '',
  links_sei: '',
  links_edital: '',
  intermediario_id: '',
  modelo_intermediacao: '',
  comissao_percentual: '',
  comissao_valor_previsto: '',
  valor_revenda_previsto: '',
  comentario_inicial: '',
  linked_contacts: [],
});


const CardPreview = ({ contact }) => {
  if (!contact) {
    return null;
  }
  const customAttributes = contact.custom_attributes || {};
  const statusLabel = customAttributes.Origem || customAttributes.Canal || 'On Track';
  const statusClass = 'bg-primary/10 text-primary';
  const secondaryName = contact.company_name ? contact.name : null;
  const cityLabel = contact.additional_attributes?.city || customAttributes.Cidade;
  const estadoLabel = customAttributes.Estado;
  const opportunityValue = customAttributes.Valor_Oportunidade;
  const formattedOpportunity = formatCurrency(opportunityValue);

  return (
    <div className="kanban-card is-overlay rounded-[14px] border border-border bg-card p-3.5 shadow-card">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 min-w-0">
        <h4 className="text-sm font-semibold text-ink leading-snug truncate">
          {contact.company_name || contact.name}
        </h4>
        {secondaryName && (
          <p className="text-xs text-muted mt-1 truncate">{secondaryName}</p>
        )}
        {(cityLabel || estadoLabel) && (
          <p className="text-xs text-muted mt-2 truncate">
            {cityLabel || 'Cidade nao informada'}{estadoLabel ? `, ${estadoLabel}` : ''}
          </p>
        )}
        {formattedOpportunity && (
          <p className="text-xs font-semibold text-ink mt-2 truncate">{formattedOpportunity}</p>
        )}
      </div>
    </div>
  );
};

const KanbanCard = ({ contact, columnId, showMenu, menuLabel, onMenuAction, onMoveToColumn, availableColumns, isDarkMode }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const sortableId = String(contact.id);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, data: { columnId } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const customAttributes = contact.custom_attributes || {};
  const statusLabel = customAttributes.Origem || customAttributes.Canal || 'On Track';
  const priorityLabel = customAttributes.Prioridade;
  const estadoLabel = customAttributes.Estado;
  const tipoClienteLabel = customAttributes.Tipo_Cliente;
  const secondaryName = contact.company_name ? contact.name : null;
  const cityLabel = contact.additional_attributes?.city || customAttributes.Cidade;
  const opportunityValue = customAttributes.Valor_Oportunidade;
  const agentName = contact.agent_name;

  const statusClass = 'bg-primary/10 text-primary';
  let priorityClass = 'bg-cardAlt text-muted border-border';
  const normalizedPriority = priorityLabel ? normalizeText(priorityLabel) : '';
  if (normalizedPriority) {
    if (normalizedPriority.includes('alta') || normalizedPriority.includes('high') || normalizedPriority.includes('quente')) {
      priorityClass = 'bg-status-danger/10 text-status-danger border-status-danger/20';
    } else if (normalizedPriority.includes('media') || normalizedPriority.includes('medium') || normalizedPriority.includes('morna')) {
      priorityClass = 'bg-status-warning/10 text-status-warning border-status-warning/20';
    } else if (normalizedPriority.includes('baixa') || normalizedPriority.includes('low') || normalizedPriority.includes('fria')) {
      priorityClass = 'bg-primary/10 text-primary border-primary/20';
    } else if (normalizedPriority.includes('nenhuma') || normalizedPriority.includes('nula')) {
      priorityClass = 'bg-cardAlt text-muted border-border';
    }
  }

  const getPriorityLabel = () => {
    if (!normalizedPriority) {
      return null;
    }
    if (normalizedPriority.includes('alta') || normalizedPriority.includes('high') || normalizedPriority.includes('quente')) {
      return 'Alta';
    }
    if (normalizedPriority.includes('media') || normalizedPriority.includes('medium') || normalizedPriority.includes('morna')) {
      return 'Média';
    }
    if (normalizedPriority.includes('baixa') || normalizedPriority.includes('low') || normalizedPriority.includes('fria')) {
      return 'Baixa';
    }
    if (normalizedPriority.includes('nenhuma') || normalizedPriority.includes('nula')) {
      return 'Nenhuma';
    }
    return priorityLabel;
  };

  const displayPriority = getPriorityLabel();

  const hexToRgba = (hex, alpha) => {
    if (!hex) {
      return null;
    }
    const normalized = hex.replace('#', '').trim();
    if (normalized.length !== 6) {
      return null;
    }
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) {
      return null;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const hexToRgb = (hex) => {
    if (!hex) {
      return null;
    }
    const normalized = hex.replace('#', '').trim();
    if (normalized.length !== 6) {
      return null;
    }
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) {
      return null;
    }
    return { r, g, b };
  };

  const rgbToHex = ({ r, g, b }) => {
    const toHex = (value) => value.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const mixWithBlack = (rgb, amount) => {
    return {
      r: Math.round(rgb.r * (1 - amount)),
      g: Math.round(rgb.g * (1 - amount)),
      b: Math.round(rgb.b * (1 - amount)),
    };
  };

  const mixWithWhite = (rgb, amount) => {
    return {
      r: Math.round(rgb.r + (255 - rgb.r) * amount),
      g: Math.round(rgb.g + (255 - rgb.g) * amount),
      b: Math.round(rgb.b + (255 - rgb.b) * amount),
    };
  };

  const getLuminance = (rgb) => {
    const toLinear = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = toLinear(rgb.r);
    const g = toLinear(rgb.g);
    const b = toLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const formattedOpportunity = formatCurrency(opportunityValue);
  const contactLink = getChatwootContactUrl(contact);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      className={`kanban-card rounded-[14px] border border-border bg-card p-3.5 shadow-card transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDragging ? 'is-dragging' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}`}>
          {statusLabel}
        </span>
        {showMenu && (
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              className="text-muted hover:text-ink"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(prev => !prev);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-6 z-10 min-w-[190px] rounded-xl border border-border bg-card p-2 shadow-card"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-cardAlt"
                  onClick={() => {
                    setMenuOpen(false);
                    onMenuAction?.(contact.id);
                  }}
                >
                  {menuLabel}
                </button>
                <div className="my-2 border-t border-border" />
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Enviar para...
                </p>
                <div className="max-h-56 overflow-y-auto pr-1 scrollbar-theme">
                  {(availableColumns || [])
                    .filter(column => column !== columnId)
                    .map(column => (
                      <button
                        key={column}
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-cardAlt"
                        onClick={() => {
                          setMenuOpen(false);
                          onMoveToColumn?.(contact.id, column);
                        }}
                      >
                        {column}
                      </button>
                    ))}
                  {availableColumns?.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted">Sem colunas disponiveis.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 min-w-0">
        {contactLink ? (
          <a
            href={contactLink}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-ink leading-snug hover:underline"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {contact.company_name || contact.name}
          </a>
        ) : (
          <h4 className="text-sm font-semibold text-ink leading-snug">
            {contact.company_name || contact.name}
          </h4>
        )}
        {secondaryName && (
          <p className="text-xs text-muted mt-1 truncate">{secondaryName}</p>
        )}
        {(cityLabel || estadoLabel) && (
          <p className="text-xs text-muted mt-2 truncate">
            {cityLabel || 'Cidade nao informada'}{estadoLabel ? `, ${estadoLabel}` : ''}
          </p>
        )}
        {formattedOpportunity && (
          <p className="text-xs font-semibold text-ink mt-2 truncate">{formattedOpportunity}</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 max-w-full">
        {displayPriority && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border max-w-full truncate ${priorityClass}`}>
            {displayPriority}
          </span>
        )}
        {tipoClienteLabel && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-cardAlt border border-border text-muted max-w-full truncate">
            {tipoClienteLabel}
          </span>
        )}
        {agentName && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-cardAlt border border-border text-muted max-w-full truncate">
            Agente: {agentName}
          </span>
        )}
        {Array.isArray(contact.labels) && contact.labels.map((label, index) => {
          const labelColor = label?.color;
          const rgb = hexToRgb(labelColor);
          const luminance = rgb ? getLuminance(rgb) : 0;
          const isVeryLight = luminance >= 0.75;
          const textShade = isDarkMode ? '#f8fafc' : '#0f172a';
          const borderShade = rgb
            ? (isDarkMode
              ? rgbToHex(mixWithWhite(rgb, 0.55))
              : rgbToHex(mixWithBlack(rgb, isVeryLight ? 0.35 : 0.2)))
            : '#cbd5f5';
          const background = rgb
            ? (isDarkMode
              ? hexToRgba(labelColor, luminance >= 0.58 ? 0.18 : 0.28)
              : hexToRgba(labelColor, isVeryLight ? 0.24 : 0.32))
            : (isDarkMode ? 'rgba(248, 250, 252, 0.12)' : 'rgba(15, 23, 42, 0.08)');
          return (
            <span
              key={`${label?.name || 'label'}-${index}`}
              className="text-xs px-2.5 py-1 rounded-full border font-semibold max-w-full truncate"
              style={{ backgroundColor: background, borderColor: borderShade, color: textShade }}
            >
              {label?.name || 'label'}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const KanbanColumn = ({ title, contacts, dotClass, showMenu, menuLabel, onMenuAction, onMoveToColumn, availableColumns, showHeaderMenu, newContactUrl, isDarkMode }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${title}` });
  const totalOpportunity = contacts.reduce((sum, contact) => {
    const value = parseCurrency(contact.custom_attributes?.Valor_Oportunidade);
    return value ? sum + value : sum;
  }, 0);
  const formattedTotal = totalOpportunity ? formatCurrency(totalOpportunity) : null;
  return (
    <div
      ref={setNodeRef}
      className={`kanban-column w-[280px] sm:w-[300px] lg:w-[320px] flex-shrink-0 rounded-2xl border border-border bg-cardAlt p-3 snap-start flex flex-col min-h-0 max-h-[300vh] transition ${isOver ? 'is-over' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-border bg-cardAlt sticky top-0 z-10">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} />
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-card text-muted">
              {contacts.length}
            </span>
          </div>
          {formattedTotal && (
            <span className="text-xs font-semibold text-ink">{formattedTotal}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {newContactUrl ? (
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-card"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                window.open(newContactUrl, '_blank', 'noreferrer');
              }}
              aria-label="Adicionar contato"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : (
            <button type="button" className="h-7 w-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-card">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          {showHeaderMenu && (
            <button type="button" className="h-7 w-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-card">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 kanban-column-scroll scrollbar-theme">
        <SortableContext items={contacts.map(c => String(c.id))}>
          {contacts.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted">
              Sem leads ainda.
            </div>
          )}
          {contacts.map(contact => (
            <KanbanCard
              key={contact.id}
              contact={contact}
              columnId={title}
              showMenu={showMenu}
              menuLabel={menuLabel}
              onMenuAction={onMenuAction}
              onMoveToColumn={onMoveToColumn}
              availableColumns={availableColumns}
              isDarkMode={isDarkMode}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
};

const LicitacaoCard = ({ opportunity, columnId, onOpen, onEdit }) => {
  const sortableId = `opp:${opportunity.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, data: { columnId } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const formattedValue = formatCurrency(opportunity.valor_oportunidade);
  const pncpOpportunityUrl = opportunity.links_pncp || opportunity?.links?.pncp || null;
  const itemCount = Number(opportunity.items_count || 0);
  const technicalRequirementsCount = Number(opportunity.technical_requirements_count || 0);
  const technicalPendingCount = Number(opportunity.technical_pending_count || 0);
  const technicalNonCompliantCount = Number(opportunity.technical_non_compliant_count || 0);
  const technicalItemsWithoutChecklistCount = Number(opportunity.technical_items_without_checklist_count || 0);
  const technicalBadge = technicalNonCompliantCount > 0
    ? { label: 'Não atende', className: 'border border-status-danger/30 bg-status-danger/10 text-status-danger' }
    : (itemCount === 0 || technicalRequirementsCount === 0 || technicalPendingCount > 0 || technicalItemsWithoutChecklistCount > 0)
      ? { label: 'Pendência Téc.', className: 'border border-status-warning/35 bg-status-warning/10 text-status-warning' }
      : { label: 'Atende', className: 'border border-status-success/30 bg-status-success/10 text-status-success' };
  const prazoClass = opportunity.prazo_status === 'atrasado'
    ? 'border border-status-danger/30 bg-status-danger/10 text-status-danger'
    : opportunity.prazo_status === 'vence_48h'
      ? 'border border-status-warning/35 bg-status-warning/10 text-status-warning'
      : opportunity.prazo_status === 'sem_data'
        ? 'border border-border bg-muted/20 text-muted'
        : 'border border-primary/30 bg-primary/10 text-primary';
  const prazoLabel = opportunity.prazo_status === 'atrasado'
    ? 'Prazo atrasado'
    : opportunity.prazo_status === 'vence_48h'
      ? 'Vence em 48h'
      : opportunity.prazo_status === 'sem_data'
        ? 'Sem prazo'
        : 'No prazo';
  const statusBadgeClass = opportunity.status === 'perdido' || opportunity.status === 'nao_atendido'
    ? 'border border-status-danger/30 bg-status-danger/10 text-status-danger'
    : opportunity.status === 'ganho'
      ? 'border border-status-success/30 bg-status-success/10 text-status-success'
      : 'border border-border bg-cardAlt text-muted';

  const formatDateShort = (dateStr) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  };

  const getDateStatus = (dateStr) => {
    if (!dateStr) return 'none';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffHours = (date - now) / (1000 * 60 * 60);
      if (diffHours < 0) return 'passed';
      if (diffHours <= 48) return 'urgent';
      if (diffHours <= 168) return 'soon';
      return 'ok';
    } catch {
      return 'none';
    }
  };

  const sessaoDate = formatDateShort(opportunity.data_sessao);
  const sessaoStatus = getDateStatus(opportunity.data_sessao);
  const propostaDate = formatDateShort(opportunity.data_envio_proposta_limite);
  const propostaStatus = getDateStatus(opportunity.data_envio_proposta_limite);

  const statusColors = {
    passed: 'text-status-danger',
    urgent: 'text-status-danger font-semibold',
    soon: 'text-status-warning',
    ok: 'text-muted',
    none: 'text-muted',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(opportunity)}
      className={`kanban-card rounded-[14px] border border-border bg-card p-3.5 shadow-card transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDragging ? 'is-dragging' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full leading-tight whitespace-nowrap ${prazoClass}`}>
            {prazoLabel}
          </span>
          <div className="flex items-center gap-2">
          <span className={`inline-flex items-center text-[10px] uppercase px-2 py-0.5 rounded-full leading-tight whitespace-nowrap ${statusBadgeClass}`}>{opportunity.status || 'ativo'}</span>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEdit?.(opportunity);
            }}
            className="h-6 w-6 rounded-md border border-border text-muted hover:text-ink hover:bg-cardAlt"
            title="Editar card"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 20h4l10-10-4-4L4 16v4z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mt-2">
        <h4 className="text-sm font-semibold text-ink leading-snug truncate">
          {pncpOpportunityUrl ? (
            <a
              href={pncpOpportunityUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {opportunity.titulo}
            </a>
          ) : opportunity.titulo}
        </h4>
        <p className="text-xs text-muted mt-1 truncate">{opportunity.orgao_nome || 'Órgão não definido'}</p>
      </div>
      <div className="mt-2 space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted">Sessão:</span>
          <span className={statusColors[sessaoStatus]}>{sessaoDate || 'não definida'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Proposta:</span>
          <span className={statusColors[propostaStatus]}>{propostaDate || 'não definida'}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-xs">
        <span className="text-muted truncate">Edital: {opportunity.numero_edital || 'n/d'}</span>
        <span className="font-semibold text-ink">{formattedValue || 'R$ 0,00'}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold leading-tight ${technicalBadge.className}`}>{technicalBadge.label}</span>
        <span className="text-muted truncate">
          {technicalRequirementsCount > 0 ? `${technicalRequirementsCount} requisitos` : 'Checklist não criado'}
        </span>
      </div>
    </div>
  );
};

const LicitacaoColumn = ({ title, opportunities, onOpen, onEdit }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `licitacao-column:${title}` });
  const totalValue = opportunities.reduce((sum, item) => sum + (parseCurrency(item.valor_oportunidade) || 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={`kanban-column w-[280px] sm:w-[300px] lg:w-[320px] flex-shrink-0 rounded-2xl border border-border bg-cardAlt p-3 snap-start flex flex-col min-h-0 max-h-[300vh] transition ${isOver ? 'is-over' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-border bg-cardAlt sticky top-0 z-10">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-secondary" />
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-card text-muted">{opportunities.length}</span>
          </div>
          <span className="text-xs font-semibold text-ink">{formatCurrency(totalValue) || 'R$ 0,00'}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 kanban-column-scroll scrollbar-theme">
        <SortableContext items={opportunities.map(o => `opp:${o.id}`)}>
          {opportunities.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted">
              Sem oportunidades nesta etapa.
            </div>
          )}
          {opportunities.map(opportunity => (
            <LicitacaoCard
              key={opportunity.id}
              opportunity={opportunity}
              columnId={title}
              onOpen={onOpen}
              onEdit={onEdit}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
};

function App() {
  const [contacts, setContacts] = useState([]);
  const [licitacaoOpportunities, setLicitacaoOpportunities] = useState([]);
  const [licitacaoLoading, setLicitacaoLoading] = useState(false);
  const [licitacaoSearch, setLicitacaoSearch] = useState('');
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [selectedCommercialRequirements, setSelectedCommercialRequirements] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [itemRequirementsMap, setItemRequirementsMap] = useState({});
  const [selectedLinkedContacts, setSelectedLinkedContacts] = useState([]);
  const [newOpportunityForm, setNewOpportunityForm] = useState(createEmptyOpportunityForm);
  const [showNewOpportunityForm, setShowNewOpportunityForm] = useState(false);
  const [newOpportunityContact, setNewOpportunityContact] = useState({ contact_id: '', papel: '', observacao: '' });
  const [newOpportunityContactQuery, setNewOpportunityContactQuery] = useState('');
  const [orgaoLookupQuery, setOrgaoLookupQuery] = useState('');
  const [uasgLookupQuery, setUasgLookupQuery] = useState('');
  const [modalidadeLookupQuery, setModalidadeLookupQuery] = useState('');
  const [catalogoLookupQuery, setCatalogoLookupQuery] = useState('');
  const [newOpportunityItemForm, setNewOpportunityItemForm] = useState({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', custo_total_item: '' });
  const [newOpportunityItemsDraft, setNewOpportunityItemsDraft] = useState([]);
  const [newOpportunityItemRequirementForm, setNewOpportunityItemRequirementForm] = useState({});
  const [orgaoOptions, setOrgaoOptions] = useState([]);
  const [uasgOptions, setUasgOptions] = useState([]);
  const [uasgSource, setUasgSource] = useState(''); // 'pncp' ou 'compras.gov'
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [modalidadeOptions, setModalidadeOptions] = useState([]);
  const [modoDisputaOptions, setModoDisputaOptions] = useState([]);
  const [tipoInstrumentoOptions, setTipoInstrumentoOptions] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [newRequirementForm, setNewRequirementForm] = useState({ titulo: '' });
  const [newItemForm, setNewItemForm] = useState({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', unidade: '', valor_referencia: '', custo_total_item: '' });
  const [expandedDraftChecklist, setExpandedDraftChecklist] = useState({});
  const [checklistModalItemId, setChecklistModalItemId] = useState(null);
  const [newItemRequirementForm, setNewItemRequirementForm] = useState({});
  const [itemRequirementCostInputMap, setItemRequirementCostInputMap] = useState({});
  const [itemQuantityInputMap, setItemQuantityInputMap] = useState({});
  const [itemReferenceInputMap, setItemReferenceInputMap] = useState({});
  const [contactLinkForm, setContactLinkForm] = useState({ contact_id: '', papel: '', observacao: '' });
  const [contactLinkQuery, setContactLinkQuery] = useState('');
  const [selectedComments, setSelectedComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [selectedOpportunityValueInput, setSelectedOpportunityValueInput] = useState('');
  // PNCP Search state
  const [pncpSearchFilters, setPncpSearchFilters] = useState({
    q: '',
    tipos_documento: 'edital',
    status: 'recebendo_proposta',
    modalidade_licitacao_id: '',
    tipo_id: '',
    modo_disputa_id: '',
    uf: '',
    esfera_id: '',
    orgao_cnpj: '',
    unidade_codigo: '',
    ordenacao: 'valor_desc_data_desc',
    usar_ia: true, // Busca inteligente com termos correlatos
  });
  const [pncpSearchResults, setPncpSearchResults] = useState({ items: [], total: 0, pagina: 1, totalPaginas: 0, termosUsados: [], termosNegativos: [], fonteIA: null });
  const [pncpSearchLoading, setPncpSearchLoading] = useState(false);
  const [pncpOrgaoLookupQuery, setPncpOrgaoLookupQuery] = useState('');
  const [pncpUasgLookupQuery, setPncpUasgLookupQuery] = useState('');
  const [pncpOrgaoOptions, setPncpOrgaoOptions] = useState([]);
  const [pncpUasgOptions, setPncpUasgOptions] = useState([]);
  const [pncpOrgaoLookupLoading, setPncpOrgaoLookupLoading] = useState(false);
  const [pncpUasgLookupLoading, setPncpUasgLookupLoading] = useState(false);
  const [pncpSearchExpanded, setPncpSearchExpanded] = useState(true);
  const [pncpImportingId, setPncpImportingId] = useState(null);
  const [isPncpImportDraft, setIsPncpImportDraft] = useState(false);
  const [pncpHiddenIds, setPncpHiddenIds] = useState(() => {
    try {
      const stored = localStorage.getItem('pncp_hidden_ids');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showPncpHidden, setShowPncpHidden] = useState(false);

  // ── Busca Lead B2B (RFB Local) ──────────────────────────────
  const [rfbStatus, setRfbStatus] = useState(null); // null=carregando, false=não importado, objeto=importado
  const [rfbFilters, setRfbFilters] = useState(() => { const _rfbDef = { cnpj: '', nome: '', socio: '', uf: '', municipio: '', cnae: [], cnaeNot: [], situacao: ['2'], porte: '', natureza: [] }; try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); const saved = s.filters || {}; const sit = saved.situacao; const situacao = Array.isArray(sit) ? sit : (sit ? [sit] : ['2']); const cn = saved.cnae; const cnae = Array.isArray(cn) ? cn : (cn ? [cn] : []); const cnn = saved.cnaeNot; const cnaeNot = Array.isArray(cnn) ? cnn : []; const nat = saved.natureza; const natureza = Array.isArray(nat) ? nat : (nat ? [nat] : []); return { ..._rfbDef, ...saved, situacao, cnae, cnaeNot, natureza }; } catch { return _rfbDef; } });
  const [rfbOps, setRfbOps] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.ops || { nome: 'contains', socio: 'contains' }; } catch { return { nome: 'contains', socio: 'contains' }; } });
  const [rfbCapitalRange, setRfbCapitalRange] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.capitalRange || [0, 0]; } catch { return [0, 0]; } });
  const [rfbAberturaRange, setRfbAberturaRange] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.aberturaRange || [0, 0]; } catch { return [0, 0]; } });
  const [rfbEndereco, setRfbEndereco] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.endereco || ''; } catch { return ''; } });
  const [rfbEnderecoOp, setRfbEnderecoOp] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.enderecoOp || 'contains'; } catch { return 'contains'; } });
  const [rfbSimples, setRfbSimples] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.simples ?? ''; } catch { return ''; } });
  const [rfbMei, setRfbMei] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.mei || ''; } catch { return ''; } });
  const [rfbOnlyMatriz, setRfbOnlyMatriz] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.onlyMatriz !== false; } catch { return true; } });
  const [rfbNome2, setRfbNome2] = useState('');
  const [rfbNome2Op, setRfbNome2Op] = useState('contains');
  const [rfbNomeLogic, setRfbNomeLogic] = useState('AND');
  const [rfbNomeExpanded, setRfbNomeExpanded] = useState(false);
  const [rfbSocio2, setRfbSocio2] = useState('');
  const [rfbSocio2Op, setRfbSocio2Op] = useState('contains');
  const [rfbSocioLogic, setRfbSocioLogic] = useState('AND');
  const [rfbSocioExpanded, setRfbSocioExpanded] = useState(false);
  const [rfbEndereco2, setRfbEndereco2] = useState('');
  const [rfbEndereco2Op, setRfbEndereco2Op] = useState('contains');
  const [rfbEnderecoLogic, setRfbEnderecoLogic] = useState('AND');
  const [rfbEnderecoExpanded, setRfbEnderecoExpanded] = useState(false);
  const [rfbShowFilters, setRfbShowFilters] = useState(false);
  const [rfbFiliais, setRfbFiliais] = useState({}); // cnpjBasico → filiais[]
  const [rfbResults, setRfbResults] = useState([]);
  const [rfbTotal, setRfbTotal] = useState(0);
  const [rfbPage, setRfbPage] = useState(1);
  const [rfbPageSize, setRfbPageSize] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.pageSize || 10; } catch { return 10; } });
  const [rfbOrderBy, setRfbOrderBy] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return s.orderBy || 'razao_social'; } catch { return 'razao_social'; } });
  const [rfbLoading, setRfbLoading] = useState(false);
  const [rfbError, setRfbError] = useState(null);
  const rfbCacheRef = useRef({ results: [], total: 0, key: null });
  const [rfbMunicipios, setRfbMunicipios] = useState([]);
  const [rfbCnaes, setRfbCnaes] = useState([]);
  const [rfbNaturezas, setRfbNaturezas] = useState([]);
  const [rfbExpanded, setRfbExpanded] = useState(null);
  const [rfbCnaeInput, setRfbCnaeInput] = useState('');
  const [rfbCnaeNotInput, setRfbCnaeNotInput] = useState('');
  const [rfbCnaeDropdownOpen, setRfbCnaeDropdownOpen] = useState(false);
  const [rfbCnaeNotDropdownOpen, setRfbCnaeNotDropdownOpen] = useState(false);
  const [rfbCnaeOnlyPrincipal, setRfbCnaeOnlyPrincipal] = useState(() => { try { const s = JSON.parse(localStorage.getItem('rfb_search') || '{}'); return !!s.cnaeOnlyPrincipal; } catch { return false; } });
  const [rfbNatInput, setRfbNatInput] = useState('');
  const [rfbMunicipioInput, setRfbMunicipioInput] = useState('');
  const [rfbMunicipioDropdownOpen, setRfbMunicipioDropdownOpen] = useState(false);
  const [rfbImportProgress, setRfbImportProgress] = useState(null); // null | { status, message, file, percent, records, error }
  const [leadExistingCNPJs, setLeadExistingCNPJs] = useState({});
  const [leadImportSettings, setLeadImportSettings] = useState({ defaultStage: '1. Inbox (Novos)', overwriteDuplicates: false });
  const [leadImportStatus, setLeadImportStatus] = useState(null);
  const [leadImportLoading, setLeadImportLoading] = useState(false);
  const [rfbImportDialog, setRfbImportDialog] = useState(null); // null | { row, isDup }
  const [rfbImportDialogStage, setRfbImportDialogStage] = useState('1. Inbox (Novos)');
  const [rfbImportDialogLabels, setRfbImportDialogLabels] = useState([]);
  const [rfbImportDialogSocio, setRfbImportDialogSocio] = useState('');
  const [rfbImportDialogTel1, setRfbImportDialogTel1] = useState('');
  const [rfbImportDialogEmail, setRfbImportDialogEmail] = useState('');
  const [rfbImportDialogRegimes, setRfbImportDialogRegimes] = useState({ simples: false, mei: false, presumido: false, real: false });
  const [rfbSavedFilters, setRfbSavedFilters] = useState(() => { try { return JSON.parse(localStorage.getItem('rfb_saved_filters') || '[]'); } catch { return []; } });
  const [rfbSaveFilterName, setRfbSaveFilterName] = useState('');
  const [chatwootLabels, setChatwootLabels] = useState([]);
  const [rfbReimportConfirm, setRfbReimportConfirm] = useState(false);
  const [rfbUpdateConfirm, setRfbUpdateConfirm] = useState(false);
  const [rfbEnriching, setRfbEnriching] = useState({}); // cnpj → true|'done'|'error'
  // ─────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState('leads');
  const [activeView, setActiveView] = useState('Board');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const stored = getCookieValue('theme');
    return stored === 'dark';
  });
  const [authStatus, setAuthStatus] = useState({ checked: false, authenticated: false, email: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [sortOption, setSortOption] = useState('opportunity-desc');
  const [historyGranularity, setHistoryGranularity] = useState('week');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewData, setOverviewData] = useState({
    summary: null,
    licitacaoSummary: null,
    byStage: [],
    byLabel: [],
    byState: [],
    byAgent: [],
    byChannel: [],
    byCustomerType: [],
    byProbability: [],
    history: [],
  });
  const [boardScrollMetrics, setBoardScrollMetrics] = useState({ scrollWidth: 0, clientWidth: 0 });
  const boardScrollRef = useRef(null);
  const boardScrollbarRef = useRef(null);
  const groupBarRef = useRef(null);
  const isSyncingRef = useRef(false);
  const dragScrollRafRef = useRef(null);
  const dragPointerXRef = useRef(null);
  const isDraggingRef = useRef(false);
  const lastPointerXRef = useRef(null);
  const [activeDragId, setActiveDragId] = useState(null);

  const getItemParticipationTotal = (item) => {
    const quantidade = parseCurrency(item?.quantidade);
    const valorReferencia = parseCurrency(item?.valor_referencia);
    if (quantidade === null || valorReferencia === null) {
      return null;
    }
    return Number((quantidade * valorReferencia).toFixed(2));
  };

  const itemsParticipationTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + (getItemParticipationTotal(item) || 0), 0),
    [selectedItems]
  );

  const hasItemsDrivingOpportunityValue = useMemo(
    () => selectedItems.some(item => getItemParticipationTotal(item) !== null),
    [selectedItems]
  );

  useEffect(() => {
    setSelectedOpportunityValueInput(toPtBrDecimalInput(selectedOpportunity?.valor_oportunidade));
  }, [selectedOpportunity?.id, selectedOpportunity?.valor_oportunidade]);

  useEffect(() => {
    let isMounted = true;
    axios.get('/api/auth/status')
      .then(response => {
        if (!isMounted) {
          return;
        }
        setAuthStatus({
          checked: true,
          authenticated: Boolean(response.data?.authenticated),
          email: response.data?.email || '',
        });
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setAuthStatus({ checked: true, authenticated: false, email: '' });
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error?.response?.status === 401) {
          setAuthStatus({ checked: true, authenticated: false, email: '' });
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated) {
      return;
    }
    axios.get('/api/contacts')
      .then(response => {
        setContacts(response.data);
      })
      .catch(error => {
        console.error('Error fetching contacts:', error);
      });
  }, [authStatus.authenticated]);

  // Carrega status RFB + listas de referência ao entrar na aba Busca Lead B2B
  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Busca Lead B2B') return;
    axios.get('/api/rfb/status').then(r => setRfbStatus(r.data)).catch(() => setRfbStatus(false));
    axios.get('/api/rfb/import-progress').then(r => setRfbImportProgress(r.data)).catch(() => {});
    if (rfbMunicipios.length === 0) axios.get('/api/rfb/municipios').then(r => setRfbMunicipios(r.data || [])).catch(() => {});
    if (rfbCnaes.length === 0) axios.get('/api/rfb/cnaes').then(r => setRfbCnaes(r.data || [])).catch(() => {});
    if (rfbNaturezas.length === 0) axios.get('/api/rfb/naturezas').then(r => setRfbNaturezas(r.data || [])).catch(() => {});
    axios.get('/api/leads/existing-cnpjs').then(r => setLeadExistingCNPJs(r.data || {})).catch(() => {});
  }, [activeView, authStatus.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll import progress while running; refresh status when done
  useEffect(() => {
    if (activeView !== 'Busca Lead B2B' || !authStatus.authenticated) return;
    const status = rfbImportProgress?.status;
    // If already done, just refresh rfbStatus once
    if (status === 'done') {
      axios.get('/api/rfb/status').then(s => setRfbStatus(s.data)).catch(() => {});
      return;
    }
    // If not imported yet, poll DB counts every 15s regardless of progress state
    if (!rfbStatus?.imported) {
      const id = setInterval(() => {
        axios.get('/api/rfb/status').then(s => {
          setRfbStatus(s.data);
          if (s.data.imported) {
            axios.get('/api/rfb/municipios').then(r => setRfbMunicipios(r.data || [])).catch(() => {});
            axios.get('/api/rfb/cnaes').then(r => setRfbCnaes(r.data || [])).catch(() => {});
          }
        }).catch(() => {});
      }, 15000);
      return () => clearInterval(id);
    }
    if (status !== 'running') return;
    const id = setInterval(() => {
      axios.get('/api/rfb/import-progress').then(r => {
        setRfbImportProgress(r.data);
        if (r.data.status === 'done') {
          axios.get('/api/rfb/status').then(s => setRfbStatus(s.data)).catch(() => {});
          axios.get('/api/rfb/municipios').then(s => setRfbMunicipios(s.data || [])).catch(() => {});
          axios.get('/api/rfb/cnaes').then(s => setRfbCnaes(s.data || [])).catch(() => {});
        }
      }).catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [rfbImportProgress?.status, activeView, authStatus.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLicitacoes = useCallback(async () => {
    setLicitacaoLoading(true);
    try {
      const opportunitiesResponse = await axios.get('/api/licitacoes/opportunities');
      setLicitacaoOpportunities(opportunitiesResponse.data || []);
    } catch (error) {
      console.error('Error loading licitacoes:', error);
    } finally {
      setLicitacaoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated) {
      return;
    }
    loadLicitacoes();
  }, [authStatus.authenticated, loadLicitacoes]);

  // Carregar modalidades para a busca do PNCP quando a aba Licitações estiver ativa
  const [pncpFiltersLoaded, setPncpFiltersLoaded] = useState(false);
  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Licitações') {
      return;
    }
    if (pncpFiltersLoaded) {
      return; // Já carregado com sucesso
    }
    const loadPncpFilters = async () => {
      try {
        console.log('[PNCP Filters] Carregando opções de filtros...');
        const [modalidadesResult, modosResult, tiposResult] = await Promise.allSettled([
          axios.get('/api/licitacoes/pncp/modalidades', { params: { tamanhoPagina: 200 } }),
          axios.get('/api/licitacoes/pncp/modos-disputa', { params: { tamanhoPagina: 200 } }),
          axios.get('/api/licitacoes/pncp/tipos-instrumentos', { params: { tamanhoPagina: 200 } }),
        ]);

        let loadedCount = 0;

        if (modalidadesResult.status === 'fulfilled') {
          const options = Array.isArray(modalidadesResult.value.data)
            ? modalidadesResult.value.data.filter(item => item && (item.id || item.nome))
            : [];
          console.log('[PNCP Filters] Modalidades carregadas:', options.length);
          setModalidadeOptions(options);
          if (options.length > 0) loadedCount++;
        } else {
          console.error('[PNCP Filters] Error loading modalidades:', modalidadesResult.reason);
        }

        if (modosResult.status === 'fulfilled') {
          const options = Array.isArray(modosResult.value.data)
            ? modosResult.value.data.filter(item => item && (item.id || item.nome))
            : [];
          console.log('[PNCP Filters] Modos de disputa carregados:', options.length);
          setModoDisputaOptions(options);
          if (options.length > 0) loadedCount++;
        } else {
          console.error('[PNCP Filters] Error loading modos de disputa:', modosResult.reason);
        }

        if (tiposResult.status === 'fulfilled') {
          const options = Array.isArray(tiposResult.value.data)
            ? tiposResult.value.data.filter(item => item && (item.id || item.nome))
            : [];
          console.log('[PNCP Filters] Tipos de instrumento carregados:', options.length);
          setTipoInstrumentoOptions(options);
          if (options.length > 0) loadedCount++;
        } else {
          console.error('[PNCP Filters] Error loading tipos de instrumentos:', tiposResult.reason);
        }

        // Marcar como carregado se pelo menos um teve sucesso
        if (loadedCount > 0) {
          setPncpFiltersLoaded(true);
        }
      } catch (error) {
        console.error('[PNCP Filters] Error loading PNCP filter options:', error);
      }
    };
    loadPncpFilters();
  }, [authStatus.authenticated, activeView, pncpFiltersLoaded]);

  useEffect(() => {
    if (!showNewOpportunityForm || !authStatus.authenticated) {
      return;
    }

    let cancelled = false;
    const fetchLookupOptions = async () => {
      setLookupLoading(true);
      try {
        const orgaoQuery = String(orgaoLookupQuery || newOpportunityForm.orgao_nome || '').trim();
        const [orgaoResult, catalogResult, modalidadeResult] = await Promise.allSettled([
          orgaoQuery.length >= 2
            ? axios.get('/api/licitacoes/pncp/orgaos', {
                params: {
                  q: orgaoQuery,
                  tamanhoPagina: 100,
                },
              })
            : Promise.resolve({ data: [] }),
          axios.get('/api/licitacoes/pncp/catalogos', { params: { tamanhoPagina: 200 } }),
          axios.get('/api/licitacoes/pncp/modalidades', { params: { tamanhoPagina: 200 } }),
        ]);

        if (cancelled) {
          return;
        }

        const orgaos = orgaoResult.status === 'fulfilled' && Array.isArray(orgaoResult.value.data) ? orgaoResult.value.data : [];
        setOrgaoOptions(orgaos);
        if (catalogResult.status === 'fulfilled') {
          setCatalogOptions(Array.isArray(catalogResult.value.data) ? catalogResult.value.data : []);
        }
        if (modalidadeResult.status === 'fulfilled') {
          setModalidadeOptions(Array.isArray(modalidadeResult.value.data) ? modalidadeResult.value.data.filter(item => item && (item.id || item.nome)) : []);
        }

        const orgaoCnpjDigits = String(newOpportunityForm.orgao_cnpj || '').replace(/\D/g, '');
        if (orgaoCnpjDigits) {
          // Tentar PNCP primeiro
          const unitsResponse = await axios.get(`/api/licitacoes/pncp/orgaos/${orgaoCnpjDigits}/unidades`, {
            params: { tamanhoPagina: 200 },
          });
          const pncpUnits = Array.isArray(unitsResponse.data) ? unitsResponse.data : [];

          if (!cancelled) {
            if (pncpUnits.length > 0) {
              setUasgOptions(pncpUnits);
              setUasgSource('pncp');
            } else {
              // Fallback para Compras.gov se PNCP não retornar unidades
              try {
                const comprasResponse = await axios.get('/api/licitacoes/compras/uasgs', {
                  params: { cnpj: orgaoCnpjDigits },
                });
                const comprasUnits = Array.isArray(comprasResponse.data) ? comprasResponse.data.map(u => ({
                  codigo: u.codigoUasg || u.codigo,
                  nome: u.nomeUasg || u.nome || '',
                })) : [];
                setUasgOptions(comprasUnits);
                setUasgSource(comprasUnits.length > 0 ? 'compras.gov' : '');
              } catch (fallbackError) {
                console.error('Fallback Compras.gov também falhou:', fallbackError);
                setUasgOptions([]);
                setUasgSource('');
              }
            }
          }
        } else {
          const uasgQuery = String(uasgLookupQuery || '').trim();
          if (uasgQuery.length >= 2) {
            try {
              const searchResponse = await axios.get('/api/licitacoes/pncp/search', {
                params: {
                  q: uasgQuery,
                  pagina: 1,
                  tam: 100,
                  usar_ia: true,
                },
              });
              const extracted = extractUasgOptionsFromPncpItems(searchResponse.data?.items || []);
              setUasgOptions(extracted);
              setUasgSource(extracted.length > 0 ? 'pncp' : '');
            } catch (uasgError) {
              console.error('Error searching UASG directly:', uasgError);
              setUasgOptions([]);
              setUasgSource('');
            }
          } else {
            setUasgOptions([]);
            setUasgSource('');
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading dropdown options:', error);
        }
      } finally {
        if (!cancelled) {
          setLookupLoading(false);
        }
      }
    };

    fetchLookupOptions();

    return () => {
      cancelled = true;
    };
  }, [
    authStatus.authenticated,
    showNewOpportunityForm,
    orgaoLookupQuery,
    newOpportunityForm.orgao_nome,
    newOpportunityForm.orgao_cnpj,
    newOpportunityForm.item_tipo,
    newOpportunityForm.uasg_codigo,
    uasgLookupQuery,
    newOpportunityForm.codigo_item_catalogo,
  ]);

  useEffect(() => {
    if (!showNewOpportunityForm) {
      return;
    }
    setOrgaoLookupQuery(newOpportunityForm.orgao_nome || '');
  }, [showNewOpportunityForm, newOpportunityForm.orgao_nome]);

  useEffect(() => {
    if (!showNewOpportunityForm) {
      return;
    }
    if (newOpportunityForm.uasg_codigo || newOpportunityForm.uasg_nome) {
      setUasgLookupQuery(`${newOpportunityForm.uasg_codigo || ''}${newOpportunityForm.uasg_nome ? ` - ${newOpportunityForm.uasg_nome}` : ''}`.trim());
    }
  }, [showNewOpportunityForm, newOpportunityForm.uasg_codigo, newOpportunityForm.uasg_nome]);

  useEffect(() => {
    if (!showNewOpportunityForm) {
      return;
    }
    setModalidadeLookupQuery(newOpportunityForm.modalidade || '');
  }, [showNewOpportunityForm, newOpportunityForm.modalidade]);

  useEffect(() => {
    if (!showNewOpportunityForm) {
      return;
    }
    if (newOpportunityForm.codigo_item_catalogo) {
      const selected = catalogOptions.find(option => String(option.codigo) === String(newOpportunityForm.codigo_item_catalogo));
      setCatalogoLookupQuery(selected ? `${selected.codigo} - ${selected.descricao}` : String(newOpportunityForm.codigo_item_catalogo));
    }
  }, [showNewOpportunityForm, newOpportunityForm.codigo_item_catalogo, catalogOptions]);

  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Licitações') {
      return;
    }
    const query = String(pncpOrgaoLookupQuery || '').trim();
    if (query.length < 2) {
      setPncpOrgaoOptions([]);
      setPncpOrgaoLookupLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPncpOrgaoLookupLoading(true);
      try {
        const response = await axios.get('/api/licitacoes/pncp/orgaos', {
          params: {
            q: query,
            tamanhoPagina: 100,
          },
        });
        if (!cancelled) {
          setPncpOrgaoOptions(Array.isArray(response.data) ? response.data : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading PNCP orgaos lookup:', error);
          setPncpOrgaoOptions([]);
        }
      } finally {
        if (!cancelled) {
          setPncpOrgaoLookupLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authStatus.authenticated, activeView, pncpOrgaoLookupQuery]);

  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Licitações') {
      return;
    }
    const cnpj = String(pncpSearchFilters.orgao_cnpj || '').replace(/\D/g, '');
    const uasgQuery = String(pncpUasgLookupQuery || '').trim();

    let cancelled = false;
    const loadUnits = async () => {
      setPncpUasgLookupLoading(true);
      try {
        if (cnpj) {
          const response = await axios.get(`/api/licitacoes/pncp/orgaos/${cnpj}/unidades`, {
            params: { tamanhoPagina: 200 },
          });
          if (!cancelled) {
            setPncpUasgOptions(Array.isArray(response.data) ? response.data : []);
          }
          return;
        }

        if (uasgQuery.length < 2) {
          if (!cancelled) {
            setPncpUasgOptions([]);
          }
          return;
        }

        const response = await axios.get('/api/licitacoes/pncp/search', {
          params: {
            q: uasgQuery,
            pagina: 1,
            tam: 100,
            usar_ia: true,
          },
        });
        if (!cancelled) {
          const extracted = extractUasgOptionsFromPncpItems(response.data?.items || []);
          setPncpUasgOptions(extracted);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading PNCP UASG lookup:', error);
          setPncpUasgOptions([]);
        }
      } finally {
        if (!cancelled) {
          setPncpUasgLookupLoading(false);
        }
      }
    };

    loadUnits();
    return () => {
      cancelled = true;
    };
  }, [authStatus.authenticated, activeView, pncpSearchFilters.orgao_cnpj, pncpUasgLookupQuery]);

  useEffect(() => {
    const selected = pncpOrgaoOptions.find(item => String(item.cnpj || '') === String(pncpSearchFilters.orgao_cnpj || ''));
    if (selected && !pncpOrgaoLookupQuery) {
      setPncpOrgaoLookupQuery(selected.nome || selected.cnpj || '');
    }
  }, [pncpSearchFilters.orgao_cnpj, pncpOrgaoOptions, pncpOrgaoLookupQuery]);

  useEffect(() => {
    const selected = pncpUasgOptions.find(item => String(item.codigo || '') === String(pncpSearchFilters.unidade_codigo || ''));
    if (selected && !pncpUasgLookupQuery) {
      setPncpUasgLookupQuery(`${selected.codigo} - ${selected.nome || selected.codigo}`);
    }
  }, [pncpSearchFilters.unidade_codigo, pncpUasgOptions, pncpUasgLookupQuery]);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDarkMode);
    document.documentElement.classList.toggle('theme-dark', isDarkMode);
    setCookieValue('theme', isDarkMode ? 'dark' : 'light', 365);
  }, [isDarkMode]);

  useEffect(() => {
    if (activeView !== 'Board' && activeView !== 'Licitações') {
      return undefined;
    }
    const updateMetrics = () => {
      if (!boardScrollRef.current) {
        return;
      }
      setBoardScrollMetrics({
        scrollWidth: boardScrollRef.current.scrollWidth,
        clientWidth: boardScrollRef.current.clientWidth,
      });
    };

    updateMetrics();

    if (!boardScrollRef.current || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMetrics);
      return () => window.removeEventListener('resize', updateMetrics);
    }

    const observer = new ResizeObserver(updateMetrics);
    observer.observe(boardScrollRef.current);
    return () => observer.disconnect();
  }, [activeTab, activeView, contacts.length, licitacaoOpportunities.length]);

  useEffect(() => {
    if (activeView !== 'Overview' || !authStatus.authenticated) {
      return;
    }
    setOverviewLoading(true);
    const range = historyGranularity === 'day' ? 30 : historyGranularity === 'month' ? 12 : 12;
    Promise.all([
      axios.get('/api/overview/summary'),
      axios.get('/api/overview/by-stage'),
      axios.get('/api/overview/by-label'),
      axios.get('/api/overview/by-state'),
      axios.get('/api/overview/by-agent'),
      axios.get('/api/overview/by-channel'),
      axios.get('/api/overview/by-customer-type'),
      axios.get('/api/overview/by-probability'),
      axios.get('/api/overview/history', { params: { granularity: historyGranularity, range } }),
      axios.get('/api/licitacoes/overview/summary'),
    ])
      .then(([summary, byStage, byLabel, byState, byAgent, byChannel, byCustomerType, byProbability, history, licitacaoSummary]) => {
        setOverviewData({
          summary: summary.data,
          licitacaoSummary: licitacaoSummary.data,
          byStage: byStage.data,
          byLabel: byLabel.data,
          byState: byState.data,
          byAgent: byAgent.data,
          byChannel: byChannel.data,
          byCustomerType: byCustomerType.data,
          byProbability: byProbability.data,
          history: history.data,
        });
      })
      .catch(error => {
        console.error('Error fetching overview data:', error);
      })
      .finally(() => {
        setOverviewLoading(false);
      });
  }, [activeView, historyGranularity, authStatus.authenticated]);

  const filteredContacts = contacts.filter(contact => {
    const search = searchQuery.trim().toLowerCase();
    const matchesSearch = !search || [
      contact.company_name,
      contact.name,
      contact.agent_name,
      contact.additional_attributes?.city,
      contact.custom_attributes?.Estado,
      contact.custom_attributes?.Tipo_Cliente,
      ...(Array.isArray(contact.labels) ? contact.labels.map(label => label?.name) : []),
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(search));

    const priority = normalizeText(contact.custom_attributes?.Prioridade || '');
    const matchesPriority = priorityFilter === 'all'
      || (priorityFilter === 'alta' && (priority.includes('alta') || priority.includes('quente') || priority.includes('high')))
      || (priorityFilter === 'media' && (priority.includes('media') || priority.includes('morna') || priority.includes('medium')))
      || (priorityFilter === 'baixa' && (priority.includes('baixa') || priority.includes('fria') || priority.includes('low')))
      || (priorityFilter === 'nenhuma' && (priority.includes('nenhuma') || priority.includes('nula') || priority.length === 0));

    const agentName = String(contact.agent_name || '').trim();
    const matchesAgent = agentFilter === 'all'
      || normalizeText(agentName) === normalizeText(agentFilter);

    const contactLabels = Array.isArray(contact.labels) ? contact.labels.map(l => l?.name).filter(Boolean) : [];
    const matchesLabel = labelFilter === 'all'
      || contactLabels.some(name => normalizeText(name) === normalizeText(labelFilter));

    return matchesSearch && matchesPriority && matchesAgent && matchesLabel;
  });

  const filteredContactsForNewOpportunity = useMemo(() => {
    const query = normalizeText(newOpportunityContactQuery).trim();
    const list = !query
      ? contacts
      : contacts.filter(contact => {
          const searchText = getContactSearchText(contact);
          return searchText.includes(query);
        });
    return list.slice(0, 150);
  }, [contacts, newOpportunityContactQuery]);

  const filteredContactsForEditLink = useMemo(() => {
    const query = normalizeText(contactLinkQuery).trim();
    const list = !query
      ? contacts
      : contacts.filter(contact => {
          const searchText = getContactSearchText(contact);
          return searchText.includes(query);
        });
    return list.slice(0, 150);
  }, [contacts, contactLinkQuery]);

  const filteredOrgaoOptions = useMemo(() => {
    const query = normalizeText(orgaoLookupQuery || newOpportunityForm.orgao_nome || '').trim();
    if (!query) return orgaoOptions.slice(0, 150);
    return orgaoOptions.filter(option => normalizeText(`${option.nome || ''} ${option.cnpj || ''}`).includes(query)).slice(0, 150);
  }, [orgaoOptions, orgaoLookupQuery, newOpportunityForm.orgao_nome]);

  const filteredUasgOptions = useMemo(() => {
    const query = normalizeText(uasgLookupQuery || '').trim();
    if (!query) return uasgOptions.slice(0, 200);
    return uasgOptions.filter(option => normalizeText(`${option.codigo || ''} ${option.nome || ''}`).includes(query)).slice(0, 200);
  }, [uasgOptions, uasgLookupQuery]);

  const filteredModalidadeOptions = useMemo(() => {
    const query = normalizeText(modalidadeLookupQuery || '').trim();
    if (!query) return modalidadeOptions;
    return modalidadeOptions.filter(option => normalizeText(option.nome || '').includes(query));
  }, [modalidadeOptions, modalidadeLookupQuery]);

  const filteredCatalogOptions = useMemo(() => {
    const query = normalizeText(catalogoLookupQuery || '').trim();
    if (!query) return catalogOptions.slice(0, 200);
    return catalogOptions.filter(option => normalizeText(`${option.codigo || ''} ${option.descricao || ''}`).includes(query)).slice(0, 200);
  }, [catalogOptions, catalogoLookupQuery]);

  const filteredPncpOrgaoOptions = useMemo(() => {
    const query = normalizeText(pncpOrgaoLookupQuery || '').trim();
    if (!query) {
      return pncpOrgaoOptions.slice(0, 150);
    }
    return pncpOrgaoOptions
      .filter(option => normalizeText(`${option.nome || ''} ${option.cnpj || ''}`).includes(query))
      .slice(0, 150);
  }, [pncpOrgaoOptions, pncpOrgaoLookupQuery]);

  const filteredPncpUasgOptions = useMemo(() => {
    const query = normalizeText(pncpUasgLookupQuery || '').trim();
    if (!query) {
      return pncpUasgOptions.slice(0, 200);
    }
    return pncpUasgOptions
      .filter(option => normalizeText(`${option.codigo || ''} ${option.nome || ''}`).includes(query))
      .slice(0, 200);
  }, [pncpUasgOptions, pncpUasgLookupQuery]);

  const selectedPncpOrgao = useMemo(() => {
    if (!pncpSearchFilters.orgao_cnpj) {
      return null;
    }
    return pncpOrgaoOptions.find(item => String(item.cnpj || '') === String(pncpSearchFilters.orgao_cnpj)) || null;
  }, [pncpOrgaoOptions, pncpSearchFilters.orgao_cnpj]);

  const selectedPncpUasg = useMemo(() => {
    if (!pncpSearchFilters.unidade_codigo) {
      return null;
    }
    return pncpUasgOptions.find(item => String(item.codigo || '') === String(pncpSearchFilters.unidade_codigo)) || null;
  }, [pncpUasgOptions, pncpSearchFilters.unidade_codigo]);

  const pncpInPipelineIndex = useMemo(() => {
    const controls = new Set();
    const paths = new Set();
    const ids = new Set();

    licitacaoOpportunities.forEach(opportunity => {
      const metadata = opportunity?.metadados || {};
      const controlCandidates = [
        opportunity?.numero_compra,
        metadata?.pncp_numero_controle,
      ];
      controlCandidates.forEach(candidate => {
        const normalized = normalizePncpControlId(candidate);
        if (normalized) {
          controls.add(normalized);
        }
      });

      const idCandidate = String(metadata?.pncp_id || '').trim();
      if (idCandidate) {
        ids.add(idCandidate);
      }

      const pathCandidates = [
        opportunity?.links_pncp,
        opportunity?.links?.pncp,
      ];
      pathCandidates.forEach(candidate => {
        const pathKey = extractPncpPathKey(candidate);
        if (pathKey) {
          paths.add(pathKey);
        }
      });
    });

    return { controls, paths, ids };
  }, [licitacaoOpportunities]);

  const visiblePncpResults = useMemo(() => {
    return (pncpSearchResults.items || []).filter(item => {
      if (pncpHiddenIds.includes(item.id)) {
        return false;
      }
      const controlId = normalizePncpControlId(item.numero_controle_pncp);
      if (controlId && pncpInPipelineIndex.controls.has(controlId)) {
        return false;
      }
      const pathKey = extractPncpPathKey(item.url || item.item_url);
      if (pathKey && pncpInPipelineIndex.paths.has(pathKey)) {
        return false;
      }
      const itemId = String(item.id || '').trim();
      if (itemId && pncpInPipelineIndex.ids.has(itemId)) {
        return false;
      }
      return true;
    });
  }, [pncpSearchResults.items, pncpHiddenIds, pncpInPipelineIndex]);

  const agentOptions = useMemo(() => {
    const names = contacts
      .map(contact => String(contact.agent_name || '').trim())
      .filter(Boolean);
    const unique = Array.from(new Set(names));
    unique.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    return unique;
  }, [contacts]);

  const labelOptions = useMemo(() => {
    const allLabels = contacts
      .flatMap(contact => Array.isArray(contact.labels) ? contact.labels.map(l => l?.name) : [])
      .filter(Boolean);
    const unique = Array.from(new Set(allLabels));
    unique.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    return unique;
  }, [contacts]);

  const sortContacts = (list) => {
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortOption === 'name-asc') {
        return String(a.company_name || a.name || '').localeCompare(String(b.company_name || b.name || ''));
      }
      if (sortOption === 'name-desc') {
        return String(b.company_name || b.name || '').localeCompare(String(a.company_name || a.name || ''));
      }
      if (sortOption === 'opportunity-desc') {
        const aVal = parseCurrency(a.custom_attributes?.Valor_Oportunidade) || 0;
        const bVal = parseCurrency(b.custom_attributes?.Valor_Oportunidade) || 0;
        return bVal - aVal;
      }
      if (sortOption === 'opportunity-asc') {
        const aVal = parseCurrency(a.custom_attributes?.Valor_Oportunidade) || 0;
        const bVal = parseCurrency(b.custom_attributes?.Valor_Oportunidade) || 0;
        return aVal - bVal;
      }
      return 0;
    });
    return sorted;
  };

  const getContactsForColumn = (columnName) => {
    const columnContacts = filteredContacts.filter(contact => contact.custom_attributes?.Funil_Vendas === columnName);
    return sortContacts(columnContacts);
  };

  const activeColumns = activeTab === 'leads' ? leadColumns : customerColumns;
  const dotClass = activeTab === 'leads' ? 'bg-primary' : 'bg-secondary';
  const showMenu = true;
  const showHeaderMenu = activeTab === 'leads';
  const menuLabel = activeTab === 'leads' ? 'Enviar para novos clientes' : 'Voltar para Inbox';
  const newContactUrl = activeTab === 'customers'
    ? 'https://chatwoot.tenryu.com.br/app/accounts/2/contacts?page=1'
    : null;

  const filteredLicitacaoOpportunities = useMemo(() => {
    const search = normalizeText(licitacaoSearch);
    const list = licitacaoOpportunities.filter(item => {
      if (!search) {
        return true;
      }
      const values = [
        item.titulo,
        item.orgao_nome,
        item.uasg_codigo,
        item.numero_edital,
        item.numero_processo_sei,
        item.codigo_item_catalogo,
        item.intermediario_razao_social,
      ]
        .filter(Boolean)
        .map(value => normalizeText(value));
      return values.some(value => value.includes(search));
    });

    return list.sort((a, b) => {
      const aStage = getStageNumber(a.fase);
      const bStage = getStageNumber(b.fase);
      if (aStage !== bStage) {
        return aStage - bStage;
      }
      return String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR', { sensitivity: 'base' });
    });
  }, [licitacaoOpportunities, licitacaoSearch]);

  const getOpportunitiesForColumn = (columnName) => {
    return filteredLicitacaoOpportunities.filter(item => item.fase === columnName);
  };

  const moveOpportunityToStage = async (opportunityId, targetStage) => {
    if (!targetStage) {
      return;
    }
    const previous = licitacaoOpportunities;
    setLicitacaoOpportunities(prev => prev.map(item => (
      String(item.id) === String(opportunityId)
        ? { ...item, fase: targetStage }
        : item
    )));
    try {
      await axios.put(`/api/licitacoes/opportunities/${opportunityId}`, { fase: targetStage });
    } catch (error) {
      console.error('Error moving licitacao opportunity:', error);
      setLicitacaoOpportunities(previous);
    }
  };

  const createOpportunity = async () => {
    if (!newOpportunityForm.titulo.trim()) {
      return;
    }
    try {
      const linkedContacts = Array.isArray(newOpportunityForm.linked_contacts)
        ? newOpportunityForm.linked_contacts
            .map(item => ({
              contact_id: Number(item.contact_id),
              papel: item.papel,
              principal: Boolean(item.principal),
              observacao: item.observacao || null,
            }))
            .filter(item => Number.isFinite(item.contact_id))
        : [];

      const payload = {
        ...newOpportunityForm,
        orgao_codigo: newOpportunityForm.orgao_codigo || newOpportunityForm.orgao_cnpj || null,
        valor_oportunidade: newOpportunityForm.valor_oportunidade
          ? parseCurrency(newOpportunityForm.valor_oportunidade)
          : null,
        comissao_percentual: newOpportunityForm.comissao_percentual
          ? Number(String(newOpportunityForm.comissao_percentual).replace(',', '.'))
          : null,
        comissao_valor_previsto: newOpportunityForm.comissao_valor_previsto
          ? Number(String(newOpportunityForm.comissao_valor_previsto).replace(',', '.'))
          : null,
        valor_revenda_previsto: newOpportunityForm.valor_revenda_previsto
          ? Number(String(newOpportunityForm.valor_revenda_previsto).replace(',', '.'))
          : null,
        intermediario_id: newOpportunityForm.intermediario_id ? Number(newOpportunityForm.intermediario_id) : null,
        palavras_chave: newOpportunityForm.palavras_chave,
        links: {
          edital: newOpportunityForm.links_edital || null,
          pncp: newOpportunityForm.links_pncp || null,
          compras: newOpportunityForm.links_compras || null,
          sei: newOpportunityForm.links_sei || null,
        },
        linked_contacts: linkedContacts,
      };
      const response = await axios.post('/api/licitacoes/opportunities', payload);
      const created = response.data;

      for (const item of newOpportunityItemsDraft) {
        if (!String(item?.descricao || '').trim()) {
          continue;
        }

        let createdItem;
        try {
          const createdItemResponse = await axios.post(`/api/licitacoes/opportunities/${created.id}/items`, {
            numero_item: item.numero_item,
            descricao: item.descricao,
            modelo_produto: item.modelo_produto,
            quantidade: parseCurrency(item.quantidade),
            unidade: item.unidade,
            valor_referencia: parseCurrency(item.valor_referencia),
            custo_total_item: parseCurrency(item.custo_total_item),
          });
          createdItem = createdItemResponse.data;
        } catch (itemError) {
          console.error('Error creating imported item:', itemError, item);
          continue;
        }

        const requirements = Array.isArray(item.requirements) ? item.requirements : [];
        for (const req of requirements) {
          if (!String(req?.requisito || '').trim()) {
            continue;
          }
          try {
            await axios.post(`/api/licitacoes/opportunities/${created.id}/items/${createdItem.id}/requirements`, {
              requisito: req.requisito,
              status: req.status,
              observacao: req.observacao,
              valor_ofertado: req.custo_subitem,
            });
          } catch (reqError) {
            console.error('Error creating imported item requirement:', reqError, req);
          }
        }
      }

      if (String(newOpportunityForm.comentario_inicial || '').trim()) {
        await axios.post(`/api/licitacoes/opportunities/${created.id}/comments`, {
          content: newOpportunityForm.comentario_inicial,
        });
      }

      setLicitacaoOpportunities(prev => [response.data, ...prev]);
      setShowNewOpportunityForm(false);
      setIsPncpImportDraft(false);
      setNewOpportunityForm(createEmptyOpportunityForm());
      setNewOpportunityContact({ contact_id: '', papel: '', observacao: '' });
      setNewOpportunityItemForm({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', custo_total_item: '' });
      setNewOpportunityItemsDraft([]);
      setNewOpportunityItemRequirementForm({});
      setExpandedDraftChecklist({});
      setChecklistModalItemId(null);
    } catch (error) {
      console.error('Error creating licitacao opportunity:', error);
    }
  };

  const addDraftItem = () => {
    if (!newOpportunityItemForm.descricao.trim()) {
      return;
    }
    const draftId = `draft-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setNewOpportunityItemsDraft(prev => ([
      ...prev,
      {
        id: draftId,
        numero_item: newOpportunityItemForm.numero_item || null,
        descricao: newOpportunityItemForm.descricao,
        modelo_produto: newOpportunityItemForm.modelo_produto || null,
        quantidade: parseCurrency(newOpportunityItemForm.quantidade),
        valor_referencia: null,
        custo_total_item: parseCurrency(newOpportunityItemForm.custo_total_item),
        requirements: [],
      },
    ]));
    setNewOpportunityItemForm({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', custo_total_item: '' });
  };

  const removeDraftItem = (draftId) => {
    setNewOpportunityItemsDraft(prev => prev.filter(item => item.id !== draftId));
    setNewOpportunityItemRequirementForm(prev => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
  };

  const updateDraftItem = (draftId, changes) => {
    setNewOpportunityItemsDraft(prev => prev.map(item => (item.id === draftId ? { ...item, ...changes } : item)));
  };

  const addDraftItemRequirement = (draftId) => {
    const form = newOpportunityItemRequirementForm[draftId] || { requisito: '' };
    if (!String(form.requisito || '').trim()) {
      return;
    }
    setNewOpportunityItemsDraft(prev => prev.map(item => (
      item.id === draftId
        ? {
            ...item,
            requirements: [
              ...(item.requirements || []),
              {
                id: `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                requisito: form.requisito,
                status: form.status || 'verificar',
                observacao: form.observacao || null,
                custo_subitem: form.custo_subitem ? parseCurrency(form.custo_subitem) : null,
                ordem: (item.requirements || []).length,
              },
            ],
          }
        : item
    )));
    setNewOpportunityItemRequirementForm(prev => ({
      ...prev,
      [draftId]: { requisito: '', status: 'verificar', observacao: '', custo_subitem: '' },
    }));
  };

  const removeDraftItemRequirement = (draftId, requirementId) => {
    setNewOpportunityItemsDraft(prev => prev.map(item => (
      item.id === draftId
        ? { ...item, requirements: (item.requirements || []).filter(req => req.id !== requirementId) }
        : item
    )));
  };

  const addContactToNewOpportunity = () => {
    const resolvedId = String(
      newOpportunityContact.contact_id
      || resolveContactIdFromInput(newOpportunityContactQuery, filteredContactsForNewOpportunity)
      || resolveContactIdFromInput(newOpportunityContactQuery, contacts)
      || ''
    );

    if (!resolvedId) {
      return;
    }
    setNewOpportunityForm(prev => {
      const alreadyExists = prev.linked_contacts.some(
        item => String(item.contact_id) === resolvedId
      );
      if (alreadyExists) {
        return prev;
      }
      return {
        ...prev,
        linked_contacts: [
          ...prev.linked_contacts,
          {
            contact_id: Number(resolvedId),
            papel: newOpportunityContact.papel || null,
            observacao: newOpportunityContact.observacao || null,
            principal: prev.linked_contacts.length === 0,
          },
        ],
      };
    });
    setNewOpportunityContact({ contact_id: '', papel: '', observacao: '' });
    setNewOpportunityContactQuery('');
  };

  const removeContactFromNewOpportunity = (contactId) => {
    setNewOpportunityForm(prev => {
      const next = prev.linked_contacts.filter(item => String(item.contact_id) !== String(contactId));
      if (next.length > 0 && !next.some(item => item.principal)) {
        next[0] = { ...next[0], principal: true };
      }
      return { ...prev, linked_contacts: next };
    });
  };

  const setPrincipalContactForNewOpportunity = (contactId) => {
    setNewOpportunityForm(prev => ({
      ...prev,
      linked_contacts: prev.linked_contacts.map(item => ({
        ...item,
        principal: String(item.contact_id) === String(contactId),
      })),
    }));
  };

  // Buscar editais/licitações no PNCP
  const runPncpSearch = async (page = 1) => {
    setPncpSearchLoading(true);
    try {
      const response = await axios.get('/api/licitacoes/pncp/search', {
        params: {
          q: pncpSearchFilters.q,
          tipos_documento: pncpSearchFilters.tipos_documento,
          status: pncpSearchFilters.status,
          modalidade_licitacao_id: pncpSearchFilters.modalidade_licitacao_id || undefined,
          tipo_id: pncpSearchFilters.tipo_id || undefined,
          modo_disputa_id: pncpSearchFilters.modo_disputa_id || undefined,
          uf: pncpSearchFilters.uf || undefined,
          esfera_id: pncpSearchFilters.esfera_id || undefined,
          orgao_cnpj: pncpSearchFilters.orgao_cnpj || (String(pncpOrgaoLookupQuery || '').trim().length >= 2 ? pncpOrgaoLookupQuery : undefined),
          unidade_codigo: pncpSearchFilters.unidade_codigo || (String(pncpUasgLookupQuery || '').trim().length >= 2 ? pncpUasgLookupQuery : undefined),
          ordenacao: pncpSearchFilters.ordenacao,
          usar_ia: pncpSearchFilters.usar_ia ? 'true' : 'false',
          pagina: page,
          tam: 50,
        },
      });
      setPncpSearchResults(response.data || { items: [], total: 0, pagina: 1, totalPaginas: 0, termosUsados: [], termosNegativos: [], fonteIA: null });
    } catch (error) {
      console.error('Error searching PNCP:', error);
      setPncpSearchResults({ items: [], total: 0, pagina: 1, totalPaginas: 0, termosUsados: [], termosNegativos: [], fonteIA: null });
    } finally {
      setPncpSearchLoading(false);
    }
  };

  // Ocultar item da busca PNCP
  const hidePncpItem = (itemId) => {
    const newHidden = [...pncpHiddenIds, itemId];
    setPncpHiddenIds(newHidden);
    localStorage.setItem('pncp_hidden_ids', JSON.stringify(newHidden));
  };

  // Restaurar item oculto
  const restorePncpItem = (itemId) => {
    const newHidden = pncpHiddenIds.filter(id => id !== itemId);
    setPncpHiddenIds(newHidden);
    localStorage.setItem('pncp_hidden_ids', JSON.stringify(newHidden));
  };

  // Restaurar todos os itens ocultos
  const restoreAllPncpItems = () => {
    setPncpHiddenIds([]);
    localStorage.removeItem('pncp_hidden_ids');
  };

  const mapPncpImportItemsToDraft = (items = []) => {
    return (Array.isArray(items) ? items : [])
      .map(entry => {
        const descricao = String(
          entry?.descricao
          || entry?.descricaoItem
          || entry?.objetoCompra
          || entry?.nomeItem
          || ''
        ).trim();
        return { ...entry, __descricao_resolvida: descricao };
      })
      .filter(entry => String(entry.__descricao_resolvida || '').trim())
      .map((entry, index) => ({
        id: `pncp-item-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
        numero_item: String(entry?.numero_item || entry?.numeroItem || '').trim() || null,
        descricao: String(entry.__descricao_resolvida || '').trim(),
        modelo_produto: null,
        quantidade: Number.isFinite(Number(entry?.quantidade)) ? Number(entry.quantidade) : null,
        unidade: String(entry?.unidade || entry?.unidadeMedida || '').trim() || null,
        valor_referencia: Number.isFinite(Number(entry?.valor_referencia ?? entry?.valor_unitario_estimado ?? entry?.valorUnitarioEstimado))
          ? Number(entry.valor_referencia ?? entry.valor_unitario_estimado ?? entry.valorUnitarioEstimado)
          : null,
        custo_total_item: Number.isFinite(Number(entry?.custo_total_item ?? entry?.valor_total ?? entry?.valorTotal))
          ? Number(entry.custo_total_item ?? entry.valor_total ?? entry.valorTotal)
          : null,
        requirements: [],
      }));
  };

  const fetchAllPncpItemsForImport = async (item) => {
    const cnpj = String(item?.orgao?.cnpj || '').replace(/\D/g, '');
    const ano = String(item?.ano || '').trim();
    const sequencial = String(item?.numero_sequencial || '').trim();
    if (!cnpj || !ano || !sequencial) {
      return [];
    }

    const pageSize = 100;
    const maxPages = 20;
    const allItems = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const response = await axios.get(`/api/licitacoes/pncp/compra/${cnpj}/${ano}/${sequencial}/itens`, {
        params: {
          pagina: page,
          tamanhoPagina: pageSize,
        },
      });
      const pageItems = Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data)
          ? response.data
          : [];

      if (pageItems.length === 0) {
        break;
      }
      allItems.push(...pageItems);
      if (pageItems.length < pageSize) {
        break;
      }
    }

    return allItems;
  };

  // Importar licitação do PNCP para criar uma oportunidade
  const importPncpLicitacao = async (item) => {
    setPncpImportingId(item.id);
    try {
      const dataSessao = item.data_sessao || item.data_inicio_vigencia || item.data_fim_vigencia;
      const prazoProposta = item.data_envio_proposta_limite || item.data_fim_vigencia;
      // Mapear situação PNCP para status da oportunidade
      const pncpSituacaoNome = (item.situacao?.nome || '').toLowerCase();
      const statusFromPncp = pncpSituacaoNome.includes('suspens') ? 'suspenso'
        : (pncpSituacaoNome.includes('revogad') || pncpSituacaoNome.includes('anuladoo') || pncpSituacaoNome.includes('cancel')) ? 'cancelado'
        : 'ativo';
      const queryText = normalizeText(pncpSearchFilters.q || '').trim();
      const shouldImportAllItems = queryText.length < 3;

      let importedItemsDraft = [];
      if (!shouldImportAllItems && Array.isArray(item.itens_pertinentes) && item.itens_pertinentes.length > 0) {
        importedItemsDraft = mapPncpImportItemsToDraft(item.itens_pertinentes);
      } else {
        const allPncpItems = await fetchAllPncpItemsForImport(item);
        importedItemsDraft = mapPncpImportItemsToDraft(allPncpItems);
      }
      const estimatedValue = Number(item.valor_itens_pertinentes) > 0
        ? Number(item.valor_itens_pertinentes)
        : (item.valor_total_estimado ?? item.valor_global ?? '');

      setNewOpportunityForm(prev => ({
        ...prev,
        status: statusFromPncp,
        titulo: item.titulo || `${item.tipo?.nome || 'Edital'} - ${item.orgao?.nome || 'Órgão'}`,
        orgao_nome: item.orgao?.nome || '',
        orgao_cnpj: item.orgao?.cnpj || '',
        orgao_codigo: item.orgao?.id || item.orgao?.cnpj || '',
        uasg_codigo: item.unidade?.codigo || '',
        uasg_nome: item.unidade?.nome || '',
        modalidade: item.modalidade?.nome || '',
        numero_edital: item.numero_sequencial || '',
        numero_compra: item.numero_controle_pncp || '',
        data_publicacao: toDateInputValue(item.data_publicacao),
        data_sessao: toDateTimeLocalValue(dataSessao),
        data_envio_proposta_limite: toDateTimeLocalValue(prazoProposta),
        data_assinatura_ata_limite: toDateTimeLocalValue(item.data_assinatura_ata_limite),
        data_entrega_limite: toDateTimeLocalValue(item.data_entrega_limite || item.data_fim_vigencia),
        valor_oportunidade: toPtBrDecimalInput(estimatedValue),
        links_pncp: item.url || '',
        metadados: {
          pncp_id: item.id,
          pncp_numero_controle: item.numero_controle_pncp,
          pncp_situacao: item.situacao?.nome,
          pncp_tipo: item.tipo?.nome,
          pncp_esfera: item.esfera?.nome,
          pncp_municipio: item.municipio?.nome,
          pncp_uf: item.uf,
        },
      }));
      setNewOpportunityItemsDraft(importedItemsDraft);
      setNewOpportunityItemRequirementForm({});
      setExpandedDraftChecklist({});
      setChecklistModalItemId(null);
      setIsPncpImportDraft(true);
      setShowNewOpportunityForm(true);
      setPncpSearchExpanded(false);
    } catch (error) {
      console.error('Error importing PNCP items:', error);
    } finally {
      setPncpImportingId(null);
    }
  };

  const openOpportunity = async (opportunity) => {
    setSelectedOpportunity(opportunity);
    try {
      const [requirementsResponse, contactsResponse, itemsResponse, commentsResponse] = await Promise.all([
        axios.get(`/api/licitacoes/opportunities/${opportunity.id}/requirements`),
        axios.get(`/api/licitacoes/opportunities/${opportunity.id}/contacts`),
        axios.get(`/api/licitacoes/opportunities/${opportunity.id}/items`),
        axios.get(`/api/licitacoes/opportunities/${opportunity.id}/comments`),
      ]);
      const requirements = Array.isArray(requirementsResponse.data) ? requirementsResponse.data : [];
      setSelectedCommercialRequirements(requirements.filter(item => item.tipo === 'comercial'));
      setSelectedLinkedContacts(contactsResponse.data || []);
      setSelectedComments(Array.isArray(commentsResponse.data) ? commentsResponse.data : []);
      setItemRequirementCostInputMap({});
      setItemQuantityInputMap({});
      setItemReferenceInputMap({});

      const items = Array.isArray(itemsResponse.data) ? itemsResponse.data : [];
      setSelectedItems(items);

      const requirementsByItem = {};
      await Promise.all(items.map(async (item) => {
        const itemRequirementsResponse = await axios.get(`/api/licitacoes/opportunities/${opportunity.id}/items/${item.id}/requirements`);
        requirementsByItem[item.id] = Array.isArray(itemRequirementsResponse.data) ? itemRequirementsResponse.data : [];
      }));
      setItemRequirementsMap(requirementsByItem);
    } catch (error) {
      console.error('Error loading licitacao details:', error);
      setSelectedCommercialRequirements([]);
      setSelectedItems([]);
      setItemRequirementsMap({});
      setSelectedLinkedContacts([]);
      setSelectedComments([]);
      setItemRequirementCostInputMap({});
      setItemQuantityInputMap({});
      setItemReferenceInputMap({});
    }
  };

  const addComment = async () => {
    if (!selectedOpportunity || !newCommentText.trim()) {
      return;
    }
    try {
      const response = await axios.post(`/api/licitacoes/opportunities/${selectedOpportunity.id}/comments`, {
        content: newCommentText.trim(),
        author: 'Admin',
      });
      setSelectedComments(prev => [response.data, ...prev]);
      setNewCommentText('');
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const deleteComment = async (commentId) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      await axios.delete(`/api/licitacoes/opportunities/${selectedOpportunity.id}/comments/${commentId}`);
      setSelectedComments(prev => prev.filter(comment => comment.id !== commentId));
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const updateSelectedOpportunity = useCallback(async (changes) => {
    if (!selectedOpportunity) {
      return;
    }
    const id = selectedOpportunity.id;
    const next = { ...selectedOpportunity, ...changes };
    setSelectedOpportunity(next);
    setLicitacaoOpportunities(prev => prev.map(item => (item.id === id ? { ...item, ...changes } : item)));
    try {
      const response = await axios.put(`/api/licitacoes/opportunities/${id}`, changes);
      setSelectedOpportunity(response.data);
      setLicitacaoOpportunities(prev => prev.map(item => (item.id === id ? response.data : item)));
    } catch (error) {
      console.error('Error updating licitacao opportunity:', error);
    }
  }, [selectedOpportunity]);

  useEffect(() => {
    if (!selectedOpportunity || !hasItemsDrivingOpportunityValue) {
      return;
    }
    const currentValue = parseCurrency(selectedOpportunity.valor_oportunidade);
    const nextValue = Number(itemsParticipationTotal.toFixed(2));
    setSelectedOpportunityValueInput(toPtBrDecimalInput(nextValue));
    if (currentValue === nextValue) {
      return;
    }
    updateSelectedOpportunity({ valor_oportunidade: nextValue });
  }, [selectedOpportunity, hasItemsDrivingOpportunityValue, itemsParticipationTotal, updateSelectedOpportunity]);

  const deleteSelectedOpportunity = async () => {
    if (!selectedOpportunity) {
      return;
    }

    const confirmed = window.confirm('Tem certeza que deseja excluir esta licitação? Esta ação não pode ser desfeita.');
    if (!confirmed) {
      return;
    }

    const opportunityId = selectedOpportunity.id;
    try {
      await axios.delete(`/api/licitacoes/opportunities/${opportunityId}`);
      setLicitacaoOpportunities(prev => prev.filter(item => String(item.id) !== String(opportunityId)));
      setSelectedOpportunity(null);
      setSelectedCommercialRequirements([]);
      setSelectedItems([]);
      setItemRequirementsMap({});
      setSelectedLinkedContacts([]);
      setSelectedComments([]);
      setContactLinkQuery('');
    } catch (error) {
      console.error('Error deleting licitacao opportunity:', error);
    }
  };

  const commitSelectedOpportunityValue = () => {
    if (!selectedOpportunity) {
      return;
    }
    if (hasItemsDrivingOpportunityValue) {
      return;
    }
    const nextValue = parseCurrency(selectedOpportunityValueInput);
    const currentValue = parseCurrency(selectedOpportunity.valor_oportunidade);
    if (nextValue === currentValue) {
      return;
    }
    updateSelectedOpportunity({ valor_oportunidade: nextValue });
  };

  const addRequirement = async () => {
    if (!selectedOpportunity || !newRequirementForm.titulo.trim()) {
      return;
    }
    try {
      const response = await axios.post(`/api/licitacoes/opportunities/${selectedOpportunity.id}/requirements`, {
        tipo: 'comercial',
        titulo: newRequirementForm.titulo,
      });
      setSelectedCommercialRequirements(prev => [...prev, response.data]);
      setNewRequirementForm({ titulo: '' });
    } catch (error) {
      console.error('Error adding requirement:', error);
    }
  };

  const updateRequirement = async (requirementId, changes) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      const response = await axios.put(
        `/api/licitacoes/opportunities/${selectedOpportunity.id}/requirements/${requirementId}`,
        changes
      );
      setSelectedCommercialRequirements(prev => prev.map(item => (item.id === requirementId ? response.data : item)));
    } catch (error) {
      console.error('Error updating requirement:', error);
    }
  };

  const deleteRequirement = async (requirementId) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      await axios.delete(`/api/licitacoes/opportunities/${selectedOpportunity.id}/requirements/${requirementId}`);
      setSelectedCommercialRequirements(prev => prev.filter(item => item.id !== requirementId));
    } catch (error) {
      console.error('Error deleting requirement:', error);
    }
  };

  const addItem = async () => {
    if (!selectedOpportunity || !newItemForm.descricao.trim()) {
      return;
    }
    try {
      const quantidade = parseCurrency(newItemForm.quantidade);
      const valorReferencia = parseCurrency(newItemForm.valor_referencia);
      const custoTotalItem = quantidade !== null && valorReferencia !== null
        ? Number((quantidade * valorReferencia).toFixed(2))
        : null;
      const response = await axios.post(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items`, {
        ...newItemForm,
        quantidade,
        valor_referencia: valorReferencia,
        custo_total_item: custoTotalItem,
      });
      setSelectedItems(prev => [...prev, response.data]);
      setNewItemForm({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', unidade: '', valor_referencia: '', custo_total_item: '' });
    } catch (error) {
      console.error('Error adding item:', error);
    }
  };

  const updateItem = async (itemId, changes) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      const response = await axios.put(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items/${itemId}`, changes);
      setSelectedItems(prev => prev.map(item => (item.id === itemId ? response.data : item)));
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const setItemNumericInput = (type, itemId, value) => {
    const normalized = String(value || '').replace(/\./g, ',');
    if (type === 'quantidade') {
      setItemQuantityInputMap(prev => ({ ...prev, [itemId]: normalized }));
      return;
    }
    setItemReferenceInputMap(prev => ({ ...prev, [itemId]: normalized }));
  };

  const commitItemNumericInput = (type, item) => {
    if (!item || !item.id) {
      return;
    }
    const itemId = item.id;
    const quantityInput = itemQuantityInputMap[itemId];
    const referenceInput = itemReferenceInputMap[itemId];

    if (type === 'quantidade' && quantityInput === undefined) {
      return;
    }
    if (type === 'valor_referencia' && referenceInput === undefined) {
      return;
    }

    const nextQuantidade = parseCurrency(type === 'quantidade' ? quantityInput : (quantityInput ?? item.quantidade));
    const nextReferencia = parseCurrency(type === 'valor_referencia' ? referenceInput : (referenceInput ?? item.valor_referencia));
    const currentQuantidade = parseCurrency(item.quantidade);
    const currentReferencia = parseCurrency(item.valor_referencia);

    const nextCustoTotal = nextQuantidade !== null && nextReferencia !== null
      ? Number((nextQuantidade * nextReferencia).toFixed(2))
      : null;

    const shouldUpdate = nextQuantidade !== currentQuantidade || nextReferencia !== currentReferencia;
    if (shouldUpdate) {
      updateItem(itemId, {
        quantidade: nextQuantidade,
        valor_referencia: nextReferencia,
        custo_total_item: nextCustoTotal,
      });
    }

    if (type === 'quantidade') {
      setItemQuantityInputMap(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }

    setItemReferenceInputMap(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const deleteItem = async (itemId) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      await axios.delete(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items/${itemId}`);
      setSelectedItems(prev => prev.filter(item => item.id !== itemId));
      setItemRequirementsMap(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setItemQuantityInputMap(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setItemReferenceInputMap(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  const addItemRequirement = async (itemId) => {
    if (!selectedOpportunity) {
      return;
    }
    const form = newItemRequirementForm[itemId] || { requisito: '' };
    if (!String(form.requisito || '').trim()) {
      return;
    }
    try {
      const response = await axios.post(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items/${itemId}/requirements`, {
        requisito: form.requisito,
        status: form.status || 'verificar',
        observacao: form.observacao || null,
        valor_ofertado: form.custo_subitem ? parseCurrency(form.custo_subitem) : null,
        ordem: (itemRequirementsMap[itemId] || []).length,
      });
      setItemRequirementsMap(prev => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), response.data],
      }));
      setNewItemRequirementForm(prev => ({
        ...prev,
        [itemId]: { requisito: '', status: 'verificar', observacao: '', custo_subitem: '' },
      }));
    } catch (error) {
      console.error('Error adding item requirement:', error);
    }
  };

  const updateItemRequirement = async (itemId, requirementId, changes) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      const response = await axios.put(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items/${itemId}/requirements/${requirementId}`, changes);
      setItemRequirementsMap(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).map(item => (item.id === requirementId ? response.data : item)),
      }));
    } catch (error) {
      console.error('Error updating item requirement:', error);
    }
  };

  const setItemRequirementCostInput = (itemId, requirementId, value) => {
    const key = `${itemId}:${requirementId}`;
    setItemRequirementCostInputMap(prev => ({
      ...prev,
      [key]: String(value || '').replace(/\./g, ','),
    }));
  };

  const commitItemRequirementCost = (itemId, requirementId, currentValue) => {
    const key = `${itemId}:${requirementId}`;
    const inputValue = itemRequirementCostInputMap[key];
    if (inputValue === undefined) {
      return;
    }
    const nextValue = parseCurrency(inputValue);
    const currentNumeric = parseCurrency(currentValue);
    if (nextValue !== currentNumeric) {
      updateItemRequirement(itemId, requirementId, { valor_ofertado: nextValue });
    }
    setItemRequirementCostInputMap(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const deleteItemRequirement = async (itemId, requirementId) => {
    if (!selectedOpportunity) {
      return;
    }
    try {
      await axios.delete(`/api/licitacoes/opportunities/${selectedOpportunity.id}/items/${itemId}/requirements/${requirementId}`);
      setItemRequirementsMap(prev => ({
        ...prev,
        [itemId]: (prev[itemId] || []).filter(item => item.id !== requirementId),
      }));
      setItemRequirementCostInputMap(prev => {
        const next = { ...prev };
        delete next[`${itemId}:${requirementId}`];
        return next;
      });
    } catch (error) {
      console.error('Error deleting item requirement:', error);
    }
  };

  const getItemChecklistStatus = (itemId) => {
    const requirements = itemRequirementsMap[itemId] || [];
    const okCount = requirements.filter(item => item.status === 'ok').length;
    const totalCount = requirements.length;
    if (requirements.length === 0) {
      return { label: 'Sem checklist', counts: '0/0', className: 'bg-cardAlt text-muted border-border' };
    }
    const pending = requirements.some(item => item.status !== 'ok');
    if (pending) {
      return { label: 'Com pendências', counts: `${okCount}/${totalCount}`, className: 'bg-status-warning/10 text-status-warning border-status-warning/20' };
    }
    return { label: 'Checklist completo', counts: `${okCount}/${totalCount}`, className: 'bg-status-success/10 text-status-success border-status-success/20' };
  };

  const addLinkedContact = async () => {
    const resolvedId = String(
      contactLinkForm.contact_id
      || resolveContactIdFromInput(contactLinkQuery, filteredContactsForEditLink)
      || resolveContactIdFromInput(contactLinkQuery, contacts)
      || ''
    );

    if (!selectedOpportunity || !resolvedId) {
      return;
    }
    try {
      await axios.post(`/api/licitacoes/opportunities/${selectedOpportunity.id}/contacts`, {
        contact_id: Number(resolvedId),
        papel: contactLinkForm.papel,
        observacao: contactLinkForm.observacao,
      });
      const contactsResponse = await axios.get(`/api/licitacoes/opportunities/${selectedOpportunity.id}/contacts`);
      setSelectedLinkedContacts(contactsResponse.data || []);
      setContactLinkForm({ contact_id: '', papel: '', observacao: '' });
      setContactLinkQuery('');
    } catch (error) {
      console.error('Error linking contact:', error);
    }
  };

  const removeLinkedContact = async (linkId) => {
    if (!selectedOpportunity || !linkId) {
      return;
    }
    try {
      await axios.delete(`/api/licitacoes/opportunities/${selectedOpportunity.id}/contacts/${linkId}`);
      setSelectedLinkedContacts(prev => prev.filter(link => String(link.id) !== String(linkId)));
    } catch (error) {
      console.error('Error unlinking contact:', error);
    }
  };

  const sortByValueAsc = (list) => [...list].sort((a, b) => (a.value || 0) - (b.value || 0));

  const stageFunnelData = useMemo(() => {
    const stages = [...leadColumns, ...customerColumns];
    const stageMap = new Map(
      overviewData.byStage.map(item => [item.stage, item])
    );
    return stages
      .map(stage => {
        const row = stageMap.get(stage);
        return {
          stage,
          stageNumber: getStageNumber(stage),
          stageLabel: getStageLabel(stage),
          count: Number(row?.count) || 0,
          totalValue: Number(row?.total_value) || 0,
        };
      })
      .sort((a, b) => a.stageNumber - b.stageNumber);
  }, [overviewData.byStage]);

  const stageGroupData = useMemo(() => {
    return STAGE_GROUPS.map(g => {
      const items = stageFunnelData.filter(s => {
        const n = parseInt(s.stageNumber, 10);
        return n >= g.range[0] && n <= g.range[1];
      });
      return {
        group: g.label,
        color: g.color,
        count: items.reduce((a, s) => a + (s.count || 0), 0),
        totalValue: items.reduce((a, s) => a + (s.totalValue || 0), 0),
        detalhes: items.map(s => ({
          stage: s.stage,
          stageNumber: s.stageNumber,
          stageLabel: s.stageLabel,
          count: s.count,
          totalValue: s.totalValue,
        })),
      };
    });
  }, [stageFunnelData]);

  const labelCountData = useMemo(() => sortByValueAsc(
    overviewData.byLabel.map(item => ({
      label: item.label,
      value: Number(item.count) || 0,
      color: item.color,
    }))
  ), [overviewData.byLabel]);

  const labelValueData = useMemo(() => sortByValueAsc(
    overviewData.byLabel.map(item => ({
      label: item.label,
      value: Number(item.total_value) || 0,
      color: item.color,
    }))
  ), [overviewData.byLabel]);

  const stateCountData = useMemo(() => sortByValueAsc(
    overviewData.byState.map(item => ({
      state: item.state,
      value: Number(item.count) || 0,
    }))
  ), [overviewData.byState]);

  const stateValueData = useMemo(() => sortByValueAsc(
    overviewData.byState.map(item => ({
      state: item.state,
      value: Number(item.total_value) || 0,
    }))
  ), [overviewData.byState]);

  const agentCountData = useMemo(() => sortByValueAsc(
    overviewData.byAgent.map(item => ({
      agent: item.agent,
      value: Number(item.count) || 0,
    }))
  ), [overviewData.byAgent]);

  const agentValueData = useMemo(() => sortByValueAsc(
    overviewData.byAgent.map(item => ({
      agent: item.agent,
      value: Number(item.total_value) || 0,
    }))
  ), [overviewData.byAgent]);

  const channelCountData = useMemo(() => sortByValueAsc(
    overviewData.byChannel.map(item => ({
      channel: item.channel,
      value: Number(item.count) || 0,
    }))
  ), [overviewData.byChannel]);

  const customerTypeCountData = useMemo(() => sortByValueAsc(
    overviewData.byCustomerType.map(item => ({
      customerType: item.customer_type,
      value: Number(item.count) || 0,
    }))
  ), [overviewData.byCustomerType]);

  const probabilityValueData = useMemo(() => sortByValueAsc(
    overviewData.byProbability.map(item => ({
      probability: item.probability,
      value: Number(item.total_value) || 0,
    }))
  ), [overviewData.byProbability]);

  const historySeries = useMemo(() => buildGroupedHistorySeries(overviewData.history), [overviewData.history]);

  const moveContactToStage = (contactId, targetStage) => {
    const previousContacts = contacts;
    setContacts(prev => prev.map(contact => {
      if (String(contact.id) !== String(contactId)) {
        return contact;
      }
      return {
        ...contact,
        custom_attributes: {
          ...contact.custom_attributes,
          Funil_Vendas: targetStage,
        },
      };
    }));
    axios.put(`/api/contacts/${contactId}`, { Funil_Vendas: targetStage })
      .catch(error => {
        console.error('Error updating contact:', error);
        setContacts(previousContacts);
      });
  };

  const sendToCustomersStage = (contactId) => {
    const targetStage = '18. Novos Clientes';
    setActiveTab('customers');
    moveContactToStage(contactId, targetStage);
  };

  const sendToLeadsInbox = (contactId) => {
    const targetStage = '1. Inbox (Novos)';
    setActiveTab('leads');
    moveContactToStage(contactId, targetStage);
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    if (loginLoading) {
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    const email = loginForm.email.trim();
    const password = loginForm.password;
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      setAuthStatus({
        checked: true,
        authenticated: true,
        email: response.data?.email || email,
      });
      setLoginForm({ email: '', password: '' });
    } catch (error) {
      const message = error?.response?.data?.error || 'Nao foi possivel entrar.';
      setLoginError(message);
      setAuthStatus({ checked: true, authenticated: false, email: '' });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch (error) {
      console.error('Error logging out:', error);
    }
    setAuthStatus({ checked: true, authenticated: false, email: '' });
  };

  const historyTicks = useMemo(() => {
    const periods = Array.from(new Set(overviewData.history.map(row => row.period_start))).sort();
    if (periods.length === 0) {
      return [];
    }
    const step = historyGranularity === 'day' ? 7 : historyGranularity === 'week' ? 2 : 1;
    return periods.filter((_, index) => index % step === 0);
  }, [overviewData.history, historyGranularity]);

  const historyTickFormat = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    if (historyGranularity === 'month') {
      return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(date);
    }
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  };

  const formatHistoryTooltipDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    const formatted = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).format(date);
    return formatted.replace(/\//g, '-');
  };

  const chartTheme = useMemo(() => {
    const textColor = isDarkMode ? '#e2e8f0' : '#1f2937';
    const mutedText = isDarkMode ? '#cbd5f5' : '#6b7280';
    const gridStroke = isDarkMode ? '#1f2937' : '#e5e7eb';
    return {
      textColor,
      fontSize: 11,
      tooltip: {
        container: {
          background: isDarkMode ? '#0b1220' : '#ffffff',
          color: textColor,
          border: isDarkMode ? '1px solid #1f2937' : '1px solid #e5e7eb',
          boxShadow: isDarkMode
            ? '0 12px 24px rgba(2, 6, 23, 0.45)'
            : '0 12px 24px rgba(15, 23, 42, 0.12)',
        },
      },
      axis: {
        ticks: {
          text: {
            fill: mutedText,
          },
        },
        legend: {
          text: {
            fill: mutedText,
          },
        },
      },
      grid: {
        line: {
          stroke: gridStroke,
        },
      },
    };
  }, [isDarkMode]);

  const stopDragAutoScroll = useCallback(() => {
    isDraggingRef.current = false;
    dragPointerXRef.current = null;
    lastPointerXRef.current = null;
    if (dragScrollRafRef.current) {
      window.cancelAnimationFrame(dragScrollRafRef.current);
      dragScrollRafRef.current = null;
    }
  }, []);

  const getPointerXFromDragEvent = useCallback((event) => {
    if (event?.activatorEvent && typeof event.activatorEvent.clientX === 'number') {
      return event.activatorEvent.clientX;
    }
    const translatedRect = event?.active?.rect?.current?.translated;
    if (translatedRect) {
      return translatedRect.left + translatedRect.width / 2;
    }
    const initialRect = event?.active?.rect?.current?.initial;
    if (initialRect && event?.delta && typeof event.delta.x === 'number') {
      return initialRect.left + event.delta.x + initialRect.width / 2;
    }
    if (initialRect) {
      return initialRect.left + initialRect.width / 2;
    }
    return null;
  }, []);

  const startDragAutoScroll = useCallback(() => {
    if (dragScrollRafRef.current) {
      return;
    }
    const step = () => {
      if (!isDraggingRef.current || !boardScrollRef.current || dragPointerXRef.current == null) {
        if (!isDraggingRef.current || !boardScrollRef.current) {
          dragScrollRafRef.current = null;
          return;
        }
        dragScrollRafRef.current = window.requestAnimationFrame(step);
        return;
      }
      const containerRect = boardScrollRef.current.getBoundingClientRect();
      const threshold = 72;
      const speed = 28;
      const pointerX = dragPointerXRef.current ?? lastPointerXRef.current;
      if (typeof pointerX !== 'number') {
        dragScrollRafRef.current = window.requestAnimationFrame(step);
        return;
      }
      lastPointerXRef.current = pointerX;
      if (pointerX < containerRect.left + threshold) {
        const next = Math.max(0, boardScrollRef.current.scrollLeft - speed);
        boardScrollRef.current.scrollLeft = next;
      } else if (pointerX > containerRect.right - threshold) {
        const maxScroll = boardScrollRef.current.scrollWidth - boardScrollRef.current.clientWidth;
        const next = Math.min(maxScroll, boardScrollRef.current.scrollLeft + speed);
        boardScrollRef.current.scrollLeft = next;
      }
      dragScrollRafRef.current = window.requestAnimationFrame(step);
    };
    dragScrollRafRef.current = window.requestAnimationFrame(step);
  }, []);

  const handleDragEnd = (event) => {
    const { active, over } = event;

    setActiveDragId(null);
    stopDragAutoScroll();

    if (!over || active.id === over.id) {
      return;
    }

    if (active.id !== over.id) {
      const activeId = String(active.id);
      if (activeId.startsWith('opp:')) {
        const opportunityId = activeId.replace('opp:', '');
        const overId = String(over.id);
        const overContainer = overId.startsWith('licitacao-column:')
          ? overId.replace('licitacao-column:', '')
          : over.data?.current?.columnId
            || licitacaoOpportunities.find(item => `opp:${item.id}` === overId)?.fase;

        const activeOpportunity = licitacaoOpportunities.find(item => String(item.id) === String(opportunityId));
        if (activeOpportunity && overContainer && activeOpportunity.fase !== overContainer) {
          moveOpportunityToStage(opportunityId, overContainer);
        }
        return;
      }

      const activeContact = contacts.find(c => String(c.id) === String(active.id));
      const overId = String(over.id);
      const overContainer = overId.startsWith('column:')
        ? overId.replace('column:', '')
        : over.data?.current?.columnId
          || contacts.find(c => String(c.id) === overId)?.custom_attributes.Funil_Vendas;

      if (activeContact && overContainer && activeContact.custom_attributes?.Funil_Vendas !== overContainer) {
        moveContactToStage(active.id, overContainer);
      }
    }
  };

  const handleDragStart = (event) => {
    setActiveDragId(event.active?.id || null);
    isDraggingRef.current = true;
    const pointerX = getPointerXFromDragEvent(event);
    if (typeof pointerX === 'number') {
      dragPointerXRef.current = pointerX;
      lastPointerXRef.current = pointerX;
    }
    startDragAutoScroll();
  };

  const handleDragMove = useCallback((event) => {
    const pointerX = getPointerXFromDragEvent(event);
    if (typeof pointerX === 'number') {
      dragPointerXRef.current = pointerX;
      lastPointerXRef.current = pointerX;
    }
    startDragAutoScroll();
  }, [getPointerXFromDragEvent, startDragAutoScroll]);

  const handleDragCancel = () => {
    setActiveDragId(null);
    stopDragAutoScroll();
  };

  useEffect(() => {
    if (!activeDragId) {
      return undefined;
    }
    const handlePointerMove = (event) => {
      dragPointerXRef.current = event.clientX;
      lastPointerXRef.current = event.clientX;
    };
    const handleMouseMove = (event) => {
      dragPointerXRef.current = event.clientX;
      lastPointerXRef.current = event.clientX;
    };
    const handleTouchMove = (event) => {
      const touch = event.touches?.[0];
      if (touch) {
        dragPointerXRef.current = touch.clientX;
        lastPointerXRef.current = touch.clientX;
      }
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true, capture: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
    };
  }, [activeDragId]);

  const handleTopScroll = () => {
    if (!boardScrollRef.current || !boardScrollbarRef.current || isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;
    boardScrollRef.current.scrollLeft = boardScrollbarRef.current.scrollLeft;
    if (groupBarRef.current) {
      groupBarRef.current.scrollLeft = boardScrollbarRef.current.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const handleBoardScroll = () => {
    if (!boardScrollRef.current || !boardScrollbarRef.current || isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;
    boardScrollbarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    if (groupBarRef.current) {
      groupBarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const collisionDetectionStrategy = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCenter(args);
  }, []);

  const isAuthLoading = !authStatus.checked;
  const showLogin = authStatus.checked && !authStatus.authenticated;

  return (
      <DndContext
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {isAuthLoading && (
        <div className="min-h-screen bg-surface text-ink relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute top-16 right-12 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-12 min-h-screen flex items-center justify-center">
            <div className="rounded-3xl border border-border bg-card p-8 shadow-lift text-center">
              <p className="text-sm text-muted">Verificando acesso...</p>
              <p className="text-2xl font-semibold mt-3">Aguarde</p>
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <div className="min-h-screen bg-surface text-ink relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute top-16 right-12 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
          <div className="absolute top-6 right-6">
            <button
              type="button"
              onClick={() => setIsDarkMode(prev => !prev)}
              className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-card"
              aria-label="Alternar tema"
            >
              <span>{isDarkMode ? 'Modo escuro' : 'Modo claro'}</span>
              <span className="relative h-4 w-8 rounded-full bg-cardAlt border border-border">
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-primary transition ${isDarkMode ? 'left-4' : 'left-0.5'}`}
                />
              </span>
            </button>
          </div>
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-12 min-h-screen flex items-center">
            <div className="w-full grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="logo-wrap h-14 w-16 rounded-2xl border border-border bg-card flex items-center justify-center overflow-hidden p-2">
                    <img
                      src="/logo_aerion.png"
                      alt="Aerion"
                      className="logo-image h-full w-full object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Aerion</p>
                    <h1 className="text-3xl md:text-4xl font-semibold">Painel comercial</h1>
                    <p className="text-sm text-muted mt-2">
                      Acompanhe funil, processos e indicadores em um unico lugar.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                    <p className="text-xs text-muted">Visao integrada</p>
                    <p className="mt-2 text-sm font-semibold text-ink">Leads, clientes e handoff</p>
                    <p className="mt-2 text-xs text-muted">Tudo sincronizado com o Chatwoot.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                    <p className="text-xs text-muted">Ritmo comercial</p>
                    <p className="mt-2 text-sm font-semibold text-ink">Resumo de processos e rituais</p>
                    <p className="mt-2 text-xs text-muted">Guia pratico para o time.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                    <p className="text-xs text-muted">Analise rapida</p>
                    <p className="mt-2 text-sm font-semibold text-ink">Distribuicao e valor por etapa</p>
                    <p className="mt-2 text-xs text-muted">Decisoes baseadas em dados.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                    <p className="text-xs text-muted">Seguranca</p>
                    <p className="mt-2 text-sm font-semibold text-ink">Acesso restrito</p>
                    <p className="mt-2 text-xs text-muted">Credenciais internas apenas.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-lift">
                <h2 className="text-xl font-semibold">Entrar no dashboard</h2>
                <p className="mt-2 text-sm text-muted">Use seu email comercial.</p>
                <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted" htmlFor="login-email">Email</label>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      required
                      value={loginForm.email}
                      onChange={(event) => setLoginForm(prev => ({ ...prev, email: event.target.value }))}
                      className="h-10 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted" htmlFor="login-password">Senha</label>
                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={loginForm.password}
                      onChange={(event) => setLoginForm(prev => ({ ...prev, password: event.target.value }))}
                      className="h-10 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Digite sua senha"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold shadow-card transition hover:shadow-lift disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loginLoading ? 'Entrando...' : 'Entrar'}
                  </button>
                </form>
                {loginError && (
                  <div className="mt-4 rounded-xl border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
                    {loginError}
                  </div>
                )}
                <div className="mt-6 rounded-2xl border border-border bg-cardAlt px-4 py-3 text-xs text-muted">
                  Acesso exclusivo para equipe Aerion. Caso nao consiga entrar, confirme suas credenciais.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {authStatus.authenticated && (
        <div className="min-h-screen bg-surface text-ink relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute top-16 right-12 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
          <div className="max-w-7xl mx-auto px-4 md:px-5 lg:px-6 pb-12">
            <header className="pt-8">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {authStatus.email && (
                  <span className="text-xs text-muted">{authStatus.email}</span>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-card"
                >
                  Sair
                </button>
                <button
                  type="button"
                  onClick={() => setIsDarkMode(prev => !prev)}
                  className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-card"
                  aria-label="Alternar tema"
                >
                  <span>{isDarkMode ? 'Modo escuro' : 'Modo claro'}</span>
                  <span className="relative h-4 w-8 rounded-full bg-cardAlt border border-border">
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-primary transition ${isDarkMode ? 'left-4' : 'left-0.5'}`}
                    />
                  </span>
                </button>
              </div>
              <div className="mt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div>
                  <div className="flex items-center gap-4">
                    <div className="logo-wrap h-14 w-16 rounded-2xl border border-border bg-card flex items-center justify-center overflow-hidden p-2">
                      <img
                        src="/logo_aerion.png"
                        alt="Aerion"
                        className="logo-image h-full w-full object-contain"
                      />
                    </div>
                    <div>
                      <h1 className="text-3xl md:text-4xl font-semibold">Funil de Vendas - Aerion</h1>
                      <p className="text-sm text-muted mt-2">
                        Etapas de leads e clientes no funil de vendas da Aerion Technologies Ltda.
                        {' '}
                        Alimentado pelo{' '}
                        <a
                          href="https://chatwoot.tenryu.com.br/app/accounts/2"
                          className="text-primary font-semibold hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          chatwoot
                        </a>
                        .
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 border-b border-border flex items-center gap-6 text-sm">
                {viewTabs.map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveView(tab)}
                    className={`pb-3 transition ${tab === activeView ? 'text-primary border-b-2 border-primary font-semibold' : 'text-muted hover:text-secondary'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeView === 'Board' && (
                <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="relative w-full md:max-w-sm">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.5-3.5" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar empresas, contatos, tags..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <select
                      value={priorityFilter}
                      onChange={(event) => setPriorityFilter(event.target.value)}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-ink"
                    >
                      <option value="all">Todas prioridades</option>
                      <option value="alta">Alta</option>
                      <option value="media">Média</option>
                      <option value="baixa">Baixa</option>
                      <option value="nenhuma">Nenhuma</option>
                    </select>
                    <select
                      value={agentFilter}
                      onChange={(event) => setAgentFilter(event.target.value)}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-ink"
                    >
                      <option value="all">Todos agentes</option>
                      {agentOptions.map(agent => (
                        <option key={agent} value={agent}>{agent}</option>
                      ))}
                    </select>
                    <select
                      value={labelFilter}
                      onChange={(event) => setLabelFilter(event.target.value)}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-ink"
                    >
                      <option value="all">Todas etiquetas</option>
                      {labelOptions.map(label => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>
                    <select
                      value={sortOption}
                      onChange={(event) => setSortOption(event.target.value)}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-ink"
                    >
                      <option value="name-asc">Nome (A-Z)</option>
                      <option value="name-desc">Nome (Z-A)</option>
                      <option value="opportunity-desc">Maior oportunidade</option>
                      <option value="opportunity-asc">Menor oportunidade</option>
                    </select>
                  </div>
                </div>
              )}

              {activeView === 'Licitações' && (
                <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="relative w-full md:max-w-sm">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.5-3.5" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar órgão, UASG, edital, SEI..."
                      value={licitacaoSearch}
                      onChange={(event) => setLicitacaoSearch(event.target.value)}
                      className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPncpImportDraft(false);
                        setShowNewOpportunityForm(true);
                      }}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-ink"
                    >
                      Nova licitação
                    </button>
                  </div>
                </div>
              )}
            </header>

          {activeView === 'Board' && (
            <>
              <div className="mt-8 flex items-center gap-3">
                <span className="text-xs font-semibold text-muted">Board view</span>
                <div className="inline-flex items-center rounded-full border border-border bg-card p-1">
                  <button
                    type="button"
                    className={`px-4 py-1.5 text-xs font-semibold rounded-full ${activeTab === 'leads' ? 'bg-primary/10 text-primary' : 'text-muted'}`}
                    onClick={() => setActiveTab('leads')}
                  >
                    Leads (SDR)
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-1.5 text-xs font-semibold rounded-full ${activeTab === 'customers' ? 'bg-secondary/10 text-secondary' : 'text-muted'}`}
                    onClick={() => setActiveTab('customers')}
                  >
                    Novos Clientes (CS)
                  </button>
                </div>
              </div>

          <div ref={groupBarRef} className="kanban-group-bar mt-4 mb-2">
            <div className="kanban-group-bar-track">
              {(() => {
                const spans = [];
                activeColumns.forEach((column) => {
                  const g = groupForStageNum(getStageNumber(column)) || { id: 'outros', label: 'Outros', color: '#6B7280' };
                  const last = spans[spans.length - 1];
                  if (last && last.id === g.id) {
                    last.colCount += 1;
                  } else {
                    spans.push({ id: g.id, label: g.label, color: g.color, colCount: 1 });
                  }
                });
                return spans.map((s) => (
                  <div
                    key={s.id}
                    className="kanban-group-span"
                    style={{
                      width: `calc(${s.colCount} * var(--kanban-col-w) + ${s.colCount - 1} * 16px)`,
                      background: `${s.color}1f`,
                      borderColor: `${s.color}55`,
                    }}
                  >
                    <span className="kanban-group-label" style={{ color: s.color }}>{s.label}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
          {boardScrollMetrics.scrollWidth > boardScrollMetrics.clientWidth && (
            <div className="kanban-scrollbar scrollbar-theme" ref={boardScrollbarRef} onScroll={handleTopScroll}>
              <div style={{ width: boardScrollMetrics.scrollWidth }} />
            </div>
          )}
          <div
            className={`kanban-board-scroll mt-2 flex gap-4 overflow-x-hidden pb-4 ${activeDragId ? 'snap-none' : 'snap-x snap-mandatory'}`}
            ref={boardScrollRef}
            onScroll={handleBoardScroll}
          >
            {activeColumns.map(column => (
              <KanbanColumn
                key={column}
                title={column}
                contacts={getContactsForColumn(column)}
                dotClass={dotClass}
                showMenu={showMenu}
                menuLabel={menuLabel}
                onMenuAction={activeTab === 'leads' ? sendToCustomersStage : sendToLeadsInbox}
                onMoveToColumn={(contactId, targetStage) => moveContactToStage(contactId, targetStage)}
                availableColumns={activeColumns}
                showHeaderMenu={showHeaderMenu}
                newContactUrl={newContactUrl}
                isDarkMode={isDarkMode}
              />
            ))}
          </div>
          <DragOverlay
            dropAnimation={{
              duration: 240,
              easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
              sideEffects: defaultDropAnimationSideEffects({
                styles: {
                  active: {
                    opacity: '0.35',
                  },
                },
              }),
            }}
          >
            {activeDragId ? (
              <div style={{ transform: 'scale(1.02)', opacity: 0.65 }}>
                {String(activeDragId).startsWith('opp:') ? (
                  <div className="kanban-card is-overlay rounded-[14px] border border-border bg-card p-3.5 shadow-card">
                    <h4 className="text-sm font-semibold text-ink truncate">
                      {licitacaoOpportunities.find(item => `opp:${item.id}` === String(activeDragId))?.titulo || 'Oportunidade'}
                    </h4>
                  </div>
                ) : (
                  <CardPreview contact={contacts.find(c => String(c.id) === String(activeDragId))} />
                )}
              </div>
            ) : null}
          </DragOverlay>
            </>
          )}

          {activeView === 'Licitações' && (
            <>
              {/* PNCP Search - Busca de Editais/Licitações */}
              <div className="mt-6 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-ink flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 text-primary text-xs font-bold">P</span>
                    Buscar Licitações no PNCP
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPncpSearchExpanded(!pncpSearchExpanded)}
                    className="text-xs text-muted hover:text-ink"
                  >
                    {pncpSearchExpanded ? 'Recolher' : 'Expandir'}
                  </button>
                </div>

                {pncpSearchExpanded && (
                  <>
                    <div className="grid gap-3 md:grid-cols-6">
                      <input
                        type="text"
                        placeholder="Buscar por palavra-chave..."
                        value={pncpSearchFilters.q}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, q: event.target.value }))}
                        onKeyDown={(event) => event.key === 'Enter' && runPncpSearch(1)}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink md:col-span-2"
                      />
                      <select
                        value={pncpSearchFilters.tipos_documento}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, tipos_documento: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="edital">Editais</option>
                        <option value="ata">Atas de Registro</option>
                        <option value="contrato">Contratos</option>
                        <option value="edital,ata">Editais e Atas</option>
                        <option value="edital,ata,contrato">Todos</option>
                      </select>
                      <select
                        value={pncpSearchFilters.status}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, status: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="recebendo_proposta">Recebendo Proposta</option>
                        <option value="encerrada">Encerrada</option>
                        <option value="suspensa">Suspensa</option>
                        <option value="todos">Todos os Status</option>
                      </select>
                      <select
                        value={pncpSearchFilters.modalidade_licitacao_id}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, modalidade_licitacao_id: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="">Todas Modalidades</option>
                        {modalidadeOptions.map(item => (
                          <option key={item.id} value={item.id}>{item.nome}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => runPncpSearch(1)}
                        disabled={pncpSearchLoading}
                        className="h-9 rounded-xl bg-primary text-white px-4 text-sm font-semibold disabled:opacity-50"
                      >
                        {pncpSearchLoading ? 'Buscando...' : 'Buscar'}
                      </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-6 mt-3">
                      <select
                        value={pncpSearchFilters.uf}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, uf: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="">Todos os Estados</option>
                        <option value="AC">Acre</option>
                        <option value="AL">Alagoas</option>
                        <option value="AP">Amapá</option>
                        <option value="AM">Amazonas</option>
                        <option value="BA">Bahia</option>
                        <option value="CE">Ceará</option>
                        <option value="DF">Distrito Federal</option>
                        <option value="ES">Espírito Santo</option>
                        <option value="GO">Goiás</option>
                        <option value="MA">Maranhão</option>
                        <option value="MT">Mato Grosso</option>
                        <option value="MS">Mato Grosso do Sul</option>
                        <option value="MG">Minas Gerais</option>
                        <option value="PA">Pará</option>
                        <option value="PB">Paraíba</option>
                        <option value="PR">Paraná</option>
                        <option value="PE">Pernambuco</option>
                        <option value="PI">Piauí</option>
                        <option value="RJ">Rio de Janeiro</option>
                        <option value="RN">Rio Grande do Norte</option>
                        <option value="RS">Rio Grande do Sul</option>
                        <option value="RO">Rondônia</option>
                        <option value="RR">Roraima</option>
                        <option value="SC">Santa Catarina</option>
                        <option value="SP">São Paulo</option>
                        <option value="SE">Sergipe</option>
                        <option value="TO">Tocantins</option>
                      </select>
                      <select
                        value={pncpSearchFilters.esfera_id}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, esfera_id: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="">Todas as Esferas</option>
                        <option value="F">Federal</option>
                        <option value="E">Estadual</option>
                        <option value="M">Municipal</option>
                      </select>
                      <select
                        value={pncpSearchFilters.tipo_id}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, tipo_id: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="">Todos os Tipos</option>
                        {tipoInstrumentoOptions.map(item => (
                          <option key={item.id} value={item.id}>{item.nome}</option>
                        ))}
                      </select>
                      <select
                        value={pncpSearchFilters.modo_disputa_id}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, modo_disputa_id: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="">Todos os Modos</option>
                        {modoDisputaOptions.map(item => (
                          <option key={item.id} value={item.id}>{item.nome}</option>
                        ))}
                      </select>
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar órgão (nome ou CNPJ)"
                          value={pncpOrgaoLookupQuery}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPncpOrgaoLookupQuery(value);
                            setPncpSearchFilters(prev => ({ ...prev, orgao_cnpj: '', unidade_codigo: '' }));
                            setPncpUasgLookupQuery('');
                          }}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={pncpSearchFilters.orgao_cnpj}
                          onChange={(event) => {
                            const selected = pncpOrgaoOptions.find(item => String(item.cnpj || '') === String(event.target.value));
                            setPncpSearchFilters(prev => ({ ...prev, orgao_cnpj: event.target.value, unidade_codigo: '' }));
                            setPncpUasgLookupQuery('');
                            if (selected) {
                              setPncpOrgaoLookupQuery(selected.nome || selected.cnpj || '');
                            }
                          }}
                        >
                          <option value="">
                            {pncpOrgaoLookupLoading
                              ? 'Carregando órgãos...'
                              : filteredPncpOrgaoOptions.length > 0
                                ? 'Selecione o órgão'
                                : 'Digite pelo menos 2 caracteres'}
                          </option>
                          {filteredPncpOrgaoOptions.map(item => (
                            <option key={item.cnpj || item.codigo} value={item.cnpj || ''}>{item.nome} {item.cnpj ? `- ${item.cnpj}` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar UASG por código/nome"
                          value={pncpUasgLookupQuery}
                          onChange={(event) => {
                            setPncpUasgLookupQuery(event.target.value);
                            setPncpSearchFilters(prev => ({ ...prev, unidade_codigo: '' }));
                          }}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={pncpSearchFilters.unidade_codigo}
                          onChange={(event) => {
                            const selected = pncpUasgOptions.find(item => String(item.codigo || '') === String(event.target.value));
                            setPncpSearchFilters(prev => ({ ...prev, unidade_codigo: event.target.value }));
                            if (selected) {
                              setPncpUasgLookupQuery(`${selected.codigo} - ${selected.nome || selected.codigo}`);
                            }
                          }}
                        >
                          <option value="">
                            {pncpUasgLookupLoading
                                ? 'Carregando UASGs...'
                                : filteredPncpUasgOptions.length > 0
                                  ? 'Selecione a UASG'
                                  : 'Digite para buscar UASG'}
                          </option>
                          {filteredPncpUasgOptions.map(item => (
                            <option key={item.codigo} value={item.codigo}>{item.codigo} - {item.nome || item.codigo}{item.orgao_nome ? ` (${item.orgao_nome})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <select
                        value={pncpSearchFilters.ordenacao}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, ordenacao: event.target.value }))}
                        className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink"
                      >
                        <option value="valor_desc_data_desc">Maior valor (mais recente)</option>
                        <option value="valor_asc_data_desc">Menor valor (mais recente)</option>
                        <option value="data_desc">Mais recentes primeiro</option>
                        <option value="data_asc">Mais antigos primeiro</option>
                      </select>
                      <div className="md:col-span-2 text-xs text-muted flex items-center justify-end gap-3">
                        {pncpSearchResults.total > 0 && (
                          <>
                            <span>{pncpSearchResults.total.toLocaleString('pt-BR')} resultados</span>
                            {visiblePncpResults.length !== pncpSearchResults.items.length && (
                              <span>{visiblePncpResults.length.toLocaleString('pt-BR')} visíveis</span>
                            )}
                            <span>Pág. {pncpSearchResults.pagina}/{pncpSearchResults.totalPaginas}</span>
                          </>
                        )}
                        {pncpHiddenIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowPncpHidden(!showPncpHidden)}
                            className="text-xs text-primary hover:underline"
                          >
                            {showPncpHidden ? 'Mostrar resultados' : `${pncpHiddenIds.length} oculto(s)`}
                          </button>
                        )}
                      </div>
                    </div>

                    {(pncpSearchFilters.orgao_cnpj || pncpSearchFilters.unidade_codigo || String(pncpOrgaoLookupQuery || '').trim().length >= 2 || String(pncpUasgLookupQuery || '').trim().length >= 2) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(pncpSearchFilters.orgao_cnpj || String(pncpOrgaoLookupQuery || '').trim().length >= 2) && (
                          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                            <strong>Órgão:</strong> {selectedPncpOrgao?.nome || pncpOrgaoLookupQuery || pncpSearchFilters.orgao_cnpj}
                            <button
                              type="button"
                              className="rounded-full px-1 text-primary hover:bg-primary/20"
                              onClick={() => {
                                setPncpSearchFilters(prev => ({ ...prev, orgao_cnpj: '', unidade_codigo: '' }));
                                setPncpOrgaoLookupQuery('');
                                setPncpUasgLookupQuery('');
                                setPncpUasgOptions([]);
                              }}
                              aria-label="Remover filtro de órgão"
                            >
                              x
                            </button>
                          </span>
                        )}

                        {(pncpSearchFilters.unidade_codigo || String(pncpUasgLookupQuery || '').trim().length >= 2) && (
                          <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs text-ink border border-border">
                            <strong>UASG:</strong> {selectedPncpUasg ? `${selectedPncpUasg.codigo} - ${selectedPncpUasg.nome}` : (pncpSearchFilters.unidade_codigo || pncpUasgLookupQuery)}
                            <button
                              type="button"
                              className="rounded-full px-1 text-muted hover:bg-cardAlt"
                              onClick={() => {
                                setPncpSearchFilters(prev => ({ ...prev, unidade_codigo: '' }));
                                setPncpUasgLookupQuery('');
                              }}
                              aria-label="Remover filtro de UASG"
                            >
                              x
                            </button>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Busca inteligente com IA */}
                    <div className="mt-3 flex items-center flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={pncpSearchFilters.usar_ia}
                          onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, usar_ia: event.target.checked }))}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="text-ink">Busca inteligente</span>
                        <span className="text-xs text-muted">(usa IA para encontrar termos correlatos)</span>
                      </label>
                    </div>

                    {/* Termos usados na busca */}
                    {pncpSearchResults.termosUsados && pncpSearchResults.termosUsados.length > 1 && (
                      <div className="mt-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          <strong>Termos buscados{pncpSearchResults.fonteIA ? ` (${pncpSearchResults.fonteIA})` : ''}:</strong>{' '}
                          {pncpSearchResults.termosUsados.map((termo, i) => (
                            <span key={termo}>
                              {i === 0 ? <strong>{termo}</strong> : termo}
                              {i < pncpSearchResults.termosUsados.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </p>
                      </div>
                    )}

                    {pncpSearchResults.termosNegativos && pncpSearchResults.termosNegativos.length > 0 && (
                      <div className="mt-2 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                        <p className="text-xs text-orange-700 dark:text-orange-300">
                          <strong>Termos excluídos por contexto:</strong>{' '}
                          {pncpSearchResults.termosNegativos.map((termo, i) => (
                            <span key={termo}>
                              {termo}
                              {i < pncpSearchResults.termosNegativos.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </p>
                      </div>
                    )}

                    {/* Lista de itens ocultos */}
                    {showPncpHidden && pncpHiddenIds.length > 0 && (
                      <div className="mt-4 rounded-xl border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-orange-700 dark:text-orange-400">Itens Ocultos ({pncpHiddenIds.length})</h4>
                          <button
                            type="button"
                            onClick={restoreAllPncpItems}
                            className="text-xs text-orange-600 hover:underline"
                          >
                            Restaurar todos
                          </button>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {pncpSearchResults.items.filter(item => pncpHiddenIds.includes(item.id)).map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 text-xs">
                              <span className="truncate flex-1 text-muted">{item.titulo}</span>
                              <button
                                type="button"
                                onClick={() => restorePncpItem(item.id)}
                                className="text-orange-600 hover:underline whitespace-nowrap"
                              >
                                Restaurar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resultados da busca PNCP */}
                    {visiblePncpResults.length > 0 && !showPncpHidden && (
                      <div className="mt-4 space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-theme">
                        {visiblePncpResults.map((item) => (
                          <div key={item.id} className="rounded-xl border border-border bg-cardAlt p-3 hover:border-primary/50 hover:bg-muted/10 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-sm text-ink truncate">
                                  {item.url ? (
                                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                      {item.titulo}
                                    </a>
                                  ) : item.titulo}
                                </h4>
                                <p className="text-xs text-muted mt-1 line-clamp-2">{item.descricao}</p>
                                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                    {item.modalidade?.nome || 'Modalidade n/d'}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-muted">
                                    {item.esfera?.nome} | {item.uf}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                    {item.situacao?.nome || 'Status n/d'}
                                  </span>
                                  {item.matched_termo && pncpSearchResults.termosUsados?.length > 1 && item.matched_termo !== pncpSearchFilters.q && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" title="Encontrado via busca inteligente">
                                      via: {item.matched_termo}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted mt-2">
                                  <strong>Órgão:</strong> {item.orgao?.nome || 'n/d'} | <strong>Unidade:</strong> {item.unidade?.nome || 'n/d'}
                                </p>
                                <p className="text-xs text-muted">
                                  <strong>Publicação:</strong> {item.data_publicacao ? new Date(item.data_publicacao).toLocaleDateString('pt-BR') : 'n/d'} |
                                  <strong> Vigência até:</strong> {item.data_fim_vigencia ? new Date(item.data_fim_vigencia).toLocaleDateString('pt-BR') : 'n/d'}
                                </p>
                                <p className="text-xs text-muted mt-1">
                                  <strong>Valor estimado:</strong> {getBestEstimatedValue(item) ? formatCurrency(getBestEstimatedValue(item)) : 'n/d'}
                                  {Number(item.itens_pertinentes_count) > 0 ? ` | ${item.itens_pertinentes_count} item(ns) pertinente(s)` : ''}
                                  {item.total_itens ? ` | ${item.total_itens} item(ns)` : ''}
                                </p>
                              </div>
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => importPncpLicitacao(item)}
                                  disabled={pncpImportingId === item.id}
                                  className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-60"
                                >
                                  {pncpImportingId === item.id ? 'Importando...' : 'Importar'}
                                </button>
                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-8 px-3 rounded-lg border border-border text-xs font-semibold flex items-center justify-center hover:bg-cardAlt"
                                  >
                                    Ver no PNCP
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => hidePncpItem(item.id)}
                                  className="h-8 px-3 rounded-lg border border-orange-300 text-orange-600 text-xs font-semibold hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                >
                                  Ocultar
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Paginação */}
                    {pncpSearchResults.totalPaginas > 1 && (
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => runPncpSearch(pncpSearchResults.pagina - 1)}
                          disabled={pncpSearchResults.pagina <= 1 || pncpSearchLoading}
                          className="h-8 px-3 rounded-lg border border-border text-xs font-semibold disabled:opacity-50 hover:bg-cardAlt"
                        >
                          Anterior
                        </button>
                        <span className="text-xs text-muted">
                          {pncpSearchResults.pagina} / {pncpSearchResults.totalPaginas}
                        </span>
                        <button
                          type="button"
                          onClick={() => runPncpSearch(pncpSearchResults.pagina + 1)}
                          disabled={pncpSearchResults.pagina >= pncpSearchResults.totalPaginas || pncpSearchLoading}
                          className="h-8 px-3 rounded-lg border border-border text-xs font-semibold disabled:opacity-50 hover:bg-cardAlt"
                        >
                          Próxima
                        </button>
                      </div>
                    )}

                    {/* Mensagem quando não há resultados */}
                    {!pncpSearchLoading && visiblePncpResults.length === 0 && pncpSearchResults.total === 0 && (
                      <div className="mt-4 text-center text-sm text-muted py-8">
                        Use os filtros acima e clique em "Buscar" para encontrar licitações no PNCP.
                      </div>
                    )}
                    {!pncpSearchLoading && visiblePncpResults.length === 0 && pncpSearchResults.total > 0 && (
                      <div className="mt-4 text-center text-sm text-muted py-8">
                        Todos os resultados desta página já estão no pipeline ou foram ocultados.
                      </div>
                    )}
                  </>
                )}
              </div>

              {showNewOpportunityForm && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                  <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">Nova licitação</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewOpportunityForm(false);
                          setIsPncpImportDraft(false);
                          setNewOpportunityForm(createEmptyOpportunityForm());
                          setNewOpportunityContact({ contact_id: '', papel: '', observacao: '' });
                          setNewOpportunityContactQuery('');
                          setOrgaoLookupQuery('');
                          setUasgLookupQuery('');
                          setModalidadeLookupQuery('');
                          setCatalogoLookupQuery('');
                          setNewOpportunityItemForm({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', custo_total_item: '' });
                          setNewOpportunityItemsDraft([]);
                          setNewOpportunityItemRequirementForm({});
                          setExpandedDraftChecklist({});
                          setChecklistModalItemId(null);
                        }}
                        className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
                      >
                        Fechar
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Título da oportunidade" value={newOpportunityForm.titulo} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, titulo: event.target.value }))} />
                      <select className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" value={newOpportunityForm.fase} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, fase: event.target.value }))}>
                        {licitacaoColumns.map(column => (<option key={column} value={column}>{column}</option>))}
                      </select>
                      <select className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" value={newOpportunityForm.status} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, status: event.target.value }))}>
                        <option value="ativo">Ativo</option>
                        <option value="ganho">Ganho</option>
                        <option value="perdido">Perdido</option>
                        <option value="suspenso">Suspenso</option>
                        <option value="cancelado">Cancelado</option>
                        <option value="fracassado">Fracassado</option>
                        <option value="nao_atendido">Não atendido</option>
                        <option value="arquivado">Arquivado</option>
                      </select>
                      <select className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" value={newOpportunityForm.origem_oportunidade} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, origem_oportunidade: event.target.value }))}>
                        <option value="direta">Origem direta</option>
                        <option value="automatica_api">Automática via API</option>
                      </select>
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar órgão (mín. 2 letras)"
                          value={orgaoLookupQuery}
                          onChange={(event) => {
                            const value = event.target.value;
                            setOrgaoLookupQuery(value);
                            setNewOpportunityForm(prev => ({ ...prev, orgao_nome: value }));
                          }}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={newOpportunityForm.orgao_cnpj}
                          onChange={(event) => {
                            const selected = orgaoOptions.find(item => String(item.cnpj || '') === String(event.target.value));
                            setNewOpportunityForm(prev => ({
                              ...prev,
                              orgao_cnpj: event.target.value,
                              orgao_nome: selected?.nome || prev.orgao_nome,
                              orgao_codigo: selected?.codigo || selected?.cnpj || prev.orgao_codigo,
                              uasg_codigo: '',
                              uasg_nome: '',
                            }));
                            if (selected) {
                              setOrgaoLookupQuery(selected.nome);
                            }
                          }}
                        >
                          <option value="">Selecione o órgão</option>
                          {filteredOrgaoOptions.map(item => (
                            <option key={item.cnpj || item.codigo} value={item.cnpj || ''}>{item.nome} {item.cnpj ? `- ${item.cnpj}` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="CNPJ do órgão" value={newOpportunityForm.orgao_cnpj || ''} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, orgao_cnpj: event.target.value, uasg_codigo: '', uasg_nome: '' }))} />
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar UASG por código/nome"
                          value={uasgLookupQuery}
                          onChange={(event) => setUasgLookupQuery(event.target.value)}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={newOpportunityForm.uasg_codigo}
                          onChange={(event) => {
                            const selected = uasgOptions.find(item => String(item.codigo || '') === String(event.target.value));
                            setNewOpportunityForm(prev => ({
                              ...prev,
                              uasg_codigo: event.target.value,
                              uasg_nome: selected?.nome || prev.uasg_nome,
                            }));
                            if (selected) {
                              setUasgLookupQuery(`${selected.codigo} - ${selected.nome || selected.codigo}`);
                            }
                          }}
                        >
                          <option value="">
                            {lookupLoading
                              ? 'Carregando UASGs...'
                              : uasgOptions.length > 0
                              ? `Selecione a UASG (${uasgSource === 'compras.gov' ? 'via Compras.gov' : 'via PNCP'})`
                              : newOpportunityForm.orgao_cnpj
                                ? 'Nenhuma UASG encontrada'
                                  : 'Digite para buscar UASG ou selecione um órgão'}
                          </option>
                          {filteredUasgOptions.map(item => {
                            const code = String(item.codigo || '');
                            const name = item.nome || code;
                            return <option key={code} value={code}>{code} - {name}</option>;
                          })}
                        </select>
                      </div>
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Nome da UASG" value={newOpportunityForm.uasg_nome} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, uasg_nome: event.target.value }))} />
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar modalidade"
                          value={modalidadeLookupQuery}
                          onChange={(event) => setModalidadeLookupQuery(event.target.value)}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={newOpportunityForm.modalidade}
                          onChange={(event) => {
                            setNewOpportunityForm(prev => ({ ...prev, modalidade: event.target.value }));
                            setModalidadeLookupQuery(event.target.value);
                          }}
                        >
                          <option value="">Selecione a modalidade</option>
                          {filteredModalidadeOptions.map(option => (
                            <option key={option.id || option.nome} value={option.nome}>{option.nome}</option>
                          ))}
                        </select>
                      </div>
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Número do edital" value={newOpportunityForm.numero_edital} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_edital: event.target.value }))} />
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Número do processo SEI" value={newOpportunityForm.numero_processo_sei} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_processo_sei: event.target.value }))} />
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Número da compra" value={newOpportunityForm.numero_compra} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_compra: event.target.value }))} />
                      <select className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" value={newOpportunityForm.item_tipo} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, item_tipo: event.target.value }))}>
                        <option value="material">Material</option>
                        <option value="servico">Serviço</option>
                      </select>
                      <div className="space-y-1">
                        <input
                          className="h-8 w-full rounded-lg border border-border bg-cardAlt px-3 text-xs"
                          placeholder="Buscar código item"
                          value={catalogoLookupQuery}
                          onChange={(event) => setCatalogoLookupQuery(event.target.value)}
                        />
                        <select
                          className="h-9 w-full rounded-xl border border-border bg-cardAlt px-3 text-sm"
                          value={newOpportunityForm.codigo_item_catalogo}
                          onChange={(event) => {
                            const selected = catalogOptions.find(option => String(option.codigo) === String(event.target.value));
                            setNewOpportunityForm(prev => ({ ...prev, codigo_item_catalogo: event.target.value }));
                            if (selected) {
                              setCatalogoLookupQuery(`${selected.codigo} - ${selected.descricao}`);
                            }
                          }}
                        >
                          <option value="">Selecione o código de item</option>
                          {filteredCatalogOptions.map(option => (
                            <option key={option.codigo} value={option.codigo}>{option.codigo} - {option.descricao}</option>
                          ))}
                        </select>
                      </div>
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Palavras-chave (separadas por vírgula)" value={newOpportunityForm.palavras_chave} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, palavras_chave: event.target.value }))} />
                      <input className="h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm" placeholder="Valor da oportunidade" inputMode="decimal" value={newOpportunityForm.valor_oportunidade} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, valor_oportunidade: event.target.value.replace(/\./g, ',') }))} />
                    </div>
                    <div className="mt-4 rounded-xl border border-border bg-cardAlt p-4">
                      <h4 className="text-xs font-semibold text-muted mb-3">Datas Importantes</h4>
                      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Publicação do Aviso</label>
                          <input type="date" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={newOpportunityForm.data_publicacao} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_publicacao: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Data/Hora da Sessão</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={newOpportunityForm.data_sessao} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_sessao: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-status-danger mb-1">Prazo Envio Proposta</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-status-danger/30 bg-card px-3 text-sm" value={newOpportunityForm.data_envio_proposta_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_envio_proposta_limite: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Prazo Assinatura Ata</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={newOpportunityForm.data_assinatura_ata_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_assinatura_ata_limite: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Prazo Final Entrega</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={newOpportunityForm.data_entrega_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_entrega_limite: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Dias após assinatura</label>
                          <input type="number" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="Dias" value={newOpportunityForm.prazo_entrega_dias_apos_assinatura} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, prazo_entrega_dias_apos_assinatura: event.target.value }))} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-border bg-cardAlt p-4">
                      <h4 className="text-xs font-semibold text-muted mb-3">Links</h4>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link do Edital</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={newOpportunityForm.links_edital} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_edital: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link SEI</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={newOpportunityForm.links_sei} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_sei: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link PNCP</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={newOpportunityForm.links_pncp} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_pncp: event.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link Compras.gov</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={newOpportunityForm.links_compras} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_compras: event.target.value }))} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4">
                      <h4 className="text-sm font-semibold">Itens da licitação (opcional na criação)</h4>
                      {isPncpImportDraft && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                          <span>Itens importados do PNCP. Revise e remova o que não for pertinente antes de salvar.</span>
                          {newOpportunityItemsDraft.length > 0 && (
                            <button
                              type="button"
                              className="font-semibold hover:underline"
                              onClick={() => setNewOpportunityItemsDraft([])}
                            >
                              Remover todos
                            </button>
                          )}
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 md:grid-cols-7">
                        <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Nº do item" value={newOpportunityItemForm.numero_item} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, numero_item: event.target.value }))} />
                        <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs md:col-span-2" placeholder="Descrição do item" value={newOpportunityItemForm.descricao} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, descricao: event.target.value }))} />
                        <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Modelo compatível" value={newOpportunityItemForm.modelo_produto} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, modelo_produto: event.target.value }))} />
                        <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" inputMode="decimal" placeholder="Quantidade" value={newOpportunityItemForm.quantidade} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, quantidade: event.target.value.replace(/\./g, ',') }))} />
                        <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" inputMode="decimal" placeholder="Custo total do item" value={newOpportunityItemForm.custo_total_item} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, custo_total_item: event.target.value.replace(/\./g, ',') }))} />
                        <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs font-semibold md:col-span-7 justify-self-end" onClick={addDraftItem}>Adicionar item</button>
                      </div>

                      <div className="mt-3 space-y-3 max-h-64 overflow-y-auto pr-1 scrollbar-theme">
                        {newOpportunityItemsDraft.map(item => {
                          const reqForm = newOpportunityItemRequirementForm[item.id] || { requisito: '', status: 'verificar', observacao: '', custo_subitem: '' };
                          const requirements = item.requirements || [];
                          const okCount = requirements.filter(req => req.status === 'ok').length;
                          const totalCount = requirements.length;
                          const pending = requirements.some(req => req.status !== 'ok');
                          const statusLabel = requirements.length === 0
                            ? 'Sem checklist técnico'
                            : pending ? 'Checklist com pendências' : 'Checklist completo';
                          return (
                            <div key={item.id} className="rounded-xl border border-border bg-card p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-ink">Item {item.numero_item || '-'} - {item.descricao}</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-muted">{statusLabel} ({okCount}/{totalCount})</span>
                                  <button type="button" className="text-xs text-status-danger font-semibold" onClick={() => removeDraftItem(item.id)}>Remover</button>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-7">
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Nº item" value={item.numero_item || ''} onChange={(event) => updateDraftItem(item.id, { numero_item: event.target.value })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs md:col-span-2" placeholder="Descrição" value={item.descricao || ''} onChange={(event) => updateDraftItem(item.id, { descricao: event.target.value })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Modelo" value={item.modelo_produto || ''} onChange={(event) => updateDraftItem(item.id, { modelo_produto: event.target.value })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" inputMode="decimal" placeholder="Quantidade" value={toPtBrInputSafe(item.quantidade)} onChange={(event) => updateDraftItem(item.id, { quantidade: event.target.value.replace(/\./g, ',') })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" inputMode="decimal" placeholder="Valor ref." value={toPtBrInputSafe(item.valor_referencia)} onChange={(event) => updateDraftItem(item.id, { valor_referencia: event.target.value.replace(/\./g, ',') })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" inputMode="decimal" placeholder="Total item" value={toPtBrInputSafe(item.custo_total_item)} onChange={(event) => updateDraftItem(item.id, { custo_total_item: event.target.value.replace(/\./g, ',') })} />
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-5">
                                <button type="button" className="h-7 w-7 rounded-lg border border-border text-muted hover:text-ink hover:bg-card" onClick={() => setExpandedDraftChecklist(prev => ({ ...prev, [item.id]: !prev[item.id] }))} title="Abrir checklist técnico do item">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <path d="M9 12l2 2 4-4" />
                                    <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                                  </svg>
                                </button>
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs md:col-span-2" placeholder="Requisito técnico" value={reqForm.requisito || ''} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, requisito: event.target.value } }))} />
                                <select className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" value={reqForm.status || 'verificar'} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, status: event.target.value } }))}>
                                  <option value="ok">OK</option>
                                  <option value="nao_ok">Não OK</option>
                                  <option value="verificar">Verificar</option>
                                </select>
                                <button type="button" className="h-7 rounded-lg border border-border px-2 text-xs font-semibold" onClick={() => addDraftItemRequirement(item.id)}>Adicionar requisito</button>
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs md:col-span-2" placeholder="Observação" value={reqForm.observacao || ''} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, observacao: event.target.value } }))} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Custo acessório" inputMode="decimal" value={reqForm.custo_subitem || ''} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, custo_subitem: event.target.value.replace(/\./g, ',') } }))} />
                              </div>
                              {expandedDraftChecklist[item.id] && (
                              <div className="mt-2 space-y-1">
                                {requirements.map((req, index) => (
                                  <div key={req.id} className="flex items-center justify-between rounded-md border border-border bg-cardAlt px-2 py-1 text-xs">
                                    <span className="truncate">{index + 1}. {req.requisito} - {req.status}</span>
                                    <button type="button" className="text-status-danger font-semibold" onClick={() => removeDraftItemRequirement(item.id, req.id)}>Excluir</button>
                                  </div>
                                ))}
                              </div>
                              )}
                            </div>
                          );
                        })}
                        {newOpportunityItemsDraft.length === 0 && (
                          <p className="text-xs text-muted">Nenhum item adicionado ainda.</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4">
                      <h4 className="text-sm font-semibold">Vincular contatos do Chatwoot na criação</h4>
                      <div className="mt-3 grid gap-2 md:grid-cols-12">
                        <div className="md:col-span-5 min-w-0">
                          <input
                            className="h-9 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-sm"
                            placeholder="Buscar e selecionar contato"
                            list="new-opportunity-contacts-list"
                            value={newOpportunityContactQuery}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNewOpportunityContactQuery(value);
                              const resolvedId = resolveContactIdFromInput(value, contacts);
                              setNewOpportunityContact(prev => ({ ...prev, contact_id: resolvedId || '' }));
                            }}
                          />
                          <datalist id="new-opportunity-contacts-list">
                            {filteredContactsForNewOpportunity.map(contact => (
                              <option key={contact.id} value={getContactLabel(contact)} />
                            ))}
                          </datalist>
                        </div>
                        <select className="h-9 min-w-0 rounded-xl border border-border bg-card px-3 text-sm md:col-span-3" value={newOpportunityContact.papel} onChange={(event) => setNewOpportunityContact(prev => ({ ...prev, papel: event.target.value }))}>
                          <option value="">Papel do contato</option>
                          {contactRoleOptions.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <input className="h-9 min-w-0 rounded-xl border border-border bg-card px-3 text-sm md:col-span-2" placeholder="Observação" value={newOpportunityContact.observacao} onChange={(event) => setNewOpportunityContact(prev => ({ ...prev, observacao: event.target.value }))} />
                        <button type="button" className="h-9 rounded-xl border border-border px-3 text-sm font-semibold md:col-span-2" onClick={addContactToNewOpportunity}>Adicionar</button>
                      </div>
                      <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1 scrollbar-theme">
                        {newOpportunityForm.linked_contacts.map(item => {
                          const contact = contacts.find(c => String(c.id) === String(item.contact_id));
                          const contactUrl = getChatwootContactUrl(contact);
                          const contactDisplayName = getCompanyContactDisplay(
                            contact?.company_name,
                            contact?.name,
                            `Contato ${item.contact_id}`
                          );
                          return (
                            <div key={item.contact_id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                              <div className="min-w-0 break-words text-ink">
                                {contactUrl ? (
                                  <a href={contactUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                                    {contactDisplayName}
                                  </a>
                                ) : (
                                  <span>{contactDisplayName}</span>
                                )}
                                <span>{item.papel ? ` - ${item.papel}` : ''}{item.observacao ? ` (${item.observacao})` : ''}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button type="button" className="text-xs text-primary font-semibold" onClick={() => setPrincipalContactForNewOpportunity(item.contact_id)}>
                                  {item.principal ? 'Principal' : 'Definir principal'}
                                </button>
                                <button type="button" className="text-xs text-status-danger font-semibold" onClick={() => removeContactFromNewOpportunity(item.contact_id)}>
                                  Remover
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4 space-y-3">
                      <h4 className="text-sm font-semibold">Comentários</h4>
                      <textarea
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm resize-y"
                        placeholder="Adicionar comentário inicial da licitação..."
                        value={newOpportunityForm.comentario_inicial || ''}
                        onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, comentario_inicial: event.target.value }))}
                        rows={3}
                      />
                    </div>

                    <div className="mt-6 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewOpportunityForm(false);
                          setNewOpportunityForm(createEmptyOpportunityForm());
                          setNewOpportunityContact({ contact_id: '', papel: '', observacao: '' });
                          setNewOpportunityContactQuery('');
                          setOrgaoLookupQuery('');
                          setUasgLookupQuery('');
                          setModalidadeLookupQuery('');
                          setCatalogoLookupQuery('');
                          setNewOpportunityItemForm({ numero_item: '', descricao: '', modelo_produto: '', quantidade: '', custo_total_item: '' });
                          setNewOpportunityItemsDraft([]);
                          setNewOpportunityItemRequirementForm({});
                          setExpandedDraftChecklist({});
                          setChecklistModalItemId(null);
                        }}
                        className="h-9 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-ink"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={createOpportunity}
                        className="h-9 rounded-xl bg-primary text-white px-4 text-sm font-semibold"
                      >
                        Salvar licitação
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {licitacaoLoading && (
                <div className="mt-4 text-sm text-muted">Carregando licitações...</div>
              )}

              {boardScrollMetrics.scrollWidth > boardScrollMetrics.clientWidth && (
                <div className="kanban-scrollbar scrollbar-theme" ref={boardScrollbarRef} onScroll={handleTopScroll}>
                  <div style={{ width: boardScrollMetrics.scrollWidth }} />
                </div>
              )}

              <div
                className={`kanban-board-scroll mt-2 flex gap-4 overflow-x-hidden pb-4 ${activeDragId ? 'snap-none' : 'snap-x snap-mandatory'}`}
                ref={boardScrollRef}
                onScroll={handleBoardScroll}
              >
                {licitacaoColumns.map(column => (
                  <LicitacaoColumn
                    key={column}
                    title={column}
                    opportunities={getOpportunitiesForColumn(column)}
                    onOpen={openOpportunity}
                    onEdit={openOpportunity}
                  />
                ))}
              </div>

              {selectedOpportunity && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                  <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">{selectedOpportunity.titulo}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={deleteSelectedOpportunity}
                          className="h-8 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 text-xs font-semibold text-status-danger hover:bg-status-danger/20"
                        >
                          Excluir
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOpportunity(null);
                            setContactLinkQuery('');
                          }}
                          className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-cardAlt p-4">
                      <h4 className="text-xs font-semibold text-muted mb-3">Dados do Processo</h4>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="md:col-span-2">
                          <label className="block text-[11px] text-muted mb-1">Título da oportunidade</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.titulo || ''} onChange={(event) => updateSelectedOpportunity({ titulo: event.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Número do Edital</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.numero_edital || ''} onChange={(event) => updateSelectedOpportunity({ numero_edital: event.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Processo SEI</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.numero_processo_sei || ''} onChange={(event) => updateSelectedOpportunity({ numero_processo_sei: event.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">UASG</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.uasg_codigo || ''} onChange={(event) => updateSelectedOpportunity({ uasg_codigo: event.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Órgão</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.orgao_nome || ''} onChange={(event) => updateSelectedOpportunity({ orgao_nome: event.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Fase</label>
                          <select className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.fase || ''} onChange={(event) => updateSelectedOpportunity({ fase: event.target.value })}>
                            {licitacaoColumns.map(column => (<option key={column} value={column}>{column}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Status</label>
                          <select className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.status || 'ativo'} onChange={(event) => updateSelectedOpportunity({ status: event.target.value })}>
                            <option value="ativo">Ativo</option>
                            <option value="ganho">Ganho</option>
                            <option value="perdido">Perdido</option>
                            <option value="suspenso">Suspenso</option>
                            <option value="cancelado">Cancelado</option>
                            <option value="fracassado">Fracassado</option>
                            <option value="nao_atendido">Não atendido</option>
                            <option value="arquivado">Arquivado</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Valor da Oportunidade</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm disabled:opacity-60" inputMode="decimal" value={selectedOpportunityValueInput} onChange={(event) => setSelectedOpportunityValueInput(event.target.value.replace(/\./g, ','))} onBlur={commitSelectedOpportunityValue} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} disabled={hasItemsDrivingOpportunityValue} title={hasItemsDrivingOpportunityValue ? 'Valor calculado automaticamente pelos itens de participação.' : ''} />
                          {hasItemsDrivingOpportunityValue && (
                            <p className="mt-1 text-[10px] text-muted">Valor calculado automaticamente pelo total dos itens (quantidade x preço de referência).</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link do Edital</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={selectedOpportunity.links?.edital || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, edital: event.target.value || null } })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link SEI</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={selectedOpportunity.links?.sei || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, sei: event.target.value || null } })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Link PNCP</label>
                          <input className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" placeholder="https://..." value={selectedOpportunity.links?.pncp || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, pncp: event.target.value || null } })} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-cardAlt p-4">
                      <h4 className="text-xs font-semibold text-muted mb-3">Datas Importantes</h4>
                      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Publicação do Aviso</label>
                          <input type="date" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.data_publicacao ? String(selectedOpportunity.data_publicacao).slice(0, 10) : ''} onChange={(event) => updateSelectedOpportunity({ data_publicacao: event.target.value || null })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Data/Hora da Sessão</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.data_sessao ? new Date(selectedOpportunity.data_sessao).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_sessao: event.target.value || null })} />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-status-danger mb-1">Prazo Envio Proposta</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-status-danger/30 bg-card px-3 text-sm" value={selectedOpportunity.data_envio_proposta_limite ? new Date(selectedOpportunity.data_envio_proposta_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_envio_proposta_limite: event.target.value || null })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Prazo Assinatura Ata</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.data_assinatura_ata_limite ? new Date(selectedOpportunity.data_assinatura_ata_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_assinatura_ata_limite: event.target.value || null })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Prazo Final Entrega</label>
                          <input type="datetime-local" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.data_entrega_limite ? new Date(selectedOpportunity.data_entrega_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_entrega_limite: event.target.value || null })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted mb-1">Dias após assinatura</label>
                          <input type="number" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm" value={selectedOpportunity.prazo_entrega_dias_apos_assinatura || ''} onChange={(event) => updateSelectedOpportunity({ prazo_entrega_dias_apos_assinatura: event.target.value ? Number(event.target.value) : null })} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                      <div className="rounded-2xl border border-border bg-cardAlt p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold">Checklist Comercial</h4>
                          <span className="text-[11px] text-muted">{selectedCommercialRequirements.filter(r => r.status === 'ok').length}/{selectedCommercialRequirements.length} concluídos</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <input className="h-8 flex-1 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Novo requisito comercial..." value={newRequirementForm.titulo} onChange={(event) => setNewRequirementForm({ titulo: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && addRequirement()} />
                          <button type="button" className="h-8 rounded-lg bg-primary text-white px-3 text-xs font-semibold" onClick={addRequirement}>+ Adicionar</button>
                        </div>
                        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-theme">
                          {selectedCommercialRequirements.map(requirement => (
                            <div key={requirement.id} className={`rounded-xl border p-2 space-y-2 ${requirement.status === 'ok' ? 'border-status-success/30 bg-status-success/5' : requirement.status === 'nao_ok' ? 'border-status-danger/30 bg-status-danger/5' : 'border-border bg-card'}`}>
                              <div className="flex items-center gap-2">
                                <div className="h-7 rounded-lg border border-border bg-cardAlt px-1 flex items-center gap-1">
                                  <button type="button" className={`h-5 w-7 rounded text-[10px] font-bold ${requirement.status === 'ok' ? 'bg-status-success text-white' : 'text-muted hover:bg-status-success/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'ok' })} title="Concluído">OK</button>
                                  <button type="button" className={`h-5 w-7 rounded text-[10px] font-bold ${requirement.status === 'nao_ok' ? 'bg-status-danger text-white' : 'text-muted hover:bg-status-danger/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'nao_ok' })} title="Problema">X</button>
                                  <button type="button" className={`h-5 w-7 rounded text-[10px] font-bold ${requirement.status === 'pendente' ? 'bg-status-warning text-white' : 'text-muted hover:bg-status-warning/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'pendente' })} title="Pendente">?</button>
                                </div>
                                <input className="h-7 flex-1 rounded-lg border border-border bg-cardAlt px-2 text-xs" value={requirement.titulo} onChange={(event) => updateRequirement(requirement.id, { titulo: event.target.value })} />
                                <button type="button" className="h-7 w-7 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger text-xs font-bold" onClick={() => deleteRequirement(requirement.id)} title="Excluir">X</button>
                              </div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Observação" value={requirement.observacao || ''} onChange={(event) => updateRequirement(requirement.id, { observacao: event.target.value })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Custo previsto" value={requirement.custo_previsto || ''} onChange={(event) => updateRequirement(requirement.id, { custo_previsto: event.target.value ? Number(String(event.target.value).replace(',', '.')) : null })} />
                                <input className="h-7 rounded-lg border border-border bg-cardAlt px-2 text-xs" placeholder="Custo real" value={requirement.custo_real || ''} onChange={(event) => updateRequirement(requirement.id, { custo_real: event.target.value ? Number(String(event.target.value).replace(',', '.')) : null })} />
                              </div>
                            </div>
                          ))}
                          {selectedCommercialRequirements.length === 0 && (
                            <p className="text-xs text-muted text-center py-2">Nenhum requisito comercial. Adicione acima.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border bg-cardAlt p-4 space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold">Contatos vinculados (Chatwoot)</h4>
                          <div className="mt-2 grid gap-2 md:grid-cols-12">
                            <div className="md:col-span-5 min-w-0">
                              <input
                                className="h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-xs"
                                placeholder="Buscar e selecionar contato"
                                list="edit-opportunity-contacts-list"
                                value={contactLinkQuery}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setContactLinkQuery(value);
                                  const resolvedId = resolveContactIdFromInput(value, contacts);
                                  setContactLinkForm(prev => ({ ...prev, contact_id: resolvedId || '' }));
                                }}
                              />
                              <datalist id="edit-opportunity-contacts-list">
                                {filteredContactsForEditLink.map(contact => (
                                  <option key={contact.id} value={getContactLabel(contact)} />
                                ))}
                              </datalist>
                            </div>
                            <select className="h-8 min-w-0 rounded-lg border border-border bg-card px-2 text-xs md:col-span-3" value={contactLinkForm.papel} onChange={(event) => setContactLinkForm(prev => ({ ...prev, papel: event.target.value }))}>
                              <option value="">Papel do contato</option>
                              {contactRoleOptions.map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                            <input className="h-8 min-w-0 rounded-lg border border-border bg-card px-2 text-xs md:col-span-2" placeholder="Observação" value={contactLinkForm.observacao} onChange={(event) => setContactLinkForm(prev => ({ ...prev, observacao: event.target.value }))} />
                            <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs font-semibold md:col-span-2" onClick={addLinkedContact}>Vincular</button>
                          </div>
                          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1 scrollbar-theme">
                            {selectedLinkedContacts.map(link => {
                              const contact = contacts.find(c => String(c.id) === String(link.contact_id || link.id));
                              const contactUrl = getChatwootContactUrl(contact || { id: link.contact_id || link.id, account_id: link.account_id });
                              const contactDisplayName = getCompanyContactDisplay(
                                link.company_name,
                                link.contact_name,
                                `Contato ${link.contact_id || link.id}`
                              );
                              return (
                                <div key={link.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                                  <div className="min-w-0 break-words text-ink">
                                    {contactUrl ? (
                                      <a href={contactUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                                        {contactDisplayName}
                                      </a>
                                    ) : (
                                      <span>{contactDisplayName}</span>
                                    )}
                                    <span>{link.papel ? ` - ${link.papel}` : ''}{link.observacao ? ` (${link.observacao})` : ''}</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-xs text-status-danger font-semibold"
                                    onClick={() => removeLinkedContact(link.id)}
                                  >
                                    Remover
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>

                    </div>

                    <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4">
                      <h4 className="text-sm font-semibold">Itens de Participação</h4>
                      <p className="text-[11px] text-muted mt-1">Clique em um item para expandir e gerenciar o checklist técnico</p>
                      <p className="text-[11px] text-muted mt-1">Total geral dos itens: <strong className="text-ink">{formatCurrency(itemsParticipationTotal) || 'R$ 0,00'}</strong></p>
                      <div className="mt-3 flex gap-2 items-end">
                        <div className="flex-1 grid gap-2 md:grid-cols-6">
                          <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Item #" value={newItemForm.numero_item} onChange={(event) => setNewItemForm(prev => ({ ...prev, numero_item: event.target.value }))} />
                          <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs md:col-span-2" placeholder="Descrição do item" value={newItemForm.descricao} onChange={(event) => setNewItemForm(prev => ({ ...prev, descricao: event.target.value }))} />
                          <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Modelo" value={newItemForm.modelo_produto} onChange={(event) => setNewItemForm(prev => ({ ...prev, modelo_produto: event.target.value }))} />
                          <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Qtd" value={newItemForm.quantidade} onChange={(event) => setNewItemForm(prev => ({ ...prev, quantidade: event.target.value }))} />
                          <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Preço ref." inputMode="decimal" value={newItemForm.valor_referencia || ''} onChange={(event) => setNewItemForm(prev => ({ ...prev, valor_referencia: event.target.value.replace(/\./g, ',') }))} />
                        </div>
                        <button type="button" className="h-8 rounded-lg bg-primary text-white px-4 text-xs font-semibold whitespace-nowrap" onClick={addItem}>+ Adicionar Item</button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {selectedItems.map(item => {
                          const checklistStatus = getItemChecklistStatus(item.id);
                          const itemRequirements = itemRequirementsMap[item.id] || [];
                          const checklistCostTotal = itemRequirements.reduce((sum, req) => sum + (parseCurrency(req.valor_ofertado) || 0), 0);
                          const isExpanded = checklistModalItemId === item.id;
                          return (
                            <div key={item.id} className={`rounded-xl border overflow-hidden ${isExpanded ? 'border-primary/50 bg-card' : 'border-border bg-card'}`}>
                              <div
                                className={`p-3 cursor-pointer hover:bg-muted/10 ${isExpanded ? 'bg-primary/5' : ''}`}
                                onClick={() => setChecklistModalItemId(isExpanded ? null : item.id)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                    <strong className="text-xs text-primary">#{item.numero_item || '-'}</strong>
                                    <span className={isExpanded ? 'text-xs whitespace-normal break-words flex-1' : 'text-xs truncate max-w-[200px]'}>{item.descricao || 'Sem descrição'}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${checklistStatus.className}`}>{checklistStatus.counts}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted">Total item: {formatCurrency(getItemParticipationTotal(item)) || 'R$ 0,00'}</span>
                                    <button type="button" className="text-[10px] text-status-danger font-semibold px-2 py-1 rounded hover:bg-status-danger/10" onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}>Excluir</button>
                                  </div>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="border-t border-border p-3 bg-cardAlt/30">
                                  <div className="grid gap-2 md:grid-cols-5 mb-3">
                                    <div>
                                      <label className="block text-[10px] text-muted mb-1">Descrição</label>
                                      <input className="h-7 w-full rounded-lg border border-border bg-card px-2 text-xs" value={item.descricao || ''} onChange={(event) => updateItem(item.id, { descricao: event.target.value })} />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-muted mb-1">Modelo</label>
                                      <input className="h-7 w-full rounded-lg border border-border bg-card px-2 text-xs" value={item.modelo_produto || ''} onChange={(event) => updateItem(item.id, { modelo_produto: event.target.value })} />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-muted mb-1">Quantidade</label>
                                      <input
                                        className="h-7 w-full rounded-lg border border-border bg-card px-2 text-xs"
                                        inputMode="decimal"
                                        value={itemQuantityInputMap[item.id] ?? toPtBrInputSafe(item.quantidade)}
                                        onChange={(event) => setItemNumericInput('quantidade', item.id, event.target.value)}
                                        onBlur={() => commitItemNumericInput('quantidade', item)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.currentTarget.blur();
                                          }
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-muted mb-1">Preço de Referência</label>
                                      <input
                                        className="h-7 w-full rounded-lg border border-border bg-card px-2 text-xs"
                                        inputMode="decimal"
                                        value={itemReferenceInputMap[item.id] ?? toPtBrInputSafe(item.valor_referencia)}
                                        onChange={(event) => setItemNumericInput('valor_referencia', item.id, event.target.value)}
                                        onBlur={() => commitItemNumericInput('valor_referencia', item)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.currentTarget.blur();
                                          }
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-muted mb-1">Total do Item</label>
                                      <input className="h-7 w-full rounded-lg border border-border bg-card px-2 text-xs" value={formatCurrency(getItemParticipationTotal(item)) || ''} readOnly />
                                    </div>
                                  </div>

                                  <div className="border-t border-border pt-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <h5 className="text-xs font-semibold">Checklist Técnico</h5>
                                      <span className="text-[10px] text-muted">{itemRequirements.filter(r => r.status === 'ok').length}/{itemRequirements.length} concluídos - Total: {formatCurrency(checklistCostTotal) || 'R$ 0,00'}</span>
                                    </div>

                                    <div className="flex gap-2 mb-2">
                                      <input
                                        className="h-7 flex-1 rounded-lg border border-border bg-card px-2 text-xs"
                                        placeholder="Novo requisito técnico..."
                                        value={(newItemRequirementForm[item.id]?.requisito) || ''}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(event) => setNewItemRequirementForm(prev => ({
                                          ...prev,
                                          [item.id]: { ...(prev[item.id] || { status: 'verificar', observacao: '', custo_subitem: '' }), requisito: event.target.value },
                                        }))}
                                        onKeyDown={(event) => { if (event.key === 'Enter') { addItemRequirement(item.id); } }}
                                      />
                                      <button type="button" className="h-7 rounded-lg bg-primary/80 text-white px-3 text-[10px] font-semibold" onClick={(e) => { e.stopPropagation(); addItemRequirement(item.id); }}>+ Adicionar</button>
                                    </div>

                                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-theme">
                                      {itemRequirements.map((req, index) => (
                                        <div key={req.id} className={`rounded-lg border p-2 flex items-center gap-2 ${req.status === 'ok' ? 'border-status-success/30 bg-status-success/5' : req.status === 'nao_ok' ? 'border-status-danger/30 bg-status-danger/5' : 'border-border bg-card'}`} onClick={(e) => e.stopPropagation()}>
                                          <span className="w-5 text-center text-[10px] font-semibold text-muted">{index + 1}</span>
                                          <div className="h-6 rounded border border-border bg-cardAlt px-0.5 flex items-center gap-0.5">
                                            <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'ok' ? 'bg-status-success text-white' : 'text-muted hover:bg-status-success/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'ok' })}>OK</button>
                                            <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'nao_ok' ? 'bg-status-danger text-white' : 'text-muted hover:bg-status-danger/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'nao_ok' })}>X</button>
                                            <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'verificar' || req.status === 'pendente' ? 'bg-status-warning text-white' : 'text-muted hover:bg-status-warning/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'verificar' })}>?</button>
                                          </div>
                                          <input className="h-6 flex-1 rounded border border-border bg-cardAlt px-2 text-[11px]" value={req.requisito || ''} onChange={(event) => updateItemRequirement(item.id, req.id, { requisito: event.target.value })} />
                                          <input className="h-6 w-24 rounded border border-border bg-cardAlt px-2 text-[11px]" placeholder="Obs" value={req.observacao || ''} onChange={(event) => updateItemRequirement(item.id, req.id, { observacao: event.target.value })} />
                                          <input className="h-6 w-20 rounded border border-border bg-cardAlt px-2 text-[11px]" placeholder="Custo" inputMode="decimal" value={itemRequirementCostInputMap[`${item.id}:${req.id}`] ?? toPtBrDecimalInput(req.valor_ofertado)} onChange={(event) => setItemRequirementCostInput(item.id, req.id, event.target.value)} onBlur={() => commitItemRequirementCost(item.id, req.id, req.valor_ofertado)} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} />
                                          <button type="button" className="h-6 w-6 rounded border border-status-danger/30 bg-status-danger/10 text-status-danger text-[10px] font-bold" onClick={() => deleteItemRequirement(item.id, req.id)}>X</button>
                                        </div>
                                      ))}
                                      {itemRequirements.length === 0 && (
                                        <p className="text-[10px] text-muted text-center py-2">Nenhum requisito técnico. Adicione acima.</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {selectedItems.length === 0 && (
                          <p className="text-xs text-muted text-center py-4">Nenhum item cadastrado. Adicione itens de participação acima.</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4 space-y-3">
                      <h4 className="text-sm font-semibold">Comentários ({selectedComments.length})</h4>
                      <div className="flex gap-2">
                        <textarea
                          value={newCommentText}
                          onChange={(event) => setNewCommentText(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && event.ctrlKey && addComment()}
                          placeholder="Adicionar comentário... (Ctrl+Enter para enviar)"
                          className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm resize-none"
                          rows={2}
                        />
                        <button
                          type="button"
                          onClick={addComment}
                          disabled={!newCommentText.trim()}
                          className="h-fit self-end rounded-lg bg-primary text-white px-4 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          Adicionar
                        </button>
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-theme">
                        {selectedComments.length === 0 ? (
                          <p className="text-xs text-muted italic">Nenhum comentário ainda.</p>
                        ) : (
                          selectedComments.map(comment => (
                            <div key={comment.id} className="rounded-xl border border-border bg-card p-3">
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 text-xs text-muted mb-1">
                                    <span className="font-semibold text-ink">{comment.author || 'Admin'}</span>
                                    <span>•</span>
                                    <span>{new Date(comment.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  <p className="text-sm text-ink whitespace-pre-wrap">{comment.content}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => deleteComment(comment.id)}
                                  className="text-[10px] text-status-danger font-semibold px-2 py-1 rounded hover:bg-status-danger/10"
                                >
                                  Excluir
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {false && checklistModalItemId && (
                      <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4">
                        <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card p-4">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold">
                              Checklist técnico - Item {selectedItems.find(item => item.id === checklistModalItemId)?.numero_item || '-'}
                            </h4>
                            <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs font-semibold" onClick={() => setChecklistModalItemId(null)}>
                              Fechar
                            </button>
                          </div>

                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <input
                              className="h-8 rounded-lg border border-border bg-cardAlt px-2 text-xs md:col-span-2"
                              placeholder="Novo requisito técnico"
                              value={(newItemRequirementForm[checklistModalItemId]?.requisito) || ''}
                              onChange={(event) => setNewItemRequirementForm(prev => ({
                                ...prev,
                                [checklistModalItemId]: {
                                  ...(prev[checklistModalItemId] || { status: 'verificar', observacao: '', custo_subitem: '' }),
                                  requisito: event.target.value,
                                },
                              }))}
                            />
                            <input
                              className="h-8 rounded-lg border border-border bg-cardAlt px-2 text-xs"
                              placeholder="Observação"
                              value={(newItemRequirementForm[checklistModalItemId]?.observacao) || ''}
                              onChange={(event) => setNewItemRequirementForm(prev => ({
                                ...prev,
                                [checklistModalItemId]: {
                                  ...(prev[checklistModalItemId] || { status: 'verificar', requisito: '', custo_subitem: '' }),
                                  observacao: event.target.value,
                                },
                              }))}
                            />
                            <input
                              className="h-8 rounded-lg border border-border bg-cardAlt px-2 text-xs"
                              placeholder="Custo acessório"
                              value={(newItemRequirementForm[checklistModalItemId]?.custo_subitem) || ''}
                              onChange={(event) => setNewItemRequirementForm(prev => ({
                                ...prev,
                                [checklistModalItemId]: {
                                  ...(prev[checklistModalItemId] || { status: 'verificar', requisito: '', observacao: '' }),
                                  custo_subitem: event.target.value,
                                },
                              }))}
                            />
                            <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs font-semibold md:col-span-4 justify-self-end" onClick={() => addItemRequirement(checklistModalItemId)}>
                              Adicionar requisito
                            </button>
                          </div>

                          <div className="mt-3 space-y-2">
                            {(itemRequirementsMap[checklistModalItemId] || []).map(req => (
                              <div key={req.id} className="rounded-lg border border-border bg-cardAlt p-2 grid gap-2 md:grid-cols-7">
                                <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs md:col-span-2" value={req.requisito || ''} onChange={(event) => updateItemRequirement(checklistModalItemId, req.id, { requisito: event.target.value })} />
                                <div className="h-8 rounded-lg border border-border bg-card px-1 flex items-center gap-1">
                                  <button type="button" className={`flex-1 h-6 rounded text-[11px] font-semibold ${req.status === 'ok' ? 'bg-status-success/15 text-status-success' : 'text-muted'}`} onClick={() => updateItemRequirement(checklistModalItemId, req.id, { status: 'ok' })}>OK</button>
                                  <button type="button" className={`flex-1 h-6 rounded text-[11px] font-semibold ${req.status === 'nao_ok' ? 'bg-status-danger/15 text-status-danger' : 'text-muted'}`} onClick={() => updateItemRequirement(checklistModalItemId, req.id, { status: 'nao_ok' })}>Não OK</button>
                                  <button type="button" className={`flex-1 h-6 rounded text-[11px] font-semibold ${req.status === 'verificar' || req.status === 'pendente' ? 'bg-status-warning/15 text-status-warning' : 'text-muted'}`} onClick={() => updateItemRequirement(checklistModalItemId, req.id, { status: 'verificar' })}>Verificar</button>
                                </div>
                                <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Observação" value={req.observacao || ''} onChange={(event) => updateItemRequirement(checklistModalItemId, req.id, { observacao: event.target.value })} />
                                <input className="h-8 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Custo acessório" value={req.valor_ofertado || ''} onChange={(event) => updateItemRequirement(checklistModalItemId, req.id, { valor_ofertado: event.target.value ? Number(String(event.target.value).replace(',', '.')) : null })} />
                                <button type="button" className="h-8 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger px-2 text-xs font-semibold" onClick={() => deleteItemRequirement(checklistModalItemId, req.id)}>Excluir</button>
                              </div>
                            ))}
                            {(itemRequirementsMap[checklistModalItemId] || []).length === 0 && (
                              <p className="text-xs text-muted">Nenhum requisito técnico cadastrado.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {activeView === 'Overview' && (
            <div className="mt-6 space-y-12">
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs text-muted">Total de leads (SDR)</p>
                  <p className="text-2xl font-semibold mt-2">
                    {overviewData.summary?.leads_count ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs text-muted">Total de clientes (CS)</p>
                  <p className="text-2xl font-semibold mt-2">
                    {overviewData.summary?.customers_count ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs text-muted">Oportunidade total</p>
                  <p className="text-2xl font-semibold mt-2">
                    {formatCurrency(overviewData.summary?.total_value) || 'R$ 0,00'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs text-muted">Oportunidade total (Licitações)</p>
                  <p className="text-2xl font-semibold mt-2">
                    {formatCurrency(overviewData.licitacaoSummary?.total_value) || 'R$ 0,00'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-xs text-muted">Oportunidades licitatórias</p>
                  <p className="text-2xl font-semibold mt-2">
                    {overviewData.licitacaoSummary?.opportunities_count ?? 0}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Vencendo em 48h: {overviewData.licitacaoSummary?.due_48h ?? 0} | Atrasadas: {overviewData.licitacaoSummary?.overdue_count ?? 0}
                  </p>
                </div>
              </div>

              {overviewLoading && (
                <div className="text-sm text-muted">Carregando dados do overview...</div>
              )}

              {!overviewLoading && (
                <div className="space-y-10">
                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Quantidade por grupo</h3>
                      </div>
                      <div className="h-64">
                        <ResponsiveBar
                          data={stageGroupData}
                          keys={['count']}
                          indexBy="group"
                          margin={{ top: 20, right: 20, bottom: 40, left: 60 }}
                          padding={0.35}
                          colors={({ data }) => data.color}
                          enableLabel={true}
                          label={d => formatCompactNumber(d.value) || d.value}
                          labelTextColor="#ffffff"
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => formatCompactNumber(value) || value }}
                          axisBottom={{ tickSize: 0, tickPadding: 6 }}
                          theme={chartTheme}
                          tooltip={({ data }) => (
                            <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs">
                              <div className="font-semibold mb-2" style={{ color: data.color }}>{data.group}</div>
                              <div className="text-muted mb-1">Total: <span className="font-semibold text-ink">{formatCompactNumber(data.count) || data.count}</span></div>
                              {data.detalhes.length > 0 && (
                                <div className="border-t border-border pt-2 mt-1 space-y-0.5">
                                  {data.detalhes.map(d => (
                                    <div key={d.stage} className="flex justify-between gap-3">
                                      <span className="text-muted">{d.stageNumber}. {d.stageLabel}</span>
                                      <span className="font-medium text-ink">{d.count}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por grupo</h3>
                      <div className="h-64">
                        <ResponsiveBar
                          data={stageGroupData}
                          keys={['totalValue']}
                          indexBy="group"
                          margin={{ top: 20, right: 20, bottom: 40, left: 70 }}
                          padding={0.35}
                          colors={({ data }) => data.color}
                          enableLabel={true}
                          label={d => formatCompactCurrency(d.value) || 'R$ 0'}
                          labelTextColor="#ffffff"
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => formatCompactCurrency(value) || value }}
                          axisBottom={{ tickSize: 0, tickPadding: 6 }}
                          theme={chartTheme}
                          tooltip={({ data }) => (
                            <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-xs">
                              <div className="font-semibold mb-2" style={{ color: data.color }}>{data.group}</div>
                              <div className="text-muted mb-1">Total: <span className="font-semibold text-ink">{formatCompactCurrency(data.totalValue) || 'R$ 0'}</span></div>
                              {data.detalhes.length > 0 && (
                                <div className="border-t border-border pt-2 mt-1 space-y-0.5">
                                  {data.detalhes.map(d => (
                                    <div key={d.stage} className="flex justify-between gap-3">
                                      <span className="text-muted">{d.stageNumber}. {d.stageLabel}</span>
                                      <span className="font-medium text-ink">{formatCompactCurrency(d.totalValue) || 'R$ 0'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Leads por etiqueta</h3>
                      <div className="h-64">
                        <ResponsiveBar
                          data={labelCountData}
                          keys={['value']}
                          indexBy="label"
                          margin={{ top: 20, right: 20, bottom: 40, left: 140 }}
                          padding={0.3}
                          layout="horizontal"
                          colors={({ data }) => data.color || '#60a5fa'}
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6 }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por etiqueta</h3>
                      <div className="h-64">
                        <ResponsiveBar
                          data={labelValueData}
                          keys={['value']}
                          indexBy="label"
                          margin={{ top: 20, right: 20, bottom: 40, left: 140 }}
                          padding={0.3}
                          layout="horizontal"
                          colors={({ data }) => data.color || '#3b82f6'}
                          enableLabel={false}
                          valueFormat={value => formatCurrency(value) || 'R$ 0,00'}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactCurrency(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Leads por estado</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={stateCountData}
                          keys={['value']}
                          indexBy="state"
                          margin={{ top: 20, right: 20, bottom: 40, left: 80 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#60a5fa"
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactNumber(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por estado</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={stateValueData}
                          keys={['value']}
                          indexBy="state"
                          margin={{ top: 20, right: 20, bottom: 40, left: 80 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#3b82f6"
                          enableLabel={false}
                          valueFormat={value => formatCurrency(value) || 'R$ 0,00'}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactCurrency(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Leads por agente</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={agentCountData}
                          keys={['value']}
                          indexBy="agent"
                          margin={{ top: 20, right: 20, bottom: 40, left: 140 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#60a5fa"
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, format: value => formatCompactNumber(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por agente</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={agentValueData}
                          keys={['value']}
                          indexBy="agent"
                          margin={{ top: 20, right: 20, bottom: 40, left: 140 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#3b82f6"
                          enableLabel={false}
                          valueFormat={value => formatCurrency(value) || 'R$ 0,00'}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactCurrency(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Leads por canal</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={channelCountData}
                          keys={['value']}
                          indexBy="channel"
                          margin={{ top: 20, right: 20, bottom: 40, left: 140 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#60a5fa"
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactNumber(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Leads por tipo de cliente</h3>
                      <div className="h-96">
                        <ResponsiveBar
                          data={customerTypeCountData}
                          keys={['value']}
                          indexBy="customerType"
                          margin={{ top: 20, right: 20, bottom: 40, left: 160 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#3b82f6"
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactNumber(value) || value }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold">Oportunidade por probabilidade de fechamento</h3>
                    <div className="h-96">
                      <ResponsiveBar
                        data={probabilityValueData}
                        keys={['value']}
                        indexBy="probability"
                        margin={{ top: 20, right: 20, bottom: 40, left: 220 }}
                        padding={0.3}
                        layout="horizontal"
                        colors="#2563eb"
                        enableLabel={false}
                        axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                        axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactCurrency(value) || value }}
                        theme={{
                          ...chartTheme,
                          legends: {
                            text: {
                              fill: isDarkMode ? '#ffffff' : chartTheme.textColor,
                            },
                          },
                        }}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Evolução por quantidade (por grupo)</h3>
                      <select
                        value={historyGranularity}
                        onChange={(event) => setHistoryGranularity(event.target.value)}
                        className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-ink"
                      >
                        <option value="day">Diario</option>
                        <option value="week">Semanal</option>
                        <option value="month">Mensal</option>
                      </select>
                    </div>
                    <div className="h-80">
                      <ResponsiveLine
                        data={historySeries}
                        margin={{ top: 20, right: 40, bottom: 70, left: 50 }}
                        xScale={{ type: 'point' }}
                        yScale={{ type: 'linear', min: 0, max: 'auto', stacked: true }}
                        curve="monotoneX"
                        axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: -35, tickValues: historyTicks, format: historyTickFormat }}
                        axisLeft={{ tickSize: 0, tickPadding: 6, format: value => formatCompactNumber(value) || value }}
                        colors={({ id }) => colorForGroupLabel(id)}
                        enableArea
                        areaOpacity={0.55}
                        enableGridX={false}
                        lineWidth={2}
                        pointSize={6}
                        pointBorderWidth={1.5}
                        pointBorderColor={{ from: 'serieColor' }}
                        pointColor={isDarkMode ? '#0f172a' : '#ffffff'}
                        useMesh
                        crosshairType="x"
                        sliceTooltip={({ slice }) => {
                          const total = slice.points.reduce((a, p) => a + (p.data.y || 0), 0);
                          return (
                            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-ink shadow-card min-w-[160px]">
                              <div className="font-semibold mb-1">{formatHistoryTooltipDate(slice.points[0].data.x)}</div>
                              <div className="space-y-0.5">
                                {[...slice.points].reverse().map(point => (
                                  <div key={point.id} className="flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-1.5">
                                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: point.serieColor }} />
                                      <span>{point.serieId}</span>
                                    </span>
                                    <span className="font-medium">{formatCompactNumber(point.data.y) || point.data.y}</span>
                                  </div>
                                ))}
                                <div className="border-t border-border mt-1 pt-1 flex justify-between font-semibold">
                                  <span>Total</span>
                                  <span>{formatCompactNumber(total) || total}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                        enableSlices="x"
                        legends={[
                          {
                            anchor: 'bottom',
                            direction: 'row',
                            justify: false,
                            translateX: 0,
                            translateY: 58,
                            itemsSpacing: 12,
                            itemDirection: 'left-to-right',
                            itemWidth: 120,
                            itemHeight: 18,
                            itemOpacity: 0.85,
                            itemTextColor: isDarkMode ? '#ffffff' : '#1f2937',
                            symbolSize: 12,
                            symbolShape: 'square',
                            textColor: isDarkMode ? '#f8fafc' : '#1f2937',
                            effects: [
                              {
                                on: 'hover',
                                style: { itemOpacity: 1 },
                              },
                            ],
                          },
                        ]}
                        theme={chartTheme}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeView === 'Busca Lead B2B' && (() => { // eslint-disable-line no-extra-parens
            // ── Helpers ──────────────────────────────────────────────────
            const fmtCNPJ = (v) => {
              const d = String(v || '').replace(/[^\d]/g, '').padStart(14, '0').slice(-14);
              return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
            };
            const fmtCapital = (v) => {
              const n = Number(String(v || '').replace(',', '.'));
              if (!n) return '—';
              return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(n);
            };
            const calcAge = (dateStr) => {
              if (!dateStr || dateStr === '00000000') return null;
              const s = String(dateStr).replace(/\D/g, '');
              if (s.length < 8) return null;
              const y = parseInt(s.slice(0, 4), 10);
              const mo = parseInt(s.slice(4, 6), 10) - 1;
              const d = parseInt(s.slice(6, 8), 10);
              const diff = (Date.now() - new Date(y, mo, d).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
              const years = Math.floor(diff);
              if (years < 0 || years > 200) return null;
              return years < 1 ? '< 1 ano' : `${years} ${years === 1 ? 'ano' : 'anos'}`;
            };
            const fmtDate = (dateStr) => {
              if (!dateStr || dateStr === '00000000') return dateStr || '—';
              const s = String(dateStr).replace(/\D/g, '');
              if (s.length < 8) return dateStr;
              return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
            };
            const situacaoClass = (s) => {
              const v = String(s || '');
              if (v === 'Ativa'   || v === '2' || v === '02') return 'bg-status-success/10 text-status-success border-status-success/30';
              if (v === 'Inapta'  || v === 'Baixada' || v === '4' || v === '04' || v === '8' || v === '08') return 'bg-status-danger/10 text-status-danger border-status-danger/30';
              if (v === 'Suspensa'|| v === '3' || v === '03') return 'bg-status-warning/10 text-status-warning border-status-warning/30';
              return 'bg-cardAlt text-muted border-border';
            };
            const SITUACAO_MAP = { '1': 'Nula', '01': 'Nula', '2': 'Ativa', '02': 'Ativa', '3': 'Suspensa', '03': 'Suspensa', '4': 'Inapta', '04': 'Inapta', '8': 'Baixada', '08': 'Baixada' };
            const situacaoLabel = (s) => SITUACAO_MAP[String(s || '')] || s || '—';
            const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

            // ── Import ────────────────────────────────────────────────────
            const openImportDialog = (row, isDup) => {
              setRfbImportDialogStage(leadImportSettings.defaultStage);
              setRfbImportDialogLabels([]);
              const socioList = (row.socios_nomes || '').split(' · ').filter(Boolean);
              const adminEntry = socioList.find(s => /administr/i.test(s)) || socioList[0] || '';
              setRfbImportDialogSocio(adminEntry.replace(/\s*\(.*\)\s*$/, '').trim());
              const fmtDialogTel = (ddd, tel) => {
                if (!ddd || !tel) return '';
                const d = String(ddd).replace(/\D/g, '');
                const t = String(tel).replace(/\D/g, '');
                return d && t ? `+55${d}${t}` : '';
              };
              setRfbImportDialogTel1(fmtDialogTel(row.ddd1, row.telefone1));
              setRfbImportDialogEmail(row.correio_eletronico || '');
              setRfbImportDialogRegimes({
                simples: row.opcao_pelo_simples === 'S',
                mei: row.opcao_pelo_mei === 'S',
                presumido: false,
                real: false,
              });
              setRfbImportDialog({ row, isDup });
              if (chatwootLabels.length === 0) {
                axios.get('/api/labels').then(r => setChatwootLabels(r.data || [])).catch(() => {});
              }
            };

            const saveRfbFilter = () => {
              const name = rfbSaveFilterName.trim();
              if (!name) return;
              const snapshot = { name, filters: rfbFilters, ops: rfbOps, capitalRange: rfbCapitalRange, aberturaRange: rfbAberturaRange, endereco: rfbEndereco, enderecoOp: rfbEnderecoOp, simples: rfbSimples, mei: rfbMei, onlyMatriz: rfbOnlyMatriz, nome2: rfbNome2, nome2Op: rfbNome2Op, nomeLogic: rfbNomeLogic, socio2: rfbSocio2, socio2Op: rfbSocio2Op, socioLogic: rfbSocioLogic, endereco2: rfbEndereco2, endereco2Op: rfbEndereco2Op, enderecoLogic: rfbEnderecoLogic, cnaeOnlyPrincipal: rfbCnaeOnlyPrincipal };
              const updated = [...rfbSavedFilters, snapshot];
              setRfbSavedFilters(updated);
              localStorage.setItem('rfb_saved_filters', JSON.stringify(updated));
              setRfbSaveFilterName('');
            };

            const applyRfbSavedFilter = (sf) => {
              if (sf.filters) setRfbFilters(sf.filters);
              if (sf.ops) setRfbOps(sf.ops);
              if (sf.capitalRange) setRfbCapitalRange(sf.capitalRange);
              if (sf.aberturaRange) setRfbAberturaRange(sf.aberturaRange);
              if (sf.endereco != null) setRfbEndereco(sf.endereco);
              if (sf.enderecoOp) setRfbEnderecoOp(sf.enderecoOp);
              if (sf.simples != null) setRfbSimples(sf.simples);
              if (sf.mei != null) setRfbMei(sf.mei);
              if (sf.onlyMatriz != null) setRfbOnlyMatriz(sf.onlyMatriz);
              if (sf.nome2 != null) setRfbNome2(sf.nome2);
              if (sf.nome2Op) setRfbNome2Op(sf.nome2Op);
              if (sf.nomeLogic) setRfbNomeLogic(sf.nomeLogic);
              if (sf.socio2 != null) setRfbSocio2(sf.socio2);
              if (sf.socio2Op) setRfbSocio2Op(sf.socio2Op);
              if (sf.socioLogic) setRfbSocioLogic(sf.socioLogic);
              if (sf.endereco2 != null) setRfbEndereco2(sf.endereco2);
              if (sf.endereco2Op) setRfbEndereco2Op(sf.endereco2Op);
              if (sf.enderecoLogic) setRfbEnderecoLogic(sf.enderecoLogic);
            };

            const handleRfbImport = async (row, { stage, labels } = {}) => {
              const cleanCNPJ = String(row.cnpj || '').replace(/\D/g, '');
              const socioName = rfbImportDialogSocio.trim();
              const partes = socioName ? socioName.split(/\s+/) : [];
              const primeiro_nome = socioName ? partes[0] : (row.razao_social || '');
              const sobrenome = partes.length > 1 ? partes.slice(1).join(' ') : '';
              const lead = {
                cnpj: cleanCNPJ,
                razao_social: row.razao_social,
                primeiro_nome,
                sobrenome,
                email: rfbImportDialogEmail || null,
                ddd_telefone_1: rfbImportDialogTel1 || null,
                municipio: row.municipio_nome,
                uf: row.uf,
                nome_fantasia: row.nome_fantasia,
                cnae_fiscal_descricao: row.cnae_descricao,
                cnae_fiscal: row.cnae_fiscal_principal,
                capital_social: String(row.capital_social || '').replace(',', '.'),
                descricao_situacao_cadastral: situacaoLabel(row.situacao_cadastral),
                data_inicio_atividade: row.data_de_inicio_da_atividade,
                descricao_porte: row.porte_da_empresa,
                opcao_pelo_simples: rfbImportDialogRegimes.simples,
                opcao_pelo_mei: rfbImportDialogRegimes.mei,
                qsa: socioName ? [{ nome: socioName }] : [],
              };
              const isExisting = Boolean(leadExistingCNPJs[cleanCNPJ]);
              setRfbImportDialog(null);
              setLeadImportLoading(true);
              setLeadImportStatus(null);
              try {
                const r = await axios.post('/api/leads/import', {
                  leads: [lead],
                  defaultStage: stage || leadImportSettings.defaultStage,
                  overwriteDuplicates: isExisting || leadImportSettings.overwriteDuplicates,
                  labels: labels || [],
                });
                setLeadImportStatus(r.data);
                axios.get('/api/leads/existing-cnpjs').then(x => setLeadExistingCNPJs(x.data || {})).catch(() => {});
              } catch (e) {
                setLeadImportStatus({ error: e.response?.data?.error || 'Erro ao importar.' });
              } finally { setLeadImportLoading(false); }
            };

            // ── Search ────────────────────────────────────────────────────
            // Normaliza acentos para usar índice pg_trgm no backend
            const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const RFB_CACHE_SIZE = 500;
            const sortRfbResults = (arr, ob) => {
              const r = [...arr];
              const cap = v => parseFloat(String(v || 0).replace(/\./g, '').replace(',', '.')) || 0;
              if (ob === 'razao_social')  return r.sort((a, b) => (a.razao_social  || '').localeCompare(b.razao_social  || '', 'pt-BR'));
              if (ob === 'nome_fantasia') return r.sort((a, b) => (a.nome_fantasia || '').localeCompare(b.nome_fantasia || '', 'pt-BR'));
              if (ob === 'uf')            return r.sort((a, b) => (a.uf            || '').localeCompare(b.uf            || '', 'pt-BR'));
              if (ob === 'situacao')      return r.sort((a, b) => (a.situacao_cadastral || '').localeCompare(b.situacao_cadastral || '', 'pt-BR'));
              if (ob === 'capital_desc')  return r.sort((a, b) => cap(b.capital_social) - cap(a.capital_social));
              if (ob === 'capital_asc')   return r.sort((a, b) => cap(a.capital_social) - cap(b.capital_social));
              if (ob === 'abertura_desc') return r.sort((a, b) => (b.data_de_inicio_da_atividade || '').localeCompare(a.data_de_inicio_da_atividade || ''));
              if (ob === 'abertura_asc')  return r.sort((a, b) => (a.data_de_inicio_da_atividade || '').localeCompare(b.data_de_inicio_da_atividade || ''));
              return r;
            };
            const buildFilterParams = () => {
              const fp = new URLSearchParams();
              if (rfbFilters.cnpj.trim()) fp.set('cnpj', rfbFilters.cnpj.trim());
              if (rfbFilters.nome.trim()) { fp.set('nome', stripAccents(rfbFilters.nome.trim())); fp.set('nome_op', rfbOps.nome); }
              if (rfbNome2.trim()) { fp.set('nome2', stripAccents(rfbNome2.trim())); fp.set('nome2_op', rfbNome2Op); }
              if (rfbFilters.nome.trim() && rfbNome2.trim()) fp.set('nome_logic', rfbNomeLogic);
              if (rfbFilters.socio.trim()) { fp.set('socio', stripAccents(rfbFilters.socio.trim())); fp.set('socio_op', rfbOps.socio); }
              if (rfbSocio2.trim()) { fp.set('socio2', stripAccents(rfbSocio2.trim())); fp.set('socio2_op', rfbSocio2Op); }
              if (rfbFilters.socio.trim() && rfbSocio2.trim()) fp.set('socio_logic', rfbSocioLogic);
              if (rfbFilters.uf.trim()) fp.set('uf', rfbFilters.uf.trim());
              if (rfbFilters.municipio.trim()) fp.set('municipio', rfbFilters.municipio.trim());
              if (rfbFilters.cnae.length > 0) fp.set('cnae', rfbFilters.cnae.join(','));
              if (rfbFilters.cnaeNot.length > 0) fp.set('cnae_not', rfbFilters.cnaeNot.join(','));
              if ((rfbFilters.cnae.length > 0 || rfbFilters.cnaeNot.length > 0) && rfbCnaeOnlyPrincipal) fp.set('cnae_only_principal', 'true');
              if (rfbFilters.situacao.length > 0) fp.set('situacao', rfbFilters.situacao.join(','));
              if (rfbFilters.porte.trim()) fp.set('porte', rfbFilters.porte.trim());
              if (rfbFilters.natureza.length > 0) fp.set('natureza', rfbFilters.natureza.join(','));
              if (rfbCapitalRange[0] > 0) fp.set('capital_min', rfbCapitalRange[0]);
              if (rfbCapitalRange[1] > 0) fp.set('capital_max', rfbCapitalRange[1]);
              if (rfbAberturaRange[0] > 0) fp.set('abertura_min_anos', rfbAberturaRange[0]);
              if (rfbAberturaRange[1] > 0) fp.set('abertura_max_anos', rfbAberturaRange[1]);
              if (rfbEndereco.trim()) { fp.set('endereco', stripAccents(rfbEndereco.trim())); fp.set('endereco_op', rfbEnderecoOp); }
              if (rfbEndereco2.trim()) { fp.set('endereco2', stripAccents(rfbEndereco2.trim())); fp.set('endereco2_op', rfbEndereco2Op); }
              if (rfbEndereco.trim() && rfbEndereco2.trim()) fp.set('endereco_logic', rfbEnderecoLogic);
              if (rfbSimples) fp.set('simples', rfbSimples);
              if (rfbMei) fp.set('mei', rfbMei);
              if (!rfbOnlyMatriz) fp.set('only_matriz', 'false');
              return fp;
            };
            const handleRfbSearch = async (pageOverride, pageSizeOverride, orderByOverride) => {
              const pg = pageOverride     != null ? pageOverride     : rfbPage;
              const ps = pageSizeOverride != null ? pageSizeOverride : rfbPageSize;
              const ob = orderByOverride  != null ? orderByOverride  : rfbOrderBy;
              if (pg === 1) setRfbExpanded(null);

              const fp = buildFilterParams();
              const filterKey = fp.toString();
              const cache = rfbCacheRef.current;
              const start = (pg - 1) * ps;

              // Serve from cache when filters unchanged and page is within cached batch
              if (cache.key === filterKey && cache.results.length > 0 && start < cache.results.length) {
                const sorted = sortRfbResults(cache.results, ob);
                setRfbResults(sorted.slice(start, start + ps));
                setRfbTotal(cache.total);
                setRfbPage(pg);
                return;
              }

              setRfbLoading(true);
              setRfbError(null);
              try {
                const params = new URLSearchParams(fp);
                if (cache.key === filterKey && start >= cache.results.length) {
                  // Beyond cache — fetch specific page with server sort + known_total
                  params.set('page', pg);
                  params.set('page_size', ps);
                  params.set('order_by', ob);
                  if (rfbTotal > 0) params.set('known_total', rfbTotal);
                  const res = await axios.get(`/api/rfb/search?${params}`);
                  setRfbResults(res.data.results || []);
                  setRfbTotal(res.data.total || rfbTotal);
                  setRfbPage(pg);
                } else {
                  // New filters — fetch full cache batch
                  params.set('page', 1);
                  params.set('page_size', RFB_CACHE_SIZE);
                  params.set('order_by', 'razao_social');
                  const res = await axios.get(`/api/rfb/search?${params}`);
                  const all   = res.data.results || [];
                  const total = res.data.total   || 0;
                  rfbCacheRef.current = { results: all, total, key: filterKey };
                  const sorted = sortRfbResults(all, ob);
                  setRfbResults(sorted.slice(start, start + ps));
                  setRfbTotal(total);
                  setRfbPage(pg);
                  try { localStorage.setItem('rfb_search', JSON.stringify({ filters: rfbFilters, ops: rfbOps, orderBy: ob, pageSize: ps, capitalRange: rfbCapitalRange, aberturaRange: rfbAberturaRange, endereco: rfbEndereco, enderecoOp: rfbEnderecoOp, simples: rfbSimples, mei: rfbMei, onlyMatriz: rfbOnlyMatriz, cnaeOnlyPrincipal: rfbCnaeOnlyPrincipal })); } catch {}
                }
              } catch (e) {
                const status = e.response?.status;
                const msg = e.response?.data?.error || e.message || 'Erro na busca.';
                setRfbError(status === 504 ? 'Tempo limite excedido — busca muito ampla ou índice ainda sendo criado.' : msg);
                // Limpa resultados antigos pra não confundir com a busca que falhou
                setRfbResults([]);
                setRfbTotal(0);
                rfbCacheRef.current = { results: [], total: 0, key: null };
              } finally { setRfbLoading(false); }
            };

            const handleClear = () => {
              const empty = { cnpj: '', nome: '', socio: '', uf: '', municipio: '', cnae: [], cnaeNot: [], situacao: ['2'], porte: '', natureza: [] };
              setRfbFilters(empty);
              setRfbOps({ nome: 'contains', socio: 'contains' });
              setRfbCapitalRange([0, 0]);
              setRfbAberturaRange([0, 0]);
              setRfbEndereco(''); setRfbEnderecoOp('contains');
              setRfbNome2(''); setRfbNome2Op('contains'); setRfbNomeLogic('AND'); setRfbNomeExpanded(false);
              setRfbSocio2(''); setRfbSocio2Op('contains'); setRfbSocioLogic('AND'); setRfbSocioExpanded(false);
              setRfbEndereco2(''); setRfbEndereco2Op('contains'); setRfbEnderecoLogic('AND'); setRfbEnderecoExpanded(false);
              setRfbSimples('');
              setRfbMei('');
              setRfbOnlyMatriz(true);
              setRfbFiliais({});
              setRfbCnaeInput('');
              setRfbCnaeNotInput('');
              setRfbCnaeOnlyPrincipal(false);
              setRfbMunicipioInput('');
              setRfbNatInput('');
              setRfbResults([]);
              setRfbTotal(0);
              setRfbPage(1);
              setRfbError(null);
              setLeadImportStatus(null);
              rfbCacheRef.current = { results: [], total: 0, key: null };
              try { localStorage.removeItem('rfb_search'); } catch {}
            };

            const totalPages = Math.ceil(rfbTotal / rfbPageSize);

            // CNAE dropdown — separado para "contém" (cnae) e "não contém" (cnaeNot)
            const cnaeQuery = rfbCnaeInput.trim().toLowerCase();
            const cnaeNotQuery = rfbCnaeNotInput.trim().toLowerCase();
            const filteredCnaes = cnaeQuery.length >= 1
              ? rfbCnaes.filter(c => !rfbFilters.cnae.includes(c.codigo) && (c.codigo.includes(cnaeQuery) || c.descricao.toLowerCase().includes(cnaeQuery))).slice(0, 30)
              : [];
            const filteredCnaesNot = cnaeNotQuery.length >= 1
              ? rfbCnaes.filter(c => !rfbFilters.cnaeNot.includes(c.codigo) && (c.codigo.includes(cnaeNotQuery) || c.descricao.toLowerCase().includes(cnaeNotQuery))).slice(0, 30)
              : [];

            // Município dropdown
            const munQuery = rfbMunicipioInput.trim().toUpperCase();
            const filteredMunicipios = munQuery.length >= 2
              ? rfbMunicipios.filter(m => m.descricao.toUpperCase().includes(munQuery) || m.codigo.includes(munQuery)).slice(0, 30)
              : [];
            const munLabel = rfbFilters.municipio
              ? (rfbMunicipios.find(m => m.codigo === rfbFilters.municipio)?.descricao || rfbFilters.municipio)
              : null;

            // ── Loading state ────────────────────────────────────────────
            if (rfbStatus === null) return (
              <div className="mt-6 flex items-center justify-center py-20">
                <div className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              </div>
            );

            // ── Not imported / importing state ────────────────────────────
            if (!rfbStatus?.imported) {
              const prog = rfbImportProgress;
              const isRunning = prog?.status === 'running';
              const isError = prog?.status === 'error';
              return (
                <div className="mt-6">
                  <div className="rounded-3xl border border-border bg-card p-8 shadow-card max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-2">Prospecção</p>
                    <h2 className="text-2xl font-semibold mb-2">Busca de Leads</h2>

                    {isError ? (
                      <div className="mb-4">
                        <p className="text-sm text-status-danger mb-3">Erro durante a importação:</p>
                        <p className="text-xs font-mono bg-cardAlt border border-border rounded-xl p-3 text-status-danger">{prog.error || prog.message}</p>
                        <button
                          onClick={() => axios.post('/api/rfb/import/start', { staging: true }).then(() => axios.get('/api/rfb/import-progress').then(r => setRfbImportProgress(r.data))).catch(() => {})}
                          className="mt-4 text-sm px-4 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    ) : isRunning ? (
                      <div className="mb-4 space-y-3">
                        <p className="text-sm text-muted">{prog.message || 'Importando dados da Receita Federal...'}</p>
                        {prog.file && <p className="text-xs text-muted truncate">{prog.file}</p>}
                        <div className="w-full h-2 bg-cardAlt rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(5, prog.percent || 0)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-muted">
                          <span>{prog.percent || 0}%</span>
                          {prog.records > 0 && <span>{prog.records.toLocaleString('pt-BR')} registros</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <p className="text-sm text-muted mb-4">
                          Importação em andamento — atualizando a cada 15s
                        </p>
                        {/* Etapas do import */}
                        {(() => {
                          const rec = rfbStatus?.records || {};
                          const steps = [
                            { label: 'Tabelas de referência', done: (rec.cnaes || 0) > 0 || (rec.municipios || 0) > 0 },
                            { label: 'Empresas', count: rec.empresas, target: 8000000 },
                            { label: 'Estabelecimentos', count: rec.estabelecimentos, target: 10000000 },
                            { label: 'Sócios', count: rec.socios, target: 22000000 },
                          ];
                          const totalTarget = 40000000;
                          const totalDone = (rec.empresas || 0) + (rec.estabelecimentos || 0) + (rec.socios || 0);
                          const pct = Math.min(99, Math.round((totalDone / totalTarget) * 100));
                          return (
                            <>
                              <div className="space-y-2 mb-4">
                                {steps.map(s => (
                                  <div key={s.label} className="flex items-center gap-2 text-xs">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.count > 0 || s.done ? 'bg-primary' : 'bg-border animate-pulse'}`} />
                                    <span className={s.count > 0 || s.done ? 'text-ink' : 'text-muted'}>{s.label}</span>
                                    {s.count > 0 && (
                                      <span className="ml-auto text-muted">{s.count.toLocaleString('pt-BR')} registros</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="w-full h-1.5 bg-cardAlt rounded-full overflow-hidden mb-1">
                                {totalDone > 0
                                  ? <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${Math.max(3, pct)}%` }} />
                                  : <div className="h-full bg-primary/40 rounded-full animate-pulse" style={{ width: '100%' }} />
                                }
                              </div>
                              {totalDone > 0 && (
                                <p className="text-xs text-muted text-right">{pct}% — {totalDone.toLocaleString('pt-BR')} de ~18M registros</p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // ── Full search UI ────────────────────────────────────────────
            return (
              <div className="mt-6">
                {/* Header */}
                <div className="rounded-3xl border border-border bg-card p-6 lg:p-8 shadow-card mb-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Prospecção</p>
                      <h2 className="mt-1 text-2xl md:text-3xl font-semibold">Busca de Leads</h2>
                      <p className="mt-1 text-sm text-muted">
                        Dados abertos da Receita Federal — uso local
                        {rfbStatus?.dev_limit > 0 && (
                          <span className="ml-2 text-xs bg-status-warning/10 text-status-warning border border-status-warning/30 rounded-full px-2 py-0.5">
                            amostra ({rfbStatus.dev_limit} arq./cat.)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
                      <span><span className="font-semibold text-ink">{(rfbStatus?.records?.estabelecimentos || 0).toLocaleString('pt-BR')}</span> estabelecimentos</span>
                      <span><span className="font-semibold text-ink">{(rfbStatus?.records?.empresas || 0).toLocaleString('pt-BR')}</span> empresas</span>
                      <span><span className={`font-semibold ${Math.max(0, rfbStatus?.records?.socios || 0) === 0 ? 'text-status-warning' : 'text-ink'}`}>{Math.max(0, rfbStatus?.records?.socios || 0).toLocaleString('pt-BR')}</span> sócios</span>
                      <button
                        onClick={() => setRfbUpdateConfirm(true)}
                        className="text-xs px-3 py-1.5 rounded-xl border border-border bg-cardAlt text-muted hover:text-ink hover:border-primary/40 transition"
                      >
                        ↺ Atualizar
                      </button>
                      <button
                        onClick={() => setRfbReimportConfirm(true)}
                        className="text-xs px-3 py-1.5 rounded-xl border border-border bg-cardAlt text-muted hover:text-ink transition"
                        title="Opções avançadas de reimport"
                      >
                        ···
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Dialog confirmação de Atualizar (zero-downtime) ─────────── */}
                {rfbUpdateConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setRfbUpdateConfirm(false)}>
                    <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
                      <div>
                        <p className="font-semibold text-ink text-base">Atualizar base da Receita Federal</p>
                        <p className="text-sm text-muted mt-1">Baixa os arquivos novos ou alterados desde o último import e atualiza a base sem derrubar as buscas.</p>
                      </div>

                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-2 text-sm">
                        <ul className="text-ink space-y-1.5 list-none">
                          <li>✓ App continua funcionando durante todo o processo</li>
                          <li>✓ Dados atuais preservados até o swap final (milissegundos)</li>
                          <li>✓ Só baixa o que mudou — muito mais rápido que um reimport completo</li>
                        </ul>
                      </div>

                      <div className="rounded-xl border border-status-warning/30 bg-status-warning/8 p-3 text-sm text-status-warning">
                        <strong>Isso não precisa ser feito manualmente.</strong> Um agendamento automático já executa essa atualização a cada 30 dias. Só faça se precisar dos dados mais recentes antes do próximo ciclo.
                      </div>

                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          autoFocus
                          onClick={() => setRfbUpdateConfirm(false)}
                          className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-ink transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => {
                            setRfbUpdateConfirm(false);
                            axios.post('/api/rfb/import/start', { staging: true })
                              .then(() => axios.get('/api/rfb/import-progress').then(r => setRfbImportProgress(r.data)))
                              .catch(() => {});
                            setRfbStatus(false);
                          }}
                          className="px-4 py-2 rounded-lg border border-primary bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition"
                        >
                          ↺ Confirmar Atualização
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Dialog opções avançadas (··· botão) ────────────────────── */}
                {rfbReimportConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setRfbReimportConfirm(false)}>
                    <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-6 flex flex-col gap-5" onClick={e => e.stopPropagation()}>
                      <p className="font-semibold text-ink text-base">Opções avançadas de importação</p>

                      {/* Gap-fill */}
                      <div className="rounded-xl border border-border bg-cardAlt p-4 flex flex-col gap-2">
                        <p className="font-medium text-ink text-sm">Preencher arquivos faltantes</p>
                        <p className="text-xs text-muted">Baixa e importa apenas os arquivos da RFB que ainda não estão na base — sem apagar nada. Ideal para corrigir gaps de um import anterior incompleto.</p>
                        <div className="flex justify-end mt-1">
                          <button
                            onClick={() => {
                              setRfbReimportConfirm(false);
                              axios.post('/api/rfb/import/start', { append: true })
                                .then(() => axios.get('/api/rfb/import-progress').then(r => setRfbImportProgress(r.data)))
                                .catch(() => {});
                              setRfbStatus(false);
                            }}
                            className="px-4 py-2 rounded-lg border border-primary bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition"
                          >
                            Preencher gaps
                          </button>
                        </div>
                      </div>

                      {/* Reimport completo */}
                      <div className="rounded-xl border border-status-danger/30 bg-status-danger/8 p-4 flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <span className="text-lg mt-0.5">⚠️</span>
                          <div>
                            <p className="font-medium text-ink text-sm">Reimport Completo (destrutivo)</p>
                            <p className="text-xs text-muted mt-0.5">Apaga tudo e rebaixa do zero (~60 GB, 4–8 horas). Buscas ficam indisponíveis.</p>
                          </div>
                        </div>
                        <div className="flex justify-end mt-1">
                          <button
                            onClick={() => {
                              setRfbReimportConfirm(false);
                              axios.post('/api/rfb/import/start', { force: true })
                                .then(() => axios.get('/api/rfb/import-progress').then(r => setRfbImportProgress(r.data)))
                                .catch(() => {});
                              setRfbStatus(false);
                            }}
                            className="px-4 py-2 rounded-lg bg-status-danger/90 hover:bg-status-danger text-white text-sm font-semibold transition"
                          >
                            Sim, Reimport Completo
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          autoFocus
                          onClick={() => setRfbReimportConfirm(false)}
                          className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-ink transition"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Dialog de confirmação de import ───────────────────────── */}
                {rfbImportDialog && (() => {
                  const { row, isDup } = rfbImportDialog;
                  const toggleLabel = (title) => setRfbImportDialogLabels(prev =>
                    prev.includes(title) ? prev.filter(l => l !== title) : [...prev, title]
                  );
                  const toggleRegime = (key) => setRfbImportDialogRegimes(prev => ({ ...prev, [key]: !prev[key] }));
                  const REGIMES = [
                    { key: 'simples', label: 'Simples Nacional' },
                    { key: 'mei', label: 'MEI' },
                    { key: 'presumido', label: 'Lucro Presumido' },
                    { key: 'real', label: 'Lucro Real' },
                  ];
                  return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setRfbImportDialog(null)}>
                      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4 overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div>
                          <p className="text-xs text-muted uppercase tracking-wide mb-0.5">{isDup ? 'Atualizar contato' : 'Importar para o Chatwoot'}</p>
                          <p className="font-semibold text-ink text-base leading-tight">{row.razao_social}</p>
                          {row.nome_fantasia && <p className="text-sm text-muted">{row.nome_fantasia}</p>}
                          <p className="text-xs text-muted font-mono mt-1">{fmtCNPJ(row.cnpj)}</p>
                        </div>

                        {/* Sócio */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">Sócio (contato principal)</label>
                          <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-cardAlt px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="Nome do sócio-administrador"
                            value={rfbImportDialogSocio}
                            onChange={e => setRfbImportDialogSocio(e.target.value)}
                          />
                        </div>

                        {/* Telefone */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">Telefone</label>
                          <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-cardAlt px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="+5511..."
                            value={rfbImportDialogTel1}
                            onChange={e => setRfbImportDialogTel1(e.target.value)}
                          />
                        </div>

                        {/* E-mail */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">E-mail</label>
                          <input
                            type="email"
                            className="w-full rounded-lg border border-border bg-cardAlt px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="contato@empresa.com.br"
                            value={rfbImportDialogEmail}
                            onChange={e => setRfbImportDialogEmail(e.target.value)}
                          />
                        </div>

                        {/* Regime Tributário */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">Regime Tributário</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {REGIMES.map(({ key, label }) => (
                              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  className="accent-primary"
                                  checked={rfbImportDialogRegimes[key]}
                                  onChange={() => toggleRegime(key)}
                                />
                                <span className="text-xs text-ink">{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Estágio */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">Estágio no Chatwoot</label>
                          <select
                            className="w-full rounded-lg border border-border bg-cardAlt px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            value={rfbImportDialogStage}
                            onChange={e => setRfbImportDialogStage(e.target.value)}
                          >
                            {leadColumns.map(col => <option key={col} value={col}>{col}</option>)}
                          </select>
                        </div>

                        {/* Etiquetas */}
                        <div>
                          <label className="block text-xs font-medium text-muted mb-1.5">Etiquetas {chatwootLabels.length === 0 && <span className="text-muted/60">(carregando…)</span>}</label>
                          {chatwootLabels.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {chatwootLabels.map(lbl => {
                                const sel = rfbImportDialogLabels.includes(lbl.title);
                                return (
                                  <button
                                    key={lbl.title}
                                    onClick={() => toggleLabel(lbl.title)}
                                    className={`text-xs px-2.5 py-1 rounded-full border transition ${sel ? 'border-transparent text-white font-medium' : 'border-border text-muted hover:border-primary/40 hover:text-ink'}`}
                                    style={sel ? { backgroundColor: lbl.color || '#6366f1' } : {}}
                                  >
                                    {lbl.title}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex gap-2 justify-end pt-2 border-t border-border">
                          <button
                            onClick={() => setRfbImportDialog(null)}
                            className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-ink hover:border-primary/40 transition"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleRfbImport(row, { stage: rfbImportDialogStage, labels: rfbImportDialogLabels })}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition ${isDup ? 'bg-status-warning hover:bg-status-warning/90' : 'bg-primary hover:bg-primary/90'}`}
                          >
                            {isDup ? 'Atualizar' : 'Importar'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Import status banner */}
                {leadImportStatus && (
                  <div className={`rounded-2xl border p-3 mb-4 text-sm flex flex-wrap gap-3 items-center ${leadImportStatus.error ? 'border-status-danger/30 bg-status-danger/10 text-status-danger' : 'border-status-success/30 bg-status-success/10 text-status-success'}`}>
                    {leadImportStatus.error ? (
                      <span>{leadImportStatus.error}</span>
                    ) : (
                      <>
                        {leadImportStatus.imported > 0 && <span className="font-medium">{leadImportStatus.imported} importado{leadImportStatus.imported !== 1 ? 's' : ''}</span>}
                        {leadImportStatus.updated > 0 && <span className="text-primary font-medium">{leadImportStatus.updated} atualizado{leadImportStatus.updated !== 1 ? 's' : ''}</span>}
                        {leadImportStatus.skipped > 0 && <span className="text-muted">{leadImportStatus.skipped} ignorado{leadImportStatus.skipped !== 1 ? 's' : ''} (duplicata)</span>}
                      </>
                    )}
                    <button onClick={() => setLeadImportStatus(null)} className="ml-auto text-muted hover:text-ink text-base leading-none">×</button>
                  </div>
                )}

                {/* Two-column layout */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">

                  {/* Mobile filter toggle */}
                  <div className="lg:hidden flex items-center gap-3">
                    <button
                      onClick={() => setRfbShowFilters(p => !p)}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-card shadow-card text-ink hover:border-primary/40 transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M10 20h4"/></svg>
                      {rfbShowFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
                    </button>
                    {rfbResults.length > 0 && (
                      <span className="text-xs text-muted">
                        {rfbTotal >= 10001 ? '+10.000' : rfbTotal.toLocaleString('pt-BR')} resultado{rfbTotal !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* ── Sidebar de filtros ─────────────────────────────── */}
                  <div className={`${rfbShowFilters ? 'block' : 'hidden'} lg:block w-full lg:w-52 lg:flex-shrink-0 rounded-2xl border border-border bg-card shadow-card p-4 space-y-4 lg:sticky lg:top-20`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Filtros de Busca</p>

                    {/* CNPJ */}
                    <div>
                      <label className="block text-xs text-muted mb-1">CNPJ</label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                        placeholder="00.000.000/0000-00"
                        value={rfbFilters.cnpj}
                        onChange={e => setRfbFilters(p => ({ ...p, cnpj: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }}
                      />
                    </div>

                    {/* shared helpers — scoped to this block via IIFE */}
                    {(() => {
                      const OP_LIST = [['contains','∋'],['not_contains','∌'],['starts','^'],['ends','$'],['exact','=']];
                      const OP_TITLES = { contains:'Contém', not_contains:'Não contém', starts:'Começa com', ends:'Termina com', exact:'Igual a' };
                      const OpPills = ({ val, set }) => (
                        <div className="flex gap-0.5 flex-wrap">
                          {OP_LIST.map(([op, sym]) => (
                            <button key={op} onClick={() => set(op)} title={OP_TITLES[op]}
                              className={`px-1.5 py-0.5 text-xs rounded border transition ${val === op ? 'bg-primary text-white border-primary' : 'border-border bg-cardAlt text-muted hover:text-ink'}`}
                            >{sym}</button>
                          ))}
                        </div>
                      );
                      const LogicToggle = ({ val, set }) => (
                        <div className="flex gap-0.5">
                          {['AND','OR'].map(l => (
                            <button key={l} onClick={() => set(l)}
                              className={`px-1.5 py-0.5 text-xs rounded border font-medium transition ${val === l ? 'bg-primary/80 text-white border-primary' : 'border-border bg-cardAlt text-muted hover:text-ink'}`}
                            >{l === 'AND' ? 'E' : 'OU'}</button>
                          ))}
                        </div>
                      );
                      const inputCls = "w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40";
                      return (
                        <>
                          {/* Nome */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-muted">Nome / Razão Social</label>
                              <button onClick={() => setRfbNomeExpanded(p => !p)} className="text-xs text-primary hover:opacity-70">{rfbNomeExpanded ? '− menos' : '+ E/OU'}</button>
                            </div>
                            <OpPills val={rfbOps.nome} set={op => setRfbOps(p => ({ ...p, nome: op }))} />
                            <input type="text" className={`${inputCls} mt-1.5`} placeholder="Ex. Farmácia..."
                              value={rfbFilters.nome} onChange={e => setRfbFilters(p => ({ ...p, nome: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                            {rfbNomeExpanded && (
                              <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <LogicToggle val={rfbNomeLogic} set={setRfbNomeLogic} />
                                  <OpPills val={rfbNome2Op} set={setRfbNome2Op} />
                                </div>
                                <input type="text" className={inputCls} placeholder="Segundo termo..."
                                  value={rfbNome2} onChange={e => setRfbNome2(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                              </div>
                            )}
                          </div>

                          {/* Sócio */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-muted">Sócio</label>
                              <button onClick={() => setRfbSocioExpanded(p => !p)} className="text-xs text-primary hover:opacity-70">{rfbSocioExpanded ? '− menos' : '+ E/OU'}</button>
                            </div>
                            <OpPills val={rfbOps.socio} set={op => setRfbOps(p => ({ ...p, socio: op }))} />
                            <input type="text" className={`${inputCls} mt-1.5`} placeholder="Nome do sócio..."
                              value={rfbFilters.socio} onChange={e => setRfbFilters(p => ({ ...p, socio: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                            {rfbSocioExpanded && (
                              <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <LogicToggle val={rfbSocioLogic} set={setRfbSocioLogic} />
                                  <OpPills val={rfbSocio2Op} set={setRfbSocio2Op} />
                                </div>
                                <input type="text" className={inputCls} placeholder="Segundo sócio..."
                                  value={rfbSocio2} onChange={e => setRfbSocio2(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                              </div>
                            )}
                          </div>

                          {/* Endereço */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-muted">Endereço / Bairro / CEP</label>
                              <button onClick={() => setRfbEnderecoExpanded(p => !p)} className="text-xs text-primary hover:opacity-70">{rfbEnderecoExpanded ? '− menos' : '+ E/OU'}</button>
                            </div>
                            <OpPills val={rfbEnderecoOp} set={setRfbEnderecoOp} />
                            <input type="text" className={`${inputCls} mt-1.5`} placeholder="Rua, bairro, CEP..."
                              value={rfbEndereco} onChange={e => setRfbEndereco(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                            {rfbEnderecoExpanded && (
                              <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <LogicToggle val={rfbEnderecoLogic} set={setRfbEnderecoLogic} />
                                  <OpPills val={rfbEndereco2Op} set={setRfbEndereco2Op} />
                                </div>
                                <input type="text" className={inputCls} placeholder="Segundo termo..."
                                  value={rfbEndereco2} onChange={e => setRfbEndereco2(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }} />
                              </div>
                            )}
                          </div>
                        </>
                      );
                    })()}

                    {/* UF */}
                    <div>
                      <label className="block text-xs text-muted mb-1">UF</label>
                      <select
                        className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                        value={rfbFilters.uf}
                        onChange={e => {
                          const uf = e.target.value;
                          setRfbFilters(p => ({ ...p, uf, municipio: '' }));
                          setRfbMunicipioInput('');
                          if (uf) {
                            axios.get(`/api/rfb/municipios?uf=${uf}`).then(r => setRfbMunicipios(r.data || [])).catch(() => {});
                          } else {
                            axios.get('/api/rfb/municipios').then(r => setRfbMunicipios(r.data || [])).catch(() => {});
                          }
                        }}
                      >
                        <option value="">Selecionar estado...</option>
                        {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>

                    {/* Município */}
                    <div>
                      <label className="block text-xs text-muted mb-1">Município</label>
                      {munLabel && (
                        <span className="inline-flex items-center gap-1 mb-1.5 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 max-w-full">
                          <span className="truncate">{munLabel}</span>
                          <button onClick={() => { setRfbFilters(p => ({ ...p, municipio: '' })); setRfbMunicipioInput(''); }} className="hover:text-status-danger flex-shrink-0 leading-none">×</button>
                        </span>
                      )}
                      <div className="relative">
                        <input
                          type="text"
                          className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                          placeholder="Buscar município..."
                          value={rfbMunicipioInput}
                          onChange={e => { setRfbMunicipioInput(e.target.value); setRfbMunicipioDropdownOpen(true); }}
                          onFocus={() => setRfbMunicipioDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setRfbMunicipioDropdownOpen(false), 200)}
                        />
                        {rfbMunicipioDropdownOpen && filteredMunicipios.length > 0 && (
                          <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-card">
                            {filteredMunicipios.map(m => (
                              <button
                                key={m.codigo}
                                onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, municipio: m.codigo })); setRfbMunicipioInput(''); setRfbMunicipioDropdownOpen(false); }}
                                className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-cardAlt border-b border-border/50 last:border-0"
                              >
                                {m.descricao}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CNAE */}
                    <div>
                      <label className="block text-xs text-muted mb-1">CNAE</label>
                      <label className="flex items-center gap-1.5 text-xs text-muted mb-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={rfbCnaeOnlyPrincipal}
                          onChange={e => setRfbCnaeOnlyPrincipal(e.target.checked)}
                        />
                        <span>Apenas CNAE principal (mais rápido)</span>
                      </label>

                      {/* Contém */}
                      <div className="mb-2">
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-xs font-medium text-status-success">∋ Contém</span>
                          <span className="text-xs text-muted/70">— qualquer um</span>
                        </div>
                        {rfbFilters.cnae.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {rfbFilters.cnae.map(cod => (
                              <span key={cod} className="inline-flex items-center gap-1 text-xs bg-status-success/10 text-status-success border border-status-success/30 rounded-full px-2 py-0.5">
                                <span className="font-mono flex-shrink-0">{cod}</span>
                                <button onClick={() => setRfbFilters(p => ({ ...p, cnae: p.cnae.filter(c => c !== cod) }))} className="hover:text-status-danger flex-shrink-0 leading-none">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="relative">
                          <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="Adicionar CNAE para incluir..."
                            value={rfbCnaeInput}
                            onChange={e => { setRfbCnaeInput(e.target.value); setRfbCnaeDropdownOpen(true); }}
                            onFocus={() => setRfbCnaeDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setRfbCnaeDropdownOpen(false), 200)}
                          />
                          {rfbCnaeDropdownOpen && filteredCnaes.length > 0 && (
                            <div className="absolute z-30 left-0 mt-1 min-w-full w-max max-w-xs max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-card">
                              {filteredCnaes.map(c => (
                                <button
                                  key={c.codigo}
                                  onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, cnae: p.cnae.includes(c.codigo) ? p.cnae : [...p.cnae, c.codigo] })); setRfbCnaeInput(''); setRfbCnaeDropdownOpen(false); }}
                                  className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-cardAlt border-b border-border/50 last:border-0 flex gap-2"
                                >
                                  <span className="font-mono text-muted flex-shrink-0">{c.codigo}</span>
                                  <span>{c.descricao}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Não contém */}
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-xs font-medium text-status-danger">∌ Não contém</span>
                          <span className="text-xs text-muted/70">— nenhum</span>
                        </div>
                        {rfbFilters.cnaeNot.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {rfbFilters.cnaeNot.map(cod => (
                              <span key={cod} className="inline-flex items-center gap-1 text-xs bg-status-danger/10 text-status-danger border border-status-danger/30 rounded-full px-2 py-0.5">
                                <span className="font-mono flex-shrink-0">{cod}</span>
                                <button onClick={() => setRfbFilters(p => ({ ...p, cnaeNot: p.cnaeNot.filter(c => c !== cod) }))} className="hover:text-status-danger flex-shrink-0 leading-none">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="relative">
                          <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="Adicionar CNAE para excluir..."
                            value={rfbCnaeNotInput}
                            onChange={e => { setRfbCnaeNotInput(e.target.value); setRfbCnaeNotDropdownOpen(true); }}
                            onFocus={() => setRfbCnaeNotDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setRfbCnaeNotDropdownOpen(false), 200)}
                          />
                          {rfbCnaeNotDropdownOpen && filteredCnaesNot.length > 0 && (
                            <div className="absolute z-30 left-0 mt-1 min-w-full w-max max-w-xs max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-card">
                              {filteredCnaesNot.map(c => (
                                <button
                                  key={c.codigo}
                                  onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, cnaeNot: p.cnaeNot.includes(c.codigo) ? p.cnaeNot : [...p.cnaeNot, c.codigo] })); setRfbCnaeNotInput(''); setRfbCnaeNotDropdownOpen(false); }}
                                  className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-cardAlt border-b border-border/50 last:border-0 flex gap-2"
                                >
                                  <span className="font-mono text-muted flex-shrink-0">{c.codigo}</span>
                                  <span>{c.descricao}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Situação */}
                    <div>
                      <label className="block text-xs text-muted mb-1">Situação</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[['2','Ativa'],['3','Suspensa'],['4','Inapta'],['8','Baixada'],['1','Nula']].map(([code, label]) => {
                          const checked = rfbFilters.situacao.includes(code);
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => setRfbFilters(p => ({ ...p, situacao: checked ? p.situacao.filter(s => s !== code) : [...p.situacao, code] }))}
                              className={`text-xs px-2 py-1 rounded-lg border transition ${checked ? 'bg-primary/15 border-primary/40 text-primary font-medium' : 'bg-cardAlt border-border text-muted hover:border-primary/30'}`}
                            >{label}</button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Porte */}
                    <div>
                      <label className="block text-xs text-muted mb-1">Porte</label>
                      <select
                        className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                        value={rfbFilters.porte}
                        onChange={e => setRfbFilters(p => ({ ...p, porte: e.target.value }))}
                      >
                        <option value="">Selecionar porte...</option>
                        <option value="01">Micro Empresa</option>
                        <option value="03">Empresa de Pequeno Porte</option>
                        <option value="05">Demais</option>
                        <option value="00">Não informado</option>
                      </select>
                    </div>

                    {/* Natureza Jurídica */}
                    {(() => {
                      const natQuery = rfbNatInput.trim().toLowerCase();
                      const filteredNats = natQuery.length >= 1
                        ? rfbNaturezas.filter(n => !rfbFilters.natureza.includes(n.codigo) && (n.codigo.includes(natQuery) || n.descricao.toLowerCase().includes(natQuery))).slice(0, 20)
                        : [];
                      return (
                        <div>
                          <label className="block text-xs text-muted mb-1">Natureza Jurídica</label>
                          {rfbFilters.natureza.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {rfbFilters.natureza.map(cod => {
                                const nat = rfbNaturezas.find(n => n.codigo === cod);
                                return (
                                  <span key={cod} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs max-w-[200px]">
                                    <span className="truncate">{nat ? `${nat.codigo} — ${nat.descricao}` : cod}</span>
                                    <button onClick={() => setRfbFilters(p => ({ ...p, natureza: p.natureza.filter(c => c !== cod) }))} className="flex-shrink-0 hover:text-red-500">×</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <div className="relative">
                            <input
                              type="text"
                              className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                              placeholder="Buscar natureza..."
                              value={rfbNatInput}
                              onChange={e => setRfbNatInput(e.target.value)}
                            />
                            {filteredNats.length > 0 && (
                              <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card shadow-lg max-h-40 overflow-y-auto">
                                {filteredNats.map(n => (
                                  <div key={n.codigo} className="px-2.5 py-1.5 text-xs text-ink hover:bg-cardAlt cursor-pointer" onClick={() => { setRfbFilters(p => ({ ...p, natureza: [...p.natureza, n.codigo] })); setRfbNatInput(''); }}>
                                    <span className="font-mono text-muted mr-1">{n.codigo}</span>{n.descricao}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Regime tributário — checkboxes "incluir esta categoria".
                        Marcado (padrão) = traz na busca. Desmarcado = exclui. */}
                    <div>
                      <label className="block text-xs text-muted mb-1.5">Trazer na busca</label>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={rfbSimples !== 'N'}
                            onChange={e => setRfbSimples(e.target.checked ? '' : 'N')}
                          />
                          <span className="text-xs text-ink">Simples Nacional</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={rfbMei !== 'N'}
                            onChange={e => setRfbMei(e.target.checked ? '' : 'N')}
                          />
                          <span className="text-xs text-ink">MEI</span>
                        </label>
                      </div>
                    </div>

                    {/* Capital Social slider */}
                    <div>
                      <label className="block text-xs text-muted mb-1">Capital Social</label>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-muted">
                          <span>{rfbCapitalRange[0] > 0 ? `R$ ${(rfbCapitalRange[0]/1000).toFixed(0)}k` : 'Mín'}</span>
                          <span>{rfbCapitalRange[1] > 0 ? `R$ ${rfbCapitalRange[1] >= 1000000 ? (rfbCapitalRange[1]/1000000).toFixed(1)+'M' : (rfbCapitalRange[1]/1000).toFixed(0)+'k'}` : 'Máx'}</span>
                        </div>
                        <input type="range" min="0" max="5000000" step="50000"
                          className="w-full accent-primary h-1"
                          value={rfbCapitalRange[0]}
                          onChange={e => setRfbCapitalRange(p => [Math.min(Number(e.target.value), p[1] || 5000000), p[1]])}
                        />
                        <input type="range" min="0" max="5000000" step="50000"
                          className="w-full accent-primary h-1"
                          value={rfbCapitalRange[1] || 5000000}
                          onChange={e => setRfbCapitalRange(p => [p[0], Math.max(Number(e.target.value), p[0])])}
                        />
                        {(rfbCapitalRange[0] > 0 || rfbCapitalRange[1] > 0) && (
                          <button onClick={() => setRfbCapitalRange([0, 0])} className="text-xs text-muted hover:text-status-danger">× limpar</button>
                        )}
                      </div>
                    </div>

                    {/* Tempo de abertura slider */}
                    <div>
                      <label className="block text-xs text-muted mb-1">Tempo de abertura</label>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-muted">
                          <span>{rfbAberturaRange[0] > 0 ? `${rfbAberturaRange[0]} anos` : 'Mín'}</span>
                          <span>{rfbAberturaRange[1] > 0 ? `${rfbAberturaRange[1]} anos` : 'Máx'}</span>
                        </div>
                        <input type="range" min="0" max="50" step="1"
                          className="w-full accent-primary h-1"
                          value={rfbAberturaRange[0]}
                          onChange={e => setRfbAberturaRange(p => [Math.min(Number(e.target.value), p[1] || 50), p[1]])}
                        />
                        <input type="range" min="0" max="50" step="1"
                          className="w-full accent-primary h-1"
                          value={rfbAberturaRange[1] || 50}
                          onChange={e => setRfbAberturaRange(p => [p[0], Math.max(Number(e.target.value), p[0])])}
                        />
                        {(rfbAberturaRange[0] > 0 || rfbAberturaRange[1] > 0) && (
                          <button onClick={() => setRfbAberturaRange([0, 0])} className="text-xs text-muted hover:text-status-danger">× limpar</button>
                        )}
                      </div>
                    </div>

                    {/* Somente matriz */}
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={rfbOnlyMatriz}
                          onChange={e => setRfbOnlyMatriz(e.target.checked)}
                        />
                        <span className="text-xs text-ink">Somente matriz (CNPJ 0001)</span>
                      </label>
                    </div>

                    {/* Import settings — estágio padrão para o dialog */}
                    <div className="pt-2 border-t border-border">
                      <label className="block text-xs text-muted mb-1">Estágio padrão (import)</label>
                      <select
                        className="w-full rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                        value={leadImportSettings.defaultStage}
                        onChange={e => setLeadImportSettings(p => ({ ...p, defaultStage: e.target.value }))}
                      >
                        {leadColumns.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>

                    {/* Buttons */}
                    <button
                      onClick={() => handleRfbSearch(1)}
                      disabled={rfbLoading}
                      className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {rfbLoading ? 'Buscando…' : 'Buscar'}
                    </button>
                    <button
                      onClick={handleClear}
                      className="w-full py-1.5 rounded-xl text-xs text-muted hover:text-ink border border-border hover:border-primary/40 transition"
                    >
                      Limpar filtros
                    </button>

                    {/* Filtros salvos */}
                    <div className="pt-2 border-t border-border">
                      <p className="text-xs font-semibold text-muted mb-2">Filtros Salvos</p>
                      {rfbSavedFilters.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {rfbSavedFilters.map((sf, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <button
                                onClick={() => applyRfbSavedFilter(sf)}
                                className="flex-1 text-left text-xs px-2 py-1 rounded-lg border border-border bg-cardAlt text-ink hover:border-primary/40 hover:text-primary transition truncate"
                                title={sf.name}
                              >{sf.name}</button>
                              <button
                                onClick={() => {
                                  const updated = rfbSavedFilters.filter((_, j) => j !== i);
                                  setRfbSavedFilters(updated);
                                  localStorage.setItem('rfb_saved_filters', JSON.stringify(updated));
                                }}
                                className="text-muted hover:text-status-danger text-sm leading-none px-1 flex-shrink-0"
                                title="Remover"
                              >×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1">
                        <input
                          type="text"
                          className="flex-1 min-w-0 rounded-lg border border-border bg-cardAlt px-2 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                          placeholder="Nome do filtro…"
                          value={rfbSaveFilterName}
                          onChange={e => setRfbSaveFilterName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveRfbFilter(); }}
                        />
                        <button
                          onClick={saveRfbFilter}
                          disabled={!rfbSaveFilterName.trim()}
                          className="text-xs px-2 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition disabled:opacity-40 flex-shrink-0"
                        >Salvar</button>
                      </div>
                    </div>
                  </div>

                  {/* ── Painel de resultados ───────────────────────────── */}
                  <div className="flex-1 min-w-0 space-y-3">

                    {rfbError && (
                      <div className="rounded-2xl border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{rfbError}</div>
                    )}

                    {/* 10K limit warning */}
                    {rfbTotal >= 10001 && rfbResults.length > 0 && (
                      <div className="rounded-2xl border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning flex items-start gap-2">
                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.072 19h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        <div>
                          <div className="font-medium">Mais de 10.000 resultados</div>
                          <div className="text-xs opacity-90 mt-0.5">A busca foi limitada. Adicione filtros (CNAE, sócio, capital, abertura, endereço…) para refinar e ver resultados mais relevantes.</div>
                        </div>
                      </div>
                    )}

                    {/* Results header */}
                    {rfbTotal > 0 && (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-muted">
                          Mostrando <span className="font-semibold text-ink">{((rfbPage - 1) * rfbPageSize) + 1}–{Math.min(rfbPage * rfbPageSize, rfbTotal)}</span> de <span className="font-semibold text-ink">{rfbTotal >= 10001 ? '+10.000' : rfbTotal.toLocaleString('pt-BR')}</span> resultados
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <select
                            className="rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            value={rfbOrderBy}
                            onChange={e => { const v = e.target.value; setRfbOrderBy(v); handleRfbSearch(1, null, v); }}
                          >
                            <option value="razao_social">Ordenar: Razão Social</option>
                            <option value="nome_fantasia">Ordenar: Nome Fantasia</option>
                            <option value="uf">Ordenar: UF</option>
                            <option value="situacao">Ordenar: Situação</option>
                            <option value="capital_desc">Capital: maior primeiro</option>
                            <option value="capital_asc">Capital: menor primeiro</option>
                            <option value="abertura_desc">Mais recentes</option>
                            <option value="abertura_asc">Mais antigas</option>
                          </select>
                          <select
                            className="rounded-lg border border-border bg-cardAlt px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                            value={rfbPageSize}
                            onChange={e => { const n = Number(e.target.value); setRfbPageSize(n); handleRfbSearch(1, n); }}
                          >
                            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} por página</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Loading */}
                    {rfbLoading && (
                      <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                      </div>
                    )}

                    {/* Results table */}
                    {!rfbLoading && rfbResults.length > 0 && (() => {
                      const ExpandedPanel = ({ row }) => {
                        const filiais = rfbFiliais[row.cnpj_basico];
                        const loadFiliais = () => {
                          if (!row.cnpj_basico || filiais !== undefined) return;
                          setRfbFiliais(p => ({ ...p, [row.cnpj_basico]: null })); // null = loading
                          axios.get(`/api/rfb/filiais/${row.cnpj_basico}`)
                            .then(r => setRfbFiliais(p => ({ ...p, [row.cnpj_basico]: r.data || [] })))
                            .catch(() => setRfbFiliais(p => ({ ...p, [row.cnpj_basico]: [] })));
                        };
                        return (
                          <div className="border-t border-border/60 bg-cardAlt px-4 py-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="font-semibold text-muted uppercase tracking-wide mb-1">Endereço</p>
                                <p className="text-ink">
                                  {[row.tipo_de_logradouro, row.logradouro, row.numero, row.complemento].filter(Boolean).join(' ')}{row.bairro ? `, ${row.bairro}` : ''}
                                </p>
                                <p className="text-muted">{row.cep ? `CEP ${String(row.cep).replace(/(\d{5})(\d{3})/, '$1-$2')}` : ''}{row.municipio_nome ? ` · ${row.municipio_nome}/${row.uf}` : ''}</p>
                              </div>
                              <div>
                                <p className="font-semibold text-muted uppercase tracking-wide mb-1">Contato</p>
                                {row.correio_eletronico && <p className="text-primary truncate">{row.correio_eletronico}</p>}
                                {row.ddd1 && row.telefone1 && <p className="text-ink">({row.ddd1}) {row.telefone1}</p>}
                                {row.ddd2 && row.telefone2 && <p className="text-ink">({row.ddd2}) {row.telefone2}</p>}
                              </div>
                              <div>
                                <p className="font-semibold text-muted uppercase tracking-wide mb-1">Empresa</p>
                                {row.capital_social && <p className="text-ink">Capital: {fmtCapital(row.capital_social)}</p>}
                                {row.porte_da_empresa && <p className="text-muted">Porte: {row.porte_da_empresa}</p>}
                                {row.natureza_juridica_descricao && <p className="text-muted">Natureza: <span className="font-mono">{row.natureza_juridica}</span> — {row.natureza_juridica_descricao}</p>}
                                {row.data_de_inicio_da_atividade && <p className="text-muted">Abertura: {fmtDate(row.data_de_inicio_da_atividade)}{calcAge(row.data_de_inicio_da_atividade) ? ` · ${calcAge(row.data_de_inicio_da_atividade)}` : ''}</p>}
                                <div className="flex gap-2 mt-1.5 flex-wrap">
                                  {row.opcao_pelo_mei === 'S' && <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">MEI</span>}
                                  {row.opcao_pelo_simples === 'S' && row.opcao_pelo_mei !== 'S' && <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">Simples</span>}
                                </div>
                              </div>
                              {row.cnae_fiscal_principal && (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="font-semibold text-muted uppercase tracking-wide mb-1">CNAE Principal</p>
                                  <p className="text-ink"><span className="font-mono">{row.cnae_fiscal_principal}</span>{row.cnae_descricao ? ` — ${row.cnae_descricao}` : ''}</p>
                                </div>
                              )}
                              {Array.isArray(row.cnaes_secundarios) && row.cnaes_secundarios.length > 0 && (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="font-semibold text-muted uppercase tracking-wide mb-1">CNAEs Secundários ({row.cnaes_secundarios.length})</p>
                                  <ul className="space-y-0.5">
                                    {row.cnaes_secundarios.map(c => (
                                      <li key={c.codigo} className="text-ink text-sm">
                                        <span className="font-mono text-muted">{c.codigo}</span>{c.descricao ? ` — ${c.descricao}` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="sm:col-span-2 lg:col-span-3">
                                <p className="font-semibold text-muted uppercase tracking-wide mb-1">Sócios</p>
                                <p className="text-ink">{row.socios_nomes || <span className="text-muted">—</span>}</p>
                              </div>
                            </div>

                            {/* Enrich from Receita Federal */}
                            {(() => {
                              const enrichState = rfbEnriching[row.cnpj];
                              return (
                                <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-3">
                                  <button
                                    disabled={enrichState === true}
                                    onClick={async () => {
                                      setRfbEnriching(p => ({ ...p, [row.cnpj]: true }));
                                      try {
                                        const r = await axios.post(`/api/rfb/cnpj-enrich/${row.cnpj}`);
                                        setRfbResults(prev => prev.map(x => x.cnpj === row.cnpj ? { ...x, ...r.data } : x));
                                        setRfbEnriching(p => ({ ...p, [row.cnpj]: 'done' }));
                                      } catch {
                                        setRfbEnriching(p => ({ ...p, [row.cnpj]: 'error' }));
                                      }
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-border bg-cardAlt text-muted hover:text-ink hover:border-primary/40 transition disabled:opacity-50"
                                  >
                                    {enrichState === true ? 'Consultando Receita...' : enrichState === 'done' ? '✓ Atualizado da Receita' : enrichState === 'error' ? '✗ Erro ao consultar' : '↺ Atualizar dados da Receita Federal'}
                                  </button>
                                  {!enrichState && <span className="text-xs text-muted">Busca dados atualizados diretamente na RF e atualiza a base local</span>}
                                </div>
                              );
                            })()}

                            {/* Filiais section */}
                            {row.filiais_count > 0 && (
                              <div className="mt-4 pt-3 border-t border-border/60">
                                <div className="flex items-center gap-3 mb-2">
                                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">{row.filiais_count} Filia{row.filiais_count === 1 ? 'l' : 'is'}</p>
                                  {filiais === undefined && (
                                    <button onClick={loadFiliais} className="text-xs text-primary hover:underline">Carregar filiais</button>
                                  )}
                                  {filiais === null && <span className="text-xs text-muted">Carregando...</span>}
                                </div>
                                {Array.isArray(filiais) && filiais.length > 0 && (
                                  <div className="space-y-2">
                                    {filiais.map(f => {
                                      const fCNPJ = String(f.cnpj || '').replace(/\D/g, '');
                                      const fDup = Boolean(leadExistingCNPJs[fCNPJ]);
                                      return (
                                        <div key={fCNPJ} className="rounded-xl border border-border bg-card px-3 py-2.5 flex flex-wrap gap-2 items-center text-xs">
                                          <span className="font-mono text-muted flex-shrink-0">{fmtCNPJ(f.cnpj)}</span>
                                          <span className="text-ink flex-1 min-w-0 truncate">{f.nome_fantasia || '—'}</span>
                                          <span className="text-muted flex-shrink-0">{f.municipio_nome || '—'}/{f.uf || '—'}</span>
                                          <span className={`px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${situacaoClass(f.situacao_cadastral)}`}>
                                            {situacaoLabel(f.situacao_cadastral)}
                                          </span>
                                          <button
                                            onClick={() => openImportDialog({ ...f, razao_social: row.razao_social, capital_social: row.capital_social, porte_da_empresa: row.porte_da_empresa, opcao_pelo_simples: row.opcao_pelo_simples, opcao_pelo_mei: row.opcao_pelo_mei, socios_nomes: row.socios_nomes, primeiro_socio: row.primeiro_socio }, fDup)}
                                            disabled={leadImportLoading}
                                            className={`text-xs px-2 py-1 rounded-lg border transition disabled:opacity-40 flex-shrink-0 ${fDup ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20' : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'}`}
                                          >
                                            {fDup ? 'Atualizar' : 'Importar'}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {Array.isArray(filiais) && filiais.length === 0 && (
                                  <p className="text-xs text-muted">Nenhuma filial encontrada.</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      };

                      return (
                        <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
                          {/* Desktop header */}
                          <div className="hidden lg:grid grid-cols-[2fr_3fr_2fr_1fr_1fr_1fr_116px] gap-x-3 px-4 py-2.5 border-b border-border bg-cardAlt text-xs font-semibold text-muted uppercase tracking-wide">
                            <span>CNPJ</span>
                            <span>Razão Social</span>
                            <span>Nome Fantasia</span>
                            <span>Município</span>
                            <span>UF</span>
                            <span>Situação</span>
                            <span></span>
                          </div>
                          {rfbResults.map((row, idx) => {
                            const cleanCNPJ = String(row.cnpj || '').replace(/\D/g, '');
                            const crmContact = leadExistingCNPJs[cleanCNPJ] || null;
                            const isDup = Boolean(crmContact);
                            const crmUrl = crmContact ? `${CHATWOOT_BASE_URL}/app/accounts/2/contacts/${crmContact.id}` : null;
                            const isExp = rfbExpanded === cleanCNPJ;
                            const toggleExpand = () => {
                              setRfbExpanded(isExp ? null : cleanCNPJ);
                            };
                            const actionBtns = (
                              <div className="flex gap-1.5 items-center flex-shrink-0">
                                <button
                                  onClick={() => openImportDialog(row, isDup)}
                                  disabled={leadImportLoading}
                                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition disabled:opacity-40 whitespace-nowrap ${isDup ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20' : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'}`}
                                >
                                  {isDup ? 'Atualizar' : 'Importar'}
                                </button>
                                <button
                                  onClick={toggleExpand}
                                  className="text-xs text-muted hover:text-ink px-1.5 py-1.5 rounded-lg border border-border bg-cardAlt transition hover:border-primary/40"
                                >
                                  {isExp ? '↑' : '↓'}
                                </button>
                              </div>
                            );
                            return (
                              <div key={cleanCNPJ || idx} className={`border-b border-border/60 last:border-0 transition-colors ${isExp ? 'bg-primary/8 border-l-[3px] border-l-primary' : ''}`}>
                                {/* Mobile card row */}
                                <div className="lg:hidden px-4 py-3 flex items-start gap-3">
                                  <div className="flex-1 min-w-0" onClick={toggleExpand}>
                                    <div className="flex items-start gap-2 flex-wrap">
                                      {crmUrl ? (
                                        <a href={crmUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline text-sm leading-snug">{row.razao_social || '—'}</a>
                                      ) : (
                                        <p className="font-medium text-ink text-sm leading-snug">{row.razao_social || '—'}</p>
                                      )}
                                      {isDup && <span className="text-xs text-status-warning flex-shrink-0">Já no CRM</span>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="font-mono text-xs text-muted">{fmtCNPJ(row.cnpj)}</span>
                                      {row.municipio_nome && <span className="text-xs text-muted">{row.municipio_nome}/{row.uf}</span>}
                                      <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${situacaoClass(row.situacao_cadastral)}`}>
                                        {situacaoLabel(row.situacao_cadastral)}
                                      </span>
                                      {row.filiais_count > 0 && (
                                        <span className="text-xs px-1.5 py-0.5 rounded-full border border-border bg-cardAlt text-muted">
                                          {row.filiais_count} filial{row.filiais_count !== 1 ? 'is' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {actionBtns}
                                </div>

                                {/* Desktop grid row */}
                                <div className="hidden lg:grid grid-cols-[2fr_3fr_2fr_1fr_1fr_1fr_116px] gap-x-3 px-4 py-3 items-center text-sm">
                                  <div className="min-w-0">
                                    <span className="font-mono text-xs text-muted">{fmtCNPJ(row.cnpj)}</span>
                                    {row.filiais_count > 0 && (
                                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full border border-border bg-cardAlt text-muted">+{row.filiais_count}</span>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    {crmUrl ? (
                                      <a href={crmUrl} target="_blank" rel="noreferrer" className={`font-medium text-primary hover:underline ${isExp ? 'break-words' : 'truncate block'}`}>{row.razao_social || '—'}</a>
                                    ) : (
                                      <p className={`font-medium text-ink ${isExp ? 'break-words' : 'truncate'}`}>{row.razao_social || '—'}</p>
                                    )}
                                    {isDup && <p className="text-xs text-status-warning">Já no CRM</p>}
                                  </div>
                                  <span className={`text-xs text-muted ${isExp ? 'break-words' : 'truncate'}`}>{row.nome_fantasia || '—'}</span>
                                  <span className="text-xs text-muted truncate">{row.municipio_nome || '—'}</span>
                                  <span className="text-xs text-muted">{row.uf || '—'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${situacaoClass(row.situacao_cadastral)}`}>
                                    {situacaoLabel(row.situacao_cadastral)}
                                  </span>
                                  {actionBtns}
                                </div>

                                {isExp && <ExpandedPanel row={row} />}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Empty state */}
                    {!rfbLoading && rfbResults.length === 0 && rfbTotal === 0 && !rfbError && (
                      <div className="text-center py-16 text-muted text-sm">
                        {(Object.values(rfbFilters).some(v => v) || rfbEndereco || rfbSimples || rfbMei) ? 'Nenhum resultado encontrado. Tente outros filtros.' : 'Use os filtros para buscar empresas.'}
                      </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && !rfbLoading && (
                      <div className="flex items-center justify-center gap-1.5 pt-2">
                        <button
                          onClick={() => handleRfbSearch(rfbPage - 1)}
                          disabled={rfbPage <= 1}
                          className="px-3 py-1.5 rounded-lg border border-border bg-cardAlt text-xs text-muted hover:text-ink hover:border-primary/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >← Anterior</button>
                        {[...Array(Math.min(totalPages, 7))].map((_, i) => {
                          let pg;
                          if (totalPages <= 7) { pg = i + 1; }
                          else if (rfbPage <= 4) { pg = i + 1; }
                          else if (rfbPage >= totalPages - 3) { pg = totalPages - 6 + i; }
                          else { pg = rfbPage - 3 + i; }
                          return (
                            <button
                              key={pg}
                              onClick={() => handleRfbSearch(pg)}
                              className={`px-3 py-1.5 rounded-lg border text-xs transition ${rfbPage === pg ? 'bg-primary text-white border-primary' : 'border-border bg-cardAlt text-muted hover:text-ink hover:border-primary/40'}`}
                            >{pg}</button>
                          );
                        })}
                        <button
                          onClick={() => handleRfbSearch(rfbPage + 1)}
                          disabled={rfbPage >= totalPages}
                          className="px-3 py-1.5 rounded-lg border border-border bg-cardAlt text-xs text-muted hover:text-ink hover:border-primary/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >Próximo →</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {activeView === 'Processo' && (
            <div className="mt-6 space-y-6">
              <div className="rounded-3xl border border-border bg-card p-6 lg:p-8 shadow-card">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Playbook comercial</p>
                    <h2 className="mt-2 text-2xl md:text-3xl font-semibold">Processo completo de vendas</h2>
                    <p className="mt-3 text-sm text-muted">
                      Estrutura consolidada para prospeccao, qualificacao, fechamento e pos-venda.
                      Conteudo organizado para apoiar a execucao diaria do time.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {processBlueprint.stats.map(stat => (
                      <div key={stat.label} className="rounded-2xl border border-border bg-cardAlt px-4 py-3">
                        <p className="text-xs text-muted">{stat.label}</p>
                        <p className="text-lg font-semibold text-ink">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <aside className="rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-24 h-fit">
                  <p className="text-xs font-semibold text-muted">Mapa do processo</p>
                  <nav className="mt-4 flex flex-col gap-2">
                    {processBlueprint.map.map(item => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className="rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-cardAlt"
                      >
                        {item.title}
                      </a>
                    ))}
                  </nav>
                  <div className="mt-6 rounded-2xl border border-border bg-cardAlt p-4">
                    <p className="text-xs font-semibold text-muted">Links rapidos</p>
                    <div className="mt-3 flex flex-col gap-2 text-sm">
                      <a
                        href="https://chatwoot.tenryu.com.br/app/accounts/2"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-primary hover:underline"
                      >
                        Acessar Chatwoot
                      </a>
                    </div>
                  </div>
                </aside>

                <main className="rounded-2xl border border-border bg-card p-6 lg:p-8 space-y-8">
                  {/* Seção Metas 2026 */}
                  <section id="metas-2026" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <p className="text-xs font-semibold text-muted">Motor de Receita</p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">Metas 2026 - Modelo Alto Volume</h3>

                    {/* Fórmula Principal */}
                    <div className="mt-4 rounded-xl border-2 border-primary bg-primary/5 px-5 py-4">
                      <p className="text-center text-sm font-semibold text-primary">{processBlueprint.revenueEngine.formula}</p>
                      <div className="mt-3 grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold text-ink">240</p>
                          <p className="text-xs text-muted">SQLs/mês</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-ink">7%</p>
                          <p className="text-xs text-muted">Conversão</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-ink">R$ 30k</p>
                          <p className="text-xs text-muted">Ticket Médio</p>
                        </div>
                      </div>
                    </div>

                    {/* Funil */}
                    <div className="mt-5">
                      <p className="text-sm font-semibold text-ink mb-3">Funil Comercial</p>
                      <div className="grid grid-cols-4 gap-2">
                        {processBlueprint.funnel.map((step, idx) => (
                          <div key={step.stage} className="rounded-xl border border-border bg-card px-3 py-3 text-center">
                            <p className="text-xs text-muted">{step.conversion}</p>
                            <p className="text-xl font-bold text-ink">{step.volume}</p>
                            <p className="text-xs font-semibold text-muted">{step.stage}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Metas por Função */}
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {/* SDR */}
                      <div className="rounded-xl border-2 border-blue-500 bg-blue-500/5 px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full bg-blue-500" />
                          <p className="text-sm font-semibold text-ink">SDR ({processBlueprint.sdrGoals.teamSize} pessoas)</p>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xl font-bold text-ink">{processBlueprint.sdrGoals.teamGoal}</p>
                            <p className="text-xs text-muted">SQLs/mês (time)</p>
                          </div>
                          <div>
                            <p className="text-xl font-bold text-ink">{processBlueprint.sdrGoals.individualGoal}</p>
                            <p className="text-xs text-muted">SQLs/mês (individual)</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {processBlueprint.sdrGoals.kpis.map(kpi => (
                            <span key={kpi} className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-600">{kpi}</span>
                          ))}
                        </div>
                      </div>

                      {/* AE */}
                      <div className="rounded-xl border-2 border-green-500 bg-green-500/5 px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full bg-green-500" />
                          <p className="text-sm font-semibold text-ink">AE ({processBlueprint.aeGoals.teamSize} pessoas)</p>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xl font-bold text-ink">{processBlueprint.aeGoals.teamGoal}</p>
                            <p className="text-xs text-muted">Vendas/mês (time)</p>
                          </div>
                          <div>
                            <p className="text-xl font-bold text-ink">R$ 510k</p>
                            <p className="text-xs text-muted">Receita/mês (time)</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {processBlueprint.aeGoals.kpis.map(kpi => (
                            <span key={kpi} className="rounded-full bg-green-500/10 px-2 py-1 text-xs text-green-600">{kpi}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Resultado Anual */}
                    <div className="mt-5 rounded-xl border border-border bg-card px-4 py-4 text-center">
                      <p className="text-xs text-muted">Resultado Anual Projetado</p>
                      <p className="text-3xl font-bold text-primary">R$ 6.2M</p>
                      <p className="text-sm text-muted">207 vendas | Ticket médio R$ 30k</p>
                    </div>
                  </section>

                  <section id="visao-geral" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <p className="text-xs font-semibold text-muted">Visao geral</p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">Principios que guiam o processo</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {processBlueprint.pillars.map(pillar => (
                        <div key={pillar.title} className="rounded-xl border border-border bg-card px-4 py-3">
                          <h4 className="text-sm font-semibold text-ink">{pillar.title}</h4>
                          <p className="mt-2 text-xs text-muted">{pillar.text}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 space-y-2">
                      {processBlueprint.overview.map(item => (
                        <div key={item} className="flex items-start gap-2 text-sm text-ink">
                          <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="pipeline" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-muted">Pipeline</p>
                        <h3 className="mt-2 text-lg font-semibold text-ink">Passo a passo do funil</h3>
                      </div>
                      <span className="text-xs text-muted">Do lead ao handoff</span>
                    </div>
                    <div className="mt-5 grid gap-3">
                      {processBlueprint.pipelineSteps.map((step, index) => (
                        <div key={step.title} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-ink">{step.title}</p>
                            <p className="mt-1 text-xs text-muted">{step.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="checklist" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <p className="text-xs font-semibold text-muted">Checklist minimo</p>
                    <h3 className="mt-2 text-base font-semibold text-ink">Obrigatorio antes de avancar</h3>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {processBlueprint.checklist.map(item => (
                        <div key={item} className="flex items-start gap-2 text-sm text-ink">
                          <span className="mt-1 h-2 w-2 rounded-full bg-secondary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {processBlueprint.streams.map(stream => (
                    <section key={stream.id} id={stream.id} className="rounded-2xl border border-border bg-cardAlt p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-2xl">
                          <p className="text-xs font-semibold text-muted">{stream.owner}</p>
                          <h3 className="mt-2 text-lg font-semibold text-ink">{stream.title}</h3>
                          <p className="mt-2 text-sm text-muted">{stream.objective}</p>
                        </div>
                        <div className="grid gap-2 text-xs text-muted">
                          <span className="rounded-full border border-border bg-card px-3 py-1">Entrada: {stream.inputs}</span>
                          <span className="rounded-full border border-border bg-card px-3 py-1">Saida: {stream.outputs}</span>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {stream.actions.map(action => (
                          <div key={action} className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink">
                            {action}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}

                  <section id="rituais" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <h3 className="text-lg font-semibold">Rituais comerciais</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {processBlueprint.rituals.map(ritual => (
                        <div key={ritual.title} className="rounded-xl border border-border bg-card px-4 py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-ink">{ritual.title}</p>
                            <span className="text-xs text-muted">{ritual.cadence}</span>
                          </div>
                          <p className="mt-2 text-xs text-muted">{ritual.focus}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="ferramentas" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <h3 className="text-lg font-semibold">Ferramentas e registros</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {processBlueprint.tools.map(tool => (
                        <div key={tool.name} className="rounded-xl border border-border bg-card px-4 py-3">
                          <p className="text-sm font-semibold text-ink">{tool.name}</p>
                          <p className="mt-2 text-xs text-muted">{tool.purpose}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="erp-sankhya" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <h3 className="text-lg font-semibold">ERP Sankhya</h3>
                    <div className="mt-4 space-y-2">
                      {processBlueprint.erp.map(item => (
                        <div key={item} className="flex items-start gap-2 text-sm text-ink">
                          <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="documentacao" className="rounded-2xl border border-border bg-cardAlt p-5">
                    <h3 className="text-lg font-semibold">Documentacao complementar</h3>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {processBlueprint.documentation.map(item => (
                        <div key={item} className="flex items-start gap-2 text-sm text-ink">
                          <span className="mt-1 h-2 w-2 rounded-full bg-secondary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </main>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </DndContext>
  );
}

export default App;
