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

const viewTabs = ['Overview', 'Board', 'Processo'];

const processBlueprint = {
  stats: [
    { label: 'Fases chave', value: '7' },
    { label: 'Frentes', value: '6' },
    { label: 'Rituais', value: '5' },
  ],
  map: [
    { title: 'Visao geral', id: 'visao-geral' },
    { title: 'Pipeline ponta a ponta', id: 'pipeline' },
    { title: 'Checklist minimo', id: 'checklist' },
    { title: 'Prospecao (SDR)', id: 'prospeccao' },
    { title: 'Qualificacao', id: 'qualificacao' },
    { title: 'Vendas diretas (AE)', id: 'vendas-diretas' },
    { title: 'Gestao de canais', id: 'canais' },
    { title: 'Licitacoes publicas', id: 'licitacoes' },
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
      title: 'Licitacoes publicas',
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
};

const parseCurrency = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(
    String(value)
      .replace(/[\sR$]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
  );
  if (Number.isNaN(numeric)) {
    return null;
  }
  return numeric;
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

const normalizeText = (value) => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
};

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
  const contactLink = contact.account_id
    ? `https://chatwoot.tenryu.com.br/app/accounts/${contact.account_id}/contacts/${contact.id}`
    : null;

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
      className={`kanban-column w-[280px] sm:w-[300px] lg:w-[320px] flex-shrink-0 rounded-2xl border border-border bg-cardAlt p-3 snap-start flex flex-col min-h-0 transition ${isOver ? 'is-over' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
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

const FunnelChart = ({ data, maxValue, valueFormatter, barClassName }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-xs text-muted">Sem dados para exibir.</div>;
  }
  const safeMax = Math.max(1, maxValue || 1);
  return (
    <div className="funnel-chart">
      {data.map((item) => {
        const percent = Math.max(0.06, Math.min(1, item.value / safeMax));
        const showValueInside = percent >= 0.72;
        return (
          <div key={item.stage} className="funnel-row">
            <div className="funnel-label">
              <span className="funnel-step">{item.stageNumber}</span>
              <span className="funnel-text">{item.stageLabel}</span>
            </div>
            <div className="funnel-bar-wrap">
              <div
                className={`funnel-bar ${barClassName} ${showValueInside ? 'funnel-bar-with-value' : ''}`}
                style={{ width: `${percent * 100}%` }}
              >
                {showValueInside && (
                  <span className="funnel-value funnel-value-inside">{valueFormatter(item.value)}</span>
                )}
              </div>
              {!showValueInside && (
                <span className="funnel-value">{valueFormatter(item.value)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function App() {
  const [contacts, setContacts] = useState([]);
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
  const [sortOption, setSortOption] = useState('opportunity-desc');
  const [historyGranularity, setHistoryGranularity] = useState('day');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewData, setOverviewData] = useState({
    summary: null,
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
  const isSyncingRef = useRef(false);
  const dragScrollRafRef = useRef(null);
  const dragPointerXRef = useRef(null);
  const isDraggingRef = useRef(false);
  const lastPointerXRef = useRef(null);
  const [activeDragId, setActiveDragId] = useState(null);

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

  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDarkMode);
    setCookieValue('theme', isDarkMode ? 'dark' : 'light', 365);
  }, [isDarkMode]);

  useEffect(() => {
    if (activeView !== 'Board') {
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
  }, [activeTab, activeView, contacts.length]);

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
    ])
      .then(([summary, byStage, byLabel, byState, byAgent, byChannel, byCustomerType, byProbability, history]) => {
        setOverviewData({
          summary: summary.data,
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

    return matchesSearch && matchesPriority && matchesAgent;
  });

  const agentOptions = useMemo(() => {
    const names = contacts
      .map(contact => String(contact.agent_name || '').trim())
      .filter(Boolean);
    const unique = Array.from(new Set(names));
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
  }, [overviewData.byStage, leadColumns, customerColumns]);

  const maxStageCount = useMemo(
    () => Math.max(1, ...stageFunnelData.map(item => item.count)),
    [stageFunnelData]
  );
  const maxStageValue = useMemo(
    () => Math.max(1, ...stageFunnelData.map(item => item.totalValue)),
    [stageFunnelData]
  );

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

  const historySeries = useMemo(() => buildHistorySeries(overviewData.history), [overviewData.history]);

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
                <CardPreview contact={contacts.find(c => String(c.id) === String(activeDragId))} />
              </div>
            ) : null}
          </DragOverlay>
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
              </div>

              {overviewLoading && (
                <div className="text-sm text-muted">Carregando dados do overview...</div>
              )}

              {!overviewLoading && (
                <div className="space-y-10">
                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Quantidade por etapa</h3>
                      </div>
                      <div className="funnel-container">
                        <FunnelChart
                          data={stageFunnelData.map(item => ({
                            stage: item.stage,
                            stageNumber: item.stageNumber,
                            stageLabel: item.stageLabel,
                            value: item.count,
                          }))}
                          maxValue={maxStageCount}
                          valueFormatter={value => formatCompactNumber(value)}
                          barClassName="funnel-bar-count"
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por etapa</h3>
                      <div className="funnel-container">
                        <FunnelChart
                          data={stageFunnelData.map(item => ({
                            stage: item.stage,
                            stageNumber: item.stageNumber,
                            stageLabel: item.stageLabel,
                            value: item.totalValue,
                          }))}
                          maxValue={maxStageValue}
                          valueFormatter={value => formatCompactCurrency(value) || 'R$ 0,00'}
                          barClassName="funnel-bar-value"
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
                      <h3 className="text-sm font-semibold">Evolucao por quantidade (por etapa)</h3>
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
                        margin={{ top: 20, right: 40, bottom: 70, left: 40 }}
                        xScale={{ type: 'point' }}
                        yScale={{ type: 'linear', min: 0, max: 'auto' }}
                        axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: -35, tickValues: historyTicks, format: historyTickFormat }}
                        axisLeft={{ tickSize: 0, tickPadding: 6, format: value => truncateAxisLabel(value) }}
                        colors={{ scheme: 'category10' }}
                        pointSize={4}
                        pointBorderWidth={1}
                        useMesh
                        tooltip={({ point }) => (
                          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-ink shadow-card">
                            <div className="font-semibold">{point.serieId}</div>
                            <div className="mt-1 text-muted">Data: {formatHistoryTooltipDate(point.data.x)}</div>
                            <div className="text-muted">Quantidade: {formatCompactNumber(point.data.y)}</div>
                          </div>
                        )}
                        legends={[
                          {
                            anchor: 'bottom',
                            direction: 'row',
                            justify: true,
                            translateX: 0,
                            translateY: 58,
                            itemsSpacing: 12,
                            itemDirection: 'left-to-right',
                            itemWidth: 120,
                            itemHeight: 18,
                            itemOpacity: 0.8,
                            itemTextColor: isDarkMode ? '#ffffff' : '#1f2937',
                            symbolSize: 10,
                            symbolShape: 'circle',
                            textColor: isDarkMode ? '#f8fafc' : '#1f2937',
                            effects: [
                              {
                                on: 'hover',
                                style: {
                                  itemOpacity: 1,
                                },
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
