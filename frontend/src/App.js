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

const viewTabs = ['Overview', 'Board'];

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

const slugify = (value) => {
  const normalized = normalizeText(value);
  return normalized
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

const extractHeadings = (markdown) => {
  if (!markdown) {
    return [];
  }
  return markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('#'))
    .map(line => {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (!match) {
        return null;
      }
      const level = match[1].length;
      const text = match[2].replace(/\s+#*$/, '').trim();
      if (!text) {
        return null;
      }
      return {
        level,
        text,
        id: slugify(text),
      };
    })
    .filter(Boolean);
};

const parseMarkdownSections = (markdown) => {
  if (!markdown) {
    return [];
  }
  const lines = markdown.split('\n');
  const sections = [];
  let currentSection = null;
  let currentSubsection = null;
  let inCodeBlock = false;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (currentSubsection) {
        currentSubsection.content.push(line);
      } else if (currentSection) {
        currentSection.content.push(line);
      }
      return;
    }

    if (!inCodeBlock) {
      const sectionMatch = line.match(/^##\s+(.+)/);
      if (sectionMatch) {
        currentSection = {
          title: sectionMatch[1].trim(),
          content: [],
          subsections: [],
        };
        sections.push(currentSection);
        currentSubsection = null;
        return;
      }

      const subsectionMatch = line.match(/^###\s+(.+)/);
      if (subsectionMatch && currentSection) {
        currentSubsection = {
          title: subsectionMatch[1].trim(),
          content: [],
        };
        currentSection.subsections.push(currentSubsection);
        return;
      }
    }

    if (currentSubsection) {
      currentSubsection.content.push(line);
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  });

  return sections;
};

const stripMarkdown = (text) => {
  if (!text) {
    return '';
  }
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
};

const extractListItems = (lines) => {
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^□\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^□\s+/, ''))
    .map(item => stripMarkdown(item))
    .filter(Boolean);
};

const extractParagraphs = (lines) => {
  if (!Array.isArray(lines)) {
    return [];
  }
  const paragraphs = [];
  let buffer = [];
  let inCodeBlock = false;

  const flush = () => {
    if (buffer.length > 0) {
      paragraphs.push(stripMarkdown(buffer.join(' ')));
      buffer = [];
    }
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      flush();
      return;
    }
    if (inCodeBlock) {
      return;
    }
    if (!trimmed) {
      flush();
      return;
    }
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^\|/.test(trimmed) || /^>/.test(trimmed)) {
      flush();
      return;
    }
    buffer.push(trimmed);
  });
  flush();
  return paragraphs.filter(Boolean);
};

const extractOrderedSteps = (lines) => {
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines
    .map(line => line.trim())
    .filter(line => /^\d+\.\s+/.test(line))
    .map(line => {
      const match = line.match(/^(\d+)\.\s+(.*)$/);
      if (!match) {
        return null;
      }
      return {
        number: match[1],
        text: stripMarkdown(match[2]).trim(),
      };
    })
    .filter(Boolean);
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

function App() {
  const [contacts, setContacts] = useState([]);
  const [activeTab, setActiveTab] = useState('leads');
  const [activeView, setActiveView] = useState('Board');
  const [processContent, setProcessContent] = useState('');
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const stored = getCookieValue('theme');
    return stored === 'dark';
  });
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
    axios.get('/api/contacts')
      .then(response => {
        setContacts(response.data);
      })
      .catch(error => {
        console.error('Error fetching contacts:', error);
      });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDarkMode);
    setCookieValue('theme', isDarkMode ? 'dark' : 'light', 365);
  }, [isDarkMode]);

  useEffect(() => {
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
  }, [activeTab]);

  useEffect(() => {
    if (activeView !== 'Overview') {
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
  }, [activeView, historyGranularity]);

  useEffect(() => {
    if (activeView !== 'Processo') {
      return;
    }
    if (processContent) {
      return;
    }
    setProcessLoading(true);
    setProcessError(null);
    axios.get('/api/processo')
      .then(response => {
        setProcessContent(response.data?.content || '');
      })
      .catch(error => {
        console.error('Error fetching process content:', error);
        setProcessError('Nao foi possivel carregar o processo agora.');
      })
      .finally(() => {
        setProcessLoading(false);
      });
  }, [activeView, processContent]);


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

  const stageCountData = useMemo(() => sortByValueAsc(
    overviewData.byStage.map(item => ({
      stage: item.stage,
      value: Number(item.count) || 0,
    }))
  ), [overviewData.byStage]);

  const stageValueData = useMemo(() => sortByValueAsc(
    overviewData.byStage.map(item => ({
      stage: item.stage,
      value: Number(item.total_value) || 0,
    }))
  ), [overviewData.byStage]);

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
  const processHeadings = useMemo(() => extractHeadings(processContent), [processContent]);
  const processSections = useMemo(
    () => processHeadings.filter(item => item.level === 2),
    [processHeadings]
  );
  const processSubsections = useMemo(
    () => processHeadings.filter(item => item.level === 3),
    [processHeadings]
  );
  const processStats = useMemo(() => {
    const words = processContent ? processContent.split(/\s+/).filter(Boolean).length : 0;
    return {
      sections: processSections.length,
      subsections: processSubsections.length,
      words,
    };
  }, [processContent, processSections, processSubsections]);
  const processParsed = useMemo(() => parseMarkdownSections(processContent), [processContent]);
  const mainProcessSection = useMemo(() => {
    const primary = processParsed.find(section => normalizeText(section.title).startsWith('1.4 processo'));
    if (primary) {
      return primary;
    }
    return processParsed.find(section => normalizeText(section.title).includes('processo')) || null;
  }, [processParsed]);
  const passoSubsection = useMemo(() => {
    if (!mainProcessSection) {
      return null;
    }
    return mainProcessSection.subsections.find(sub => normalizeText(sub.title).includes('passo a passo')) || null;
  }, [mainProcessSection]);
  const checklistSubsection = useMemo(() => {
    if (!mainProcessSection) {
      return null;
    }
    return mainProcessSection.subsections.find(sub => normalizeText(sub.title).includes('checklist')) || null;
  }, [mainProcessSection]);
  const processSteps = useMemo(
    () => extractOrderedSteps(passoSubsection?.content || []),
    [passoSubsection]
  );
  const processChecklist = useMemo(
    () => extractListItems(checklistSubsection?.content || []),
    [checklistSubsection]
  );
  const mainProcessIntro = useMemo(() => {
    if (!mainProcessSection) {
      return [];
    }
    return extractParagraphs(mainProcessSection.content);
  }, [mainProcessSection]);
  const processFlows = useMemo(() => {
    const flowSections = processParsed.filter(section => /^\d+\./.test(section.title.trim()));
    return flowSections.filter(section => !normalizeText(section.title).startsWith('1.4 processo'));
  }, [processParsed]);
  const toolsSection = useMemo(
    () => processParsed.find(section => normalizeText(section.title).includes('ferramentas e sistemas')) || null,
    [processParsed]
  );
  const toolsList = useMemo(() => extractListItems(toolsSection?.content || []), [toolsSection]);

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

  const handleDragEnd = (event) => {
    const { active, over } = event;

    setActiveDragId(null);

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
  };

  const handleDragMove = useCallback((event) => {
    if (!boardScrollRef.current) {
      return;
    }
    const activeRect = event.active?.rect?.current?.translated || event.active?.rect?.current?.initial;
    if (!activeRect) {
      return;
    }
    const pointerX = activeRect.left + activeRect.width / 2;
    const containerRect = boardScrollRef.current.getBoundingClientRect();
    const threshold = 80;
    const speed = 24;
    if (pointerX < containerRect.left + threshold) {
      const next = Math.max(0, boardScrollRef.current.scrollLeft - speed);
      boardScrollRef.current.scrollLeft = next;
    } else if (pointerX > containerRect.right - threshold) {
      const maxScroll = boardScrollRef.current.scrollWidth - boardScrollRef.current.clientWidth;
      const next = Math.min(maxScroll, boardScrollRef.current.scrollLeft + speed);
      boardScrollRef.current.scrollLeft = next;
    }
  }, []);

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

  return (
    <DndContext
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen bg-surface text-ink relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute top-16 right-12 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 md:px-5 lg:px-6 pb-12">
          <header className="pt-8">
            <div className="flex items-center justify-end">
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
            className="kanban-board-scroll mt-2 flex gap-4 overflow-x-hidden pb-4 snap-x snap-mandatory"
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
                      <div className="h-72">
                        <ResponsiveBar
                          data={stageCountData}
                          keys={['value']}
                          indexBy="stage"
                          margin={{ top: 20, right: 20, bottom: 40, left: 160 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#2563eb"
                          enableLabel={false}
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
                          axisBottom={{ tickSize: 0, tickPadding: 6 }}
                          theme={chartTheme}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <h3 className="text-sm font-semibold">Oportunidade por etapa</h3>
                      <div className="h-72">
                        <ResponsiveBar
                          data={stageValueData}
                          keys={['value']}
                          indexBy="stage"
                          margin={{ top: 20, right: 20, bottom: 40, left: 160 }}
                          padding={0.3}
                          layout="horizontal"
                          colors="#1d4ed8"
                          enableLabel={false}
                          valueFormat={value => formatCurrency(value) || 'R$ 0,00'}
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
                          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 2, format: value => formatCompactCurrency(value) || value }}
                          theme={chartTheme}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                          axisLeft={{ tickSize: 0, tickPadding: 6 }}
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
                        axisLeft={{ tickSize: 0, tickPadding: 6 }}
                        axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 5, format: value => formatCompactCurrency(value) || value }}
                        theme={chartTheme}
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
                        margin={{ top: 20, right: 40, bottom: 50, left: 40 }}
                        xScale={{ type: 'point' }}
                        yScale={{ type: 'linear', min: 0, max: 'auto' }}
                        axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: -35, tickValues: historyTicks, format: historyTickFormat }}
                        axisLeft={{ tickSize: 0, tickPadding: 6 }}
                        colors={{ scheme: 'category10' }}
                        pointSize={4}
                        pointBorderWidth={1}
                        useMesh
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
                      Estrutura oficial para prospeccao, qualificacao, fechamento e handoff.
                      Use esta pagina como referencia durante o dia a dia.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-2xl border border-border bg-cardAlt px-4 py-3">
                      <p className="text-xs text-muted">Secoes</p>
                      <p className="text-lg font-semibold text-ink">{processStats.sections}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-cardAlt px-4 py-3">
                      <p className="text-xs text-muted">Subsecoes</p>
                      <p className="text-lg font-semibold text-ink">{processStats.subsections}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-cardAlt px-4 py-3">
                      <p className="text-xs text-muted">Palavras</p>
                      <p className="text-lg font-semibold text-ink">{formatCompactNumber(processStats.words)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <aside className="rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-24 h-fit">
                  <p className="text-xs font-semibold text-muted">Mapa do processo</p>
                  <nav className="mt-4 flex flex-col gap-2">
                    {processSections.map(section => (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        className="rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-cardAlt"
                      >
                        {section.text}
                      </a>
                    ))}
                    {processSections.length === 0 && (
                      <p className="text-sm text-muted">Sem secoes detectadas.</p>
                    )}
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
                      <a
                        href="/api/processo"
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted hover:text-ink"
                      >
                        Abrir markdown original
                      </a>
                    </div>
                  </div>
                </aside>

                <main className="rounded-2xl border border-border bg-card p-6 lg:p-8 space-y-8">
                  {processLoading && (
                    <p className="text-sm text-muted">Carregando processo...</p>
                  )}
                  {processError && (
                    <p className="text-sm text-status-danger">{processError}</p>
                  )}
                  {!processLoading && !processError && processContent && (
                    <>
                      <section className="rounded-2xl border border-border bg-cardAlt p-5">
                        <div className="flex flex-col gap-2">
                          <p className="text-xs font-semibold text-muted">Fluxo principal</p>
                          <h3 className="text-lg font-semibold text-ink">Passo a passo do vendedor</h3>
                          {mainProcessIntro.slice(0, 2).map((paragraph, index) => (
                            <p key={`process-intro-${index}`} className="text-sm text-muted">
                              {paragraph}
                            </p>
                          ))}
                        </div>
                        <div className="mt-5 grid gap-3">
                          {processSteps.map(step => (
                            <div key={step.number} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                                {step.number}
                              </span>
                              <p className="text-sm text-ink leading-relaxed">{step.text}</p>
                            </div>
                          ))}
                          {processSteps.length === 0 && (
                            <p className="text-sm text-muted">Etapas do processo nao identificadas.</p>
                          )}
                        </div>
                      </section>

                      <section className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-border bg-cardAlt p-5">
                          <p className="text-xs font-semibold text-muted">Checklist</p>
                          <h3 className="mt-2 text-base font-semibold text-ink">Minimo por oportunidade</h3>
                          <div className="mt-4 space-y-2">
                            {processChecklist.map(item => (
                              <div key={item} className="flex items-start gap-2 text-sm text-ink">
                                <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                                <span>{item}</span>
                              </div>
                            ))}
                            {processChecklist.length === 0 && (
                              <p className="text-sm text-muted">Checklist nao identificado.</p>
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border bg-cardAlt p-5">
                          <p className="text-xs font-semibold text-muted">Ferramentas centrais</p>
                          <h3 className="mt-2 text-base font-semibold text-ink">Base do processo</h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {toolsList.slice(0, 8).map(tool => (
                              <span key={tool} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-ink">
                                {tool}
                              </span>
                            ))}
                            {toolsList.length === 0 && (
                              <p className="text-sm text-muted">Ferramentas nao identificadas.</p>
                            )}
                          </div>
                        </div>
                      </section>

                      <section>
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">Processos principais</h3>
                          <span className="text-xs text-muted">Baseado no playbook completo</span>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          {processFlows.map(section => {
                            const paragraphs = extractParagraphs(section.content);
                            const bullets = extractListItems(section.content);
                            return (
                              <div key={section.title} className="rounded-2xl border border-border bg-cardAlt p-5">
                                <h4 className="text-base font-semibold text-ink">{section.title}</h4>
                                {paragraphs[0] && (
                                  <p className="mt-2 text-sm text-muted">{paragraphs[0]}</p>
                                )}
                                <div className="mt-3 space-y-2">
                                  {bullets.slice(0, 4).map(item => (
                                    <div key={item} className="flex items-start gap-2 text-sm text-ink">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-secondary" />
                                      <span>{item}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          {processFlows.length === 0 && (
                            <p className="text-sm text-muted">Nao foi possivel identificar processos principais.</p>
                          )}
                        </div>
                      </section>

                      <section>
                        <h3 className="text-lg font-semibold">Detalhamento por area</h3>
                        <div className="mt-4 space-y-6">
                          {processParsed.map(section => (
                            <div key={section.title} className="rounded-2xl border border-border bg-cardAlt p-5" id={slugify(section.title)}>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h4 className="text-base font-semibold text-ink">{section.title}</h4>
                                  {extractParagraphs(section.content).slice(0, 2).map((paragraph, index) => (
                                    <p key={`${section.title}-p-${index}`} className="mt-2 text-sm text-muted">
                                      {paragraph}
                                    </p>
                                  ))}
                                </div>
                                {section.subsections.length > 0 && (
                                  <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted">
                                    {section.subsections.length} subsecoes
                                  </span>
                                )}
                              </div>
                              {section.subsections.length > 0 && (
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                  {section.subsections.map(sub => {
                                    const subParagraphs = extractParagraphs(sub.content);
                                    const subBullets = extractListItems(sub.content);
                                    return (
                                      <div key={`${section.title}-${sub.title}`} className="rounded-xl border border-border bg-card px-4 py-3">
                                        <h5 className="text-sm font-semibold text-ink">{sub.title}</h5>
                                        {subParagraphs[0] && (
                                          <p className="mt-2 text-xs text-muted">{subParagraphs[0]}</p>
                                        )}
                                        {subBullets.slice(0, 3).length > 0 && (
                                          <div className="mt-3 space-y-1">
                                            {subBullets.slice(0, 3).map(item => (
                                              <div key={item} className="flex items-start gap-2 text-xs text-ink">
                                                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                                                <span>{item}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                          {processParsed.length === 0 && (
                            <p className="text-sm text-muted">Nenhum conteudo identificado.</p>
                          )}
                        </div>
                      </section>
                    </>
                  )}
                  {!processLoading && !processError && !processContent && (
                    <p className="text-sm text-muted">Nenhum conteudo encontrado.</p>
                  )}
                </main>
              </div>
            </div>
          )}
        </div>
      </div>
    </DndContext>
  );
}

export default App;
