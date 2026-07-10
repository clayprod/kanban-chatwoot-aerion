import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';
import {
  ViewColumnsIcon,
  MagnifyingGlassIcon,
  DocumentMagnifyingGlassIcon,
  ClipboardDocumentListIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  UsersIcon,
  CheckBadgeIcon,
  BanknotesIcon,
  DocumentTextIcon,
  BuildingLibraryIcon,
  ArrowRightOnRectangleIcon,
  PlusIcon,
  ChartBarIcon,
  BellIcon,
  ViewfinderCircleIcon,
  ScaleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
  Bars3Icon,
  TrashIcon,
  UserPlusIcon,
  PencilSquareIcon,
  StopIcon,
  ArrowPathIcon,
  QueueListIcon,
  PresentationChartBarIcon,
} from '@heroicons/react/24/outline';
import {
  btnPrimary,
  btnSecondary,
  btnGhost,
  iconBtn,
  input,
  select,
  textarea,
  card,
  cardAlt,
  sectionTitle,
  subtle,
  modalOverlay,
  modalPanel,
  badge,
  chip,
} from './ui';
import {
  countOpenFunnelLeads,
  countOperationalLicitacoes,
  getNewEditalSignalsCount,
} from './navigationBadges';
import './App.css';

// Configurar axios para enviar cookies em todas as requisições
axios.defaults.withCredentials = true;

const viewTabs = ['Overview', 'Board', 'Busca Lead B2B', 'Licitações', 'Processo'];
const VIEW_LABELS = {
  Overview: 'Gestão de Leads',
  Board: 'Funil',
  Metas: 'Metas e Resultados',
  'Definir Metas': 'Definir Metas',
  'Busca Lead B2B': 'Busca de leads',
  Licitações: 'Licitações',
  Processo: 'Processo',
  'Disparo WhatsApp': 'Disparo WhatsApp',
  Usuários: 'Usuários',
};
const viewLabel = (view) => VIEW_LABELS[view] || view;
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
  { id: 'topo',     label: 'Topo',            color: '#5a93ff', range: [1, 5] },
  { id: 'meio',     label: 'Meio',            color: '#a78bff', range: [6, 8] },
  { id: 'fundo',    label: 'Fundo',           color: '#ffb24d', range: [9, 12] },
  { id: 'outros',   label: 'Outros',          color: '#7b87a3', range: [13, 17] },
  { id: 'recompra', label: 'Recompra/Upsell', color: '#36d39a', range: [18, 26] },
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
// Groupings for the Licitações board group-bar (Lei 14.133 phases → 4 macro stages).
const LIC_STAGE_GROUPS = [
  { id: 'inteligencia', label: 'Inteligência', color: '#38d6e6', range: [1, 6] },
  { id: 'disputa',      label: 'Disputa',      color: '#7c5cff', range: [7, 9] },
  { id: 'recursal',     label: 'Recursal',     color: '#ffb24d', range: [10, 12] },
  { id: 'encerrado',    label: 'Encerrado',    color: '#7b87a3', range: [13, 15] },
];
const licGroupForStageNum = (n) => LIC_STAGE_GROUPS.find(g => n >= g.range[0] && n <= g.range[1]);
const PNCP_SCORE_HIGH_THRESHOLD = 68;
const PNCP_SCORE_MEDIUM_THRESHOLD = 38;

// Labels for the Licitações subviews — used by the header breadcrumb/title.
const LIC_SUB_LABELS = {
  overview: 'Resumo',
  editais: 'Busca Editais',
  editais_watchlist: 'Busca Editais',
  board: 'Pipeline',
  resultados: 'Contratos/Resultados',
  pca: 'PCA',
  sinais: 'PCA',
};
const licSubLabel = (sub) => LIC_SUB_LABELS[sub] || 'Resumo';

// DDDs brasileiros com região, para o seletor de público do Disparo.
const DDD_REGIONS = [
  ['11', 'São Paulo – SP'], ['12', 'Vale do Paraíba – SP'], ['13', 'Baixada Santista – SP'], ['14', 'Bauru/Marília – SP'],
  ['15', 'Sorocaba – SP'], ['16', 'Ribeirão Preto – SP'], ['17', 'S. J. do Rio Preto – SP'], ['18', 'Presidente Prudente – SP'], ['19', 'Campinas – SP'],
  ['21', 'Rio de Janeiro – RJ'], ['22', 'Campos/Macaé – RJ'], ['24', 'Volta Redonda/Petrópolis – RJ'],
  ['27', 'Vitória – ES'], ['28', 'Cachoeiro – ES'],
  ['31', 'Belo Horizonte – MG'], ['32', 'Juiz de Fora – MG'], ['33', 'Gov. Valadares – MG'], ['34', 'Uberlândia – MG'],
  ['35', 'Poços de Caldas – MG'], ['37', 'Divinópolis – MG'], ['38', 'Montes Claros – MG'],
  ['41', 'Curitiba – PR'], ['42', 'Ponta Grossa – PR'], ['43', 'Londrina – PR'], ['44', 'Maringá – PR'], ['45', 'Foz do Iguaçu – PR'], ['46', 'Pato Branco – PR'],
  ['47', 'Joinville/Blumenau – SC'], ['48', 'Florianópolis – SC'], ['49', 'Chapecó – SC'],
  ['51', 'Porto Alegre – RS'], ['53', 'Pelotas – RS'], ['54', 'Caxias do Sul – RS'], ['55', 'Santa Maria – RS'],
  ['61', 'Brasília – DF'], ['62', 'Goiânia – GO'], ['64', 'Rio Verde – GO'], ['63', 'Palmas – TO'],
  ['65', 'Cuiabá – MT'], ['66', 'Rondonópolis – MT'], ['67', 'Campo Grande – MS'],
  ['68', 'Rio Branco – AC'], ['69', 'Porto Velho – RO'],
  ['71', 'Salvador – BA'], ['73', 'Ilhéus – BA'], ['74', 'Juazeiro – BA'], ['75', 'Feira de Santana – BA'], ['77', 'Barreiras – BA'],
  ['79', 'Aracaju – SE'],
  ['81', 'Recife – PE'], ['87', 'Petrolina – PE'],
  ['82', 'Maceió – AL'], ['83', 'João Pessoa – PB'], ['84', 'Natal – RN'],
  ['85', 'Fortaleza – CE'], ['88', 'Juazeiro do Norte – CE'],
  ['86', 'Teresina – PI'], ['89', 'Picos – PI'],
  ['91', 'Belém – PA'], ['93', 'Santarém – PA'], ['94', 'Marabá – PA'],
  ['92', 'Manaus – AM'], ['97', 'Coari – AM'],
  ['95', 'Boa Vista – RR'], ['96', 'Macapá – AP'],
  ['98', 'São Luís – MA'], ['99', 'Imperatriz – MA'],
];

// Brazil tile-grid (statebins) — [uf, col, row] 0-indexed on a 6×8 grid, geographic-ish
// silhouette matching the design prototype's buildSegments().
const BR_STATE_BINS = [
  ['RR', 2, 0], ['AP', 3, 0],
  ['AM', 1, 1], ['PA', 2, 1], ['MA', 3, 1], ['CE', 4, 1], ['RN', 5, 1],
  ['AC', 0, 2], ['RO', 1, 2], ['TO', 2, 2], ['PI', 3, 2], ['PE', 4, 2], ['PB', 5, 2],
  ['MT', 1, 3], ['GO', 2, 3], ['BA', 3, 3], ['AL', 4, 3], ['SE', 5, 3],
  ['MS', 1, 4], ['DF', 2, 4], ['MG', 3, 4], ['ES', 4, 4],
  ['PR', 2, 5], ['SP', 3, 5], ['RJ', 4, 5],
  ['SC', 2, 6],
  ['RS', 2, 7],
];

const BR_STATE_COORDS = {
  AC: [-9.02, -70.81], AL: [-9.57, -36.78], AM: [-3.47, -65.10], AP: [1.41, -51.77],
  BA: [-12.58, -41.70], CE: [-5.20, -39.53], DF: [-15.78, -47.93], ES: [-19.19, -40.34],
  GO: [-15.98, -49.86], MA: [-5.42, -45.44], MG: [-18.10, -44.38], MS: [-20.51, -54.54],
  MT: [-12.64, -55.42], PA: [-3.79, -52.48], PB: [-7.28, -36.72], PE: [-8.38, -37.86],
  PI: [-7.72, -42.73], PR: [-24.89, -51.55], RJ: [-22.25, -42.66], RN: [-5.81, -36.59],
  RO: [-10.83, -63.34], RR: [1.99, -61.33], RS: [-30.17, -53.50], SC: [-27.45, -50.95],
  SE: [-10.57, -37.45], SP: [-22.19, -48.79], TO: [-10.18, -48.33],
};

// path id → UF no SVG público brazil-state-map-clean.svg (27 estados)
const BR_SVG_PATH_TO_UF = {
  path44: 'RO', path46: 'AC', path48: 'AM', path50: 'RR', path52: 'AP',
  path54: 'TO', path56: 'MT', path58: 'GO', path60: 'MS', path62: 'MG',
  path64: 'PR', path66: 'RS', path68: 'BA', path70: 'PI', path72: 'CE',
  path74: 'RN', path76: 'AL', path78: 'SE', path80: 'DF', path82: 'PE',
  path84: 'MA', path86: 'PA', path88: 'SP', path90: 'RJ', path92: 'ES',
  path94: 'SC', path96: 'PB',
};

// Heatmap: escala log + interpolação roxo → ciano (maior contraste com outliers como SP)
const BR_HEAT_STOPS = [
  { t: 0,    rgb: [42, 48, 68] },     // sem dado / mínimo
  { t: 0.15, rgb: [58, 42, 130] },    // roxo escuro
  { t: 0.4,  rgb: [111, 85, 242] },   // roxo marca
  { t: 0.7,  rgb: [90, 147, 255] },   // azul
  { t: 1,    rgb: [56, 214, 230] },   // ciano (pico)
];
const brHeatIntensity = (value, max) => {
  if (!value || value <= 0 || !max || max <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(max));
};
const brHeatColor = (t) => {
  const clamped = Math.max(0, Math.min(1, t));
  let a = BR_HEAT_STOPS[0];
  let b = BR_HEAT_STOPS[BR_HEAT_STOPS.length - 1];
  for (let i = 0; i < BR_HEAT_STOPS.length - 1; i++) {
    if (clamped >= BR_HEAT_STOPS[i].t && clamped <= BR_HEAT_STOPS[i + 1].t) {
      a = BR_HEAT_STOPS[i];
      b = BR_HEAT_STOPS[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const u = (clamped - a.t) / span;
  const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u);
  const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u);
  const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u);
  return `rgb(${r},${g},${bl})`;
};

const BrazilChoroplethMap = memo(function BrazilChoroplethMap({
  metricByUf,
  ufMax,
  selectedUf,
  onSelectUf,
  fmtMetric,
  plotUf,
  ufRows,
}) {
  const hostRef = useRef(null);
  const [svgReady, setSvgReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/brazil-state-map-clean.svg')
      .then((r) => r.text())
      .then((text) => {
        if (cancelled || !hostRef.current) return;
        // strip XML declaration; keep viewBox SVG only
        const cleaned = text.replace(/<\?xml[^?]*\?>/i, '').trim();
        hostRef.current.innerHTML = cleaned;
        const svg = hostRef.current.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          svg.style.display = 'block';
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.overflow = 'visible';
        }
        setSvgReady(true);
      })
      .catch(() => {
        if (!cancelled) setSvgReady(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!svgReady || !hostRef.current) return;
    const root = hostRef.current;
    Object.entries(BR_SVG_PATH_TO_UF).forEach(([pathId, uf]) => {
      const el = root.querySelector(`#${pathId}`);
      if (!el) return;
      const value = metricByUf[uf] || 0;
      const t = brHeatIntensity(value, ufMax);
      const selected = selectedUf === uf;
      el.style.fill = value > 0 ? brHeatColor(Math.max(t, 0.12)) : 'rgb(42,48,68)';
      el.style.fillOpacity = value > 0 ? '0.95' : '0.55';
      el.style.stroke = selected ? '#38d6e6' : 'rgba(15, 20, 32, 0.85)';
      el.style.strokeWidth = selected ? '900' : '340';
      el.style.strokeLinejoin = 'round';
      el.style.cursor = 'pointer';
      el.style.transition = 'fill 180ms ease, stroke 180ms ease, fill-opacity 180ms ease';
      el.setAttribute('data-uf', uf);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${uf}: ${fmtMetric(value)}`);
      el.onclick = (e) => {
        e.stopPropagation();
        onSelectUf?.(uf);
      };
    });
  }, [svgReady, metricByUf, ufMax, selectedUf, onSelectUf, fmtMetric]);

  return (
    <div className="relative mx-auto h-[390px] w-full max-w-[640px] overflow-hidden">
      <div ref={hostRef} className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" />
      {!svgReady && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">
          Carregando mapa…
        </div>
      )}
      {ufRows.map((item) => {
        const pos = plotUf(item.key);
        if (!pos) return null;
        const selected = selectedUf === item.key;
        return (
          <button
            key={item.key}
            type="button"
            title={`${item.key}: ${fmtMetric(item.metric)}`}
            onClick={() => onSelectUf?.(item.key)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none shadow-card transition ${selected ? 'border-cyan bg-cyan text-bg' : 'border-line bg-bg/90 text-ink hover:border-primary hover:text-primary'}`}
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
          >
            {item.key} {fmtMetric(item.metric)}
          </button>
        );
      })}
      <div className="pointer-events-none absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-bg/85 px-3 py-1 backdrop-blur-sm">
        <span className="text-[10px] font-medium text-muted">Baixo</span>
        <div
          className="h-2 w-28 rounded-full"
          style={{
            background: 'linear-gradient(90deg, rgb(42,48,68), rgb(58,42,130), rgb(111,85,242), rgb(90,147,255), rgb(56,214,230))',
          }}
        />
        <span className="text-[10px] font-medium text-muted">Alto</span>
      </div>
    </div>
  );
});

const processBlueprint = {
  stats: [
    { label: 'SQLs/mês', value: '240' },
    { label: 'Vendas/mês', value: '17' },
    { label: 'Receita/ano', value: 'R$ 6.2M' },
  ],
  map: [
    { title: 'Metas 2026', id: 'metas-2026' },
    { title: 'Visão geral', id: 'visao-geral' },
    { title: 'Treinamento de produtos', id: 'treinamento-produtos' },
    { title: 'ICPs Aerion (Autel)', id: 'icps-aerion' },
    { title: 'Guia do Sales Command', id: 'guia-sales-command' },
    { title: 'Pipeline ponta a ponta', id: 'pipeline' },
    { title: 'Checklist mínimo', id: 'checklist' },
    { title: 'Venda consultiva (BANT+U)', id: 'venda-consultiva' },
    { title: 'Playbook operacional', id: 'playbook-operacional' },
    { title: 'Prospecção (SDR)', id: 'prospeccao' },
    { title: 'Qualificação', id: 'qualificacao' },
    { title: 'Vendas diretas (AE)', id: 'vendas-diretas' },
    { title: 'Gestão de canais', id: 'canais' },
    { title: 'Licitações públicas', id: 'licitacoes' },
    { title: 'Customer Success', id: 'customer-success' },
    { title: 'Rituais comerciais', id: 'rituais' },
    { title: 'Ferramentas e registros', id: 'ferramentas' },
    { title: 'ERP Sankhya', id: 'erp-sankhya' },
    { title: 'Documentação complementar', id: 'documentacao' },
  ],
  pillars: [
    {
      title: 'Especializacao com clareza',
      text: 'Separar prospecção, fechamento e pós-venda mesmo em time enxuto, mantendo a responsabilidade de cada etapa.'
    },
    {
      title: 'Processo previsivel e replicavel',
      text: 'Etapas, critérios e registros padronizados para facilitar onboarding e manter a consistencia.'
    },
    {
      title: 'Volume com qualidade',
      text: 'Cadencia estruturada e qualificação rigorosa para concentrar esforco em oportunidades aderentes.'
    },
  ],
  overview: [
    'Todo lead precisa ter histórico completo no CRM antes de avançar.',
    'BANT+U e ICP direcionam quem avança e quem entra em nurturing.',
    'Handoff para CS acontece somente com contexto, riscos e próximos passos claros.'
  ],
  glossary: [
    { term: 'ICP', meaning: 'Perfil de cliente ideal com maior chance de fechamento, adoção e expansão.' },
    { term: 'SQL', meaning: 'Lead qualificado para vendas, com dor valida, proximo passo e potencial real de compra.' },
    { term: 'BANT+U', meaning: 'Framework de qualificação: Budget, Authority, Need, Timeline e Use Case.' },
    { term: 'Nurture', meaning: 'Lead sem timing agora, mas com fit potencial para retomada futura com gatilho claro.' },
    { term: 'Handoff', meaning: 'Transferencia estruturada de contexto entre SDR, AE e CS sem perda de informação critica.' },
    { term: 'QBR', meaning: 'Revisao trimestral de resultados para ajustar plano de acao, risco e oportunidades de expansão.' }
  ],
  funnelGuide: [
    {
      group: 'Workspace',
      tab: 'Gestão de Leads',
      use: 'Painel de saúde do pipeline: KPIs (leads, clientes, valor aberto), evolução do funil, ritmo do time e distribuição por etapa/grupo.',
      routine: 'Abrir no início do dia para priorizar contatos, ver bloqueios e cruzar feito × meta.'
    },
    {
      group: 'Workspace',
      tab: 'Funil',
      use: 'Kanban operacional com duas faixas: Leads · SDR (etapas 1–17) e Clientes · CS (18–26). Arraste cards, filtre e atualize atributos no card.',
      routine: 'Uso contínuo: cada contato gera histórico, próximo passo e, quando couber, mudança de etapa.'
    },
    {
      group: 'Workspace',
      tab: 'Metas e Resultados',
      use: 'Acompanhar meta de receita × faturamento realizado (mês e ano). Acesso admin.',
      routine: 'Consultar ritmo de faturamento. Definir metas em Administração → Definir Metas.'
    },
    {
      group: 'Workspace',
      tab: 'Processo',
      use: 'Playbook comercial de referência: metas, ICPs, scripts BANT+U, fluxos e este guia do Sales Command.',
      routine: 'Consulta sob demanda — onboarding, calibração de abordagem e auditoria de execução.'
    },
    {
      group: 'Licitações',
      tab: 'Resumo',
      use: 'Visão executiva do módulo: oportunidades, valor em aberto, prazos críticos (48h / atrasadas) e funil por fase.',
      routine: 'Check diário de urgências antes de entrar no Pipeline ou na Busca de Editais.'
    },
    {
      group: 'Licitações',
      tab: 'Busca Editais',
      use: 'Busca PNCP com filtros (UF, modalidade, órgão, termos), score de aderência, watchlist e jobs de coleta em lote.',
      routine: 'Rodar buscas / revisar resultados; promover editais relevantes para o Pipeline.'
    },
    {
      group: 'Licitações',
      tab: 'Pipeline',
      use: 'Kanban de licitações (Lei 14.133): Inteligência → Disputa → Recursal → Encerrado, com checklist e prazos no card.',
      routine: 'Atualizar fase a cada marco (edital, cadastro, disputa, recurso, contrato).'
    },
    {
      group: 'Licitações',
      tab: 'Contratos/Resultados',
      use: 'Acompanhamento de contratos, atas e resultados pós-disputa.',
      routine: 'Fechar o ciclo das oportunidades ganhas/perdidas e manter rastreabilidade.'
    },
    {
      group: 'Licitações',
      tab: 'PCA',
      use: 'Monitoramento de Planos de Contratações Anuais e sinais de demanda pública futura.',
      routine: 'Usar na fase de inteligência para antecipar editais e mapear órgãos/áreas.'
    },
    {
      group: 'Prospecção',
      tab: 'Busca de leads',
      use: 'Prospecção B2B na base RFB/CNPJ com filtros (CNAE, UF, porte, capital, idade) e Radar Trends sob demanda (IA sugere buscas por setor, ICP e o que estiver em alta).',
      routine: 'Sob demanda: abrir Radar Trends → aplicar sugestão → importar leads para o Funil (Inbox).'
    },
    {
      group: 'Prospecção',
      tab: 'Disparo WhatsApp',
      use: 'Campanhas de disparo com seleção de público (DDD/lista), templates e acompanhamento de envio.',
      routine: 'Campanhas de cadência outbound alinhadas ao volume de contatos do plano comercial.'
    },
    {
      group: 'Administração',
      tab: 'Usuários',
      use: 'Gestão de acesso: papéis (admin/membro) e views liberadas por usuário. Somente admin.',
      routine: 'Ao onboarding de pessoa no time ou mudança de escopo de acesso.'
    },
    {
      group: 'Administração',
      tab: 'Definir Metas',
      use: 'Cadastro do plano de receita mensal (R$) usado em Metas e Resultados. Somente admin.',
      routine: 'No início do ano ou ao revisar o plano comercial; o realizado vem do faturamento.'
    },
  ],
  icps: [
    {
      id: 'icp-1',
      name: 'ICP 1 - Construcao e Topografia Urbana',
      sector: 'Construtoras medias/grandes e empresas de topografia e geodesia.',
      profile: 'Faturamento R$ 50M-R$ 500M e 5-20 obras simultaneas.',
      decisionMaker: 'Diretor de Operações e Gerente de Engenharia.',
      pains: 'Atraso de cronograma e custo alto de topografia terceirizada.',
      products: 'Autel EVO Lite Enterprise e EVO Max 4T (RTK).',
      ticket: 'R$ 80k-R$ 120k',
      fitSignals: ['Obra com multa por atraso.', 'Topografia contratada com recorrencia.', 'Necessidade de RTK e mapeamento recorrente.'],
      redFlags: ['Projeto sem dono definido.', 'Sem dor financeira clara.', 'Apenas cotacao para comparar preco.']
    },
    {
      id: 'icp-2',
      name: 'ICP 2 - Inspecao Industrial e Energia',
      sector: 'Concessionarias, parques solares/eolicos e empresas de inspeção.',
      profile: 'Faturamento acima de R$ 100M e mais de 500 ativos criticos.',
      decisionMaker: 'Gerente de Manutencao e Diretor de Engenharia.',
      pains: 'Inspecao cara com helicoptero, risco operacional e downtime não planejado.',
      products: 'Autel Alpha (BVLOS) e EVO Max 4T (zoom 10x + termica).',
      ticket: 'R$ 150k-R$ 300k',
      fitSignals: ['Meta formal de redução de downtime.', 'Ativos distribuidos em area extensa.', 'Pressao por seguranca do time de campo.'],
      redFlags: ['Sem baseline de custo atual.', 'Operacao sem padrao de inspeção.', 'Sem patrocinio da engenharia.']
    },
    {
      id: 'icp-3',
      name: 'ICP 3 - Seguranca Publica e Defesa Civil',
      sector: 'PM, PC, PRF, orgaos de Defesa Civil e empresas de seguranca privada.',
      profile: 'Atendimento acima de 500 mil habitantes e mais de 1000 agentes.',
      decisionMaker: 'Comandante/Secretario e Coordenador de Operações.',
      pains: 'Cobertura grande com efetivo limitado e alto custo de aeronaves tripuladas.',
      products: 'Autel Alpha (visao noturna e alcance de 20 km).',
      ticket: 'R$ 200k-R$ 400k',
      fitSignals: ['Operações noturnas recorrentes.', 'Historico de missão sem cobertura suficiente.', 'Programa de modernizacao em andamento.'],
      redFlags: ['Sem janela orcamentaria aberta.', 'Demanda sem uso operacional definido.', 'Processo sem patrocinador institucional.']
    },
    {
      id: 'icp-4',
      name: 'ICP 4 - Resgate, Emergencias e Meio Ambiente',
      sector: 'Corpo de Bombeiros, Defesa Civil e ONGs ambientais.',
      profile: 'Area de atuacao acima de 50.000 km2 e mais de 5.000 chamados/ano.',
      decisionMaker: 'Comandante Geral e Coordenador de Operações.',
      pains: 'Acesso dificil a areas remotas e janela curta para busca e resposta.',
      products: 'Autel Alpha (termica e autonomia) e EVO Max 4T.',
      ticket: 'R$ 180k-R$ 350k',
      fitSignals: ['Ocorrencias com janela critica de resposta.', 'Demanda por busca em mata/serra.', 'Dor explicita com cobertura de area.'],
      redFlags: ['Projeto sem protocolo operacional.', 'Sem time para adoção e treinamento.', 'Foco apenas em equipamento, sem missão clara.']
    }
  ],
  boards: [
    {
      name: 'Funil · Leads (SDR)',
      area: 'Workspace → Funil',
      purpose: 'Kanban único de prospecção e fechamento B2B. Time multi-chapéu opera da Inbox ao ganho/perda no mesmo board.',
      stages: 'Topo 1–5 · Meio 6–8 · Fundo 9–12 · Outros 13–17',
      stageHint: 'Inbox → Contato → Follow-ups → SQL → Demo → Proposta → Negociação → Fechado / Nurturing / Descarte',
      usage: [
        'Card nasce na Inbox com origem, dono e atributos (ICP, valor, labels).',
        'Só avança etapa com último contato registrado e próximo passo datado.',
        'SQL (etapa 6) exige BANT+U mínimo e dor resumida no histórico.',
        'Fechado-Ganho (13) dispara handoff para a faixa Clientes · CS.',
      ],
    },
    {
      name: 'Funil · Clientes (CS)',
      area: 'Workspace → Funil',
      purpose: 'Kanban de pós-venda: onboarding, saúde da conta, upsell e recompra.',
      stages: 'Recompra/Upsell 18–26',
      stageHint: 'Novos Clientes → Onboarding → Ativo → Upsell/Recompra → Em Risco → Inativo',
      usage: [
        'Entrada após Fechado-Ganho, com escopo, riscos e plano 30-60-90 no card.',
        'Onboarding e Ativo medem adoção; Em Risco exige plano corretivo.',
        'Upsell/Recompra só com valor comprovado e janela de decisão clara.',
      ],
    },
    {
      name: 'Licitações · Pipeline',
      area: 'Licitações → Pipeline',
      purpose: 'Kanban de oportunidades públicas alinhado à Lei 14.133, com checklist e prazos no card.',
      stages: 'Inteligência 1–6 · Disputa 7–9 · Recursal 10–12 · Encerrado 13–15',
      stageHint: 'PCA/áreas/ETP → Edital → Análise → Cadastro/Disputa → Recurso → Contrato / Perdido',
      usage: [
        'Oportunidades entram via Busca Editais (PNCP), PCA ou cadastro manual.',
        'Mover fase só com marco real (edital publicado, cadastro feito, disputa, recurso).',
        'Checklist técnico e prazos críticos ficam no card — Resumo destaca atrasadas e 48h.',
      ],
    },
  ],
  marketAdvantages: [
    'Proposta de melhor custo-beneficio: preco mais competitivo com tecnologia equivalente para os casos de uso prioritarios.',
    'Maior flexibilidade comercial para montar condicoes por projeto, parceiro e janela de compra.',
    'SDK aberto para integradores e equipes técnicas criarem solucoes sob medida com menor dependencia.',
    'Produto com menor saturacao de concorrentes diretos em parte dos segmentos de alto valor.',
    'Canal curto: Aerion como importador direto para revendas, reduzindo camadas e acelerando decisões.',
    'Posicionamento em licitações: não entramos diretamente; registramos a oportunidade para proteger o parceiro.',
    'Nao ofertamos servico final: atuamos junto de prestadores e integradores, sem concorrer com eles.',
    'Suporte técnico e pós-venda feitos pela Aerion, com garantia de 1 ano.',
    'Entrega técnica com treinamento operacional para acelerar adoção e reduzir risco de implantacao.'
  ],
  competitorContext: [
    'Em alguns fabricantes, o canal passa por distribuidores master e subdistribuidores, alongando prazos e margens.',
    'Politicas de preco mais engessadas podem aumentar concorrência entre parceiros da mesma marca.',
    'Mudancas de linha sem previsibilidade podem elevar risco de suporte e manutenção no medio prazo.'
  ],
  marketWeaknesses: [
    'Ainda não temos linhas com LiDAR no portfólio atual.',
    'Ainda não temos linhas dedicadas com IR no portfólio atual.',
    'Ainda não temos drones agrícolas no portfólio atual.',
    'Ainda não temos câmera multiespectral no portfólio atual.'
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
      text: 'Aprofundar diagnostico, mapear use case e definir critérios de sucesso.'
    },
    {
      title: 'Proposta e negociação',
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
      inputs: 'Leads inbound/outbound com ICP inicial, canal e dono definidos no Sales Command.',
      outputs: 'SQL agendado com notas completas de contexto, dor, urgencia e próximos passos.',
      actions: [
        'Cadencia multicanal de 10 dias com registro de cada tentativa e resposta.',
        'Abertura consultiva com foco em problema operacional, não em catalogo.',
        'Classificacao por ICP + fit (alto/medio/baixo) antes da ligacao de qualificação.',
        'Checkpoint de qualidade: sem proximo passo agendado, não avança etapa.',
        'Saida padrao: SQL, nurture com gatilho de retomada, ou descarte com motivo.'
      ]
    },
    {
      id: 'qualificacao',
      title: 'Qualificacao de leads',
      owner: 'SDR/AE',
      objective: 'Garantir aderencia antes da demo.',
      inputs: 'Lead contatado com dor inicial declarada e janela de conversa ativa.',
      outputs: 'Diagnostico BANT+U completo, score de prioridade e decisão de avançar/nurture.',
      actions: [
        'Aplicar BANT+U com perguntas calibradas (como/o que) e busca do não.',
        'Usar mirroring e labeling para aprofundar causa-raiz e impacto.',
        'Quantificar custo da inação e critérios de sucesso esperados pelo cliente.',
        'Mapear com clareza quem decide, quem influencia e quem pode bloquear.',
        'Concluir com resumo de alinhamento e convite de agendamento em formato isso ou aquilo.'
      ]
    },
    {
      id: 'vendas-diretas',
      title: 'Vendas diretas (AE)',
      owner: 'AE',
      objective: 'Converter SQL em cliente ativo.',
      inputs: 'SQL com resumo diagnostico, stakeholders mapeados e objetivo de negocio.',
      outputs: 'Proposta defendida por valor, plano de decisão fechado e handoff aceito.',
      actions: [
        'Discovery em duas camadas: operação atual e impacto executivo.',
        'Demo ancorada em casos de uso do ICP, com roteiro por dor critica.',
        'Proposta com ROI esperado, riscos, premissas e responsabilidades.',
        'Negociacao consultiva: objeção vira diagnostico de risco e não disputa de preco.',
        'Comite interno antes do fechamento para reduzir retrabalho e ruptura no onboarding.'
      ]
    },
    {
      id: 'canais',
      title: 'Gestão de canais',
      owner: 'Channel Manager',
      objective: 'Ativar parceiros e manter pipeline recorrente.',
      inputs: 'Parceiros com potencial de cobertura regional e capacidade comercial minima.',
      outputs: 'Parceiros ativos com metas, plano de execução e revisão trimestral.',
      actions: [
        'Pre-qualificar carteira, maturidade e capacidade técnica do parceiro.',
        'Onboarding de 30 dias com metas de pipeline e rituais definidos.',
        'Playbook de abordagem por ICP com acompanhamento de execução.',
        'QBR trimestral com pipeline, conversão e plano de recuperacao quando abaixo da meta.',
        'Classificar parceiros em acelerar, manter ou recuperar.'
      ]
    },
    {
      id: 'licitacoes',
      title: 'Licitações públicas',
      owner: 'AE/Backoffice',
      objective: 'Competir de forma organizada e dentro do compliance.',
      inputs: 'Edital, anexos técnicos, prazos oficiais e matriz documental.',
      outputs: 'Proposta protocolada com rastreabilidade, risco e plano de disputa.',
      actions: [
        'Go/no-go inicial por aderencia técnica, margem e risco juridico.',
        'Checklist de habilitação, atestados e responsaveis por documento.',
        'Revisao técnica com engenharia e juridico antes de protocolar.',
        'Plano de disputa com tese de preco, diferencial e limites de desconto.',
        'Registro estruturado no Sales Command para reaproveitar inteligencia no proximo edital.'
      ]
    },
    {
      id: 'customer-success',
      title: 'Customer Success',
      owner: 'CS',
      objective: 'Ativar, reter e expandir clientes.',
      inputs: 'Handoff com escopo, objetivo de negocio, stakeholders e riscos.',
      outputs: 'Adocao comprovada, saude da conta e tese de expansão validada.',
      actions: [
        'Onboarding com marcos de valor em 30-60-90 dias e critérios de aceite.',
        'Governanca de check-ins com registro de risco, bloqueio e acao corretiva.',
        'Plano de sucesso com KPI operacional e sponsor executivo.',
        'Mapeamento de gatilhos de upsell/recompra por maturidade de uso.',
        'QBR com narrativa de resultado: antes/depois e próximos ganhos potenciais.'
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
      focus: 'Qualidade das oportunidades e próximos passos.'
    },
    {
      title: 'Comite de propostas',
      cadence: 'Semanal',
      focus: 'Escopo, riscos e aprovações internas.'
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
    { name: 'Chatwoot', purpose: 'Registro principal do contato e histórico.' },
    { name: 'Sales Command', purpose: 'CRM operacional Aerion: Gestão de Leads, Funil (Leads/CS), Licitações, prospecção B2B e playbook Processo.' },
    { name: 'Email/WhatsApp/LinkedIn', purpose: 'Canais de cadencia e follow-up.' },
    { name: 'ERP Sankhya', purpose: 'Fluxo administrativo apos fechamento.' },
  ],
  consultiveSales: {
    opening: [
      'Bom dia [Nome], aqui e [Seu Nome] da Aerion Technologies. Recebi seu contato via [fonte].',
      'Nos somos especializados em solucoes com drones para [segmento do cliente].',
      'Imagino que agora seja um momento terrivel para conversarmos, não e?'
    ],
    bantu: [
      {
        key: 'B - Budget',
        prompts: [
          'Como voces costumam avaliar investimentos em tecnologia?',
          'Existe budget definido ou depende de aprovacao caso a caso?',
          'O que precisaria acontecer para esse investimento ser aprovado?'
        ]
      },
      {
        key: 'A - Authority',
        prompts: [
          'Imagino que essa decisão não seja tomada sozinho. Como funciona a aprovacao ai?',
          'O que o decisor principal mais valoriza nesse tipo de projeto?',
          'Seria absurdo envolvermos [decisor] na proxima conversa?'
        ]
      },
      {
        key: 'N - Need',
        prompts: [
          'Como voces executam esse processo hoje?',
          'O que mais frustra no modelo atual?',
          'Se isso continuar por 6 meses, qual impacto operacional e financeiro voce espera?'
        ]
      },
      {
        key: 'T - Timeline',
        prompts: [
          'O que acontece se voces não resolverem isso nos próximos 3 meses?',
          'Qual e o custo da inação para a operação?',
          'Qual timeline ideal para implantar sem comprometer a rotina?'
        ]
      },
      {
        key: 'U - Use Case',
        prompts: [
          'O uso principal e pulverizacao, inspeção, mapeamento ou resposta emergencial?',
          'Qual area, volume e frequencia de operação?',
          'Qual resultado mínimo faria essa iniciativa ser considerada um sucesso?'
        ]
      }
    ],
    close: [
      'Resumo: voces precisam [X], hoje enfrentam [Y], e isso custa [Z]. Acertei?',
      'Parece justo eu conectar voce ao especialista da Aerion nesse segmento?',
      'Para demo técnica focada no seu caso, funciona melhor amanha 14h ou quinta 10h?'
    ]
  },
  objections: [
    {
      objection: '"Ja usamos DJI e estamos acostumados com a marca."',
      answer: 'Perfeito, manter continuidade e importante. Em varios projetos, a Aerion entrega tecnologia equivalente com melhor custo-beneficio, mais flexibilidade comercial e canal mais curto para suporte e decisão.'
    },
    {
      objection: '"Tenho receio de ficar sem suporte ou manutenção."',
      answer: 'Faz sentido. Todo o suporte técnico e pós-venda fica conosco, com garantia de 1 ano e entrega técnica com treinamento de operação para sua equipe.'
    },
    {
      objection: '"Nao quero que meu fornecedor concorra comigo em licitação."',
      answer: 'Esse ponto e central para nos: não entramos direto em licitação. Registramos a oportunidade para o parceiro e apoiamos a estrategia técnica/comercial.'
    },
    {
      objection: '"Voce tambem presta servico? Pode competir com meu integrador."',
      answer: 'Nao ofertamos servico final. Precisamos de prestadores e integradores para entrega da solucao, entao nosso modelo e colaborativo, não competitivo.'
    },
    {
      objection: '"Preciso de customizacao técnica."',
      answer: 'Temos SDK aberto para desenvolvimento com integradores e time técnico, o que reduz lock-in e acelera adaptações por caso de uso.'
    }
  ],
  productTraining: [
    {
      product: 'Autel EVO Lite Enterprise (640T/6K)',
      summary: 'Drone compacto para inspeções ágeis, segurança e mapeamento leve; até 40 min de voo e opção térmica 640x512.',
      equivalent: 'Equivalência de categoria: DJI Mavic 3 Enterprise / Mavic 3 Thermal.',
      useWhen: 'Quando o cliente prioriza mobilidade, resposta rápida e menor custo de entrada.'
    },
    {
      product: 'Autel EVO Max V2 (4T/4N)',
      summary: 'Plataforma robusta com sensores triplos, câmera térmica 640x512, zoom óptico na versão 4T e foco em ambientes complexos.',
      equivalent: 'Equivalência de categoria: DJI Matrice 30T.',
      useWhen: 'Quando a operação exige anti-interferência, alta precisão e versatilidade de sensores.'
    },
    {
      product: 'Autel Alpha',
      summary: 'Drone industrial IP55 com zoom óptico 35x, térmicas duplas, laser e alcance estendido para operações críticas.',
      equivalent: 'Equivalência de categoria: DJI Matrice 350 RTK (com payload térmico/zoom equivalente).',
      useWhen: 'Quando a missão exige robustez máxima, longo alcance e observação detalhada.'
    },
    {
      product: 'EVO Nest + Autel Mapper',
      summary: 'Ecossistema para operação remota automatizada (dock) e processamento 2D/3D com deep learning.',
      equivalent: 'Equivalência de categoria: DJI Dock + DJI Terra.',
      useWhen: 'Quando a meta é escala operacional com missões recorrentes e padronização de dados.'
    }
  ],
  playbook: [
    {
      title: 'Playbook Diario (SDR/AE/CS)',
      items: [
        '08:30-09:00: revisar cards sem proximo passo e definir prioridade do dia.',
        '09:00-11:30: executar contatos e registrar resultado no card em tempo real.',
        '11:30-12:00: ajustar etapas com base em evidencia (não por percepção).',
        '14:00-17:00: follow-ups, reunioes e atualizacao de risco por oportunidade.',
        '17:00-17:30: limpar pendencias e preparar handoffs do dia seguinte.'
      ]
    },
    {
      title: 'Playbook de Passagem entre Boards',
      items: [
        'SDR -> AE: BANT+U mínimo completo, dor principal, impacto e decisor mapeado.',
        'AE -> CS: escopo fechado, condicoes comerciais, riscos e plano de 30-60-90 dias.',
        'CS -> AE (expansão): valor comprovado, gatilho de crescimento e sponsor ativo.',
        'Toda passagem exige dono, data e proximo marco registrado no Sales Command.'
      ]
    },
    {
      title: 'Playbook de Qualidade de Execucao',
      items: [
        'Card sem histórico atualizado em 48h entra em alerta de execução.',
        'Negociacao sem critério de decisão explicito não avança para fechamento.',
        'Conta em risco sem plano corretivo em 72h sobe para revisão com lideranca.',
        'Toda perda deve registrar motivo raiz e aprendizado acionavel.'
      ]
    }
  ],
  erp: [
    'Abrir cadastro do cliente com dados completos e validados.',
    'Registrar oportunidade ganha e documentos necessarios.',
    'Garantir que o CS tenha acesso a contratos e escopo.'
  ],
  erpDeepDive: [
    {
      title: '1) Cadastro e validação de parceiro/cliente',
      items: [
        'Conferir CNPJ, IE/IM, endereco fiscal, contatos e condicao de contribuinte.',
        'Definir tabela de preco, condicao de pagamento e regras comerciais padrao.',
        'Registrar observações de compliance e documentos para auditoria.'
      ]
    },
    {
      title: '2) Pedido de venda e aprovações internas',
      items: [
        'Criar pedido com itens, impostos, frete, prazos e centro de resultado.',
        'Aplicar politica de desconto e alcada de aprovacao quando necessario.',
        'Vincular numero da oportunidade do Sales Command no histórico do pedido.'
      ]
    },
    {
      title: '3) Faturamento e documentos fiscais',
      items: [
        'Gerar NF-e conforme CFOP, CST/CSOSN, base de calculo e aliquotas aplicaveis.',
        'Validar dados de transporte, volumes e regras de expedicao.',
        'Acompanhar rejeicoes de SEFAZ e registrar tratativas no card da oportunidade.'
      ]
    },
    {
      title: '4) Pos-venda administrativo e conciliacao',
      items: [
        'Confirmar titulo financeiro, vencimentos, recebimento e eventuais renegociações.',
        'Atualizar status de entrega e comprovantes para handoff completo ao CS.',
        'Fechar ciclo com licoes aprendidas comerciais e fiscais para reduzir retrabalho.'
      ]
    }
  ],
  documentation: [
    'Scripts de prospecção e discovery por segmento.',
    'Modelos de email e proposta.',
    'Checklist de onboarding e health check.',
    'Playbooks de canais e licitações.'
  ],
  // Motor de Receita 2026 (Receita Previsível — Aaron Ross)
  revenueEngine: {
    formula: 'Receita = SQLs × Taxa de Conversão × Ticket Médio',
    annual: { revenue: 6200000, sales: 207, avgTicket: 30000 },
    monthly: { revenue: 516667, sales: 17, sqls: 240 },
    conversion: 0.07,
    workingDays: 20,
  },
  // Metas SDR (2 SDRs)
  sdrGoals: {
    teamSize: 2,
    teamGoal: 240,
    individualGoal: 120,
    kpis: ['Contatos/dia', 'SQLs gerados', 'Taxa de contato']
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
  // Atividade diária — alavanca principal no estágio inicial do negócio
  activity: {
    callsPerDayTeamMin: 200,
    callsPerDayTeamMax: 240,
    callsPerDayTeam: 220,
    emailsPerDayTeam: 120,
    conversationsPerWeekTeam: 60,
    mqlToSqlRate: 0.30,
  },
  // Time enxuto 2026: cada vendedor acumula os chapéus do livro
  multiHat: {
    title: 'Time enxuto — multi-chapéu',
    book: 'Receita Previsível (Aaron Ross)',
    note: 'No início, a métrica que torna o plano factível é o volume de contatos. Os papéis abaixo são do modelo clássico; na prática cada vendedor faz SDR + Market Response + AE no mesmo dia.',
    hats: [
      { id: 'sdr', label: 'SDR', full: 'Sales Development Representative', aka: 'Outbound / Prospector', focus: 'Cadência e volume de contatos → SQL', color: '#7c5cff' },
      { id: 'mrr', label: 'Market Response', full: 'Market Response Rep', aka: 'Inbound SDR', focus: 'Leads de marketing com SLA rápido', color: '#38d6e6' },
      { id: 'ae', label: 'Account Executive', full: 'Account Executive', aka: 'Closer', focus: 'Demo, proposta e fechamento', color: '#36d39a' },
    ],
  },
  // Funil reverso: volume necessário em cada etapa para bater a meta do mês
  // Conversões planejadas: MQL→SQL 30%; SQL→Opp 50%; Opp→Prop 60%; Prop→Close ~24% (SQL→Close 7%)
  funnel: [
    {
      key: 'contatos', stage: 'Contatos', short: 'WhatsApp + notas (ligação/e-mail)',
      volume: 4400, daily: 220, conversionFromPrev: null, conversionToNext: null,
      conversionLabel: 'atividade', role: 'SDR', hat: 'sdr', color: '#5a93ff', isActivity: true,
      hasValue: false,
      stockStages: [2, 3, 4, 5],
      howCounted: 'Mensagens enviadas no Chatwoot (WhatsApp etc.) + notas privadas. Ligação e e-mail não entram sozinhos: registre em Notas no chat.',
    },
    {
      key: 'leads', stage: 'Leads (MQL)', short: 'Entrada no funil',
      volume: 800, conversionFromPrev: null, conversionToNext: 0.30,
      conversionLabel: 'topo de funil', role: 'MRR/SDR', hat: 'mrr', color: '#7c5cff',
      hasValue: false,
      stockStages: [1, 2, 3, 4, 5],
      howCounted: 'Card movido para Inbox / etapa 1 do funil.',
    },
    {
      key: 'sql', stage: 'SQL', short: 'Qualificado BANT+U',
      volume: 240, conversionFromPrev: 0.30, conversionToNext: 0.50,
      conversionLabel: '30% MQL → SQL', role: 'SDR', hat: 'sdr', color: '#a78bff',
      hasValue: false,
      stockStages: [6, 7, 8],
      howCounted: 'Card movido para 6. Qualificado (SQL).',
    },
    {
      key: 'oportunidade', stage: 'Oportunidade', short: 'Demo / discovery',
      volume: 120, conversionFromPrev: 0.50, conversionToNext: 0.60,
      conversionLabel: '50% SQL → Opp', role: 'AE', hat: 'ae', color: '#ffb24d',
      hasValue: true,
      stockStages: [7, 8, 9, 10, 11, 12],
      howCounted: 'Card movido para 7–8 (Agendamento Demo / Demo Realizada). Em R$: Valor_Oportunidade.',
    },
    {
      key: 'proposta', stage: 'Proposta', short: 'Proposta em jogo',
      volume: 72, conversionFromPrev: 0.60, conversionToNext: 0.24,
      conversionLabel: '60% Opp → Prop', role: 'AE', hat: 'ae', color: '#38d6e6',
      hasValue: true,
      stockStages: [9, 10, 11, 12],
      howCounted: 'Card movido para 9–12 (Elaborando Proposta até Aprovação Interna). Em R$: Valor_Oportunidade.',
    },
    {
      key: 'fechamento', stage: 'Fechamento', short: 'Venda ganha',
      volume: 17, conversionFromPrev: 0.24, conversionToNext: null,
      conversionLabel: '24% Prop → Venda · 7% SQL → Venda', role: 'AE', hat: 'ae', color: '#36d39a',
      hasValue: true,
      stockStages: [13],
      howCounted: 'Card movido para 13. Fechado-Ganho. Em R$: receita das vendas.',
    },
  ],
  glossary: [
    { term: 'SDR', full: 'Sales Development Representative', meaning: 'Prospecção outbound: contatos e qualificação até SQL.' },
    { term: 'MRR', full: 'Market Response Rep', meaning: 'Inbound SDR — atende leads de marketing com SLA rápido.' },
    { term: 'AE', full: 'Account Executive', meaning: 'Closer: demo, proposta e fechamento.' },
    { term: 'SQL', full: 'Sales Qualified Lead', meaning: 'Lead com BANT+U mínimo, dor e próximo passo claros.' },
    { term: 'MQL', full: 'Marketing Qualified Lead', meaning: 'Lead que entrou pelo marketing/inbound com fit inicial.' },
    { term: 'BANT+U', full: 'Budget, Authority, Need, Timeline + Use Case', meaning: 'Critérios de qualificação antes de virar SQL.' },
    { term: 'ICP', full: 'Ideal Customer Profile', meaning: 'Perfil de cliente ideal (verticais Autel).' },
  ],
};

/** Escala o funil-base (qtd) para a meta de receita do mês. */
const buildFunnelTargets = (monthlyRevenueMeta) => {
  const baseRevenue = processBlueprint.revenueEngine.monthly.revenue;
  const scale = monthlyRevenueMeta && monthlyRevenueMeta > 0
    ? monthlyRevenueMeta / baseRevenue
    : 1;
  const workingDays = processBlueprint.revenueEngine.workingDays || 20;
  return processBlueprint.funnel.map((step) => {
    const target = Math.max(1, Math.round(step.volume * scale));
    const daily = step.daily != null
      ? Math.max(1, Math.round(step.daily * scale))
      : (step.isActivity ? Math.max(1, Math.round(target / workingDays)) : null);
    return { ...step, target, daily, scale };
  });
};

/**
 * Funil reverso em R$: Fechamento = meta de faturamento do mês.
 * Etapas de cima = divide pelas taxas (números maiores acima).
 */
const buildValueFunnelTargets = (monthlyRevenueMeta) => {
  const R = monthlyRevenueMeta > 0
    ? monthlyRevenueMeta
    : (processBlueprint.revenueEngine.monthly?.revenue || 516667);
  const opp = processBlueprint.funnel.find((s) => s.key === 'oportunidade');
  const prop = processBlueprint.funnel.find((s) => s.key === 'proposta');
  const oppToProp = opp?.conversionToNext != null ? opp.conversionToNext : 0.60;
  const propToClose = prop?.conversionToNext != null ? prop.conversionToNext : 0.24;
  const safePropToClose = propToClose > 0 ? propToClose : 0.24;
  const safeOppToProp = oppToProp > 0 ? oppToProp : 0.60;
  const fechamento = R;
  const proposta = R / safePropToClose;
  const oportunidade = proposta / safeOppToProp;
  return {
    revenueMonth: R,
    rates: { oppToProp: safeOppToProp, propToClose: safePropToClose },
    month: { oportunidade, proposta, fechamento },
  };
};

const countStockForStages = (stageFunnelData, stageNums) => {
  if (!Array.isArray(stageFunnelData) || !Array.isArray(stageNums)) return 0;
  const set = new Set(stageNums);
  return stageFunnelData.reduce((sum, row) => {
    const n = parseInt(row.stageNumber, 10);
    return set.has(n) ? sum + (Number(row.count) || 0) : sum;
  }, 0);
};

/**
 * Painel limpo do modal "Detalhes do ritmo".
 * Hierarquia: resumo → regras → funil reverso R$ → tabela qtd+R$ → estoque → extras.
 */
const PaceDetailsPanel = ({
  stages,
  stockByKey = {},
  actualByKey = {},
  revenueMeta = null,
  revenueDone = null,
  rules = null,
  stageGroups = [],
}) => {
  const [openHow, setOpenHow] = useState(null);
  const [showExtras, setShowExtras] = useState(false);
  const avgTicket = processBlueprint.revenueEngine.annual?.avgTicket || 30000;
  const R = revenueMeta > 0 ? revenueMeta : (processBlueprint.revenueEngine.monthly?.revenue || 516667);
  const valueFunnel = buildValueFunnelTargets(R);
  const revenuePct = R > 0 && revenueDone != null
    ? Math.min((revenueDone / R) * 100, 999)
    : null;

  const flowStages = stages;
  const valueBars = [
    { key: 'oportunidade', label: 'Oportunidade', color: '#ffb24d', meta: valueFunnel.month.oportunidade },
    { key: 'proposta', label: 'Proposta', color: '#38d6e6', meta: valueFunnel.month.proposta },
    { key: 'fechamento', label: 'Fechamento (= meta)', color: '#36d39a', meta: valueFunnel.month.fechamento },
  ];
  const maxValueMeta = Math.max(...valueBars.map((b) => b.meta), 1);

  const convChain = stages
    .filter((s) => s.key !== 'contatos')
    .map((s) => {
      const rate = s.conversionFromPrev != null ? Math.round(s.conversionFromPrev * 100) : null;
      const valueMeta = s.hasValue ? valueFunnel.month[s.key] : null;
      return {
        stage: s.stage,
        key: s.key,
        rate,
        color: s.color,
        volume: s.target || s.volume,
        valueMeta,
      };
    });

  return (
    <div className="space-y-5">
      {/* 1. Resumo */}
      <div className="rounded-xl border border-line bg-bg2 px-4 py-3">
        <p className="text-[13px] text-ink dark:text-white">
          <span className="font-semibold">Receita previsível:</span>{' '}
          <span className="font-mono text-[12px] text-muted">
            SQLs × 7% × ticket {formatCompactCurrency(avgTicket) || 'R$ 30k'}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[20px] font-bold text-ink dark:text-white">
            {formatCompactCurrency(R) || 'R$ 0'}
          </span>
          <span className="text-[12px] text-muted">meta faturamento do mês (= fechamento)</span>
          {revenueDone != null && (
            <>
              <span className="text-muted">·</span>
              <span className="font-mono text-[14px] font-semibold text-ink dark:text-white">
                {formatCompactCurrency(revenueDone) || 'R$ 0'}
              </span>
              <span className={`font-mono text-[12px] ${revenuePct >= 100 ? 'text-green' : 'text-amber'}`}>
                ({revenuePct != null ? `${Math.round(revenuePct)}%` : '—'})
              </span>
            </>
          )}
        </div>
        {revenuePct != null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#7c5cff,#38d6e6)]"
              style={{ width: `${Math.min(revenuePct, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* 2. Regras */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-ink dark:text-white">Como conta no ritmo</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              title: '1. Contatos',
              body: 'WhatsApp/canal automático + notas (ligação e e-mail você registra na Nota).',
              tone: 'border-primary/30 bg-primary/10',
            },
            {
              title: '2. SQL → Fechamento',
              body: 'Só conta quando o card muda de etapa no funil (arrastar ou alterar status).',
              tone: 'border-line bg-bg2',
            },
            {
              title: '3. Modo R$',
              body: 'Fechamento = meta de faturamento. Opp e Prop = funil reverso (÷ taxas). Feito = Valor_Oportunidade no mês.',
              tone: 'border-line bg-bg2',
            },
          ].map((r) => (
            <div key={r.title} className={`rounded-xl border px-3 py-2.5 ${r.tone}`}>
              <p className="text-[12px] font-semibold text-ink dark:text-white">{r.title}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted">{r.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Gráfico funil reverso em R$ */}
      <div>
        <p className="mb-1 text-[12px] font-semibold text-ink dark:text-white">Funil reverso em R$ (meta do mês)</p>
        <p className="mb-2 text-[11px] text-muted">
          De baixo pra cima: receita → prop (÷{Math.round(valueFunnel.rates.propToClose * 100)}%) → opp (÷{Math.round(valueFunnel.rates.oppToProp * 100)}%).
          Etapas de cima exigem mais valor em pipeline.
        </p>
        <div className="space-y-2 rounded-xl border border-line bg-bg2 px-3 py-3">
          {valueBars.map((bar) => (
            <div key={bar.key} className="flex items-center gap-2.5">
              <span className="w-[7.5rem] shrink-0 truncate text-[11px] font-medium text-ink dark:text-white">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: bar.color }} />
                {bar.label}
              </span>
              <div className="h-7 flex-1 overflow-hidden rounded-lg bg-bg">
                <div
                  className="flex h-full items-center justify-end rounded-lg px-2"
                  style={{
                    width: `${Math.max((bar.meta / maxValueMeta) * 100, 8)}%`,
                    background: bar.color,
                  }}
                >
                  <span className="font-mono text-[10px] font-bold text-bg">
                    {formatCompactCurrency(bar.meta) || 'R$ 0'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Cadeia qtd + R$ */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-ink dark:text-white">Cadeia (qtd e R$ meta/mês)</p>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-bg2 px-3 py-2.5">
          {convChain.map((c, i) => (
            <React.Fragment key={c.key}>
              {i > 0 && (
                <span className="font-mono text-[10px] font-semibold text-primary">
                  {c.rate != null ? `${c.rate}%` : '→'}
                </span>
              )}
              <span className="inline-flex flex-col items-start gap-0.5 rounded-lg border border-line bg-surf px-2 py-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink dark:text-white">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  {c.stage.replace(' (MQL)', '')}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {formatCompactNumber(c.volume) || c.volume} un
                  {c.valueMeta != null && (
                    <span className="text-ink/80 dark:text-white/80"> · {formatCompactCurrency(c.valueMeta)}</span>
                  )}
                </span>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 5. Tabela qtd + R$ */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-ink dark:text-white">Metas e realizado</p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-bg2 font-mono text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">Etapa</th>
                <th className="px-2 py-2 font-semibold text-right">Meta qtd</th>
                <th className="px-2 py-2 font-semibold text-right">Meta R$</th>
                <th className="px-2 py-2 font-semibold text-right text-cyan">Hoje</th>
                <th className="px-2 py-2 font-semibold text-right">Mês qtd</th>
                <th className="px-2 py-2 font-semibold text-right">Board</th>
                <th className="px-2 py-2 font-semibold"> </th>
              </tr>
            </thead>
            <tbody>
              {flowStages.map((step) => {
                const target = step.target || step.volume || 0;
                const valueMeta = step.hasValue ? valueFunnel.month[step.key] : null;
                const actual = actualByKey[step.key] || {};
                const stock = stockByKey[step.key];
                const how = rules?.[step.key] || step.howCounted;
                const isOpen = openHow === step.key;
                return (
                  <React.Fragment key={step.key}>
                    <tr className={`border-b border-line/60 ${step.isActivity ? 'bg-primary/5' : ''} ${step.key === 'fechamento' ? 'bg-green/5' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-white">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: step.color }} />
                          {step.stage}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-muted">{step.role}</span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-ink dark:text-white">
                        {formatCompactNumber(target) || target}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-ink dark:text-white">
                        {valueMeta != null ? (formatCompactCurrency(valueMeta) || 'R$ 0') : '—'}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-cyan">
                        {actual.day != null ? actual.day : '—'}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-ink/80 dark:text-white/80">
                        {actual.month != null ? actual.month : '—'}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {stock != null ? stock : '—'}
                      </td>
                      <td className="px-2 py-2">
                        {how && (
                          <button
                            type="button"
                            onClick={() => setOpenHow(isOpen ? null : step.key)}
                            className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-ink"
                          >
                            {isOpen ? '−' : '?'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && how && (
                      <tr className="border-b border-line/60 bg-bg2">
                        <td colSpan={7} className="px-3 py-2 text-[11px] leading-snug text-muted">
                          <span className="font-semibold text-ink/80 dark:text-white/80">Como conta: </span>
                          {how}
                          {actual.breakdown && (
                            <span className="mt-1 block font-mono text-[10px]">
                              Hoje — canal {actual.breakdown.messages ?? 0} · notas {actual.breakdown.notes ?? 0}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px] text-muted">
          Meta R$ do fechamento = faturamento do mês. Opp/Prop = funil reverso. Board = estoque atual (não é o feito).
        </p>
      </div>

      {/* 5. Estoque no board — compacto */}
      {stageGroups.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold text-ink dark:text-white">Estoque no board agora</p>
          <div className="space-y-2 rounded-xl border border-line bg-bg2 px-3 py-3">
            {(() => {
              const max = Math.max(...stageGroups.map((g) => g.count || 0), 1);
              return stageGroups.map((g) => (
                <div key={g.group} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 truncate text-[11px] text-muted">{g.group}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(((g.count || 0) / max) * 100, 2)}%`, backgroundColor: g.color }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[11px] font-bold text-ink dark:text-white">
                    {g.count || 0}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* 6. Extras sob demanda */}
      <div className="border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setShowExtras((v) => !v)}
          className="flex w-full items-center justify-between text-left text-[12px] font-semibold text-ink dark:text-white"
        >
          <span>Papéis (multi-chapéu) e siglas</span>
          <span className="font-mono text-muted">{showExtras ? '−' : '+'}</span>
        </button>
        {showExtras && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] leading-relaxed text-muted">
              {processBlueprint.multiHat?.note}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(processBlueprint.multiHat?.hats || []).map((hat) => (
                <div key={hat.id} className="rounded-lg border border-line bg-bg2 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: hat.color }} />
                    <span className="text-[12px] font-semibold text-ink dark:text-white">{hat.label}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">{hat.aka}</p>
                  <p className="mt-1 text-[11px] text-ink/80 dark:text-white/75">{hat.focus}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(processBlueprint.glossary || []).map((g) => (
                <p key={g.term} className="text-[11px] leading-snug text-muted">
                  <span className="font-semibold text-ink dark:text-white">{g.term}</span>
                  {' — '}{g.full || g.meaning}
                  {g.full && g.meaning ? `. ${g.meaning}` : ''}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Card compacto: meta × feito × faltam. Escopo: time/agente · métrica Qtd|R$. */
const TeamPaceCard = ({
  stages,
  pace,
  agents = [],
  agentId = null,
  onAgentChange,
  metric = 'count',
  onMetricChange,
  onOpenDetails,
  revenueMeta = null,
  className = '',
}) => {
  const loaded = pace != null;
  const day = pace?.day || {};
  const month = pace?.month || {};
  const dayValue = day.value || {};
  const monthValue = month.value || {};
  const workingDays = processBlueprint.revenueEngine.workingDays || 20;
  const isValue = metric === 'value';
  // Meta individual ≈ time / nº agentes (mín. 2 do blueprint se lista vazia)
  const headcount = Math.max(
    agents.length,
    processBlueprint.sdrGoals?.teamSize || 2,
    1
  );
  const isIndividual = agentId != null && agentId !== '';
  const personScale = isIndividual ? 1 / headcount : 1;

  const baseRevenue = revenueMeta > 0
    ? revenueMeta
    : (processBlueprint.revenueEngine.monthly?.revenue || 516667);
  const valueFunnel = buildValueFunnelTargets(baseRevenue);

  const rows = stages
    .filter((step) => step.key !== 'leads')
    // Em R$: só a partir de oportunidade (processo — valor entra no AE)
    .filter((step) => !isValue || step.hasValue)
    .map((step) => {
      const teamCountDay = step.daily != null
        ? step.daily
        : Math.max(1, Math.round((step.target || step.volume || 0) / workingDays));

      let target;
      let done = null;
      let doneToday = null;
      let periodLabel;

      if (isValue) {
        // Meta do MÊS (funil reverso da receita). Feito = acumulado do mês.
        const monthTarget = valueFunnel.month[step.key] || 0;
        target = Math.max(0, Math.round(monthTarget * personScale));
        periodLabel = 'mês';
        if (loaded) {
          done = Number(monthValue[step.key]) || 0;
          doneToday = Number(dayValue[step.key]) || 0;
        }
      } else {
        target = Math.max(1, Math.round(teamCountDay * personScale));
        periodLabel = 'dia';
        if (loaded) {
          if (step.key === 'contatos') {
            done = Number(day.contatos?.total) || 0;
          } else {
            done = Number(day[step.key]) || 0;
          }
        }
      }

      const remaining = done == null ? null : Math.max(target - done, 0);
      const pct = done != null && target > 0 ? Math.min((done / target) * 100, 100) : 0;
      return { step, target, done, remaining, pct, doneToday, periodLabel };
    });

  // Em R$: o “total” é a meta de fechamento/receita — não a soma das etapas
  const closeRow = rows.find((r) => r.step.key === 'fechamento');
  const totalTarget = isValue
    ? (closeRow?.target ?? valueFunnel.revenueMonth * personScale)
    : rows.reduce((s, r) => s + r.target, 0);
  const totalDone = isValue
    ? (loaded ? (closeRow?.done ?? 0) : null)
    : (loaded ? rows.reduce((s, r) => s + (r.done || 0), 0) : null);
  const overallPct = loaded && totalTarget > 0 ? Math.min((totalDone / totalTarget) * 100, 100) : 0;
  const scopeLabel = isIndividual
    ? (agents.find((a) => String(a.id) === String(agentId))?.name || 'Agente')
    : 'Time (geral)';
  const fmt = (n) => {
    if (n == null) return '—';
    return isValue ? (formatCompactCurrency(n) || 'R$ 0') : (formatCompactNumber(n) || n);
  };
  const fmtRemain = (n) => {
    if (n == null) return '—';
    if (n === 0) return 'ok';
    return isValue ? `−${formatCompactCurrency(n) || n}` : `−${n}`;
  };
  const ratePct = (r) => `${Math.round(r * 100)}%`;

  return (
    <div className={`${card} p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`${sectionTitle} text-base`}>Ritmo do time</h3>
          <p className={`${subtle} mt-0.5`}>
            {isValue ? 'R$ no mês · funil reverso' : 'Qtd hoje'} · {scopeLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          className={`${btnGhost} h-8 shrink-0 gap-1 px-2.5 text-xs`}
          title="Ver funil, conversões, estoque e regras"
        >
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line font-mono text-[9px] font-bold text-muted">i</span>
          Detalhes
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted">Escopo</label>
          <select
            value={agentId == null || agentId === '' ? '' : String(agentId)}
            onChange={(e) => onAgentChange?.(e.target.value === '' ? null : Number(e.target.value))}
            className={`${select} h-9 w-full text-xs`}
            aria-label="Filtrar ritmo por agente"
          >
            <option value="">Time (geral)</option>
            {agents.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>
        </div>
        {onMetricChange && (
          <MetricToggle value={metric} onChange={onMetricChange} />
        )}
      </div>

      {isValue && (
        <p className="mb-3 text-[11px] leading-snug text-muted">
          Fechamento = meta de faturamento do mês.
          Acima: divide pelas taxas ({ratePct(valueFunnel.rates.propToClose)} prop→venda, {ratePct(valueFunnel.rates.oppToProp)} opp→prop).
        </p>
      )}

      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {isValue ? 'Receita (fechamento) no mês' : 'Atividade de hoje'}
          </p>
          <p className="mt-0.5 font-mono text-[22px] font-bold leading-none text-ink dark:text-white">
            {fmt(totalDone)}
            <span className="text-[13px] font-semibold text-muted"> / {fmt(totalTarget)}</span>
          </p>
        </div>
        <p className={`font-mono text-[12px] font-semibold ${overallPct >= 100 ? 'text-green' : 'text-amber'}`}>
          {loaded ? `${Math.round(overallPct)}%` : '—'}
        </p>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-bg2">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#7c5cff,#38d6e6)]" style={{ width: `${Math.max(overallPct, totalDone > 0 ? 4 : 0)}%` }} />
      </div>

      <div className="mb-1.5 grid grid-cols-[1fr_auto] gap-x-2 px-2 font-mono text-[10px] uppercase tracking-wide text-muted">
        <span>Etapa</span>
        <span className="text-right">{isValue ? 'mês: feito / meta · faltam' : 'hoje: feito / meta · faltam'}</span>
      </div>

      <div className="space-y-1.5">
        {rows.map(({ step, target, done, remaining, pct, doneToday }) => (
          <button
            key={step.key}
            type="button"
            onClick={onOpenDetails}
            className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left transition hover:bg-bg2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: step.color }} />
              <span className="truncate text-[12.5px] font-medium text-ink dark:text-white">{step.stage}</span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] sm:text-[12px]">
              <div className="flex items-baseline gap-1.5">
                <span className="font-bold text-ink dark:text-white">{fmt(done)}</span>
                <span className="text-muted">/{fmt(target)}</span>
                <span className={`min-w-[3.5rem] text-right text-[11px] font-semibold ${remaining === 0 ? 'text-green' : 'text-amber'}`}>
                  {fmtRemain(remaining)}
                </span>
              </div>
              {isValue && doneToday != null && (
                <span className="text-[10px] text-muted">hoje {fmt(doneToday)}</span>
              )}
            </div>
            <div className="col-span-2 h-1 overflow-hidden rounded-full bg-bg2">
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, done > 0 ? 4 : 0)}%`, background: step.color }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/** Toggle Qtd | R$ por quadro (Gestão de Leads). */
const MetricToggle = ({ value, onChange, className = '' }) => (
  <div className={`inline-flex items-center gap-1 rounded-xl border border-line bg-bg2 p-1 ${className}`}>
    {[['count', 'Qtd'], ['value', 'R$']].map(([key, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={`h-7 rounded-[9px] px-2.5 text-[11px] font-semibold transition ${
          value === key
            ? 'bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] text-white'
            : 'text-muted hover:text-ink'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

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

const getPncpScoreClass = (score) => {
  const value = Number(score || 0);
  if (value >= PNCP_SCORE_HIGH_THRESHOLD) return 'bg-status-success/10 text-status-success border-status-success/20';
  if (value >= PNCP_SCORE_MEDIUM_THRESHOLD) return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
  return 'bg-status-danger/10 text-status-danger border-status-danger/20';
};

const getPncpScoreLabel = (score) => {
  const value = Number(score || 0);
  if (value >= PNCP_SCORE_HIGH_THRESHOLD) return 'Alta aderencia';
  if (value >= PNCP_SCORE_MEDIUM_THRESHOLD) return 'Media aderencia';
  return 'Baixa aderencia';
};

const getPncpUrgencyClass = (urgency) => {
  if (urgency === 'ok') return 'bg-status-success/10 text-status-success';
  if (urgency === 'warning') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (urgency === 'critical' || urgency === 'expired') return 'bg-status-danger/10 text-status-danger';
  return 'bg-gray-100 text-muted dark:bg-gray-800';
};

const createPncpUiSummary = (items = []) => {
  const emptyBucket = () => ({ count: 0, total_value: 0 });
  const summary = {
    count: items.length,
    total_value: 0,
    by_adherence: { alta: emptyBucket(), media: emptyBucket(), baixa: emptyBucket() },
    by_stage: {},
    by_status: {},
    by_source: {},
    by_publication: { publicado: emptyBucket(), nao_publicado: emptyBucket() },
  };
  for (const item of items) {
    const value = getBestEstimatedValue(item) || 0;
    summary.total_value += value;
    const adherence = Number(item?.score || 0) >= PNCP_SCORE_HIGH_THRESHOLD ? 'alta' : Number(item?.score || 0) >= PNCP_SCORE_MEDIUM_THRESHOLD ? 'media' : 'baixa';
    summary.by_adherence[adherence].count += 1;
    summary.by_adherence[adherence].total_value += value;
    const stage = item?.legal_stage?.label || 'Sem fase';
    summary.by_stage[stage] = summary.by_stage[stage] || emptyBucket();
    summary.by_stage[stage].count += 1;
    summary.by_stage[stage].total_value += value;
    const status = item?.situacao?.nome || 'Status n/d';
    summary.by_status[status] = summary.by_status[status] || emptyBucket();
    summary.by_status[status].count += 1;
    summary.by_status[status].total_value += value;
    const source = item?.source === 'pncp_consulta' ? 'PNCP Consulta' : 'PNCP Search';
    summary.by_source[source] = summary.by_source[source] || emptyBucket();
    summary.by_source[source].count += 1;
    summary.by_source[source].total_value += value;
    const publication = item?.data_publicacao ? 'publicado' : 'nao_publicado';
    summary.by_publication[publication].count += 1;
    summary.by_publication[publication].total_value += value;
  }
  return summary;
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
  const attrs = contact?.custom_attributes || {};
  const additional = contact?.additional_attributes || {};
  const labels = Array.isArray(contact?.labels)
    ? contact.labels.map((label) => label?.name).filter(Boolean)
    : [];
  return normalizeText([
    contact?.company_name,
    contact?.name,
    getContactLabel(contact),
    contact?.agent_name,
    contact?.phone_number,
    contact?.location,
    contact?.email,
    contact?.id,
    additional.city,
    additional.company_name,
    attrs.Estado,
    attrs.Tipo_Cliente,
    attrs.Canal,
    attrs.Origem,
    attrs.Funil_Vendas,
    attrs.Prioridade,
    attrs.Valor_Oportunidade,
    attrs.CNPJ,
    attrs.Cnpj,
    attrs.cnpj,
    attrs.Telefone,
    attrs.Email,
    ...labels,
  ].filter(Boolean).join(' '));
};

/** Accent-insensitive + digit-aware match for board/global search. */
const contactMatchesQuery = (contact, rawQuery) => {
  const query = normalizeText(rawQuery).trim();
  if (!query) return true;
  if (getContactSearchText(contact).includes(query)) return true;
  const queryDigits = String(rawQuery || '').replace(/\D/g, '');
  if (queryDigits.length < 3) return false;
  const digitFields = [
    contact?.phone_number,
    contact?.id,
    contact?.custom_attributes?.CNPJ,
    contact?.custom_attributes?.Cnpj,
    contact?.custom_attributes?.cnpj,
    contact?.custom_attributes?.Telefone,
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/\D/g, ''));
  return digitFields.some((digits) => digits.includes(queryDigits));
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

const buildGroupedHistorySeries = (historyRows, metric = 'count') => {
  if (!Array.isArray(historyRows) || historyRows.length === 0) {
    return [];
  }
  const periods = Array.from(new Set(historyRows.map(row => row.period_start))).sort();
  const groupValues = new Map();
  historyRows.forEach(row => {
    const num = getStageNumber(row.stage);
    const grp = groupForStageNum(num);
    if (!grp) return;
    const key = `${grp.id}|${row.period_start}`;
    const value = metric === 'value' ? Number(row.total_value) || 0 : Number(row.count) || 0;
    groupValues.set(key, (groupValues.get(key) || 0) + value);
  });
  return STAGE_GROUPS.map(g => ({
    id: g.label,
    data: periods.map(period => ({
      x: period,
      y: groupValues.get(`${g.id}|${period}`) || 0,
    })),
  }));
};

const normalizeText = (value) => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
};

/** Extrai o “miolo” útil de erros n8n / Evolution (JSON embutido, arrays, etc.). */
const unwrapDisparoErrorPayload = (raw) => {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  let text = String(raw).trim();
  if (!text) return null;

  // "400 - \"{...}\"" | "500 - {...}"
  const prefix = text.match(/^(\d{3})\s*[-:]\s*([\s\S]+)$/);
  let httpCode = prefix ? Number(prefix[1]) : null;
  if (prefix) text = prefix[2].trim();

  // tira aspas externas e unescapes comuns
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  text = text.replace(/\\"/g, '"').replace(/\\n/g, '\n');

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  let parsed = tryParse(text);
  if (!parsed) {
    const brace = text.indexOf('{');
    const bracket = text.indexOf('[');
    const start = [brace, bracket].filter(i => i >= 0).sort((a, b) => a - b)[0];
    if (start != null) parsed = tryParse(text.slice(start));
  }

  if (parsed && typeof parsed === 'object') {
    return { ...parsed, __http: httpCode ?? parsed.status ?? null, __raw: String(raw) };
  }
  return { message: text, __http: httpCode, __raw: String(raw) };
};

/**
 * Normaliza motivo/erro de disparo WhatsApp para algo legível.
 * Retorna { title, detail, code, kind, raw }.
 */
const formatDisparoError = (raw) => {
  if (raw == null || raw === '') {
    return { title: 'Erro desconhecido', detail: '', code: null, kind: 'unknown', raw: '' };
  }
  const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const payload = unwrapDisparoErrorPayload(raw);
  if (!payload) {
    return { title: 'Erro no envio', detail: rawStr.slice(0, 240), code: null, kind: 'unknown', raw: rawStr };
  }

  const code = payload.__http ?? payload.status ?? null;
  const collectMessages = (node, out = []) => {
    if (node == null) return out;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return out;
    }
    if (Array.isArray(node)) {
      node.forEach(item => collectMessages(item, out));
      return out;
    }
    if (typeof node === 'object') {
      if (node.exists === false && (node.number || node.jid)) {
        out.push(`NUMBER_NOT_ON_WHATSAPP:${node.number || String(node.jid).split('@')[0]}`);
        return out;
      }
      if (node.message != null) collectMessages(node.message, out);
      else if (node.error != null && typeof node.error === 'string' && node.response) {
        // { error: "Bad Request", response: { message: ... } }
        collectMessages(node.response, out);
        if (!out.length) out.push(node.error);
      } else if (node.error != null) collectMessages(node.error, out);
      else if (node.response != null) collectMessages(node.response, out);
      else if (node.msg != null) collectMessages(node.msg, out);
      else if (node.motivo != null) collectMessages(node.motivo, out);
      else {
        const keys = Object.keys(node).filter(k => !k.startsWith('__'));
        if (keys.length && keys.length <= 4) {
          try { out.push(JSON.stringify(node)); } catch { /* ignore */ }
        }
      }
    }
    return out;
  };

  const parts = collectMessages(payload).filter(Boolean);
  const blob = parts.join(' | ') || payload.error || payload.message || rawStr;
  const lower = normalizeText(blob);
  const rawLower = normalizeText(rawStr);

  const numberNotWa = parts.find(p => String(p).startsWith('NUMBER_NOT_ON_WHATSAPP:'));
  if (numberNotWa || (lower.includes('exists') && lower.includes('false')) || rawLower.includes('"exists":false')) {
    const num = numberNotWa
      ? numberNotWa.split(':')[1]
      : (blob.match(/\d{10,15}/) || rawStr.match(/\d{10,15}/) || [])[0] || '';
    return {
      title: 'Número sem WhatsApp',
      detail: num
        ? `O número ${num} não existe no WhatsApp (ou está inválido).`
        : 'Este telefone não tem conta WhatsApp ou está incorreto.',
      code,
      kind: 'no_whatsapp',
      raw: rawStr,
    };
  }

  if (lower.includes('connection closed') || lower.includes('conexao fechada') || lower.includes('connection closed')) {
    return {
      title: 'Instância desconectou',
      detail: 'A conexão WhatsApp caiu durante o envio. Reconecte a instância no Evolution e tente de novo.',
      code,
      kind: 'connection_closed',
      raw: rawStr,
    };
  }

  if (lower.includes('onwhatsapp')) {
    return {
      title: 'Falha ao validar o número',
      detail: 'A Evolution não conseguiu consultar se o número tem WhatsApp. Verifique a instância e o telefone.',
      code,
      kind: 'check_failed',
      raw: rawStr,
    };
  }

  if (
    lower.includes("reading 'id'")
    || lower.includes('reading "id"')
    || lower.includes('cannot read properties of undefined')
  ) {
    return {
      title: 'Erro na sessão da instância',
      detail: 'Falha interna da Evolution (sessão incompleta). Reconecte a instância e dispare novamente.',
      code,
      kind: 'session',
      raw: rawStr,
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('etimedout')) {
    return {
      title: 'Tempo esgotado',
      detail: 'O envio demorou demais e foi abortado. Tente de novo com a instância online.',
      code,
      kind: 'timeout',
      raw: rawStr,
    };
  }

  if (lower.includes('rate') || lower.includes('too many') || lower.includes('limite')) {
    return {
      title: 'Limite de envio',
      detail: 'A instância ou a API bloqueou por excesso de mensagens. Aguarde e reduza o ritmo.',
      code,
      kind: 'rate_limit',
      raw: rawStr,
    };
  }

  if (lower.includes('not connected') || lower.includes('not logged') || lower.includes('disconnect') || lower.includes('desconect')) {
    return {
      title: 'Instância offline',
      detail: 'A instância não está conectada. Reconecte no Evolution antes de continuar.',
      code,
      kind: 'offline',
      raw: rawStr,
    };
  }

  if (lower.includes('ban') || lower.includes('blocked') || lower.includes('forbidden')) {
    return {
      title: 'Envio bloqueado',
      detail: 'A API recusou o envio (bloqueio ou restrição). Revise o número e a instância.',
      code,
      kind: 'blocked',
      raw: rawStr,
    };
  }

  // Limpa ruído técnico residual
  let detail = blob
    .replace(/^Error:\s*/i, '')
    .replace(/^TypeError:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (detail.length > 180) detail = `${detail.slice(0, 180)}…`;

  const titleByCode = {
    400: 'Requisição recusada',
    401: 'Não autorizado',
    403: 'Acesso negado',
    404: 'Recurso não encontrado',
    408: 'Tempo esgotado',
    429: 'Muitas tentativas',
    500: 'Erro no servidor de envio',
    502: 'Falha de comunicação',
    503: 'Serviço indisponível',
  };

  return {
    title: titleByCode[Number(code)] || 'Falha no envio',
    detail: detail || 'A Evolution/n8n retornou um erro sem detalhes.',
    code,
    kind: 'generic',
    raw: rawStr,
  };
};

/** Erros de API do painel (axios) em texto amigável. */
const formatDisparoApiError = (error, fallback = 'Falha na operação.') => {
  const data = error?.response?.data;
  const status = error?.response?.status;
  const raw = data?.error || data?.message || error?.message || fallback;
  const formatted = formatDisparoError(raw);
  if (formatted.kind !== 'generic' && formatted.kind !== 'unknown') {
    return formatted.detail ? `${formatted.title}: ${formatted.detail}` : formatted.title;
  }
  if (status === 401) return 'Sessão expirada. Entre de novo.';
  if (status === 403) return 'Sem permissão para esta ação.';
  if (status === 409) return String(raw);
  if (status === 502 || status === 503) {
    return String(raw).includes('n8n') || String(raw).includes('Evolution')
      ? String(raw)
      : 'Não foi possível falar com o n8n/Evolution. Tente de novo em instantes.';
  }
  return String(raw || fallback);
};

const splitTermsInput = (value = '') => String(value || '')
  .split(/[,;\n]+/)
  .map(term => term.trim())
  .filter(Boolean);

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
  const secondaryName = contact.company_name ? contact.name : null;
  const cityLabel = contact.additional_attributes?.city || customAttributes.Cidade;
  const estadoLabel = customAttributes.Estado;
  const opportunityValue = customAttributes.Valor_Oportunidade;
  const formattedOpportunity = formatCurrency(opportunityValue);

  return (
    <div className="kanban-card is-overlay rounded-[13px] border border-line bg-surf px-[13px] py-3 shadow-card">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
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
            {cityLabel || 'Cidade não informada'}{estadoLabel ? `, ${estadoLabel}` : ''}
          </p>
        )}
        {formattedOpportunity && (
          <p className="text-xs font-semibold text-ink mt-2 truncate">{formattedOpportunity}</p>
        )}
      </div>
    </div>
  );
};

// Snappy gap animation; layout anim disabled — transforms handle Trello gaps cheaper.
const SORTABLE_TRANSITION = { duration: 150, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' };
const skipSortableLayoutAnim = () => false;

const hexToRgba = (hex, alpha) => {
  if (!hex) return null;
  const normalized = hex.replace('#', '').trim();
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const hexToRgb = (hex) => {
  if (!hex) return null;
  const normalized = hex.replace('#', '').trim();
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mixWithBlack = (rgb, amount) => ({
  r: Math.round(rgb.r * (1 - amount)),
  g: Math.round(rgb.g * (1 - amount)),
  b: Math.round(rgb.b * (1 - amount)),
});

const mixWithWhite = (rgb, amount) => ({
  r: Math.round(rgb.r + (255 - rgb.r) * amount),
  g: Math.round(rgb.g + (255 - rgb.g) * amount),
  b: Math.round(rgb.b + (255 - rgb.b) * amount),
});

const getLuminance = (rgb) => {
  const toLinear = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
};

const getLabelChipStyle = (labelColor, isDarkMode) => {
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
  return { backgroundColor: background, borderColor: borderShade, color: textShade };
};

// Heavy card UI is memoized so dnd-kit drag frames only repaint the thin wrapper (transform).
const KanbanCardBody = memo(function KanbanCardBody({
  contact,
  columnId,
  showMenu,
  menuLabel,
  onMenuAction,
  onMoveToColumn,
  availableColumns,
  isDarkMode,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const customAttributes = contact.custom_attributes || {};
  const statusLabel = customAttributes.Origem || customAttributes.Canal || 'On Track';
  const priorityLabel = customAttributes.Prioridade;
  const estadoLabel = customAttributes.Estado;
  const tipoClienteLabel = customAttributes.Tipo_Cliente;
  const secondaryName = contact.company_name ? contact.name : null;
  const cityLabel = contact.additional_attributes?.city || customAttributes.Cidade;
  const opportunityValue = customAttributes.Valor_Oportunidade;
  const agentName = contact.agent_name;

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

  let displayPriority = null;
  if (normalizedPriority) {
    if (normalizedPriority.includes('alta') || normalizedPriority.includes('high') || normalizedPriority.includes('quente')) {
      displayPriority = 'Alta';
    } else if (normalizedPriority.includes('media') || normalizedPriority.includes('medium') || normalizedPriority.includes('morna')) {
      displayPriority = 'Média';
    } else if (normalizedPriority.includes('baixa') || normalizedPriority.includes('low') || normalizedPriority.includes('fria')) {
      displayPriority = 'Baixa';
    } else if (normalizedPriority.includes('nenhuma') || normalizedPriority.includes('nula')) {
      displayPriority = 'Nenhuma';
    } else {
      displayPriority = priorityLabel;
    }
  }

  const formattedOpportunity = formatCurrency(opportunityValue);
  const contactLink = getChatwootContactUrl(contact);

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted dark:text-[#94a3b8]">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
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
                <VerticalScrollArrows
                  className="max-h-56"
                  contentClassName="pr-0.5"
                  remeasureKey={(availableColumns || []).length}
                >
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
                </VerticalScrollArrows>
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
            {cityLabel || 'Cidade não informada'}{estadoLabel ? `, ${estadoLabel}` : ''}
          </p>
        )}
        {formattedOpportunity && (
          <p className="font-mono text-[16px] font-bold text-ink dark:text-[#e5e7eb] mt-2.5 truncate">{formattedOpportunity}</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 max-w-full">
        {displayPriority && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border max-w-full truncate ${priorityClass}`}>
            {displayPriority}
          </span>
        )}
        {tipoClienteLabel && (
          <span className={chip}>
            {tipoClienteLabel}
          </span>
        )}
        {agentName && (
          <span className={chip}>
            Agente: {agentName}
          </span>
        )}
        {Array.isArray(contact.labels) && contact.labels.map((label, index) => (
          <span
            key={`${label?.name || 'label'}-${index}`}
            className="text-[11px] px-2 py-0.5 rounded-full border font-medium max-w-full truncate"
            style={getLabelChipStyle(label?.color, isDarkMode)}
          >
            {label?.name || 'label'}
          </span>
        ))}
      </div>
    </>
  );
});

const kanbanCardClassName = (isDragging, isSearchFocus = false) =>
  `kanban-card rounded-[13px] border border-line bg-surf px-[13px] py-3 shadow-card hover:bg-surf2 hover:border-line2 hover:shadow-lift focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDragging ? 'is-dragging' : ''} ${isSearchFocus ? 'is-search-focus' : ''}`;

const KanbanCard = memo(function KanbanCard({
  contact,
  columnId,
  showMenu,
  menuLabel,
  onMenuAction,
  onMoveToColumn,
  availableColumns,
  isDarkMode,
  isSearchFocus = false,
}) {
  const sortableId = String(contact.id);
  const sortableData = useMemo(() => ({ columnId, type: 'contact' }), [columnId]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    data: sortableData,
    transition: SORTABLE_TRANSITION,
    animateLayoutChanges: skipSortableLayoutAnim,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-contact-id={sortableId}
      className={kanbanCardClassName(isDragging, isSearchFocus)}
    >
      <KanbanCardBody
        contact={contact}
        columnId={columnId}
        showMenu={showMenu}
        menuLabel={menuLabel}
        onMenuAction={onMenuAction}
        onMoveToColumn={onMoveToColumn}
        availableColumns={availableColumns}
        isDarkMode={isDarkMode}
      />
    </div>
  );
});

// Static twin (no useSortable): used on inactive columns during an active drag so
// dnd-kit does not re-render hundreds of sortables across Inbox/Contato/etc.
const KanbanCardStatic = memo(function KanbanCardStatic({
  contact,
  columnId,
  showMenu,
  menuLabel,
  onMenuAction,
  onMoveToColumn,
  availableColumns,
  isDarkMode,
  isSearchFocus = false,
}) {
  return (
    <div
      className={kanbanCardClassName(false, isSearchFocus)}
      role="presentation"
      data-contact-id={String(contact.id)}
    >
      <KanbanCardBody
        contact={contact}
        columnId={columnId}
        showMenu={showMenu}
        menuLabel={menuLabel}
        onMenuAction={onMenuAction}
        onMoveToColumn={onMoveToColumn}
        availableColumns={availableColumns}
        isDarkMode={isDarkMode}
      />
    </div>
  );
});

// Virtualize every non-trivial column. Idle keeps a tight window; drag widens only
// the active/hovered column. Other fat columns stay virtualized + static cards.
const COLUMN_LIST_GAP_PX = 9;
const COLUMN_VIRTUAL_THRESHOLD = 1; // always window long columns (Inbox, Contato, …)
const FUNNEL_CARD_ESTIMATE_PX = 152;
const LICITACAO_CARD_ESTIMATE_PX = 168;

/** Track vertical overflow + expose up/down scroll helpers (replaces scrollbars with chevrons). */
function useVerticalScrollArrows(scrollRef, remeasureKey = null) {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const updateMetrics = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      setHasOverflow(false);
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    const overflow = max > 2;
    setHasOverflow(overflow);
    setCanScrollUp(overflow && el.scrollTop > 2);
    setCanScrollDown(overflow && el.scrollTop < max - 2);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    updateMetrics();
    el.addEventListener('scroll', updateMetrics, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateMetrics) : null;
    ro?.observe(el);
    // Content size changes (virtualized rows, list growth) also need a remeasure.
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          window.requestAnimationFrame(updateMetrics);
        })
      : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', updateMetrics);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scrollRef, updateMetrics, remeasureKey]);

  const scrollByDir = useCallback((direction) => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = Math.max(el.clientHeight * 0.78, 140) * direction;
    el.scrollBy({ top: delta, behavior: 'smooth' });
  }, [scrollRef]);

  return { canScrollUp, canScrollDown, hasOverflow, scrollByDir, updateMetrics };
}

const scrollYArrowBtnClass =
  'scroll-y-arrow flex w-full shrink-0 items-center justify-center py-0.5 text-muted2 transition hover:text-ink focus:outline-none focus-visible:text-ink disabled:pointer-events-none disabled:opacity-30';

const VerticalScrollArrows = memo(function VerticalScrollArrows({
  children,
  className = '',
  contentClassName = '',
  contentRef = null,
  style = undefined,
  /** Extra key to remeasure overflow (e.g. itemCount / role). */
  remeasureKey = null,
  contentRole = undefined,
  contentAriaLabel = undefined,
  contentAriaMultiselectable = undefined,
}) {
  const innerRef = useRef(null);
  const setRefs = useCallback((node) => {
    innerRef.current = node;
    if (typeof contentRef === 'function') contentRef(node);
    else if (contentRef) contentRef.current = node;
  }, [contentRef]);

  const { canScrollUp, canScrollDown, hasOverflow, scrollByDir } = useVerticalScrollArrows(
    innerRef,
    remeasureKey
  );

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${className}`} style={style}>
      {hasOverflow && (
        <button
          type="button"
          aria-label="Rolar para cima"
          disabled={!canScrollUp}
          onClick={() => scrollByDir(-1)}
          className={scrollYArrowBtnClass}
        >
          <ChevronUpIcon className="h-4 w-4" />
        </button>
      )}
      <div
        ref={setRefs}
        role={contentRole}
        aria-label={contentAriaLabel}
        aria-multiselectable={contentAriaMultiselectable}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-none ${contentClassName}`}
      >
        {children}
      </div>
      {hasOverflow && (
        <button
          type="button"
          aria-label="Rolar para baixo"
          disabled={!canScrollDown}
          onClick={() => scrollByDir(1)}
          className={scrollYArrowBtnClass}
        >
          <ChevronDownIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});

const VirtualizedColumnList = memo(function VirtualizedColumnList({
  itemIds,
  itemCount,
  estimateSize,
  isDragActiveColumn,
  isBoardDragging,
  emptyNode,
  renderItem,
  focusItemId = null,
}) {
  const parentRef = useRef(null);
  const shouldVirtualize = itemCount >= COLUMN_VIRTUAL_THRESHOLD;
  const remeasureKey = `${itemCount}:${itemIds[0] ?? ''}:${itemIds[itemIds.length - 1] ?? ''}`;
  const { canScrollUp, canScrollDown, hasOverflow, scrollByDir } = useVerticalScrollArrows(parentRef, remeasureKey);

  const estimateSizeFn = useCallback(
    () => estimateSize + COLUMN_LIST_GAP_PX,
    [estimateSize]
  );
  const getItemKey = useCallback(
    (index) => itemIds[index] ?? index,
    [itemIds]
  );

  // Idle: small overscan. Active drag column: wider for gap. Other columns while
  // board is dragging: minimal nodes (static cards, column droppable still works).
  let overscan = 4;
  if (isBoardDragging) {
    overscan = isDragActiveColumn ? 12 : 2;
  }

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? itemCount : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateSizeFn,
    overscan,
    getItemKey,
  });

  useEffect(() => {
    if (focusItemId == null || focusItemId === '') return undefined;
    const focusId = String(focusItemId);
    const index = itemIds.findIndex((id) => String(id) === focusId);
    if (index < 0) return undefined;

    let cancelled = false;
    let timeoutId = 0;

    const scrollToFocus = () => {
      if (cancelled) return;
      if (shouldVirtualize) {
        virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
        return;
      }
      const node = parentRef.current?.querySelector(`[data-contact-id="${focusId}"]`);
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    };

    // Wait for filter/layout paint, then retry once — virtual rows may not exist yet.
    const frame = window.requestAnimationFrame(() => {
      scrollToFocus();
      timeoutId = window.setTimeout(scrollToFocus, 60);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [focusItemId, itemIds, shouldVirtualize, virtualizer]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      {hasOverflow && (
        <button
          type="button"
          aria-label="Rolar coluna para cima"
          disabled={!canScrollUp}
          onClick={() => scrollByDir(-1)}
          className={scrollYArrowBtnClass}
        >
          <ChevronUpIcon className="h-4 w-4" />
        </button>
      )}
      <div
        ref={parentRef}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden kanban-column-scroll scrollbar-none ${shouldVirtualize ? '' : 'flex flex-col gap-[9px]'}`}
      >
        <SortableContext
          items={isDragActiveColumn || !isBoardDragging ? itemIds : []}
          strategy={verticalListSortingStrategy}
        >
          {itemCount === 0 && emptyNode}
          {!shouldVirtualize && itemCount > 0 && (
            Array.from({ length: itemCount }, (_, index) => (
              <React.Fragment key={itemIds[index] ?? index}>
                {renderItem(index)}
              </React.Fragment>
            ))
          )}
          {shouldVirtualize && itemCount > 0 && (
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 w-full"
                  style={{ top: virtualRow.start }}
                >
                  <div style={{ paddingBottom: COLUMN_LIST_GAP_PX }}>
                    {renderItem(virtualRow.index)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SortableContext>
      </div>
      {hasOverflow && (
        <button
          type="button"
          aria-label="Rolar coluna para baixo"
          disabled={!canScrollDown}
          onClick={() => scrollByDir(1)}
          className={scrollYArrowBtnClass}
        >
          <ChevronDownIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});

const KanbanColumn = memo(function KanbanColumn({
  title,
  contacts,
  dotClass,
  showMenu,
  menuLabel,
  onMenuAction,
  onMoveToColumn,
  availableColumns,
  showHeaderMenu,
  newContactUrl,
  isDarkMode,
  activeDragId,
  focusedSearchContactId = null,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${title}` });
  const itemIds = useMemo(() => contacts.map((c) => String(c.id)), [contacts]);
  const totalOpportunity = useMemo(
    () => contacts.reduce((sum, contact) => {
      const value = parseCurrency(contact.custom_attributes?.Valor_Oportunidade);
      return value ? sum + value : sum;
    }, 0),
    [contacts]
  );
  const formattedTotal = totalOpportunity ? formatCurrency(totalOpportunity) : null;
  const activeIdStr = activeDragId != null ? String(activeDragId) : '';
  const isBoardDragging = Boolean(activeDragId) && !String(activeDragId).startsWith('opp:');
  const containsActive = Boolean(activeIdStr && itemIds.includes(activeIdStr));
  // Only the source/target column keeps real sortables during drag.
  const isDragActiveColumn = Boolean(isBoardDragging && (isOver || containsActive));
  const enableSortable = !isBoardDragging || isDragActiveColumn;
  const focusIdStr = focusedSearchContactId != null ? String(focusedSearchContactId) : '';
  const columnHasSearchFocus = Boolean(focusIdStr && itemIds.includes(focusIdStr));

  const renderItem = useCallback(
    (index) => {
      const contact = contacts[index];
      if (!contact) return null;
      const shared = {
        contact,
        columnId: title,
        showMenu,
        menuLabel,
        onMenuAction,
        onMoveToColumn,
        availableColumns,
        isDarkMode,
        isSearchFocus: focusIdStr !== '' && String(contact.id) === focusIdStr,
      };
      return enableSortable ? <KanbanCard {...shared} /> : <KanbanCardStatic {...shared} />;
    },
    [contacts, title, showMenu, menuLabel, onMenuAction, onMoveToColumn, availableColumns, isDarkMode, enableSortable, focusIdStr]
  );

  return (
    <div
      ref={setNodeRef}
      data-column-title={title}
      className={`kanban-column w-[var(--kanban-col-w)] max-w-[calc(100vw-2.5rem)] flex-shrink-0 rounded-2xl border border-line bg-bg2 p-2.5 sm:p-3 snap-start flex flex-col min-h-0 max-h-[calc(100dvh-16rem)] sm:max-h-[calc(100vh-280px)] ${isOver ? 'is-over' : ''} ${columnHasSearchFocus ? 'is-search-focus-column' : ''}`}
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
            <span className="font-mono text-sm font-bold text-ink dark:text-[#e5e7eb]">{formattedTotal}</span>
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
      <VirtualizedColumnList
        itemIds={itemIds}
        itemCount={contacts.length}
        estimateSize={FUNNEL_CARD_ESTIMATE_PX}
        isDragActiveColumn={isDragActiveColumn}
        isBoardDragging={isBoardDragging}
        focusItemId={columnHasSearchFocus ? focusIdStr : null}
        emptyNode={(
          <div className="rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted">
            Sem leads ainda.
          </div>
        )}
        renderItem={renderItem}
      />
    </div>
  );
});

const formatLicitacaoDateShort = (dateStr) => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
};

const getLicitacaoDateStatus = (dateStr) => {
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

const LICITACAO_STATUS_COLORS = {
  passed: 'text-status-danger',
  urgent: 'text-status-danger font-semibold',
  soon: 'text-status-warning',
  ok: 'text-muted',
  none: 'text-muted',
};

const LicitacaoCardBody = memo(function LicitacaoCardBody({ opportunity, onEdit }) {
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

  const sessaoDate = formatLicitacaoDateShort(opportunity.data_sessao);
  const sessaoStatus = getLicitacaoDateStatus(opportunity.data_sessao);
  const propostaDate = formatLicitacaoDateShort(opportunity.data_envio_proposta_limite);
  const propostaStatus = getLicitacaoDateStatus(opportunity.data_envio_proposta_limite);

  return (
    <>
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
          <span className="text-muted">Proposta início:</span>
          <span className={LICITACAO_STATUS_COLORS[sessaoStatus]}>{sessaoDate || 'não definida'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Proposta fim:</span>
          <span className={LICITACAO_STATUS_COLORS[propostaStatus]}>{propostaDate || 'não definida'}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-xs">
        <span className="text-muted truncate">Edital: {opportunity.numero_edital || 'n/d'}</span>
        <span className="font-mono font-semibold text-ink">{formattedValue || 'R$ 0,00'}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold leading-tight ${technicalBadge.className}`}>{technicalBadge.label}</span>
        <span className="text-muted truncate">
          {technicalRequirementsCount > 0 ? `${technicalRequirementsCount} requisitos` : 'Checklist não criado'}
        </span>
      </div>
    </>
  );
});

const LicitacaoCard = memo(function LicitacaoCard({ opportunity, columnId, onOpen, onEdit, isSearchFocus = false }) {
  const sortableId = `opp:${opportunity.id}`;
  const sortableData = useMemo(() => ({ columnId, type: 'opportunity' }), [columnId]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    data: sortableData,
    transition: SORTABLE_TRANSITION,
    animateLayoutChanges: skipSortableLayoutAnim,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-contact-id={sortableId}
      onClick={() => onOpen?.(opportunity)}
      className={kanbanCardClassName(isDragging, isSearchFocus)}
    >
      <LicitacaoCardBody opportunity={opportunity} onEdit={onEdit} />
    </div>
  );
});

const LicitacaoCardStatic = memo(function LicitacaoCardStatic({ opportunity, onOpen, onEdit, isSearchFocus = false }) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-contact-id={`opp:${opportunity.id}`}
      onClick={() => onOpen?.(opportunity)}
      className={kanbanCardClassName(false, isSearchFocus)}
    >
      <LicitacaoCardBody opportunity={opportunity} onEdit={onEdit} />
    </div>
  );
});

const LicitacaoColumn = memo(function LicitacaoColumn({
  title,
  opportunities,
  onOpen,
  onEdit,
  activeDragId,
  focusedSearchOpportunityId = null,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `licitação-column:${title}` });
  const itemIds = useMemo(() => opportunities.map((o) => `opp:${o.id}`), [opportunities]);
  const totalValue = useMemo(
    () => opportunities.reduce((sum, item) => sum + (parseCurrency(item.valor_oportunidade) || 0), 0),
    [opportunities]
  );
  const activeIdStr = activeDragId != null ? String(activeDragId) : '';
  const isBoardDragging = Boolean(activeDragId) && String(activeDragId).startsWith('opp:');
  const containsActive = Boolean(activeIdStr && itemIds.includes(activeIdStr));
  const isDragActiveColumn = Boolean(isBoardDragging && (isOver || containsActive));
  const enableSortable = !isBoardDragging || isDragActiveColumn;
  const focusIdStr = focusedSearchOpportunityId != null ? String(focusedSearchOpportunityId) : '';
  const focusItemId = focusIdStr ? `opp:${focusIdStr}` : null;
  const columnHasSearchFocus = Boolean(focusItemId && itemIds.includes(focusItemId));

  const renderItem = useCallback(
    (index) => {
      const opportunity = opportunities[index];
      if (!opportunity) return null;
      const isSearchFocus = focusIdStr !== '' && String(opportunity.id) === focusIdStr;
      if (!enableSortable) {
        return (
          <LicitacaoCardStatic
            opportunity={opportunity}
            onOpen={onOpen}
            onEdit={onEdit}
            isSearchFocus={isSearchFocus}
          />
        );
      }
      return (
        <LicitacaoCard
          opportunity={opportunity}
          columnId={title}
          onOpen={onOpen}
          onEdit={onEdit}
          isSearchFocus={isSearchFocus}
        />
      );
    },
    [opportunities, title, onOpen, onEdit, enableSortable, focusIdStr]
  );

  return (
    <div
      ref={setNodeRef}
      data-column-title={title}
      className={`kanban-column w-[var(--kanban-col-w)] max-w-[calc(100vw-2.5rem)] flex-shrink-0 rounded-2xl border border-line bg-bg2 p-2.5 sm:p-3 snap-start flex flex-col min-h-0 max-h-[calc(100dvh-16rem)] sm:max-h-[calc(100vh-280px)] ${isOver ? 'is-over' : ''} ${columnHasSearchFocus ? 'is-search-focus-column' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-line bg-bg2 sticky top-0 z-10">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-secondary" />
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <span className="font-mono text-xs px-2 py-0.5 rounded-full border border-line bg-surf text-muted">{opportunities.length}</span>
          </div>
          <span className="font-mono text-xs font-semibold text-ink">{formatCurrency(totalValue) || 'R$ 0,00'}</span>
        </div>
      </div>
      <VirtualizedColumnList
        itemIds={itemIds}
        itemCount={opportunities.length}
        estimateSize={LICITACAO_CARD_ESTIMATE_PX}
        isDragActiveColumn={isDragActiveColumn}
        isBoardDragging={isBoardDragging}
        focusItemId={columnHasSearchFocus ? focusItemId : null}
        emptyNode={(
          <div className="rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted">
            Sem oportunidades nesta etapa.
          </div>
        )}
        renderItem={renderItem}
      />
    </div>
  );
});

// ===================== PCA — Plano Anual de Contratações =====================

const formatPcaCurrency = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
};

const formatPcaQuantity = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const isIntegerLike = Math.abs(n - Math.trunc(n)) < 1e-9;
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: isIntegerLike ? 0 : 3,
  });
};

const formatPcaDate = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR');
  } catch { return '—'; }
};

const groupPcaSignalsByWatchlist = (signals) => {
  const groups = new Map();
  for (const s of (signals || [])) {
    if (!s.watchlist_id) continue;
    const key = `watchlist_${s.watchlist_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: s.watchlist_nome || (s.watchlist_id ? `Watchlist #${s.watchlist_id}` : 'Sem watchlist'),
        plans: new Map(),
        itemsCount: 0,
        totalCount: Number(s.watchlist_total_count) || 0,
      });
    }
    const group = groups.get(key);
    group.totalCount = Math.max(group.totalCount, Number(s.watchlist_total_count) || 0);
    const planKey = `plano_${s.plano_id || `${s.orgao_cnpj}:${s.codigo_unidade}:${s.ano_pca}`}`;
    if (!group.plans.has(planKey)) {
      group.plans.set(planKey, {
        key: planKey,
        plano_id: s.plano_id,
        id_pca_pncp: s.id_pca_pncp,
        orgao_cnpj: s.orgao_cnpj,
        orgao_razao: s.orgao_razao_social,
        codigo_unidade: s.codigo_unidade,
        unidade_nome: s.unidade_nome,
        ano_pca: s.ano_pca,
        pncp_url: `https://pncp.gov.br/app/pca/${s.orgao_cnpj}/${s.ano_pca}`,
        items: [],
        valor_total: 0,
        max_score: 0,
      });
    }
    const plan = group.plans.get(planKey);
    plan.items.push(s);
    plan.valor_total += Number(s.valor_total) || 0;
    plan.max_score = Math.max(plan.max_score, Number(s.score) || 0);
    group.itemsCount += 1;
  }
  return Array.from(groups.values()).map(group => ({
    ...group,
    plans: Array.from(group.plans.values()).sort((a, b) => {
      const byValorTotal = b.valor_total - a.valor_total;
      if (byValorTotal !== 0) return byValorTotal;
      return b.max_score - a.max_score;
    }),
  }));
};

const groupEditalSignalsByWatchlist = (signals) => {
  const groups = new Map();
  for (const s of (signals || [])) {
    if (!s.watchlist_id) continue;
    const key = `watchlist_${s.watchlist_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: s.watchlist_nome || `Watchlist #${s.watchlist_id}`,
        items: [],
        itemsCount: 0,
        totalCount: Number(s.watchlist_total_count) || 0,
        maxScore: 0,
      });
    }
    const group = groups.get(key);
    group.items.push(s);
    group.itemsCount += 1;
    group.totalCount = Math.max(group.totalCount, Number(s.watchlist_total_count) || 0);
    group.maxScore = Math.max(group.maxScore, Number(s.score) || 0);
  }
  return Array.from(groups.values()).sort((a, b) => b.maxScore - a.maxScore);
};

const PcaChips = ({ items, onRemove, accent }) => (
  <div className="flex flex-wrap gap-1.5">
    {(items || []).map((t, i) => (
      <span
        key={`${t}-${i}`}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide ${
          accent === 'pos'
            ? 'border border-primary/30 bg-primary/10 text-primary'
            : 'border border-amber/30 bg-amber/15 text-amber'
        }`}
      >
        {t}
        <button
          type="button"
          className="normal-case opacity-70 hover:opacity-100"
          onClick={() => onRemove(i)}
          aria-label={`remover ${t}`}
        >×</button>
      </span>
    ))}
  </div>
);

const statusFilterPill = (active) =>
  `h-8 rounded-lg border px-3 text-xs font-semibold transition ${
    active
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-line bg-bg2 text-muted hover:border-line2 hover:text-ink'
  }`;

const statusFilterLabel = (s) => ({
  novo: 'Novos',
  visto: 'Vistos',
  promovido: 'Promovidos',
  descartado: 'Descartados',
}[s] || s);

function PcaExplorer({ onPromoted, onSwitchToBoard, onOpenOpportunity, onSwitchToWatchlist }) {
  const [q, setQ] = useState('');
  const [usarIa, setUsarIa] = useState(true);
  const [positivos, setPositivos] = useState([]);
  const [negativos, setNegativos] = useState([]);
  const [fonteIa, setFonteIa] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filtros, setFiltros] = useState({
    valor_min: '', valor_max: '', mes_previsto: '',
    orgao_cnpj: '', unidade_codigo: '',
    ano_pca: String(new Date().getFullYear()),
  });
  const [showFilters, setShowFilters] = useState(false);
  const [editTerms, setEditTerms] = useState(false);
  const [posDraft, setPosDraft] = useState('');
  const [negDraft, setNegDraft] = useState('');
  const [busy, setBusy] = useState({});
  const [itemBusy, setItemBusy] = useState({});
  const [saveDialog, setSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveWhatsappEnabled, setSaveWhatsappEnabled] = useState(false);
  const [saveWhatsappNumber, setSaveWhatsappNumber] = useState('');
  const [selecionados, setSelecionados] = useState({});
  const [lastPromoted, setLastPromoted] = useState(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const filtrosAtivos = Object.entries(filtros).filter(([k, v]) => v && !(k === 'ano_pca' && v === String(new Date().getFullYear()))).length;

  // Auto-dismiss do toast de promoção
  useEffect(() => {
    if (!lastPromoted) return;
    const id = setTimeout(() => setLastPromoted(null), 8000);
    return () => clearTimeout(id);
  }, [lastPromoted]);

  const fetchBootstrapStatus = useCallback(async () => {
    try {
      const r = await axios.get('/api/licitacoes/pca/bootstrap/status');
      setBootstrapStatus(r.data);
      return r.data;
    } catch {
      return null;
    }
  }, []);

  // Status é rápido durante a carga; fora dela, revalida em intervalo leve e
  // quando o usuário volta para a aba. Não há motivo para consultar a cada 5s sempre.
  useEffect(() => {
    fetchBootstrapStatus();
  }, [fetchBootstrapStatus]);

  useEffect(() => {
    const intervalMs = bootstrapStatus?.running ? 5000 : 5 * 60 * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchBootstrapStatus();
    }, intervalMs);
    return () => clearInterval(id);
  }, [bootstrapStatus?.running, fetchBootstrapStatus]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') fetchBootstrapStatus();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [fetchBootstrapStatus]);

  const runSearch = async (overridePositivos, overrideNegativos) => {
    if (!q.trim() && !overridePositivos?.length) {
      setError('Digite uma palavra-chave para buscar.');
      return;
    }
    setHasSearched(true);
    setLoading(true);
    setError(null);
    try {
      const params = {
        q: q.trim(),
        usar_ia: overridePositivos ? 'false' : (usarIa ? 'true' : 'false'),
        ano_pca: filtros.ano_pca || undefined,
        valor_min: filtros.valor_min || undefined,
        valor_max: filtros.valor_max || undefined,
        mes_previsto: filtros.mes_previsto || undefined,
        orgao_cnpj: filtros.orgao_cnpj || undefined,
        unidade_codigo: filtros.unidade_codigo || undefined,
        tam: 50,
      };
      if (overridePositivos) {
        params.positivos_override = JSON.stringify(overridePositivos);
        params.negativos_override = JSON.stringify(overrideNegativos || []);
      }
      const r = await axios.get('/api/licitacoes/pca/search', { params });
      setPositivos(r.data.positivos || []);
      setNegativos(r.data.negativos || []);
      setFonteIa(r.data.fonte_ia || null);
      setItems((r.data.items || []).map(it => ({
        ...it,
        signal_status: it.signal_status || 'novo',
      })));
      setTotal(r.data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const refazerComEditados = () => runSearch(positivos, negativos);

  const toggleItem = (key, itemId) => {
    setSelecionados(prev => {
      const set = new Set(prev[key] || []);
      if (set.has(itemId)) set.delete(itemId);
      else set.add(itemId);
      return { ...prev, [key]: set };
    });
  };
  const setAllForCt = (key, itemIds, mode) => {
    setSelecionados(prev => ({
      ...prev,
      [key]: new Set(mode === 'all' ? itemIds : []),
    }));
  };

  const promoverContratacao = async (ct) => {
    const set = selecionados[ct.key];
    const itemIds = set ? Array.from(set) : [];
    const itemIdsPromoviveis = itemIds.filter((id) => {
      const item = ct.itens.find(i => i.item_id === id);
      return item && !item.ja_promovido;
    });
    if (!itemIdsPromoviveis.length) return;
    setBusy(prev => ({ ...prev, [ct.key]: true }));
    try {
      const r = await axios.post('/api/licitacoes/pca/contratacoes/promote', {
        plano_id: ct.plano_id,
        item_ids: itemIdsPromoviveis,
        titulo: ct.contratacao_nome || (ct.contratacao_id ? `Contratação ${ct.contratacao_id}` : null),
      });
      onPromoted && onPromoted();
      setSelecionados(prev => ({ ...prev, [ct.key]: new Set() }));
      setItems(prev => prev.map(it => (
        itemIdsPromoviveis.includes(it.item_id)
          ? { ...it, ja_promovido: true, promovido_para_opportunity_id: r.data?.id || it.promovido_para_opportunity_id }
          : it
      )));
      setLastPromoted({
        titulo: r.data?.titulo || ct.contratacao_nome || `Contratação ${ct.contratacao_id || ''}`,
        itens: itemIdsPromoviveis.length,
        opportunityId: r.data?.id,
        pncpUrl: ct.pncp_url,
      });
    } catch (e) {
      alert(`Erro ao promover: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [ct.key]: false }));
    }
  };

  const salvarWatchlist = async () => {
    try {
      await axios.post('/api/licitacoes/pca/watchlist', {
        nome: saveName || q,
        palavras_chave: q ? [q] : positivos.slice(0, 1),
        termos_negativos: negativos,
        usar_ia: usarIa,
        valor_minimo: filtros.valor_min ? Number(filtros.valor_min) : null,
        valor_maximo: filtros.valor_max ? Number(filtros.valor_max) : null,
        whatsapp_enabled: saveWhatsappEnabled,
        whatsapp_number: saveWhatsappNumber || null,
      });
      setSaveDialog(false);
      setSaveName('');
      setSaveWhatsappEnabled(false);
      setSaveWhatsappNumber('');
      alert('Watchlist salva. A busca por oportunidades começou em segundo plano.');
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    }
  };

  const updateItemLocal = useCallback((itemId, changes) => {
    setItems(prev => prev.map(it => (String(it.item_id) === String(itemId) ? { ...it, ...changes } : it)));
  }, []);

  const promoteSingleItem = async (item) => {
    const key = `promote:${item.item_id}`;
    setItemBusy(prev => ({ ...prev, [key]: true }));
    try {
      const r = await axios.post('/api/licitacoes/pca/signals/promote-item', { item_id: item.item_id });
      updateItemLocal(item.item_id, {
        ja_promovido: true,
        signal_status: 'promovido',
        promovido_para_opportunity_id: r.data?.id || item.promovido_para_opportunity_id,
      });
      onPromoted && onPromoted();
    } catch (e) {
      alert(`Erro ao promover item: ${e.response?.data?.error || e.message}`);
    } finally {
      setItemBusy(prev => ({ ...prev, [key]: false }));
    }
  };

  const setSingleItemStatus = async (item, status) => {
    const key = `status:${item.item_id}:${status}`;
    setItemBusy(prev => ({ ...prev, [key]: true }));
    try {
      await axios.put(`/api/licitacoes/pca/items/${item.item_id}/status`, { status });
      updateItemLocal(item.item_id, { signal_status: status });
    } catch (e) {
      alert(`Erro ao atualizar status: ${e.response?.data?.error || e.message}`);
    } finally {
      setItemBusy(prev => ({ ...prev, [key]: false }));
    }
  };

  // Lista plana de Futuras Contratações (uma por card).
  // Itens sem futura_contratacao_id viram cards "solo" (key inclui o item_id pra não fundir não-relacionados).
  const contratacoesPlanas = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const ctTag = it.futura_contratacao_id || `__solo_${it.item_id}__`;
      const key = `${it.orgao_cnpj}:${it.codigo_unidade}:${ctTag}`;
      if (!m.has(key)) {
        const pncpUrl = `https://pncp.gov.br/app/pca/${it.orgao_cnpj}/${it.ano_pca}`;
        m.set(key, {
          key,
          plano_id: it.plano_id,
          id_pca_pncp: it.id_pca_pncp,
          pncp_url: pncpUrl,
          orgao_cnpj: it.orgao_cnpj,
          orgao_razao: it.orgao_razao_social,
          codigo_unidade: it.codigo_unidade,
          unidade_nome: it.unidade_nome,
          ano_pca: it.ano_pca,
          contratacao_id: it.futura_contratacao_id,
          contratacao_nome: it.futura_contratacao_nome,
          itens: [],
          valor_total: 0,
          quantidade_total: 0,
          max_score: 0,
        });
      }
      const ct = m.get(key);
      ct.itens.push(it);
      ct.valor_total += Number(it.valor_total) || 0;
      ct.quantidade_total += Number(it.quantidade) || 0;
      const s = Number(it.score) || 0;
      if (s > ct.max_score) ct.max_score = s;
    }
    return Array.from(m.values()).sort((a, b) => {
      const byValorTotal = b.valor_total - a.valor_total;
      if (byValorTotal !== 0) return byValorTotal;
      return b.max_score - a.max_score;
    });
  }, [items]);

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-[16px] border border-line bg-surf p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={`${sectionTitle} text-base`}>Busca de PCA</h3>
            <p className={`${subtle} mt-0.5`}>
              Planejamento pré-edital. Encontre contratações futuras e promova para o board.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {bootstrapStatus?.total_planos_db > 0 && (
              <span
                className="rounded-lg border border-line bg-bg2 px-2.5 py-1 font-mono text-[10px] text-muted"
                title={bootstrapStatus.ultimo_sync
                  ? `Base atualizada automaticamente em ${new Date(bootstrapStatus.ultimo_sync).toLocaleString('pt-BR')}`
                  : 'Base atualizada automaticamente'}
              >
                {bootstrapStatus.total_planos_db.toLocaleString('pt-BR')} planos · {bootstrapStatus.total_itens_db.toLocaleString('pt-BR')} itens · automático
              </span>
            )}
            <button type="button" onClick={() => onSwitchToWatchlist && onSwitchToWatchlist()} className={`${btnSecondary} h-8 px-3 text-xs`}>
              Watchlists / sinais
            </button>
          </div>
        </div>

        {bootstrapStatus?.running && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-primary/25 bg-primary/[0.07] px-3 py-2 text-xs text-ink">
            <span className="font-semibold">
              Preparando a base de PCAs — etapa {bootstrapStatus.mes_atual ?? '…'}/{bootstrapStatus.mes_total ?? '…'}
            </span>
            <span className="text-muted">A atualização continua em segundo plano; você pode sair desta tela.</span>
          </div>
        )}

        {bootstrapStatus && !bootstrapStatus.running && !bootstrapStatus.total_planos_db && (
          <div role="status" className="rounded-[12px] border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-ink">
            <span className="font-semibold">Preparando a base de PCAs automaticamente.</span>{' '}
            <span className="text-muted">
              Nenhuma ação é necessária{bootstrapStatus.error ? '; uma nova tentativa será feita pelo sistema' : ''}.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex h-[42px] min-w-0 flex-1 items-center rounded-[11px] border border-line bg-bg2">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder='Buscar PCAs — ex: "drone", "raio-x", "veículo blindado"…'
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
              className="h-full w-full rounded-[11px] bg-transparent pl-10 pr-28 text-sm font-semibold text-ink outline-none placeholder:text-muted"
            />
            <button
              type="button"
              onClick={() => setUsarIa(v => !v)}
              title={usarIa ? 'Busca IA ativada — expande termos correlatos' : 'Busca IA desativada'}
              className={`absolute right-2 rounded-md px-2 py-1 text-[10.5px] font-bold transition ${usarIa ? 'bg-cyan/10 text-cyan' : 'bg-bg text-muted2'}`}
            >
              ✦ Busca IA
            </button>
          </div>
          <button type="button" onClick={() => runSearch()} disabled={loading} className={`${btnPrimary} h-[42px] px-6`}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            className={`${btnSecondary} h-[42px] px-3 text-xs ${showFilters || filtrosAtivos > 0 ? 'border-primary/40 text-primary' : ''}`}
          >
            Filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setSaveDialog(true)}
            disabled={!q.trim() && !positivos.length}
            className={`${btnSecondary} h-[42px] px-3 text-xs disabled:opacity-50`}
          >
            Salvar watchlist
          </button>
        </div>

        {(positivos.length > 0 || negativos.length > 0) && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted2">+ {positivos.length}</span>
              <PcaChips items={positivos} onRemove={(i) => setPositivos(positivos.filter((_, idx) => idx !== i))} accent="pos" />
            </div>
            {negativos.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted2">− {negativos.length}</span>
                <PcaChips items={negativos} onRemove={(i) => setNegativos(negativos.filter((_, idx) => idx !== i))} accent="neg" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
              {fonteIa && <span className="text-muted">via {fonteIa}</span>}
              <button type="button" onClick={() => setEditTerms(v => !v)} className="font-semibold text-primary hover:underline">
                {editTerms ? 'Fechar edição' : 'Editar termos'}
              </button>
              <button type="button" onClick={refazerComEditados} className="font-semibold text-primary hover:underline">
                Refazer busca
              </button>
            </div>
            {editTerms && (
              <div className="flex flex-wrap gap-2 pt-1">
                <input
                  value={posDraft}
                  onChange={e => setPosDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && posDraft.trim()) {
                      setPositivos([...positivos, posDraft.trim()]);
                      setPosDraft('');
                    }
                  }}
                  placeholder="+ termo positivo (Enter)"
                  className={`${input} h-8 min-w-[180px] flex-1 text-xs`}
                />
                <input
                  value={negDraft}
                  onChange={e => setNegDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && negDraft.trim()) {
                      setNegativos([...negativos, negDraft.trim()]);
                      setNegDraft('');
                    }
                  }}
                  placeholder="− termo negativo (Enter)"
                  className={`${input} h-8 min-w-[180px] flex-1 text-xs`}
                />
              </div>
            )}
          </div>
        )}

        {showFilters && (
          <div className="space-y-4 rounded-[14px] border border-line bg-bg2/40 p-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2">Filtros da busca PCA</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">Ano PCA</label>
                <input className={`${input} w-full text-xs`} placeholder="Ex.: 2026"
                  value={filtros.ano_pca} onChange={e => setFiltros({ ...filtros, ano_pca: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">Mês previsto</label>
                <input className={`${input} w-full text-xs`} placeholder="1–12"
                  value={filtros.mes_previsto} onChange={e => setFiltros({ ...filtros, mes_previsto: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">Valor mínimo (R$)</label>
                <input className={`${input} w-full text-xs`} placeholder="0"
                  value={filtros.valor_min} onChange={e => setFiltros({ ...filtros, valor_min: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">Valor máximo (R$)</label>
                <input className={`${input} w-full text-xs`} placeholder="Sem limite"
                  value={filtros.valor_max} onChange={e => setFiltros({ ...filtros, valor_max: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">CNPJ do órgão</label>
                <input className={`${input} w-full text-xs`} placeholder="00.000.000/0000-00"
                  value={filtros.orgao_cnpj} onChange={e => setFiltros({ ...filtros, orgao_cnpj: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-muted">UASG (código unidade)</label>
                <input className={`${input} w-full text-xs`} placeholder="Código da unidade"
                  value={filtros.unidade_codigo} onChange={e => setFiltros({ ...filtros, unidade_codigo: e.target.value })} />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-sm text-status-danger">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {!loading && contratacoesPlanas.length > 0 && (
            <p className="text-xs text-muted">
              <span className="font-semibold text-ink">{contratacoesPlanas.length}</span> contratação(ões)
              {' · '}
              <span className="font-semibold text-ink">{total}</span> item(ns)
              <span className="text-muted2"> · ordenado por maior valor</span>
            </p>
          )}
          {loading && <p className="text-xs text-muted">Buscando no banco de PCAs…</p>}
        </div>
      </div>

      <div className="space-y-2.5">
        {contratacoesPlanas.map(ct => {
          const allItemIds = ct.itens.map(i => i.item_id);
          const sel = selecionados[ct.key] || new Set();
          const selectedCount = sel.size;
          const selectedPromotableCount = ct.itens.filter(i => sel.has(i.item_id) && !i.ja_promovido).length;
          const promotedCount = ct.itens.filter(i => i.ja_promovido).length;
          const valorSelecionado = ct.itens
            .filter(i => sel.has(i.item_id))
            .reduce((acc, i) => acc + (Number(i.valor_total) || 0), 0);
          const titulo = ct.contratacao_nome
            || (ct.contratacao_id ? `Contratação ${ct.contratacao_id}` : ct.itens[0]?.descricao || 'Item PCA');
          return (
            <details key={ct.key} className="group rounded-[14px] border border-line bg-surf overflow-hidden transition hover:border-primary/40">
              <summary className="flex cursor-pointer list-none items-start gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {ct.orgao_razao || ct.orgao_cnpj}
                    </span>
                    <span className="rounded-md border border-line bg-bg2 px-2 py-0.5 font-mono text-[10px] text-muted">UASG {ct.codigo_unidade}</span>
                    <span className="rounded-md border border-line bg-bg2 px-2 py-0.5 font-mono text-[10px] text-muted">PCA {ct.ano_pca}</span>
                    {ct.contratacao_id && <span className="font-mono text-[10px] text-muted2">{ct.contratacao_id}</span>}
                    <a
                      href={ct.pncp_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto text-[11px] font-semibold text-primary hover:underline"
                      title="Abrir PCA no PNCP"
                    >
                      PNCP ↗
                    </a>
                  </div>
                  <div className="truncate text-sm font-semibold text-ink">{titulo}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{ct.itens.length} item(ns)</span>
                    <span>{formatPcaQuantity(ct.quantidade_total)} un.</span>
                    <span className="font-mono font-semibold text-ink">{formatPcaCurrency(ct.valor_total)}</span>
                    {promotedCount > 0 && <span className="text-emerald-600">{promotedCount}/{ct.itens.length} promovido(s)</span>}
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                      score {ct.max_score.toFixed(2)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); promoverContratacao(ct); }}
                  disabled={busy[ct.key] || selectedPromotableCount === 0}
                  className="h-9 shrink-0 rounded-[10px] bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] px-3 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                  title={selectedCount === 0
                    ? 'Selecione itens primeiro'
                    : selectedPromotableCount === 0
                      ? 'Itens selecionados já estão promovidos'
                      : `Promover ${selectedPromotableCount} de ${ct.itens.length} (${formatPcaCurrency(valorSelecionado)})`}
                >
                  {busy[ct.key] ? '…' : `Promover${selectedPromotableCount > 0 ? ` (${selectedPromotableCount})` : ''}`}
                </button>
              </summary>
              <div className="border-t border-line bg-bg2/50 p-3.5">
                <div className="mb-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <button type="button" onClick={() => setAllForCt(ct.key, allItemIds, 'all')}
                    className="font-semibold text-primary hover:underline">Selecionar todos ({ct.itens.length})</button>
                  <button type="button" onClick={() => setAllForCt(ct.key, allItemIds, 'none')}
                    className="text-muted hover:underline">Limpar</button>
                  {selectedCount > 0 && (
                    <span className="ml-auto font-mono text-muted">
                      {selectedCount} sel. · {formatPcaCurrency(valorSelecionado)}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {ct.itens.map(item => {
                    const checked = sel.has(item.item_id);
                    return (
                      <label key={item.item_id} className={`py-2 flex items-start gap-3 cursor-pointer rounded-md px-2 -mx-2 transition-colors ${checked ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-primary/5'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(ct.key, item.item_id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-ink">{item.descricao}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                            <span>{formatPcaQuantity(item.quantidade)} {item.unidade_medida || ''}</span>
                            <span>{formatPcaCurrency(item.valor_total)}</span>
                            {item.mes_previsto && <span>mês {item.mes_previsto}/{ct.ano_pca}</span>}
                            {item.classificacao_nome && <span className="truncate max-w-[200px]">{item.classificacao_nome}</span>}
                            {item.ja_promovido && (
                              <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-600">
                                Promovido
                              </span>
                            )}
                            {item.ja_promovido && item.promovido_para_opportunity_id && onOpenOpportunity && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onOpenOpportunity(item.promovido_para_opportunity_id);
                                }}
                                className="text-primary hover:underline"
                              >
                                Ver no Board ↗
                              </button>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!item.ja_promovido && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  promoteSingleItem(item);
                                }}
                                disabled={itemBusy[`promote:${item.item_id}`]}
                                className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                              >
                                {itemBusy[`promote:${item.item_id}`] ? 'Promovendo...' : 'Promover item'}
                              </button>
                            )}
                            {item.signal_status !== 'novo' && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSingleItemStatus(item, 'novo');
                                }}
                                disabled={itemBusy[`status:${item.item_id}:novo`]}
                                className="h-7 rounded-md border border-border px-2.5 text-[11px] text-muted disabled:opacity-50"
                              >
                                Novo
                              </button>
                            )}
                            {item.signal_status !== 'visto' && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSingleItemStatus(item, 'visto');
                                }}
                                disabled={itemBusy[`status:${item.item_id}:visto`]}
                                className="h-7 rounded-md border border-border px-2.5 text-[11px] text-muted disabled:opacity-50"
                              >
                                Visto
                              </button>
                            )}
                            {item.signal_status !== 'descartado' && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSingleItemStatus(item, 'descartado');
                                }}
                                disabled={itemBusy[`status:${item.item_id}:descartado`]}
                                className="h-7 rounded-md border border-border px-2.5 text-[11px] text-muted disabled:opacity-50"
                              >
                                Descartar
                              </button>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          );
        })}
        {!loading && !error && items.length === 0 && !hasSearched && (
          <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-ink">Busque um produto ou serviço nos planos de contratação</p>
            <p className={`${subtle} mx-auto mt-1 max-w-lg`}>
              Exemplos: drone, raio-X, veículo blindado ou manutenção preventiva.
            </p>
          </div>
        )}

        {!loading && !error && items.length === 0 && hasSearched && (
          <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-ink">Nenhum PCA encontrado</p>
            <p className={`${subtle} mx-auto mt-1 max-w-lg`}>
              Tente ampliar os termos, remover filtros ou desativar a expansão por IA.
            </p>
            {bootstrapStatus?.total_planos_db > 0 && (
              <p className={`${subtle} mt-2`}>
                A base tem {bootstrapStatus.total_planos_db.toLocaleString('pt-BR')} planos e é atualizada automaticamente
                {bootstrapStatus.ultimo_sync
                  ? ` · última atualização ${new Date(bootstrapStatus.ultimo_sync).toLocaleString('pt-BR')}`
                  : ''}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* TOAST de promoção */}
      {lastPromoted && (
        <div className="fixed bottom-4 right-4 z-50 rounded-2xl border border-primary/40 bg-card shadow-xl p-4 max-w-sm animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">✓ Promovido para o Board</div>
              <div className="mt-1 text-xs text-muted truncate">
                {lastPromoted.titulo}
              </div>
              <div className="text-xs text-muted">
                {lastPromoted.itens} item(ns) · coluna 1. Monitoramento de PCA
              </div>
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                {onSwitchToBoard && (
                  <button type="button" onClick={() => { onSwitchToBoard(); setLastPromoted(null); }}
                    className="text-xs font-semibold text-primary hover:underline">
                    Ver no Board ↗
                  </button>
                )}
                {lastPromoted.pncpUrl && (
                  <a href={lastPromoted.pncpUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-primary hover:underline">
                    Ver no PNCP ↗
                  </a>
                )}
                <button type="button" onClick={() => setLastPromoted(null)}
                  className="text-xs text-muted hover:underline ml-auto">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {saveDialog && (
        <div className={modalOverlay}>
          <div className={`${modalPanel} max-w-md space-y-3`}>
            <h3 className="text-base font-semibold text-ink">Salvar watchlist</h3>
            <input
              className={`${input} w-full`}
              placeholder="Nome (ex: Drones / RPA)"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={saveWhatsappEnabled}
                onChange={e => setSaveWhatsappEnabled(e.target.checked)}
              />
              Enviar novas oportunidades por WhatsApp
            </label>
            {saveWhatsappEnabled && (
              <input
                className={`${input} w-full`}
                placeholder="WhatsApp com DDD (ex: 48999999999)"
                value={saveWhatsappNumber}
                onChange={e => setSaveWhatsappNumber(e.target.value)}
              />
            )}
            <div className="text-xs text-muted">
              Termos: <strong>{(q ? [q] : positivos.slice(0, 1)).join(', ') || '—'}</strong>
              {negativos.length > 0 && <> · negativos: {negativos.slice(0, 4).join(', ')}{negativos.length > 4 ? '…' : ''}</>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSaveDialog(false)} className={btnSecondary}>Cancelar</button>
              <button type="button" onClick={salvarWatchlist} className={btnPrimary}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PCA_SIGNALS_PAGE_SIZE = 200;

function PcaSignalsPanel({ onPromoted }) {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('novo');
  const [busy, setBusy] = useState({});
  const [selectedSignals, setSelectedSignals] = useState({});
  const [collapsedWatchlists, setCollapsedWatchlists] = useState({});
  const [statusCounts, setStatusCounts] = useState({ novo: 0, visto: 0, promovido: 0, descartado: 0 });
  const [pageInfo, setPageInfo] = useState({ total: 0, limit: PCA_SIGNALS_PAGE_SIZE, offset: 0, hasMore: false });

  const loadCounts = useCallback(async () => {
    try {
      const r = await axios.get('/api/licitacoes/pca/signals/stats');
      setStatusCounts({
        novo: Number(r.data?.novo) || 0,
        visto: Number(r.data?.visto) || 0,
        promovido: Number(r.data?.promovido) || 0,
        descartado: Number(r.data?.descartado) || 0,
      });
    } catch {
      setStatusCounts({ novo: 0, visto: 0, promovido: 0, descartado: 0 });
    }
  }, []);

  const load = useCallback(async ({ append = false, offset = 0, background = false } = {}) => {
    if (append) setLoadingMore(true);
    else if (!background) setLoading(true);
    setError(null);
    try {
      const r = await axios.get('/api/licitacoes/pca/signals', {
        params: { status: statusFilter, limit: PCA_SIGNALS_PAGE_SIZE, offset },
      });
      const rows = Array.isArray(r.data) ? r.data : (r.data?.data || []);
      const total = Array.isArray(r.data) ? rows.length : (Number(r.data?.total) || 0);
      setSignals(prev => append ? [...prev, ...rows] : rows);
      setPageInfo({
        total,
        limit: Number(r.data?.limit) || PCA_SIGNALS_PAGE_SIZE,
        offset,
        hasMore: Array.isArray(r.data) ? false : !!r.data?.has_more,
      });
      loadCounts();
    } catch (e) {
      setError(e.response?.status === 504
        ? 'A atualização demorou mais que o esperado. Vamos tentar novamente automaticamente.'
        : (e.response?.data?.error || 'Não foi possível carregar os sinais agora.'));
    } finally {
      if (append) setLoadingMore(false);
      else if (!background) setLoading(false);
    }
  }, [statusFilter, loadCounts]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let lastRefresh = Date.now();
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 60000) return;
      lastRefresh = Date.now();
      load({ background: true });
    };
    const intervalId = setInterval(refreshIfStale, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [load]);

  useEffect(() => {
    setSelectedSignals({});
  }, [statusFilter]);

  const toggleSelected = (id) => {
    setSelectedSignals(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedIds = Object.keys(selectedSignals).filter(id => selectedSignals[id]).map(id => Number(id));
  const groupedSignals = useMemo(() => groupPcaSignalsByWatchlist(signals), [signals]);

  const toggleWatchlistCollapsed = (key) => {
    setCollapsedWatchlists(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllWatchlistsCollapsed = (collapsed) => {
    const next = {};
    groupedSignals.forEach(group => {
      next[group.key] = collapsed;
    });
    setCollapsedWatchlists(next);
  };

  const runBatch = async (action, status = null) => {
    if (!selectedIds.length) return;
    setBusy(prev => ({ ...prev, __batch: true }));
    try {
      await axios.post('/api/licitacoes/pca/signals/batch', {
        action,
        status,
        signal_ids: selectedIds,
      });
      if (action === 'promote') onPromoted && onPromoted();
      setSelectedSignals({});
      load();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, __batch: false }));
    }
  };

  const act = async (id, kind) => {
    setBusy(prev => ({ ...prev, [id]: true }));
    try {
      if (kind === 'promote') {
        await axios.post(`/api/licitacoes/pca/signals/${id}/promote`);
        onPromoted && onPromoted();
      } else if (kind === 'unpromote') {
        await axios.post(`/api/licitacoes/pca/signals/${id}/unpromote`);
      } else if (kind === 'dismiss') {
        await axios.post(`/api/licitacoes/pca/signals/${id}/dismiss`);
      } else if (kind === 'seen') {
        await axios.post(`/api/licitacoes/pca/signals/${id}/seen`);
      } else if (kind === 'to_novo' || kind === 'to_visto' || kind === 'to_descartado') {
        const status = kind.replace('to_', '');
        await axios.put(`/api/licitacoes/pca/signals/${id}/status`, { status });
      }
      load();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {['novo', 'visto', 'promovido', 'descartado'].map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={statusFilterPill(statusFilter === s)}
          >
            {statusFilterLabel(s)} ({statusCounts[s] || 0})
          </button>
        ))}
        <span className="font-mono text-[11px] text-muted2">
          {signals.length}/{pageInfo.total || statusCounts[statusFilter] || signals.length}
        </span>
        {groupedSignals.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setAllWatchlistsCollapsed(false)} className={`${btnSecondary} h-8 px-2.5 text-[11px]`}>
              Expandir
            </button>
            <button type="button" onClick={() => setAllWatchlistsCollapsed(true)} className={`${btnSecondary} h-8 px-2.5 text-[11px]`}>
              Colapsar
            </button>
          </div>
        )}
        <span className="ml-auto text-[11px] text-muted">Atualização automática</span>
      </div>

      {statusFilter !== 'promovido' && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-bg2/40 px-3 py-2">
          <span className="text-xs text-muted">{selectedIds.length} selecionado(s)</span>
          {statusFilter === 'novo' && (
            <button type="button" disabled={!selectedIds.length || busy.__batch}
              onClick={() => runBatch('promote')}
              className="h-8 rounded-lg bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] px-3 text-xs font-semibold text-white disabled:opacity-50">
              Promover selecionados
            </button>
          )}
          <button type="button" disabled={!selectedIds.length || busy.__batch}
            onClick={() => runBatch('status', 'visto')}
            className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`}>Marcar visto</button>
          <button type="button" disabled={!selectedIds.length || busy.__batch}
            onClick={() => runBatch('status', 'descartado')}
            className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`}>Descartar</button>
          <button type="button" disabled={!selectedIds.length || busy.__batch}
            onClick={() => setSelectedSignals({})}
            className={`${btnGhost} h-8 px-2 text-xs disabled:opacity-50`}>Limpar</button>
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-sm text-status-danger">
          <span>{error}</span>
          <button type="button" onClick={() => load()} className="text-xs font-semibold underline">Tentar novamente</button>
        </div>
      )}

      {loading ? (
        <div className={`${subtle} py-8 text-center`}>Carregando sinais…</div>
      ) : error && signals.length === 0 ? null : signals.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
          <p className="text-sm font-semibold text-ink">Nenhum sinal {statusFilterLabel(statusFilter).toLowerCase()}</p>
          <p className={`${subtle} mt-1`}>Os sinais aparecem após o sync das watchlists ativas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedSignals.map(group => {
            const isCollapsed = !!collapsedWatchlists[group.key];
            const itemLabel = group.totalCount > group.itemsCount ? `${group.itemsCount}/${group.totalCount}` : group.itemsCount;
            return (
            <div key={group.key} className="overflow-hidden rounded-[14px] border border-line bg-surf">
              <button
                type="button"
                onClick={() => toggleWatchlistCollapsed(group.key)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 border-b border-line bg-primary/[0.07] px-3.5 py-2.5 text-left text-xs font-semibold text-primary hover:bg-primary/12"
              >
                <span className="w-4 text-center font-mono text-[10px] text-muted" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                <span className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold uppercase tracking-wide">{group.title}</span>
                <span className="shrink-0 rounded-md border border-primary/20 bg-surf px-2 py-0.5 font-mono text-[11px] text-primary">
                  {itemLabel} sinal{Number(group.itemsCount) === 1 ? '' : 's'}
                </span>
              </button>
              {!isCollapsed && (
              <div className="space-y-2.5 bg-bg2/30 p-3">
                {group.plans.map(plan => (
                  <div key={plan.key} className="overflow-hidden rounded-[12px] border border-line bg-surf">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                      <div className="min-w-[240px] flex-1">
                        <div className="text-sm font-semibold text-ink">
                          {plan.orgao_razao || plan.orgao_cnpj} · PCA {plan.ano_pca}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                          <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5 font-mono text-[10px]">UASG {plan.codigo_unidade}</span>
                          {plan.unidade_nome && <span>{plan.unidade_nome}</span>}
                          <span>{plan.items.length} item{plan.items.length !== 1 ? 's' : ''}</span>
                          <span className="font-mono font-semibold text-ink">{formatPcaCurrency(plan.valor_total)}</span>
                          <span className="font-mono text-[10px] text-primary">score {Number(plan.max_score || 0).toFixed(2)}</span>
                        </div>
                      </div>
                      <a
                        href={plan.pncp_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${btnSecondary} h-8 px-3 text-xs`}
                        title="Abrir PCA no PNCP"
                      >
                        PNCP ↗
                      </a>
                    </div>
                    <div className="divide-y divide-border">
                      {plan.items.map(s => (
                        <div key={s.id} className="p-3 flex items-start gap-3">
                          <input type="checkbox" checked={!!selectedSignals[s.id]} onChange={() => toggleSelected(s.id)} className="mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-ink">{s.descricao}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                              <span>Item {s.numero_item || '—'}</span>
                              {s.futura_contratacao_id && <span>Contratação {s.futura_contratacao_id}</span>}
                              {s.futura_contratacao_nome && <span>{s.futura_contratacao_nome}</span>}
                              <span>Mês {s.mes_previsto ?? '—'}</span>
                              <span>Qtd. {formatPcaQuantity(s.quantidade)}</span>
                              {s.unidade_medida && <span>{s.unidade_medida}</span>}
                              <span>{formatPcaCurrency(s.valor_total)}</span>
                              <span>Score {Number(s.score || 0).toFixed(2)}</span>
                              <span>· {formatPcaDate(s.criado_em)}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap justify-end">
                            {statusFilter !== 'promovido' && (
                              <>
                                {s.status !== 'novo' && (
                                  <button type="button" disabled={busy[s.id]}
                                    onClick={() => act(s.id, 'to_novo')}
                                    className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50">Novo</button>
                                )}
                                {s.status !== 'visto' && (
                                  <button type="button" disabled={busy[s.id]}
                                    onClick={() => act(s.id, 'to_visto')}
                                    className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50">Visto</button>
                                )}
                                {s.status !== 'descartado' && (
                                  <button type="button" disabled={busy[s.id]}
                                    onClick={() => act(s.id, 'to_descartado')}
                                    className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50">Descartar</button>
                                )}
                              </>
                            )}
                            {statusFilter === 'novo' && (
                              <button type="button" disabled={busy[s.id]}
                                onClick={() => act(s.id, 'promote')}
                                className="h-8 rounded-lg bg-primary text-white px-3 text-xs font-semibold disabled:opacity-50">Promover</button>
                            )}
                            {statusFilter === 'promovido' && (
                              <button type="button" disabled={busy[s.id]}
                                onClick={() => act(s.id, 'unpromote')}
                                className="h-8 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50">Despromover</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
            );
          })}
          {pageInfo.hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => load({ append: true, offset: signals.length })}
                className="h-9 rounded-lg border border-border bg-card px-4 text-xs font-semibold text-primary disabled:opacity-50"
              >
                {loadingMore ? 'Carregando...' : `Carregar mais (${signals.length}/${pageInfo.total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PcaWatchlistsPanel() {
  const [watchlists, setWatchlists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});

  const loadWatchlists = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const r = await axios.get('/api/licitacoes/pca/watchlist');
      setWatchlists(r.data || []);
    } catch (e) {
      setError(e.response?.status === 504
        ? 'A atualização demorou mais que o esperado. Vamos tentar novamente automaticamente.'
        : (e.response?.data?.error || 'Não foi possível carregar as watchlists agora.'));
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWatchlists();
  }, [loadWatchlists]);

  useEffect(() => {
    let lastRefresh = Date.now();
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 60000) return;
      lastRefresh = Date.now();
      loadWatchlists({ background: true });
    };
    const intervalId = setInterval(refreshIfStale, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [loadWatchlists]);

  const toggleAtivo = async (row) => {
    setBusy(prev => ({ ...prev, [row.id]: true }));
    try {
      await axios.put(`/api/licitacoes/pca/watchlist/${row.id}`, { ativo: !row.ativo });
      await loadWatchlists();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }));
    }
  };

  const removeWatchlist = async (row) => {
    if (!window.confirm(`Excluir watchlist "${row.nome}"?`)) return;
    setBusy(prev => ({ ...prev, [row.id]: true }));
    try {
      await axios.delete(`/api/licitacoes/pca/watchlist/${row.id}`);
      await loadWatchlists();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }));
    }
  };

  const updateWhatsapp = async (row) => {
    const nextNumber = window.prompt('Número de WhatsApp para alertas desta watchlist:', row.whatsapp_number || '');
    if (nextNumber === null) return;
    setBusy(prev => ({ ...prev, [`wa:${row.id}`]: true }));
    try {
      await axios.put(`/api/licitacoes/pca/watchlist/${row.id}`, {
        whatsapp_enabled: Boolean(nextNumber.trim()),
        whatsapp_number: nextNumber.trim() || null,
      });
      await loadWatchlists();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [`wa:${row.id}`]: false }));
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={subtle}>Regras salvas são verificadas automaticamente e ao voltar para esta tela.</p>
        <span className="text-[11px] text-muted">Atualização automática</span>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-sm text-status-danger">
          <span>{error}</span>
          <button type="button" onClick={() => loadWatchlists()} className="text-xs font-semibold underline">Tentar novamente</button>
        </div>
      )}

      {loading ? (
        <div className={`${subtle} py-8 text-center`}>Carregando watchlists…</div>
      ) : error && watchlists.length === 0 ? null : watchlists.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
          <p className="text-sm font-semibold text-ink">Nenhuma watchlist PCA</p>
          <p className={`${subtle} mt-1 mx-auto max-w-md`}>Salve uma busca na aba PCA para monitorar termos e receber sinais.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {watchlists.map(w => (
            <div key={w.id} className={`flex flex-col rounded-[14px] border bg-surf p-3.5 ${w.ativo ? 'border-line' : 'border-line opacity-75'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display text-[13px] font-semibold uppercase tracking-wide text-ink">{w.nome}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted2">criada {formatPcaDate(w.criado_em)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${w.ativo ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' : 'border-line bg-bg2 text-muted'}`}>
                  {w.ativo ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] text-muted">
                <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">IA: {w.usar_ia ? 'sim' : 'não'}</span>
                <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">
                  WhatsApp: {w.whatsapp_enabled && w.whatsapp_number ? w.whatsapp_number : 'off'}
                </span>
              </div>
              {(w.palavras_chave || []).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {(w.palavras_chave || []).slice(0, 6).map(t => (
                    <span key={t} className="max-w-[9rem] truncate rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-primary">{t}</span>
                  ))}
                  {(w.palavras_chave || []).length > 6 && (
                    <span className="rounded-md bg-bg2 px-1.5 py-0.5 text-[10px] text-muted">+{(w.palavras_chave || []).length - 6}</span>
                  )}
                </div>
              )}
              {(w.termos_negativos || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(w.termos_negativos || []).slice(0, 4).map(t => (
                    <span key={t} className="rounded-md border border-amber/30 bg-amber/15 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-amber">− {t}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-2.5">
                <button type="button" disabled={busy[w.id]} onClick={() => toggleAtivo(w)} className={`${btnSecondary} h-7 px-2.5 text-[11px] disabled:opacity-50`}>
                  {w.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" disabled={busy[`wa:${w.id}`]} onClick={() => updateWhatsapp(w)} className={`${btnSecondary} h-7 px-2.5 text-[11px] disabled:opacity-50`}>
                  WhatsApp
                </button>
                <button type="button" disabled={busy[w.id]} onClick={() => removeWatchlist(w)} className="ml-auto h-7 rounded-lg border border-line bg-bg2 px-2.5 text-[11px] text-muted hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50">
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PcaWatchlistPage({ onPromoted }) {
  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-[16px] border border-line bg-surf p-4 md:p-5">
        <div className="mb-1">
          <h3 className={`${sectionTitle} text-base`}>Watchlists PCA</h3>
          <p className={`${subtle} mt-0.5`}>Ative, configure WhatsApp e gerencie regras de monitoramento pré-edital.</p>
        </div>
        <PcaWatchlistsPanel />
      </section>
      <section className="rounded-[16px] border border-line bg-surf p-4 md:p-5">
        <div className="mb-1">
          <h3 className={`${sectionTitle} text-base`}>Sinais encontrados</h3>
          <p className={`${subtle} mt-0.5`}>Oportunidades geradas pelas watchlists — promova para o board quando fizer sentido.</p>
        </div>
        <PcaSignalsPanel onPromoted={onPromoted} />
      </section>
    </div>
  );
}

function EditalWatchlistsPanel({ onSignalsChanged }) {
  const [watchlists, setWatchlists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});

  const loadWatchlists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get('/api/licitacoes/editais/watchlist');
      setWatchlists(r.data || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWatchlists();
  }, [loadWatchlists]);

  const toggleAtivo = async (row) => {
    setBusy(prev => ({ ...prev, [row.id]: true }));
    try {
      await axios.put(`/api/licitacoes/editais/watchlist/${row.id}`, { ativo: !row.ativo });
      await loadWatchlists();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }));
    }
  };

  const updateWhatsapp = async (row) => {
    const nextNumber = window.prompt('Número de WhatsApp para alertas desta watchlist:', row.whatsapp_number || '');
    if (nextNumber === null) return;
    setBusy(prev => ({ ...prev, [`wa:${row.id}`]: true }));
    try {
      await axios.put(`/api/licitacoes/editais/watchlist/${row.id}`, {
        whatsapp_enabled: Boolean(nextNumber.trim()),
        whatsapp_number: nextNumber.trim() || null,
      });
      await loadWatchlists();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [`wa:${row.id}`]: false }));
    }
  };

  const removeWatchlist = async (row) => {
    if (!window.confirm(`Excluir watchlist "${row.nome}"?`)) return;
    setBusy(prev => ({ ...prev, [row.id]: true }));
    try {
      await axios.delete(`/api/licitacoes/editais/watchlist/${row.id}`);
      await loadWatchlists();
      onSignalsChanged?.();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }));
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={subtle}>Watchlists de editais usam a busca PNCP e geram sinais no sync.</p>
        <button type="button" onClick={loadWatchlists} className={`${btnSecondary} h-8 px-3 text-xs inline-flex items-center gap-1.5`}>
          <ArrowPathIcon className="h-3.5 w-3.5" /> Atualizar
        </button>
      </div>
      {error && <div className="rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-sm text-status-danger">{error}</div>}
      {loading ? (
        <div className={`${subtle} py-8 text-center`}>Carregando watchlists…</div>
      ) : watchlists.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
          <p className="text-sm font-semibold text-ink">Nenhuma watchlist de editais</p>
          <p className={`${subtle} mt-1 mx-auto max-w-md`}>Na Busca Editais, abra um job e use “Virar watchlist” para monitorar termos no PNCP.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {watchlists.map(w => (
            <div key={w.id} className={`flex flex-col rounded-[14px] border bg-surf p-3.5 ${w.ativo ? 'border-line' : 'border-line opacity-75'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display text-[13px] font-semibold uppercase tracking-wide text-ink">{w.nome}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted2">criada {formatPcaDate(w.criado_em)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${w.ativo ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' : 'border-line bg-bg2 text-muted'}`}>
                  {w.ativo ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] text-muted">
                <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">IA: {w.usar_ia ? 'sim' : 'não'}</span>
                <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">
                  WhatsApp: {w.whatsapp_enabled && w.whatsapp_number ? w.whatsapp_number : 'off'}
                </span>
              </div>
              {(w.palavras_chave || []).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {(w.palavras_chave || []).slice(0, 6).map(t => (
                    <span key={t} className="max-w-[9rem] truncate rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-primary">{t}</span>
                  ))}
                  {(w.palavras_chave || []).length > 6 && (
                    <span className="rounded-md bg-bg2 px-1.5 py-0.5 text-[10px] text-muted">+{(w.palavras_chave || []).length - 6}</span>
                  )}
                </div>
              )}
              {Object.keys(w.filtros || {}).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(w.filtros || {}).filter(([, v]) => v !== '' && v != null).slice(0, 4).map(([k, v]) => (
                    <span key={k} className="rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-[10px] text-muted">
                      <span className="text-muted2">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-2.5">
                <button type="button" disabled={busy[w.id]} onClick={() => toggleAtivo(w)} className={`${btnSecondary} h-7 px-2.5 text-[11px] disabled:opacity-50`}>
                  {w.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" disabled={busy[`wa:${w.id}`]} onClick={() => updateWhatsapp(w)} className={`${btnSecondary} h-7 px-2.5 text-[11px] disabled:opacity-50`}>
                  WhatsApp
                </button>
                <button type="button" disabled={busy[w.id]} onClick={() => removeWatchlist(w)} className="ml-auto h-7 rounded-lg border border-line bg-bg2 px-2.5 text-[11px] text-muted hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50">
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EDITAL_SIGNALS_PAGE_SIZE = 100;

function EditalSignalsPanel({ onImportSignal, onNewCountChange, refreshVersion = 0 }) {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('novo');
  const [statusCounts, setStatusCounts] = useState({ novo: 0, visto: 0, promovido: 0, descartado: 0 });
  const [pageInfo, setPageInfo] = useState({ total: 0, hasMore: false });
  const [busy, setBusy] = useState({});
  const [collapsedWatchlists, setCollapsedWatchlists] = useState({});

  const loadCounts = useCallback(async () => {
    try {
      const r = await axios.get('/api/licitacoes/editais/signals/stats');
      const nextCounts = {
        novo: Number(r.data?.novo) || 0,
        visto: Number(r.data?.visto) || 0,
        promovido: Number(r.data?.promovido) || 0,
        descartado: Number(r.data?.descartado) || 0,
      };
      setStatusCounts(nextCounts);
      onNewCountChange?.(getNewEditalSignalsCount(nextCounts));
    } catch {
      setStatusCounts({ novo: 0, visto: 0, promovido: 0, descartado: 0 });
    }
  }, [onNewCountChange]);

  const load = useCallback(async ({ append = false, offset = 0 } = {}) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await axios.get('/api/licitacoes/editais/signals', {
        params: { status: statusFilter, limit: EDITAL_SIGNALS_PAGE_SIZE, offset },
      });
      const rows = r.data?.data || [];
      setSignals(prev => append ? [...prev, ...rows] : rows);
      setPageInfo({ total: Number(r.data?.total) || 0, hasMore: !!r.data?.has_more });
      loadCounts();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [statusFilter, loadCounts]);

  useEffect(() => { load(); }, [load, refreshVersion]);

  const groupedSignals = useMemo(() => groupEditalSignalsByWatchlist(signals), [signals]);

  const setStatus = async (row, status) => {
    setBusy(prev => ({ ...prev, [row.id]: true }));
    try {
      await axios.put(`/api/licitacoes/editais/signals/${row.id}/status`, { status });
      await load();
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(prev => ({ ...prev, [row.id]: false }));
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {['novo', 'visto', 'promovido', 'descartado'].map(s => (
          <button key={s} type="button" onClick={() => setStatusFilter(s)} className={statusFilterPill(statusFilter === s)}>
            {statusFilterLabel(s)} ({statusCounts[s] || 0})
          </button>
        ))}
        <span className="font-mono text-[11px] text-muted2">
          {signals.length}/{pageInfo.total || statusCounts[statusFilter] || signals.length}
        </span>
        <button type="button" onClick={load} className={`${btnSecondary} ml-auto h-8 px-3 text-xs inline-flex items-center gap-1.5`}>
          <ArrowPathIcon className="h-3.5 w-3.5" /> Atualizar
        </button>
      </div>
      {error && <div className="rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-sm text-status-danger">{error}</div>}
      {loading ? (
        <div className={`${subtle} py-8 text-center`}>Carregando sinais…</div>
      ) : signals.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
          <p className="text-sm font-semibold text-ink">Nenhum sinal {statusFilterLabel(statusFilter).toLowerCase()}</p>
          <p className={`${subtle} mt-1`}>Rode o sync ou aguarde o ciclo automático das watchlists ativas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedSignals.map(group => {
            const isCollapsed = !!collapsedWatchlists[group.key];
            return (
              <div key={group.key} className="overflow-hidden rounded-[14px] border border-line bg-surf">
                <button type="button" onClick={() => setCollapsedWatchlists(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 border-b border-line bg-primary/[0.07] px-3.5 py-2.5 text-left text-xs font-semibold text-primary hover:bg-primary/12">
                  <span className="w-4 text-center font-mono text-[10px] text-muted" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold uppercase tracking-wide">{group.title}</span>
                  <span className="shrink-0 rounded-md border border-primary/20 bg-surf px-2 py-0.5 font-mono text-[11px] text-primary">{group.itemsCount} sinais</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-line">
                    {group.items.map(s => {
                      const item = s.payload || {};
                      return (
                        <div key={s.id} className="flex items-start gap-3 p-3.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-ink">{item.titulo || item.title || 'Edital PNCP'}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted">{item.descricao || item.description}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted">
                              <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">{item.orgao?.nome || item.orgao_nome || 'Órgão n/d'}</span>
                              {item.unidade?.codigo && <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5 font-mono text-[10px]">UASG {item.unidade.codigo}</span>}
                              {item.prazo_info?.label && <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5">{item.prazo_info.label}</span>}
                              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">score {Number(s.score || 0).toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} h-8 px-3 text-xs`}>PNCP ↗</a>
                            )}
                            {statusFilter !== 'promovido' && onImportSignal && (
                              <button type="button" disabled={busy[s.id]} onClick={() => onImportSignal(item, s.id)} className="h-8 rounded-[10px] bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                                Importar
                              </button>
                            )}
                            {s.status !== 'visto' && (
                              <button type="button" disabled={busy[s.id]} onClick={() => setStatus(s, 'visto')} className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`}>Visto</button>
                            )}
                            {s.status !== 'descartado' && (
                              <button type="button" disabled={busy[s.id]} onClick={() => setStatus(s, 'descartado')} className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`}>Descartar</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {pageInfo.hasMore && (
            <div className="flex justify-center pt-1">
              <button type="button" disabled={loadingMore} onClick={() => load({ append: true, offset: signals.length })}
                className={`${btnSecondary} h-9 px-4 text-xs disabled:opacity-50`}>
                {loadingMore ? 'Carregando…' : `Carregar mais (${signals.length}/${pageInfo.total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditalWatchlistPage({ onImportSignal, onNewCountChange }) {
  const [syncing, setSyncing] = useState(false);
  const [signalsRefreshVersion, setSignalsRefreshVersion] = useState(0);
  const refreshSignals = useCallback(() => {
    setSignalsRefreshVersion(version => version + 1);
  }, []);
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await axios.post('/api/licitacoes/editais/sync');
      refreshSignals();
      alert(`Sync concluído: ${r.data?.signals_inserted || 0} novo(s) sinal(is).`);
    } catch (e) {
      alert(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-[16px] border border-line bg-surf p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={`${sectionTitle} text-base`}>Watchlists de editais</h3>
            <p className={`${subtle} mt-0.5`}>Regras salvas a partir da Busca Editais / PNCP.</p>
          </div>
          <button type="button" disabled={syncing} onClick={syncNow} className={`${btnPrimary} h-8 px-3 text-xs disabled:opacity-50`}>
            {syncing ? 'Sincronizando…' : 'Rodar sync'}
          </button>
        </div>
        <EditalWatchlistsPanel onSignalsChanged={refreshSignals} />
      </section>
      <section className="rounded-[16px] border border-line bg-surf p-4 md:p-5">
        <div className="mb-1">
          <h3 className={`${sectionTitle} text-base`}>Sinais encontrados</h3>
          <p className={`${subtle} mt-0.5`}>Editais capturados pelas watchlists — importe para o funil quando fizer sentido.</p>
        </div>
        <EditalSignalsPanel
          onImportSignal={onImportSignal}
          onNewCountChange={onNewCountChange}
          refreshVersion={signalsRefreshVersion}
        />
      </section>
    </div>
  );
}

const fetchEditalNewSignalsCount = async () => {
  const response = await axios.get('/api/licitacoes/editais/signals/stats');
  return getNewEditalSignalsCount(response.data);
};

// ===================== /PCA =====================

function App() {
  const [contacts, setContacts] = useState([]);
  const [licitacaoOpportunities, setLicitacaoOpportunities] = useState([]);
  const [licSummary, setLicSummary] = useState(null);
  const [editalNewSignalsCount, setEditalNewSignalsCount] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [metasYear, setMetasYear] = useState(new Date().getFullYear());
  const [metasRows, setMetasRows] = useState([]);
  const [realizadoRows, setRealizadoRows] = useState([]);
  const [realizadoVendedores, setRealizadoVendedores] = useState([]);
  const [metasLoading, setMetasLoading] = useState(false);
  const [vendaMeta, setVendaMeta] = useState(null);
  const [disparoModo, setDisparoModo] = useState('funil');
  const [disparoFunil, setDisparoFunil] = useState([]);
  const [disparoTags, setDisparoTags] = useState([]);
  const [disparoCanais, setDisparoCanais] = useState([]);
  const [disparoDDDs, setDisparoDDDs] = useState([]);
  const [disparoContatos, setDisparoContatos] = useState([]);
  const [disparoContatoBusca, setDisparoContatoBusca] = useState('');
  const [disparoMensagens, setDisparoMensagens] = useState([{ tipo: 'texto', texto: 'Olá {nome}, tudo bem? Aqui é da Aerion.' }]);
  const [disparoStep, setDisparoStep] = useState(0);
  const [disparoSending, setDisparoSending] = useState(false);
  const [disparoResult, setDisparoResult] = useState(null);
  const [disparoConfigured, setDisparoConfigured] = useState(null);
  const [disparoInstancias, setDisparoInstancias] = useState([]);
  const [disparoInstanciasSel, setDisparoInstanciasSel] = useState([]);
  const [disparoInstanciasStatus, setDisparoInstanciasStatus] = useState({ configured: null, verificado: false, error: '' });
  const [disparoNome, setDisparoNome] = useState('');
  const [disparoConfig, setDisparoConfig] = useState({ maxPerDay: 30, minInterval: 30, maxInterval: 60, sendPeriod: 'integral', diasSemana: [1, 2, 3, 4, 5], fixarNumero: true, priorizarRecentes: true, cooldownDias: 7, pularConversasAbertas: true });
  const [disparoVerificando, setDisparoVerificando] = useState(false);
  const [disparoCampanhas, setDisparoCampanhas] = useState([]);
  const [disparoDash, setDisparoDash] = useState(null);
  const [disparoCampanhaBusy, setDisparoCampanhaBusy] = useState(null);
  const [disparoSubview, setDisparoSubview] = useState('criar'); // 'criar' | 'gestao'
  const [disparoCampanhaSel, setDisparoCampanhaSel] = useState(null);
  const [disparoCampanhaMeta, setDisparoCampanhaMeta] = useState(null);
  const [disparoEnvios, setDisparoEnvios] = useState([]);
  const [disparoEnviosLoading, setDisparoEnviosLoading] = useState(false);
  const [disparoEnviosError, setDisparoEnviosError] = useState('');
  const [disparoEnviosFiltro, setDisparoEnviosFiltro] = useState('todos');
  const [disparoEnviosBusca, setDisparoEnviosBusca] = useState('');
  const [disparoCampanhaBusca, setDisparoCampanhaBusca] = useState('');
  const [disparoMonitorLoading, setDisparoMonitorLoading] = useState(false);
  const disparoDetalheRef = useRef(null);
  const [licitacaoLoading, setLicitacaoLoading] = useState(false);
  const [licitacaoSearch, setLicitacaoSearch] = useState('');
  const [licitacaoSubview, setLicitacaoSubview] = useState('overview'); // 'overview' | 'board' | 'editais' | 'pca' | 'sinais' | 'watchlists'
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [selectedCommercialRequirements, setSelectedCommercialRequirements] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [itemRequirementsMap, setItemRequirementsMap] = useState({});
  const [selectedLinkedContacts, setSelectedLinkedContacts] = useState([]);
  const [newOpportunityForm, setNewOpportunityForm] = useState(createEmptyOpportunityForm);
  const [showNewOpportunityForm, setShowNewOpportunityForm] = useState(false);
  const [newOpportunityFormSubview, setNewOpportunityFormSubview] = useState(null);
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
    ordenacao: 'relevancia_desc',
    usar_ia: true, // Busca inteligente com termos correlatos
    negative_terms: '',
  });
  const [pncpSearchResults, setPncpSearchResults] = useState({ items: [], total: 0, pagina: 1, totalPaginas: 0, termosUsados: [], termosNegativos: [], fonteIA: null });
  const [pncpSearchLoading, setPncpSearchLoading] = useState(false);
  const [pncpSearchJobs, setPncpSearchJobs] = useState([]);
  const [activePncpSearchJobId, setActivePncpSearchJobId] = useState(() => {
    try {
      return localStorage.getItem('pncp_active_search_job_id') || null;
    } catch {
      return null;
    }
  });
  const [pncpSuggestedTerms, setPncpSuggestedTerms] = useState({ positivos: [], negativos: [], fonte: null });
  const [pncpAcceptedPositiveTerms, setPncpAcceptedPositiveTerms] = useState([]);
  const [pncpAcceptedNegativeTerms, setPncpAcceptedNegativeTerms] = useState([]);
  const [pncpCustomTermInput, setPncpCustomTermInput] = useState('');
  const [pncpActiveJobTermInput, setPncpActiveJobTermInput] = useState('');
  const [pncpSuggestionLoading, setPncpSuggestionLoading] = useState(false);
  const [pncpOrgaoLookupQuery, setPncpOrgaoLookupQuery] = useState('');
  const [pncpUasgLookupQuery, setPncpUasgLookupQuery] = useState('');
  const [pncpOrgaoOptions, setPncpOrgaoOptions] = useState([]);
  const [pncpUasgOptions, setPncpUasgOptions] = useState([]);
  const [pncpOrgaoLookupLoading, setPncpOrgaoLookupLoading] = useState(false);
  const [pncpUasgLookupLoading, setPncpUasgLookupLoading] = useState(false);
  const [pncpSearchExpanded, setPncpSearchExpanded] = useState(false);
  const [pncpSummaryExpanded, setPncpSummaryExpanded] = useState(false);
  const [pncpDiagnosticsExpanded, setPncpDiagnosticsExpanded] = useState(false);
  const [pncpJobModalOpen, setPncpJobModalOpen] = useState(false);
  const [pncpJobModalTab, setPncpJobModalTab] = useState('resultados'); // resultados | termos | auditoria
  const [pncpJobFilterDraft, setPncpJobFilterDraft] = useState({
    tipos_documento: 'edital',
    status: 'recebendo_proposta',
    modalidade_licitacao_id: '',
    tipo_id: '',
    modo_disputa_id: '',
    uf: '',
    esfera_id: '',
    orgao_cnpj: '',
    unidade_codigo: '',
    negative_terms: '',
    ordenacao: 'relevancia_desc',
    usar_ia: true,
  });
  const [pncpJobFiltersEditing, setPncpJobFiltersEditing] = useState(false);
  const [pncpJobFiltersSaving, setPncpJobFiltersSaving] = useState(false);
  const [pncpResultLocalQuery, setPncpResultLocalQuery] = useState('');
  const [pncpResultScope, setPncpResultScope] = useState('all');
  const [pncpJobResultsPage, setPncpJobResultsPage] = useState(1);
  const [pncpDebugControlId, setPncpDebugControlId] = useState('');
  const [pncpImportingId, setPncpImportingId] = useState(null);
  const [isPncpImportDraft, setIsPncpImportDraft] = useState(false);
  const [pncpHiddenIds, setPncpHiddenIds] = useState(() => {
    try {
      const stored = localStorage.getItem('pncp_hidden_ids');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showPncpHidden, setShowPncpHidden] = useState(false);
  const [pncpOutcomeFilters, setPncpOutcomeFilters] = useState({
    q: '',
    fornecedor: '',
    fornecedor_ni: '',
    orgao_cnpj: '',
    uf: '',
    tipo: 'todos',
  });
  const [pncpOutcomeResults, setPncpOutcomeResults] = useState({ items: [], total: 0, pagina: 1, totalPaginas: 1, summary: null });
  const [pncpOutcomeLoading, setPncpOutcomeLoading] = useState(false);
  const [pncpOutcomeError, setPncpOutcomeError] = useState('');
  const [pncpOutcomeDossier, setPncpOutcomeDossier] = useState(null);
  const [pncpOutcomeDossierLoading, setPncpOutcomeDossierLoading] = useState(false);

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
  const [trendsIntel, setTrendsIntel] = useState(null);
  const [trendsIntelLoading, setTrendsIntelLoading] = useState(false);
  const [trendsIntelError, setTrendsIntelError] = useState('');
  const [trendsPanelOpen, setTrendsPanelOpen] = useState(false);
  const [trendsRefreshing, setTrendsRefreshing] = useState(false);
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
  const [activeView, setActiveView] = useState('Overview');
  const [processActiveSection, setProcessActiveSection] = useState(processBlueprint.map[0]?.id || 'metas-2026');
  const [processQuery, setProcessQuery] = useState('');
  // Dark (Aerion Command) is the only theme — no light/dark toggle.
  const isDarkMode = true;
  const [authStatus, setAuthStatus] = useState({ checked: false, authenticated: false, email: '', name: '', role: 'member', allowedViews: null });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // When logged in, the app shell (h-dvh + chevron scroll) owns vertical overflow.
  useEffect(() => {
    const root = document.documentElement;
    if (authStatus.authenticated) {
      root.classList.add('aerion-shell-lock');
    } else {
      root.classList.remove('aerion-shell-lock');
    }
    return () => root.classList.remove('aerion-shell-lock');
  }, [authStatus.authenticated]);
  const [searchQuery, setSearchQuery] = useState('');
  const [boardSearchFocusIndex, setBoardSearchFocusIndex] = useState(0);
  const [focusedSearchContactId, setFocusedSearchContactId] = useState(null);
  const pendingBoardFocusContactIdRef = useRef(null);
  const [licitacaoSearchFocusIndex, setLicitacaoSearchFocusIndex] = useState(0);
  const [focusedSearchOpportunityId, setFocusedSearchOpportunityId] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [sortOption, setSortOption] = useState('opportunity-desc');
  const [historyGranularity, setHistoryGranularity] = useState('week');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [funnelPace, setFunnelPace] = useState(null);
  const [paceAgentId, setPaceAgentId] = useState(null); // null = time geral
  const [paceMetric, setPaceMetric] = useState('count'); // 'count' | 'value' (R$ a partir de opp)
  const [showFunnelPaceModal, setShowFunnelPaceModal] = useState(false);
  const [recentActionsSource, setRecentActionsSource] = useState('all');
  const [recentActionsPage, setRecentActionsPage] = useState(0);
  const RECENT_ACTIONS_PAGE_SIZE = 6;
  // Qtd | R$ independente por quadro (Gestão de Leads)
  const [historyMetric, setHistoryMetric] = useState('count');
  const [mapMetric, setMapMetric] = useState('count');
  const [channelMetric, setChannelMetric] = useState('count');
  const [labelMetric, setLabelMetric] = useState('count');
  const [globalSearchQ, setGlobalSearchQ] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchHighlight, setGlobalSearchHighlight] = useState(0);
  const [globalSearchPos, setGlobalSearchPos] = useState(null);
  const globalSearchWrapRef = useRef(null);
  const globalSearchPanelRef = useRef(null);
  const [rfbPendingSearch, setRfbPendingSearch] = useState(false);
  const rfbSearchTriggerRef = useRef(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifPos, setNotifPos] = useState(null);
  const notifBtnRef = useRef(null);
  const notifPanelRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Cross-filter da segmentação do Overview: cada dimensão selecionada filtra as outras.
  const [segFilter, setSegFilter] = useState({ uf: null, channel: null, label: null });
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
    faturamentoVendedores: [],
    history: [],
    recentActions: [],
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
  const dragSnapshotRef = useRef(null);
  const lastDragOverKeyRef = useRef(null);
  const contactsRef = useRef(contacts);
  const licitacaoOpportunitiesRef = useRef(licitacaoOpportunities);
  contactsRef.current = contacts;
  licitacaoOpportunitiesRef.current = licitacaoOpportunities;
  const [activeDragId, setActiveDragId] = useState(null);
  // Overlay payload frozen at drag start so board re-renders stay cheap during drag.
  const [dragOverlayPayload, setDragOverlayPayload] = useState(null);

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
          name: response.data?.name || '',
          role: response.data?.role || 'member',
          allowedViews: response.data?.allowed_views ?? null,
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

  const loadUsers = useCallback(() => {
    setUsersLoading(true);
    axios.get('/api/users')
      .then(r => setUsersList(r.data || []))
      .catch(() => setUsersList([]))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated || authStatus.role !== 'admin' || activeView !== 'Usuários') return;
    loadUsers();
  }, [authStatus.authenticated, authStatus.role, activeView, loadUsers]);

  const saveUserAccess = useCallback(async (userId, allowedViews) => {
    try {
      await axios.put(`/api/users/${userId}/access`, { allowed_views: allowedViews });
      setUsersList(prev => prev.map(u => (u.id === userId ? { ...u, allowed_views: allowedViews } : u)));
    } catch (error) {
      console.error('Error saving user access:', error);
    }
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Overview') return;
    const now = new Date();
    const ano = now.getFullYear();
    const mes = now.getMonth() + 1;
    Promise.all([
      axios.get('/api/metas', { params: { ano } }),
      axios.get('/api/vendas/realizado', { params: { ano, mes } }),
    ])
      .then(([m, r]) => {
        const metaRow = (m.data || []).find(x => Number(x.mes) === mes);
        setVendaMeta({ meta: metaRow ? Number(metaRow.receita_meta) : null, ...r.data });
      })
      .catch(() => setVendaMeta(null));
  }, [authStatus.authenticated, activeView]);

  const loadMetas = useCallback((year) => {
    setMetasLoading(true);
    Promise.all([
      axios.get('/api/metas', { params: { ano: year } }).then(r => r.data || []).catch(() => []),
      axios.get('/api/vendas/realizado/ano', { params: { ano: year } })
        .then(r => (r.data && r.data.configured ? (r.data.meses || []) : []))
        .catch(() => []),
      axios.get('/api/vendas/realizado/vendedores/ano', { params: { ano: year } })
        .then(r => (r.data && r.data.configured ? (r.data.vendedores || []) : []))
        .catch(() => []),
    ])
      .then(([metas, meses, vendedores]) => { setMetasRows(metas); setRealizadoRows(meses); setRealizadoVendedores(vendedores); })
      .finally(() => setMetasLoading(false));
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated || authStatus.role !== 'admin') return;
    if (activeView !== 'Metas' && activeView !== 'Definir Metas') return;
    loadMetas(metasYear);
  }, [authStatus.authenticated, authStatus.role, activeView, metasYear, loadMetas]);

  const saveMeta = useCallback(async (ano, mes, patch, prevRow) => {
    const merged = {
      ano, mes, vendedor: '',
      receita_meta: Number(prevRow?.receita_meta) || 0,
      ...patch,
    };
    setMetasRows(prev => {
      const idx = prev.findIndex(r => r.mes === mes && (r.vendedor || '') === '');
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...merged }; return copy; }
      return [...prev, merged];
    });
    try {
      await axios.put('/api/metas', merged);
    } catch (error) {
      console.error('Error saving meta:', error);
    }
  }, []);

  // Instâncias com estado real de conexão (listar + verificar no Evolution via n8n).
  const carregarDisparoInstancias = useCallback(async () => {
    setDisparoVerificando(true);
    try {
      const r = await axios.get('/api/disparo/instancias');
      const list = r.data?.instancias || [];
      setDisparoInstanciasStatus({
        configured: r.data?.configured !== false,
        verificado: Boolean(r.data?.verificado),
        error: r.data?.error || '',
      });
      setDisparoInstancias(list);
      // Pré-seleciona apenas instâncias conectadas; remove da seleção o que caiu.
      setDisparoInstanciasSel(prev => {
        const conectadas = list.filter(i => i.connection_state === 'open').map(i => String(i.id ?? i.instancia_nome ?? i.nome));
        if (!prev.length) return conectadas;
        const validas = prev.filter(id => {
          const inst = list.find(i => String(i.id ?? i.instancia_nome ?? i.nome) === String(id));
          return !inst || inst.connection_state == null || inst.connection_state === 'open';
        });
        return validas.length ? validas : conectadas;
      });
    } catch (error) {
      setDisparoInstanciasStatus({ configured: true, verificado: false, error: error?.response?.data?.error || 'Falha ao consultar o estado das instâncias.' });
      setDisparoInstancias([]);
    } finally {
      setDisparoVerificando(false);
    }
  }, []);

  const carregarDisparoMonitor = useCallback(async () => {
    setDisparoMonitorLoading(true);
    try {
      const [dash, camps] = await Promise.all([
        axios.get('/api/disparo/dashboard').catch(() => null),
        axios.get('/api/disparo/campanhas').catch(() => null),
      ]);
      if (dash?.data?.configured) setDisparoDash(dash.data);
      else if (dash?.data) setDisparoDash(dash.data);
      const list = camps?.data?.campanhas;
      setDisparoCampanhas(Array.isArray(list) ? list : []);
    } catch { /* monitor é best-effort */ }
    finally { setDisparoMonitorLoading(false); }
  }, []);

  const carregarDetalheCampanha = useCallback(async (campanhaId, meta = null) => {
    if (campanhaId == null || campanhaId === '') return;
    const id = String(campanhaId);
    setDisparoCampanhaSel(id);
    if (meta) setDisparoCampanhaMeta(meta);
    setDisparoEnviosLoading(true);
    setDisparoEnviosError('');
    setDisparoEnvios([]);
    setDisparoEnviosFiltro('todos');
    setDisparoEnviosBusca('');
    // Garante que o painel entre na viewport (lista longa escondia o detalhe embaixo).
    requestAnimationFrame(() => {
      disparoDetalheRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    });
    try {
      const r = await axios.get(`/api/disparo/campanhas/${encodeURIComponent(id)}`);
      const raw = r.data?.envios;
      const list = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' ? [raw] : []);
      setDisparoEnvios(list);
      if (!meta && Array.isArray(disparoCampanhas)) {
        const found = disparoCampanhas.find(c => String(c.campanha_id ?? c.id) === id);
        if (found) setDisparoCampanhaMeta(found);
      }
    } catch (error) {
      setDisparoEnviosError(formatDisparoApiError(error, 'Falha ao carregar destinatários da campanha.'));
      setDisparoEnvios([]);
    } finally {
      setDisparoEnviosLoading(false);
    }
  }, [disparoCampanhas]);

  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Disparo WhatsApp') return;
    axios.get('/api/disparo/status')
      .then(r => setDisparoConfigured(Boolean(r.data?.configured)))
      .catch(() => setDisparoConfigured(false));
    carregarDisparoInstancias();
    carregarDisparoMonitor();
    const monitorTimer = setInterval(carregarDisparoMonitor, 30000);
    const instanceTimer = setInterval(carregarDisparoInstancias, 30000);
    return () => {
      clearInterval(monitorTimer);
      clearInterval(instanceTimer);
    };
  }, [authStatus.authenticated, activeView, carregarDisparoInstancias, carregarDisparoMonitor]);

  const acaoCampanha = useCallback(async (campanhaId, acao) => {
    setDisparoCampanhaBusy(`${campanhaId}:${acao}`);
    try {
      await axios.post(`/api/disparo/campanhas/${campanhaId}/${acao}`);
      await carregarDisparoMonitor();
      if (String(disparoCampanhaSel) === String(campanhaId)) {
        await carregarDetalheCampanha(campanhaId);
      }
    } catch (error) {
      alert(formatDisparoApiError(error, `Falha ao ${acao} a campanha.`));
    } finally {
      setDisparoCampanhaBusy(null);
    }
  }, [carregarDisparoMonitor, carregarDetalheCampanha, disparoCampanhaSel]);

  const sendDisparo = useCallback(async () => {
    if (disparoSending) return;
    const msgs = disparoMensagens
      .filter(m => (m.tipo || 'texto') === 'texto' ? (m.texto || '').trim() : Boolean(m.arquivo_base64))
      .map(m => {
        const tipo = m.tipo || 'texto';
        const txt = (m.texto || '').trim() || null;
        // Contrato do disparo-wpp: mídia usa `legenda`; só texto usa `texto`.
        return {
          tipo,
          texto: tipo === 'texto' ? txt : null,
          legenda: tipo === 'texto' ? null : txt,
          arquivo_nome: m.arquivo_nome || null,
          arquivo_tipo: m.arquivo_tipo || null,
          arquivo_base64: m.arquivo_base64 || null,
        };
      });
    const ddds = disparoDDDs;
    const contatosSel = disparoContatos.map(id => Number(id)).filter(Number.isFinite);
    const instSel = disparoInstanciasSel.map(id => {
      const inst = disparoInstancias.find(i => String(i.id ?? i.instancia_nome ?? i.nome) === String(id));
      return inst ? (inst.id ?? inst.instancia_nome ?? inst.nome) : id;
    });
    const selectorGroups = [disparoFunil, disparoTags, disparoCanais, ddds, contatosSel].filter(group => group.length > 0);
    if (!selectorGroups.length) { setDisparoResult({ error: 'Selecione ao menos um item do público.' }); return; }
    if (!msgs.length) { setDisparoResult({ error: 'Escreva ao menos uma mensagem.' }); return; }
    if (!instSel.length) { setDisparoResult({ error: 'Selecione ao menos uma instância.' }); return; }
    // Só contatos manuais (sem funil/tags/canal/ddd): escolha deliberada — não aplicar
    // anti-spam de conversa aberta/cooldown (bloqueava testes e reenvios pontuais).
    const soContatosManuais = contatosSel.length > 0
      && !disparoFunil.length
      && !disparoTags.length
      && !disparoCanais.length
      && !ddds.length;
    const destinatarios = {
      modo: soContatosManuais ? 'contatos' : disparoModo,
      funil_vendas: disparoFunil,
      tags: disparoTags,
      canais: disparoCanais,
      ddds,
      contatos: contatosSel,
      combinar: selectorGroups.length > 1,
    };
    const configEnvio = soContatosManuais
      ? { ...disparoConfig, pularConversasAbertas: false, cooldownDias: 0 }
      : disparoConfig;
    setDisparoSending(true);
    setDisparoResult(null);
    try {
      const r = await axios.post('/api/disparo/send', {
        destinatarios,
        mensagens: msgs,
        instancias: instSel,
        config: configEnvio,
        nomeCampanha: disparoNome || null,
      });
      setDisparoResult(r.data);
      if (r.data && !r.data.error) {
        await carregarDisparoMonitor();
        setDisparoSubview('gestao');
        const newId = r.data.campanhaId
          || r.data.campanhas?.find(c => c.campanhaId)?.campanhaId
          || null;
        if (newId) await carregarDetalheCampanha(newId);
      }
    } catch (error) {
      const data = error?.response?.data;
      const formatted = formatDisparoError(data?.error || data?.message || 'Falha no envio.');
      setDisparoResult({
        error: data?.error || formatted.title,
        errorTitle: formatted.title,
        errorDetail: formatted.detail || formatDisparoApiError(error, 'Falha no envio.'),
        errorKind: formatted.kind,
        resumo: data?.resumo || null,
      });
    } finally {
      setDisparoSending(false);
    }
  }, [disparoModo, disparoFunil, disparoTags, disparoCanais, disparoDDDs, disparoContatos, disparoMensagens, disparoInstanciasSel, disparoInstancias, disparoConfig, disparoNome, disparoSending, carregarDisparoMonitor, carregarDetalheCampanha]);

  // Busca global do header: depois de navegar até a Busca B2B, dispara a pesquisa.
  useEffect(() => {
    if (!rfbPendingSearch || activeView !== 'Busca Lead B2B') return;
    const id = setTimeout(() => {
      setRfbPendingSearch(false);
      rfbSearchTriggerRef.current?.(1);
    }, 80);
    return () => clearTimeout(id);
  }, [rfbPendingSearch, activeView]);

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

  const refreshEditalNewSignalsCount = useCallback(async () => {
    try {
      const count = await fetchEditalNewSignalsCount();
      setEditalNewSignalsCount(count);
      return count;
    } catch (error) {
      console.error('Error fetching new edital signals count:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated) {
      setEditalNewSignalsCount(null);
      return undefined;
    }

    let ignore = false;
    const load = async () => {
      try {
        const count = await fetchEditalNewSignalsCount();
        if (!ignore) setEditalNewSignalsCount(count);
      } catch (error) {
        if (!ignore) console.error('Error fetching new edital signals count:', error);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };

    load();
    const intervalId = window.setInterval(load, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
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

  const loadTrendsIntel = useCallback(async ({ force = false } = {}) => {
    if (force) setTrendsRefreshing(true);
    else setTrendsIntelLoading(true);
    setTrendsIntelError('');
    try {
      const r = force
        ? await axios.post('/api/trends/intel/refresh')
        : await axios.get('/api/trends/intel');
      setTrendsIntel(r.data || null);
    } catch (e) {
      setTrendsIntelError(e.response?.data?.error || e.message || 'Falha ao carregar trends');
    } finally {
      setTrendsIntelLoading(false);
      setTrendsRefreshing(false);
    }
  }, []);

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
      const data = opportunitiesResponse.data || [];
      setLicitacaoOpportunities(data);
      axios.get('/api/licitacoes/overview/summary').then(r => setLicSummary(r.data)).catch(() => {});
      return data;
    } catch (error) {
      console.error('Error loading licitações:', error);
      return [];
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
    document.body.classList.add('theme-dark');
    document.documentElement.classList.add('theme-dark');
  }, []);

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

  // Ritmo do time: time geral ou um agente (feito do dia filtrado) — só Gestão de Leads
  useEffect(() => {
    if (!authStatus.authenticated) return;
    if (activeView !== 'Overview') return;
    const params = paceAgentId ? { agent_id: paceAgentId } : {};
    axios.get('/api/overview/funnel-pace', { params })
      .then((r) => setFunnelPace(r.data || null))
      .catch(() => setFunnelPace(null));
  }, [authStatus.authenticated, activeView, paceAgentId]);

  useEffect(() => {
    if (!authStatus.authenticated) return;
    if (activeView !== 'Overview') return;

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
      axios.get('/api/overview/recent-actions', { params: { limit: 60 } }),
      axios.get('/api/licitacoes/overview/summary'),
      axios.get('/api/vendas/realizado/vendedores/ano', { params: { ano: new Date().getFullYear() } }).catch(() => ({ data: { vendedores: [] } })),
    ])
      .then(([summary, byStage, byLabel, byState, byAgent, byChannel, byCustomerType, byProbability, history, recentActions, licitacaoSummary, faturamentoVendedores]) => {
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
          faturamentoVendedores: faturamentoVendedores.data?.vendedores || [],
          history: history.data,
          recentActions: recentActions.data || [],
        });
      })
      .catch(error => {
        console.error('Error fetching overview data:', error);
      })
      .finally(() => {
        setOverviewLoading(false);
      });
  }, [activeView, historyGranularity, authStatus.authenticated]);

  useEffect(() => {
    if (activeView !== 'Processo') return undefined;
    let observer;
    const setup = () => {
      const elements = processBlueprint.map
        .map((item) => document.getElementById(item.id))
        .filter(Boolean);
      if (!elements.length) return;
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
          if (visible[0]?.target?.id) {
            setProcessActiveSection(visible[0].target.id);
          }
        },
        { rootMargin: '-15% 0px -55% 0px', threshold: [0.1, 0.25, 0.5] }
      );
      elements.forEach((el) => observer.observe(el));
    };
    // Wait one frame so ProcessSection nodes are in the DOM.
    const raf = requestAnimationFrame(setup);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [activeView]);

  const openFunnelLeadCount = useMemo(
    () => countOpenFunnelLeads(contacts, leadColumns),
    [contacts]
  );

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = contactMatchesQuery(contact, searchQuery);

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

  const selectedPncpTipoInstrumento = useMemo(() => {
    if (!pncpSearchFilters.tipo_id) {
      return null;
    }
    return tipoInstrumentoOptions.find(item => String(item.id || '') === String(pncpSearchFilters.tipo_id)) || null;
  }, [tipoInstrumentoOptions, pncpSearchFilters.tipo_id]);

  const pncpEditalTipoInstrumentoOptions = useMemo(
    () => tipoInstrumentoOptions.filter(item => item.bucket !== 'resultado'),
    [tipoInstrumentoOptions]
  );

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

  const getPncpResultVisibility = useCallback((item) => {
    if (pncpHiddenIds.includes(item.id)) {
      return 'hidden';
    }
    const controlId = normalizePncpControlId(item.numero_controle_pncp);
    if (controlId && pncpInPipelineIndex.controls.has(controlId)) {
      return 'pipeline';
    }
    const pathKey = extractPncpPathKey(item.url || item.item_url);
    if (pathKey && pncpInPipelineIndex.paths.has(pathKey)) {
      return 'pipeline';
    }
    const itemId = String(item.id || '').trim();
    if (itemId && pncpInPipelineIndex.ids.has(itemId)) {
      return 'pipeline';
    }
    return 'visible';
  }, [pncpHiddenIds, pncpInPipelineIndex]);

  const pncpResultsWithVisibility = useMemo(() => {
    return (pncpSearchResults.items || []).map(item => ({
      ...item,
      score_label: getPncpScoreLabel(item.score),
      __visibility: getPncpResultVisibility(item),
    }));
  }, [pncpSearchResults.items, getPncpResultVisibility]);

  const pncpVisibilityCounts = useMemo(() => {
    return pncpResultsWithVisibility.reduce((acc, item) => {
      acc[item.__visibility] = (acc[item.__visibility] || 0) + 1;
      acc.all += 1;
      return acc;
    }, { all: 0, visible: 0, hidden: 0, pipeline: 0 });
  }, [pncpResultsWithVisibility]);

  const visiblePncpResults = useMemo(() => {
    let list = pncpResultScope === 'all'
      ? pncpResultsWithVisibility
      : pncpResultsWithVisibility.filter(item => item.__visibility === pncpResultScope);
    const q = String(pncpResultLocalQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(item => {
        const hay = [
          item.titulo,
          item.descricao,
          item.orgao?.nome,
          item.uf,
          item.modalidade?.nome,
          item.numero_controle_pncp,
        ].map(v => String(v || '').toLowerCase()).join(' ');
        return hay.includes(q);
      });
    }
    return list;
  }, [pncpResultsWithVisibility, pncpResultScope, pncpResultLocalQuery]);

  const pncpSearchSummary = useMemo(() => {
    const backendSummary = pncpSearchResults.summary || pncpSearchResults.pageSummary;
    return backendSummary || createPncpUiSummary(pncpSearchResults.items || []);
  }, [pncpSearchResults]);

  const visiblePncpSummary = useMemo(() => createPncpUiSummary(visiblePncpResults), [visiblePncpResults]);

  const activePncpSearchJob = useMemo(() => {
    if (!activePncpSearchJobId) return null;
    return pncpSearchJobs.find(job => String(job.id) === String(activePncpSearchJobId)) || null;
  }, [activePncpSearchJobId, pncpSearchJobs]);

  const activePncpJobProgress = useMemo(() => {
    const progress = activePncpSearchJob?.progress || {};
    const done = Number(progress.terms_done || 0);
    const total = Math.max(Number(progress.terms_total || activePncpSearchJob?.terms?.length || 0), 1);
    const pct = ['completed', 'failed', 'cancelled'].includes(activePncpSearchJob?.status) ? 100 : Math.min(98, Math.round((done / total) * 100));
    return {
      done,
      total,
      pct,
      currentTerm: progress.current_term || '',
      currentPage: progress.current_page || null,
      currentCollected: Number(progress.current_term_collected || 0),
      currentReported: progress.current_term_total_reported ? Number(progress.current_term_total_reported) : null,
      totalCollected: Number(progress.items_collected || activePncpSearchJob?.total || 0),
    };
  }, [activePncpSearchJob]);

  const getPncpJobStatusMeta = (status) => {
    const normalized = String(status || 'queued');
    if (normalized === 'completed') return { label: 'Concluída', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25', live: false };
    if (normalized === 'running') return { label: 'Coletando', className: 'bg-primary/10 text-primary border-primary/25', live: true };
    if (normalized === 'paused_rate_limit') return { label: 'Pausada (limite PNCP)', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30', live: true };
    if (normalized === 'queued') return { label: 'Na fila', className: 'bg-sky-500/10 text-sky-600 border-sky-500/25', live: true };
    if (normalized === 'cancelling') return { label: 'Parando…', className: 'bg-cardAlt text-muted border-border', live: true };
    if (normalized === 'cancelled') return { label: 'Parada', className: 'bg-cardAlt text-muted border-border', live: false };
    if (normalized === 'failed') return { label: 'Erro', className: 'bg-status-danger/10 text-status-danger border-status-danger/25', live: false };
    return { label: normalized.replace(/_/g, ' '), className: 'bg-cardAlt text-muted border-border', live: false };
  };

  const isPncpJobLive = (status) => ['queued', 'running', 'paused_rate_limit', 'cancelling'].includes(String(status || ''));

  const formatPncpJobAge = (value) => {
    if (!value) return '';
    const ts = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(ts)) return '';
    const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'agora';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h`;
    return `${Math.floor(diffSec / 86400)} d`;
  };

  const seedPncpJobFilterDraft = (filters = {}) => {
    setPncpJobFilterDraft({
      tipos_documento: filters.tipos_documento || 'edital',
      status: filters.status || 'recebendo_proposta',
      modalidade_licitacao_id: filters.modalidade_licitacao_id || '',
      tipo_id: filters.tipo_id || '',
      modo_disputa_id: filters.modo_disputa_id || '',
      uf: filters.uf || '',
      esfera_id: filters.esfera_id || '',
      orgao_cnpj: filters.orgao_cnpj || '',
      unidade_codigo: filters.unidade_codigo || '',
      negative_terms: filters.negative_terms || '',
      ordenacao: filters.ordenacao || 'relevancia_desc',
      usar_ia: filters.usar_ia === undefined ? true : String(filters.usar_ia) !== 'false',
    });
  };

  const getPncpPartidaFilterChips = (filters = {}, options = {}) => {
    const chips = [];
    const f = filters || {};
    const tipoDocLabel = {
      edital: 'Editais',
      ata: 'Atas',
      contrato: 'Contratos',
      'edital,ata': 'Editais e Atas',
      'edital,ata,contrato': 'Todos docs',
    };
    const statusLabel = {
      recebendo_proposta: 'Recebendo proposta',
      encerrada: 'Encerrada',
      suspensa: 'Suspensa',
      todos: 'Todos status',
    };
    const esferaLabel = { F: 'Federal', E: 'Estadual', M: 'Municipal' };
    if (f.tipos_documento) chips.push({ key: 'tipos_documento', label: 'Documento', value: tipoDocLabel[f.tipos_documento] || f.tipos_documento });
    if (f.status) chips.push({ key: 'status', label: 'Status', value: statusLabel[f.status] || String(f.status).replace(/_/g, ' ') });
    if (f.uf) chips.push({ key: 'uf', label: 'UF', value: f.uf });
    if (f.esfera_id) chips.push({ key: 'esfera_id', label: 'Esfera', value: esferaLabel[f.esfera_id] || f.esfera_id });
    if (f.modalidade_licitacao_id) {
      const mod = (options.modalidades || []).find(m => String(m.id) === String(f.modalidade_licitacao_id));
      chips.push({ key: 'modalidade_licitacao_id', label: 'Modalidade', value: mod?.nome || f.modalidade_licitacao_id });
    }
    if (f.tipo_id) {
      const tipo = (options.tipos || []).find(t => String(t.id) === String(f.tipo_id));
      chips.push({ key: 'tipo_id', label: 'Instrumento', value: tipo?.nome || f.tipo_id });
    }
    if (f.modo_disputa_id) {
      const modo = (options.modos || []).find(m => String(m.id) === String(f.modo_disputa_id));
      chips.push({ key: 'modo_disputa_id', label: 'Disputa', value: modo?.nome || f.modo_disputa_id });
    }
    if (f.orgao_cnpj) chips.push({ key: 'orgao_cnpj', label: 'Órgão', value: f.orgao_cnpj });
    if (f.unidade_codigo) chips.push({ key: 'unidade_codigo', label: 'UASG', value: f.unidade_codigo });
    if (f.negative_terms) chips.push({ key: 'negative_terms', label: 'Excluir', value: f.negative_terms });
    return chips;
  };

  const pncpDebugLookup = useMemo(() => {
    const query = normalizePncpControlId(pncpDebugControlId);
    if (!query) {
      return null;
    }
    const queryDigits = query.replace(/\D/g, '');
    const found = pncpResultsWithVisibility.find(item => {
      const control = normalizePncpControlId(item.numero_controle_pncp);
      const path = extractPncpPathKey(item.url || item.item_url);
      const id = normalizePncpControlId(item.id);
      const combinedDigits = `${control} ${path} ${id}`.replace(/\D/g, '');
      return (control && control.includes(query))
        || (path && path.includes(query))
        || (id && id.includes(query))
        || (queryDigits.length >= 8 && combinedDigits.includes(queryDigits));
    });
    return {
      query: pncpDebugControlId,
      found,
      status: found ? found.__visibility : 'missing',
    };
  }, [pncpDebugControlId, pncpResultsWithVisibility]);

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

  const activeColumns = activeTab === 'leads' ? leadColumns : customerColumns;

  // Pre-bucket contacts once per render deps so columns keep stable array refs
  // unless that column's membership actually changed.
  const contactsByColumnPrevRef = useRef(Object.create(null));
  const contactsByColumn = useMemo(() => {
    const buckets = Object.create(null);
    activeColumns.forEach((column) => {
      buckets[column] = [];
    });
    filteredContacts.forEach((contact) => {
      const column = contact.custom_attributes?.Funil_Vendas;
      if (column && buckets[column]) {
        buckets[column].push(contact);
      }
    });
    if (!activeDragId) {
      activeColumns.forEach((column) => {
        buckets[column] = sortContacts(buckets[column]);
      });
    }
    // Reuse previous column arrays when membership/order is unchanged — critical
    // for funnel boards so untouched columns skip React.memo invalidation.
    const prev = contactsByColumnPrevRef.current;
    activeColumns.forEach((column) => {
      const nextList = buckets[column];
      const prevList = prev[column];
      if (
        prevList
        && prevList.length === nextList.length
        && prevList.every((item, index) => item === nextList[index])
      ) {
        buckets[column] = prevList;
      }
    });
    contactsByColumnPrevRef.current = buckets;
    return buckets;
  }, [filteredContacts, activeColumns, activeDragId, sortOption]);

  const getContactsForColumn = (columnName) => contactsByColumn[columnName] || [];
  const dotClass = activeTab === 'leads' ? 'bg-primary' : 'bg-secondary';
  const showMenu = true;
  const showHeaderMenu = activeTab === 'leads';
  const menuLabel = activeTab === 'leads' ? 'Enviar para novos clientes' : 'Voltar para Inbox';
  const newContactUrl = activeTab === 'customers'
    ? 'https://chatwoot.tenryu.com.br/app/accounts/2/contacts?page=1'
    : null;

  // Ordered matches for board search focus (column order → card order in column).
  const boardSearchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const matches = [];
    activeColumns.forEach((column) => {
      (contactsByColumn[column] || []).forEach((contact) => {
        matches.push({
          contactId: contact.id,
          column,
          label: contact.company_name || contact.name || `Contato #${contact.id}`,
        });
      });
    });
    return matches;
  }, [searchQuery, activeColumns, contactsByColumn]);

  const boardSearchMatchKey = boardSearchMatches
    .map((match) => `${match.contactId}@${match.column}`)
    .join('|');

  const operationalLicitacaoCount = useMemo(
    () => countOperationalLicitacoes(licitacaoOpportunities, licitacaoColumns),
    [licitacaoOpportunities]
  );

  const filteredLicitacaoOpportunities = useMemo(() => {
    const search = normalizeText(licitacaoSearch);
    // Keep source order so drag-and-drop can open gaps between cards (Trello-like).
    return licitacaoOpportunities.filter(item => {
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
  }, [licitacaoOpportunities, licitacaoSearch]);

  const opportunitiesByColumnPrevRef = useRef(Object.create(null));
  const opportunitiesByColumn = useMemo(() => {
    const buckets = Object.create(null);
    licitacaoColumns.forEach((column) => {
      buckets[column] = [];
    });
    filteredLicitacaoOpportunities.forEach((item) => {
      const column = item.fase;
      if (column && buckets[column]) {
        buckets[column].push(item);
      }
    });
    const prev = opportunitiesByColumnPrevRef.current;
    licitacaoColumns.forEach((column) => {
      const nextList = buckets[column];
      const prevList = prev[column];
      if (
        prevList
        && prevList.length === nextList.length
        && prevList.every((item, index) => item === nextList[index])
      ) {
        buckets[column] = prevList;
      }
    });
    opportunitiesByColumnPrevRef.current = buckets;
    return buckets;
  }, [filteredLicitacaoOpportunities]);

  const getOpportunitiesForColumn = (columnName) => opportunitiesByColumn[columnName] || [];

  // Ordered matches for licitação pipeline search focus (column order → card order).
  const licitacaoSearchMatches = useMemo(() => {
    if (!licitacaoSearch.trim()) return [];
    const matches = [];
    licitacaoColumns.forEach((column) => {
      (opportunitiesByColumn[column] || []).forEach((item) => {
        matches.push({
          opportunityId: item.id,
          column,
          label: item.titulo || `Licitação #${item.id}`,
        });
      });
    });
    return matches;
  }, [licitacaoSearch, opportunitiesByColumn]);

  const licitacaoSearchMatchKey = licitacaoSearchMatches
    .map((match) => `${match.opportunityId}@${match.column}`)
    .join('|');

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
      console.error('Error moving licitação opportunity:', error);
      setLicitacaoOpportunities(previous);
    }
  };

  const resetNewOpportunityFormState = useCallback(() => {
    setShowNewOpportunityForm(false);
    setNewOpportunityFormSubview(null);
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
  }, []);

  const openNewOpportunityForm = useCallback(() => {
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
    setNewOpportunityFormSubview(licitacaoSubview);
    setShowNewOpportunityForm(true);
  }, [licitacaoSubview]);

  // Trava o scroll do body e Esc fecha o modal ativo (nova licitação ou detalhe).
  useEffect(() => {
    const anyModal = showNewOpportunityForm || Boolean(selectedOpportunity);
    if (!anyModal) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (showNewOpportunityForm) {
        resetNewOpportunityFormState();
        return;
      }
      if (selectedOpportunity) {
        setSelectedOpportunity(null);
        setContactLinkQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [showNewOpportunityForm, selectedOpportunity, resetNewOpportunityFormState]);

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
      resetNewOpportunityFormState();
    } catch (error) {
      console.error('Error creating licitação opportunity:', error);
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
  const applyPncpJobSnapshot = (job) => {
    if (!job) return;
    setPncpSearchResults({
      items: Array.isArray(job.items) ? job.items : (pncpSearchResults.items || []),
      total: Number(job.total || job.items?.length || pncpSearchResults.total || 0),
      pagina: pncpSearchResults.pagina || 1,
      tamanhoPagina: pncpSearchResults.tamanhoPagina || 25,
      totalPaginas: pncpSearchResults.totalPaginas || 1,
      termosUsados: job.terms || [],
      termosNegativos: job.negative_terms || [],
      fonteIA: job.suggested_positive_terms?.length ? 'IA + termos aceitos' : null,
      summary: job.summary || null,
      query_plan: job.query_plan || { mode: 'deep_background', term_runs: job.term_runs || [] },
      diagnostics: {
        aiRequested: true,
        aiUsed: Boolean(job.suggested_positive_terms?.length || job.accepted_positive_terms?.length),
        jobStatus: job.status,
      },
    });
    setPncpResultScope('all');
    setShowPncpHidden(false);
  };

  const loadPncpJobResults = async (jobId, page = 1, overrides = {}) => {
    if (!jobId) return null;
    const effectivePage = Math.max(1, Number(page) || 1);
    const effectiveScope = overrides.scope || (pncpResultScope === 'hidden' || pncpResultScope === 'pipeline' ? 'all' : pncpResultScope);
    const response = await axios.get(`/api/licitacoes/pncp/search/deep/${jobId}/results`, {
      params: {
        pagina: effectivePage,
        tam: 25,
        ordenacao: overrides.ordenacao || pncpSearchFilters.ordenacao,
        scope: effectiveScope,
      },
    });
    const payload = response.data || {};
    const total = Number(payload.total || 0);
    setPncpJobResultsPage(effectivePage);
    setPncpSearchResults(prev => ({
      ...prev,
      items: Array.isArray(payload.items) ? payload.items : [],
      total,
      pagina: Number(payload.pagina || effectivePage),
      tamanhoPagina: Number(payload.tamanhoPagina || 25),
      totalPaginas: Number(payload.totalPaginas || 1),
      summary: payload.summary || prev.summary || null,
    }));
    // Mantém o card alinhado ao total real da tabela de resultados (mesma fonte do popup).
    if (jobId && Number.isFinite(total)) {
      setPncpSearchJobs(prev => prev.map(job => (
        String(job.id) === String(jobId) ? { ...job, total } : job
      )));
    }
    return payload;
  };

  const loadPncpSearchJobs = async () => {
    try {
      const response = await axios.get('/api/licitacoes/pncp/search/jobs');
      const jobs = Array.isArray(response.data) ? response.data : [];
      setPncpSearchJobs(jobs);
      return jobs;
    } catch (error) {
      console.error('Error loading PNCP jobs:', error);
      return [];
    }
  };

  const openPncpSearchJob = async (jobId, { refreshJobs = true, openModal = true } = {}) => {
    if (!jobId) return;
    try {
      const response = await axios.get(`/api/licitacoes/pncp/search/deep/${jobId}`);
      setActivePncpSearchJobId(jobId);
      setPncpResultLocalQuery('');
      setPncpResultScope('all');
      setPncpJobModalTab('resultados');
      setPncpJobFiltersEditing(false);
      seedPncpJobFilterDraft(response.data?.filters || {});
      applyPncpJobSnapshot(response.data);
      setPncpSearchJobs(prev => {
        const next = {
          id: jobId,
          nome: response.data?.filters?.q || response.data?.nome,
          status: response.data?.status,
          filters: response.data?.filters || {},
          terms: response.data?.terms || [],
          negative_terms: response.data?.negative_terms || [],
          progress: response.data?.progress || {},
          total: Number(response.data?.total || 0),
          summary: response.data?.summary || null,
          error: response.data?.error || null,
        };
        const exists = prev.some(j => String(j.id) === String(jobId));
        if (!exists) return [next, ...prev].slice(0, 20);
        return prev.map(j => String(j.id) === String(jobId) ? { ...j, ...next } : j);
      });
      await loadPncpJobResults(jobId, 1);
      if (openModal) setPncpJobModalOpen(true);
      try {
        localStorage.setItem('pncp_active_search_job_id', jobId);
      } catch {}
      if (refreshJobs) loadPncpSearchJobs();
    } catch (error) {
      console.error('Error opening PNCP job:', error);
      if (error.response?.status === 404) {
        setActivePncpSearchJobId(null);
        setPncpJobModalOpen(false);
        try {
          localStorage.removeItem('pncp_active_search_job_id');
        } catch {}
      }
    }
  };

  const closePncpSearchJobModal = () => {
    setPncpJobModalOpen(false);
    setPncpJobFiltersEditing(false);
  };

  const applyPncpJobFiltersAndRerun = async () => {
    if (!activePncpSearchJobId) return;
    setPncpJobFiltersSaving(true);
    try {
      await axios.post(`/api/licitacoes/pncp/search/deep/${activePncpSearchJobId}/filters`, {
        filters: {
          ...pncpJobFilterDraft,
          usar_ia: pncpJobFilterDraft.usar_ia ? 'true' : 'false',
          // mantém o q original do job se o draft não tiver
          q: activePncpSearchJob?.filters?.q || activePncpSearchJob?.nome || pncpSearchFilters.q || '',
        },
      });
      setPncpJobFiltersEditing(false);
      setPncpSearchLoading(true);
      await openPncpSearchJob(activePncpSearchJobId, { refreshJobs: true, openModal: true });
      await loadPncpSearchJobs();
    } catch (error) {
      alert(`Erro ao reaplicar filtros: ${error.response?.data?.error || error.message}`);
    } finally {
      setPncpJobFiltersSaving(false);
    }
  };

  const cancelPncpSearchJob = async (jobId) => {
    if (!jobId) return;
    try {
      await axios.post(`/api/licitacoes/pncp/search/deep/${jobId}/cancel`);
      await loadPncpSearchJobs();
      if (activePncpSearchJobId === jobId && pncpJobModalOpen) {
        await openPncpSearchJob(jobId, { refreshJobs: false, openModal: true });
      }
    } catch (error) {
      console.error('Error cancelling PNCP job:', error);
    }
  };

  const deletePncpSearchJob = async (jobId) => {
    if (!jobId) return;
    if (!window.confirm('Excluir esta busca e todos os resultados salvos?')) return;
    try {
      await axios.delete(`/api/licitacoes/pncp/search/deep/${jobId}`);
      if (String(activePncpSearchJobId) === String(jobId)) {
        setActivePncpSearchJobId(null);
        setPncpJobModalOpen(false);
        setPncpSearchResults({ items: [], total: 0, pagina: 1, totalPaginas: 0, termosUsados: [], termosNegativos: [], fonteIA: null });
        try {
          localStorage.removeItem('pncp_active_search_job_id');
        } catch {}
      }
      await loadPncpSearchJobs();
    } catch (error) {
      console.error('Error deleting PNCP job:', error);
      alert(`Erro ao excluir: ${error.response?.data?.error || error.message}`);
    }
  };

  const convertPncpSearchJobToWatchlist = async (jobId) => {
    if (!jobId) return;
    const name = window.prompt('Nome da watchlist:', pncpSearchFilters.q || 'Watchlist PNCP');
    if (name === null) return;
    try {
      await axios.post(`/api/licitacoes/pncp/search/deep/${jobId}/watchlist`, { nome: name });
      await loadPncpSearchJobs();
      setLicitacaoSubview('editais_watchlist');
    } catch (error) {
      alert(`Erro: ${error.response?.data?.error || error.message}`);
    }
  };

  const addPncpCustomTerms = () => {
    const terms = splitTermsInput(pncpCustomTermInput);
    if (!terms.length) return;
    setPncpAcceptedPositiveTerms(prev => Array.from(new Set([...prev, ...terms])));
    setPncpCustomTermInput('');
  };

  const postPncpSearchJobTerms = async (jobId, payload) => {
    if (!jobId) throw new Error('Nenhuma busca selecionada.');
    try {
      return await axios.post(`/api/licitacoes/pncp/search/deep-terms/${jobId}`, payload);
    } catch (error) {
      if (error.response?.status === 404) {
        setActivePncpSearchJobId(null);
        try {
          localStorage.removeItem('pncp_active_search_job_id');
        } catch {}
        await loadPncpSearchJobs();
        throw new Error('Essa busca nao foi encontrada no backend atual. Reabra uma busca recente ou reinicie o backend local para carregar a rota nova.');
      }
      throw error;
    }
  };

  const addTermsToActivePncpJob = async () => {
    const terms = splitTermsInput(pncpActiveJobTermInput);
    if (!activePncpSearchJobId || !terms.length) return;
    try {
      await postPncpSearchJobTerms(activePncpSearchJobId, { terms });
      setPncpActiveJobTermInput('');
      await openPncpSearchJob(activePncpSearchJobId);
    } catch (error) {
      alert(`Erro: ${error.response?.data?.error || error.message}`);
    }
  };

  const runPncpSearch = async (page = 1, overrides = {}) => {
    setPncpSearchLoading(true);
    const effectiveFilters = { ...pncpSearchFilters, ...overrides };
    let startedJob = false;
    try {
      const response = await axios.post('/api/licitacoes/pncp/search/deep-start', {
        filters: {
          q: effectiveFilters.q,
          tipos_documento: effectiveFilters.tipos_documento,
          status: effectiveFilters.status,
          modalidade_licitacao_id: effectiveFilters.modalidade_licitacao_id || undefined,
          semantic: 'true',
          negative_terms: effectiveFilters.negative_terms || undefined,
          tipo_id: effectiveFilters.tipo_id || undefined,
          modo_disputa_id: effectiveFilters.modo_disputa_id || undefined,
          uf: effectiveFilters.uf || undefined,
          esfera_id: effectiveFilters.esfera_id || undefined,
          orgao_cnpj: effectiveFilters.orgao_cnpj || (String(pncpOrgaoLookupQuery || '').trim().length >= 2 ? pncpOrgaoLookupQuery : undefined),
          unidade_codigo: effectiveFilters.unidade_codigo || (String(pncpUasgLookupQuery || '').trim().length >= 2 ? pncpUasgLookupQuery : undefined),
          ordenacao: effectiveFilters.ordenacao,
          usar_ia: effectiveFilters.usar_ia ? 'true' : 'false',
        },
        terms: [effectiveFilters.q, ...pncpAcceptedPositiveTerms].filter(Boolean),
        accepted_positive_terms: pncpAcceptedPositiveTerms,
        accepted_negative_terms: pncpAcceptedNegativeTerms,
        suggested_positive_terms: pncpSuggestedTerms.positivos || [],
        suggested_negative_terms: pncpSuggestedTerms.negativos || [],
      });
      const jobId = response.data?.job_id;
      startedJob = Boolean(jobId);
      setActivePncpSearchJobId(jobId || null);
      if (jobId) {
        try {
          localStorage.setItem('pncp_active_search_job_id', jobId);
        } catch {}
      }
      if (jobId) {
        const optimisticJob = {
          id: jobId,
          nome: effectiveFilters.q || 'Busca PNCP',
          status: response.data?.reused ? response.data.status || 'queued' : 'queued',
          filters: effectiveFilters,
          terms: [effectiveFilters.q, ...pncpAcceptedPositiveTerms].filter(Boolean),
          negative_terms: pncpAcceptedNegativeTerms,
          progress: {
            current_term: '',
            terms_done: 0,
            terms_total: [effectiveFilters.q, ...pncpAcceptedPositiveTerms].filter(Boolean).length,
            items_collected: 0,
          },
          total: 0,
          updated_at: new Date().toISOString(),
        };
        setPncpSearchJobs(prev => [optimisticJob, ...prev.filter(job => String(job.id) !== String(jobId))].slice(0, 20));
      }
      setPncpResultScope('all');
      setShowPncpHidden(false);
      await loadPncpSearchJobs();
      if (jobId) {
        setTimeout(() => openPncpSearchJob(jobId, { openModal: true }), response.data?.reused ? 100 : 600);
      }
    } catch (error) {
      console.error('Error searching PNCP:', error);
      setPncpSearchLoading(false);
    } finally {
      if (!startedJob) setPncpSearchLoading(false);
    }
  };

  const runPncpOutcomeSearch = async (page = 1, overrides = {}) => {
    setPncpOutcomeLoading(true);
    setPncpOutcomeError('');
    const effectiveFilters = { ...pncpOutcomeFilters, ...overrides };
    try {
      const response = await axios.get('/api/licitacoes/pncp/resultados/search', {
        params: {
          q: effectiveFilters.q || undefined,
          fornecedor: effectiveFilters.fornecedor || undefined,
          fornecedor_ni: effectiveFilters.fornecedor_ni || undefined,
          orgao_cnpj: effectiveFilters.orgao_cnpj || undefined,
          uf: effectiveFilters.uf || undefined,
          tipo: effectiveFilters.tipo || 'todos',
          pagina: page,
          tam: 20,
          refresh: page === 1 ? 'true' : undefined,
        },
      });
      setPncpOutcomeResults(response.data || { items: [], total: 0, pagina: 1, totalPaginas: 1, summary: null });
    } catch (error) {
      console.error('Error searching PNCP outcomes:', error);
      setPncpOutcomeError(error.response?.data?.error || error.message || 'Erro ao buscar resultados/contratos PNCP.');
      setPncpOutcomeResults({ items: [], total: 0, pagina: 1, totalPaginas: 1, summary: null });
    } finally {
      setPncpOutcomeLoading(false);
    }
  };

  const openPncpOutcomeDossier = async (item) => {
    const cnpj = String(item?.orgao_cnpj || '').replace(/\D/g, '');
    const ano = String(item?.ano || '').trim();
    const sequencial = String(item?.sequencial || '').trim();
    if (!cnpj || !ano || !sequencial) return;
    setPncpOutcomeDossierLoading(true);
    try {
      const response = await axios.get(`/api/licitacoes/pncp/compra/${cnpj}/${ano}/${sequencial}/dossier`, {
        params: { q: pncpOutcomeFilters.q || undefined },
      });
      setPncpOutcomeDossier(response.data);
    } catch (error) {
      console.error('Error loading PNCP dossier:', error);
    } finally {
      setPncpOutcomeDossierLoading(false);
    }
  };

  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Licitações') return;
    loadPncpSearchJobs();
  }, [authStatus.authenticated, activeView]);

  useEffect(() => {
    try {
      if (activePncpSearchJobId) {
        localStorage.setItem('pncp_active_search_job_id', activePncpSearchJobId);
      } else {
        localStorage.removeItem('pncp_active_search_job_id');
      }
    } catch {}
  }, [activePncpSearchJobId]);

  // Atualiza cards enquanto houver jobs vivos (mesmo com o popup fechado).
  useEffect(() => {
    if (!authStatus.authenticated || activeView !== 'Licitações' || licitacaoSubview !== 'editais') return;
    const hasLive = pncpSearchJobs.some(job => isPncpJobLive(job.status));
    if (!hasLive) return undefined;
    const timer = setInterval(() => {
      loadPncpSearchJobs();
    }, 4000);
    return () => clearInterval(timer);
  }, [authStatus.authenticated, activeView, licitacaoSubview, pncpSearchJobs.map(j => `${j.id}:${j.status}`).join('|')]);

  useEffect(() => {
    const q = String(pncpSearchFilters.q || '').trim();
    if (!authStatus.authenticated || q.length < 3 || !pncpSearchFilters.usar_ia) {
      setPncpSuggestedTerms({ positivos: [], negativos: [], fonte: null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPncpSuggestionLoading(true);
      try {
        const response = await axios.get('/api/licitacoes/termos-correlatos', { params: { q } });
        if (!cancelled) {
          setPncpSuggestedTerms({
            positivos: Array.isArray(response.data?.positivos) ? response.data.positivos.slice(0, 8) : [],
            negativos: Array.isArray(response.data?.negativos) ? response.data.negativos.slice(0, 8) : [],
            fonte: response.data?.fonte || null,
          });
        }
      } catch (error) {
        if (!cancelled) setPncpSuggestedTerms({ positivos: [], negativos: [], fonte: null });
      } finally {
        if (!cancelled) setPncpSuggestionLoading(false);
      }
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authStatus.authenticated, pncpSearchFilters.q, pncpSearchFilters.usar_ia]);

  useEffect(() => {
    if (!pncpJobModalOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closePncpSearchJobModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pncpJobModalOpen]);

  // Poll detalhado só com o popup aberto — resultados e progresso ao vivo.
  useEffect(() => {
    if (!activePncpSearchJobId || !pncpJobModalOpen) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const response = await axios.get(`/api/licitacoes/pncp/search/deep/${activePncpSearchJobId}`);
        if (stopped) return;
        applyPncpJobSnapshot(response.data);
        await loadPncpJobResults(activePncpSearchJobId, pncpJobResultsPage);
        setPncpSearchJobs(prev => prev.map(job => (
          String(job.id) === String(activePncpSearchJobId)
            ? {
                ...job,
                status: response.data?.status || job.status,
                progress: response.data?.progress || job.progress,
                total: Number(response.data?.total || 0),
                terms: response.data?.terms || job.terms,
                negative_terms: response.data?.negative_terms || job.negative_terms,
                filters: response.data?.filters || job.filters,
                summary: response.data?.summary || job.summary,
                error: response.data?.error || null,
              }
            : job
        )));
        const status = response.data?.status;
        if (['completed', 'failed', 'cancelled'].includes(status)) {
          setPncpSearchLoading(false);
          loadPncpSearchJobs();
          return;
        }
        setPncpSearchLoading(true);
        setTimeout(tick, status === 'paused_rate_limit' ? 15000 : 1800);
      } catch (error) {
        if (!stopped) setPncpSearchLoading(false);
      }
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [activePncpSearchJobId, pncpJobModalOpen]);

  const savePncpWatchlist = async () => {
    const term = String(pncpSearchFilters.q || '').trim();
    if (!term) {
      alert('Informe um termo de busca antes de salvar a watchlist.');
      return;
    }
    const name = window.prompt('Nome da watchlist de editais:', term);
    if (name === null) return;
    const whatsappNumber = window.prompt('WhatsApp para alertas (opcional):', '');
    if (whatsappNumber === null) return;
    try {
      await axios.post('/api/licitacoes/editais/watchlist', {
        nome: name.trim() || term,
        palavras_chave: Array.from(new Set([term, ...pncpAcceptedPositiveTerms])).filter(Boolean),
        termos_negativos: Array.from(new Set([...(splitTermsInput(pncpSearchFilters.negative_terms || '')), ...pncpAcceptedNegativeTerms])).filter(Boolean),
        usar_ia: pncpSearchFilters.usar_ia,
        filtros: {
          tipos_documento: pncpSearchFilters.tipos_documento,
          status: pncpSearchFilters.status,
          modalidade_licitacao_id: pncpSearchFilters.modalidade_licitacao_id,
          tipo_id: pncpSearchFilters.tipo_id,
          modo_disputa_id: pncpSearchFilters.modo_disputa_id,
          uf: pncpSearchFilters.uf,
          esfera_id: pncpSearchFilters.esfera_id,
          orgao_cnpj: pncpSearchFilters.orgao_cnpj || pncpOrgaoLookupQuery,
          unidade_codigo: pncpSearchFilters.unidade_codigo || pncpUasgLookupQuery,
          ordenacao: pncpSearchFilters.ordenacao,
        },
        whatsapp_enabled: Boolean(whatsappNumber.trim()),
        whatsapp_number: whatsappNumber.trim() || null,
      });
      alert('Watchlist de editais salva. Ela será processada no próximo sync.');
      setLicitacaoSubview('editais_watchlist');
    } catch (error) {
      alert(`Erro: ${error.response?.data?.error || error.message}`);
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
      const pickPncpDate = (source, keys = []) => {
        for (const key of keys) {
          const value = source?.[key];
          if (value) return value;
        }
        return null;
      };

      const propostaInicio = pickPncpDate(item, [
        'data_inicio_proposta',
        'dataInicioProposta',
        'data_inicio_recebimento_proposta',
        'dataInicioRecebimentoProposta',
        'data_abertura_proposta',
        'dataAberturaProposta',
        'data_sessao',
      ]) || item.data_publicacao;

      const propostaFim = pickPncpDate(item, [
        'data_fim_proposta',
        'dataFimProposta',
        'data_envio_proposta_limite',
        'dataEnvioPropostaLimite',
        'data_fim_recebimento_proposta',
        'dataFimRecebimentoProposta',
        'data_encerramento_proposta',
        'dataEncerramentoProposta',
      ]) || item.data_fim_vigencia;
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
        data_sessao: toDateTimeLocalValue(propostaInicio),
        data_envio_proposta_limite: toDateTimeLocalValue(propostaFim),
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
          pncp_score: item.score,
          pncp_score_label: item.score_label,
          pncp_fase_lei_14133: item.legal_stage?.label,
          pncp_criterio_julgamento: item.criterio_julgamento,
          pncp_match_reasons: item.match_reasons || [],
        },
      }));
      setNewOpportunityItemsDraft(importedItemsDraft);
      setNewOpportunityItemRequirementForm({});
      setExpandedDraftChecklist({});
      setChecklistModalItemId(null);
      setIsPncpImportDraft(true);
      setNewOpportunityFormSubview('editais');
      setLicitacaoSubview('editais');
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
      console.error('Error loading licitação details:', error);
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
      console.error('Error updating licitação opportunity:', error);
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
      console.error('Error deleting licitação opportunity:', error);
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

  const channelValueData = useMemo(() => sortByValueAsc(
    overviewData.byChannel.map(item => ({
      channel: item.channel,
      value: Number(item.total_value) || 0,
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

  const historySeries = useMemo(() => buildGroupedHistorySeries(overviewData.history, historyMetric), [overviewData.history, historyMetric]);

  // Segmentação cross-filtrada: computada dos contatos em memória para que
  // selecionar UF/canal/etiqueta reduza as demais dimensões na hora.
  const segData = useMemo(() => {
    const rows = contacts.map(c => ({
      uf: String(c.custom_attributes?.Estado || '').toUpperCase().trim(),
      channel: String(c.custom_attributes?.Canal || '').trim(),
      labels: Array.isArray(c.labels) ? c.labels.map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : [],
      value: parseCurrency(c.custom_attributes?.Valor_Oportunidade) || 0,
    }));
    const match = (r, dims) => (!dims.uf || r.uf === dims.uf)
      && (!dims.channel || r.channel === dims.channel)
      && (!dims.label || r.labels.includes(dims.label));
    const agg = (list, keyFn) => {
      const map = new Map();
      list.forEach(r => {
        const keys = keyFn(r);
        (Array.isArray(keys) ? keys : [keys]).forEach(k => {
          if (!k) return;
          const cur = map.get(k) || { count: 0, value: 0 };
          cur.count += 1;
          cur.value += r.value;
          map.set(k, cur);
        });
      });
      return map;
    };
    return {
      byUf: agg(rows.filter(r => match(r, { channel: segFilter.channel, label: segFilter.label })), r => r.uf),
      byChannel: agg(rows.filter(r => match(r, { uf: segFilter.uf, label: segFilter.label })), r => r.channel || 'Sem canal'),
      byLabel: agg(rows.filter(r => match(r, { uf: segFilter.uf, channel: segFilter.channel })), r => r.labels),
      active: Boolean(segFilter.uf || segFilter.channel || segFilter.label),
    };
  }, [contacts, segFilter]);

  const moveContactToStage = useCallback((contactId, targetStage) => {
    setContacts(prev => {
      const previousContacts = prev;
      const next = prev.map(contact => {
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
      });
      axios.put(`/api/contacts/${contactId}`, { Funil_Vendas: targetStage })
        .catch(error => {
          console.error('Error updating contact:', error);
          setContacts(previousContacts);
        });
      return next;
    });
  }, []);

  const sendToCustomersStage = useCallback((contactId) => {
    setActiveTab('customers');
    moveContactToStage(contactId, '18. Novos Clientes');
  }, [moveContactToStage]);

  const sendToLeadsInbox = useCallback((contactId) => {
    setActiveTab('leads');
    moveContactToStage(contactId, '1. Inbox (Novos)');
  }, [moveContactToStage]);

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
        name: response.data?.name || '',
        role: response.data?.role || 'member',
        allowedViews: response.data?.allowed_views ?? null,
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

  const reorderColumnItems = useCallback((items, getContainer, setContainer, activeId, overId, overRect, activeRect) => {
    const findContainer = (id, list) => {
      const idStr = String(id);
      if (idStr.startsWith('column:') || idStr.startsWith('licitação-column:')) {
        return idStr.replace(/^column:/, '').replace(/^licitação-column:/, '');
      }
      const item = list.find((entry) => String(getContainer.idOf(entry)) === idStr);
      return item ? getContainer.of(item) : null;
    };

    const activeContainer = findContainer(activeId, items);
    const overContainer = findContainer(overId, items);
    if (!activeContainer || !overContainer) {
      return items;
    }

    const activeIndex = items.findIndex((entry) => String(getContainer.idOf(entry)) === String(activeId));
    if (activeIndex < 0) {
      return items;
    }

    const isOverColumnShell = String(overId).startsWith('column:') || String(overId).startsWith('licitação-column:');

    if (activeContainer === overContainer) {
      if (isOverColumnShell) {
        return items;
      }
      const columnIds = items
        .filter((entry) => getContainer.of(entry) === activeContainer)
        .map((entry) => String(getContainer.idOf(entry)));
      const oldColIndex = columnIds.indexOf(String(activeId));
      const newColIndex = columnIds.indexOf(String(overId));
      if (oldColIndex < 0 || newColIndex < 0 || oldColIndex === newColIndex) {
        return items;
      }
      const nextColumnIds = arrayMove(columnIds, oldColIndex, newColIndex);
      const byId = new Map(items.map((entry) => [String(getContainer.idOf(entry)), entry]));
      let cursor = 0;
      return items.map((entry) => {
        if (getContainer.of(entry) === activeContainer) {
          return byId.get(nextColumnIds[cursor++]);
        }
        return entry;
      });
    }

    // Cross-column: move item into target column near the hovered card.
    const moving = setContainer(items[activeIndex], overContainer);
    const without = items.filter((_, index) => index !== activeIndex);

    let insertIndex;
    if (isOverColumnShell) {
      let lastInColumn = -1;
      without.forEach((entry, index) => {
        if (getContainer.of(entry) === overContainer) {
          lastInColumn = index;
        }
      });
      insertIndex = lastInColumn === -1 ? without.length : lastInColumn + 1;
    } else {
      const overIndex = without.findIndex((entry) => String(getContainer.idOf(entry)) === String(overId));
      if (overIndex < 0) {
        return items;
      }
      const isBelowOverItem = Boolean(
        activeRect?.translated
        && overRect
        && activeRect.translated.top > overRect.top + overRect.height / 2
      );
      insertIndex = overIndex + (isBelowOverItem ? 1 : 0);
    }

    const next = [...without];
    next.splice(insertIndex, 0, moving);
    return next;
  }, []);

  const handleDragOver = useCallback((event) => {
    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) {
      return;
    }

    // Same-column gap is handled by verticalListSortingStrategy (no React state).
    // Only commit state when the card crosses into another column — keeps drag smooth.
    // Prefer sortable data.columnId (O(1)); fall back to refs only when needed.
    const resolveContainer = (id, type, nodeData) => {
      const idStr = String(id);
      if (type === 'opp') {
        if (idStr.startsWith('licitação-column:')) return idStr.replace('licitação-column:', '');
        if (nodeData?.columnId) return nodeData.columnId;
        if (idStr.startsWith('opp:')) {
          const item = licitacaoOpportunitiesRef.current.find((entry) => `opp:${entry.id}` === idStr);
          return item?.fase || null;
        }
        return null;
      }
      if (idStr.startsWith('column:')) return idStr.replace('column:', '');
      if (nodeData?.columnId) return nodeData.columnId;
      const contact = contactsRef.current.find((entry) => String(entry.id) === idStr);
      return contact?.custom_attributes?.Funil_Vendas || null;
    };

    if (activeId.startsWith('opp:')) {
      const activeContainer = resolveContainer(activeId, 'opp', active.data?.current);
      const overContainer = resolveContainer(overId, 'opp', over.data?.current);
      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return;
      }
      const overKey = `${activeId}=>${overContainer}`;
      if (lastDragOverKeyRef.current === overKey) {
        return;
      }
      lastDragOverKeyRef.current = overKey;

      setLicitacaoOpportunities((prev) => reorderColumnItems(
        prev,
        {
          idOf: (item) => `opp:${item.id}`,
          of: (item) => item.fase,
        },
        (item, container) => ({ ...item, fase: container }),
        activeId,
        overId,
        over.rect,
        active.rect.current
      ));
      return;
    }

    const activeContainer = resolveContainer(activeId, 'contact', active.data?.current);
    const overContainer = resolveContainer(overId, 'contact', over.data?.current);
    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }
    // Key by target column (not card) so we don't re-setState on every card hover after insert.
    const overKey = `${activeId}=>${overContainer}`;
    if (lastDragOverKeyRef.current === overKey) {
      return;
    }
    lastDragOverKeyRef.current = overKey;

    setContacts((prev) => reorderColumnItems(
      prev,
      {
        idOf: (item) => String(item.id),
        of: (item) => item.custom_attributes?.Funil_Vendas,
      },
      (item, container) => ({
        ...item,
        custom_attributes: {
          ...item.custom_attributes,
          Funil_Vendas: container,
        },
      }),
      activeId,
      overId,
      over.rect,
      active.rect.current
    ));
  }, [reorderColumnItems]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    const snapshot = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    lastDragOverKeyRef.current = null;

    setActiveDragId(null);
    setDragOverlayPayload(null);
    stopDragAutoScroll();

    if (!over) {
      if (snapshot) {
        setContacts(snapshot.contacts);
        setLicitacaoOpportunities(snapshot.opportunities);
      }
      return;
    }

    const activeId = String(active.id);
    const latestOpportunities = licitacaoOpportunitiesRef.current;
    const latestContacts = contactsRef.current;

    if (activeId.startsWith('opp:')) {
      const opportunityId = activeId.replace('opp:', '');
      const overId = String(over.id);
      const originFase = snapshot?.opportunities?.find((item) => String(item.id) === String(opportunityId))?.fase;
      const current = latestOpportunities.find((item) => String(item.id) === String(opportunityId));
      const overContainer = overId.startsWith('licitação-column:')
        ? overId.replace('licitação-column:', '')
        : over.data?.current?.columnId
          || current?.fase
          || latestOpportunities.find((item) => `opp:${item.id}` === overId)?.fase;

      // Ensure final position in case last dragOver was skipped.
      setLicitacaoOpportunities((prev) => reorderColumnItems(
        prev,
        {
          idOf: (item) => `opp:${item.id}`,
          of: (item) => item.fase,
        },
        (item, container) => ({ ...item, fase: container }),
        activeId,
        overId,
        over.rect,
        active.rect.current
      ));

      if (overContainer && originFase && originFase !== overContainer) {
        axios.put(`/api/licitacoes/opportunities/${opportunityId}`, { fase: overContainer })
          .catch((error) => {
            console.error('Error moving licitação opportunity:', error);
            if (snapshot) {
              setLicitacaoOpportunities(snapshot.opportunities);
            }
          });
      }
      return;
    }

    const overId = String(over.id);
    const originStage = snapshot?.contacts?.find((c) => String(c.id) === String(active.id))?.custom_attributes?.Funil_Vendas;
    const currentContact = latestContacts.find((c) => String(c.id) === String(active.id));
    const overContainer = overId.startsWith('column:')
      ? overId.replace('column:', '')
      : over.data?.current?.columnId
        || currentContact?.custom_attributes?.Funil_Vendas
        || latestContacts.find((c) => String(c.id) === overId)?.custom_attributes?.Funil_Vendas;

    setContacts((prev) => reorderColumnItems(
      prev,
      {
        idOf: (item) => String(item.id),
        of: (item) => item.custom_attributes?.Funil_Vendas,
      },
      (item, container) => ({
        ...item,
        custom_attributes: {
          ...item.custom_attributes,
          Funil_Vendas: container,
        },
      }),
      activeId,
      overId,
      over.rect,
      active.rect.current
    ));

    if (overContainer && originStage && originStage !== overContainer) {
      axios.put(`/api/contacts/${active.id}`, { Funil_Vendas: overContainer })
        .catch((error) => {
          console.error('Error updating contact:', error);
          if (snapshot) {
            setContacts(snapshot.contacts);
          }
        });
    }
  };

  const handleDragStart = (event) => {
    const activeId = event.active?.id || null;
    setActiveDragId(activeId);
    const activeIdStr = activeId != null ? String(activeId) : '';
    if (activeIdStr.startsWith('opp:')) {
      const opportunity = licitacaoOpportunitiesRef.current.find(
        (item) => `opp:${item.id}` === activeIdStr
      );
      setDragOverlayPayload({
        type: 'opp',
        titulo: opportunity?.titulo || 'Oportunidade',
        orgao: opportunity?.orgao_nome || 'Órgão não definido',
        edital: opportunity?.numero_edital || 'n/d',
        valor: formatCurrency(opportunity?.valor_oportunidade) || 'R$ 0,00',
      });
    } else {
      const contact = contactsRef.current.find((c) => String(c.id) === activeIdStr);
      setDragOverlayPayload({ type: 'contact', contact: contact || null });
    }
    dragSnapshotRef.current = {
      contacts: contactsRef.current,
      opportunities: licitacaoOpportunitiesRef.current,
    };
    lastDragOverKeyRef.current = null;
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
    const snapshot = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    lastDragOverKeyRef.current = null;
    if (snapshot) {
      setContacts(snapshot.contacts);
      setLicitacaoOpportunities(snapshot.opportunities);
    }
    setActiveDragId(null);
    setDragOverlayPayload(null);
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
    if (!boardScrollRef.current || isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;
    if (boardScrollbarRef.current) {
      boardScrollbarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    }
    if (groupBarRef.current) {
      groupBarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const scrollBoardBy = (direction) => {
    if (!boardScrollRef.current) {
      return;
    }
    const delta = Math.max(boardScrollRef.current.clientWidth * 0.78, 320) * direction;
    boardScrollRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const syncBoardScrollPeers = useCallback(() => {
    if (!boardScrollRef.current) return;
    isSyncingRef.current = true;
    if (boardScrollbarRef.current) {
      boardScrollbarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    }
    if (groupBarRef.current) {
      groupBarRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }, []);

  /** Horizontally focus a kanban column (and optionally a card) in the board scroller. */
  const scrollBoardToColumn = useCallback((columnTitle, itemDomId = null) => {
    const board = boardScrollRef.current;
    if (!board || !columnTitle) return;

    const escapeAttr = (value) => {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(String(value));
      }
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    };

    const focusColumn = () => {
      const columnEl = board.querySelector(`[data-column-title="${escapeAttr(columnTitle)}"]`);
      if (!columnEl) return false;
      const boardRect = board.getBoundingClientRect();
      const colRect = columnEl.getBoundingClientRect();
      const padding = 20;
      let delta = 0;
      if (colRect.left < boardRect.left + padding) {
        delta = colRect.left - boardRect.left - padding;
      } else if (colRect.right > boardRect.right - padding) {
        delta = colRect.right - boardRect.right + padding;
      }
      if (Math.abs(delta) > 2) {
        board.scrollBy({ left: delta, behavior: 'smooth' });
        window.setTimeout(syncBoardScrollPeers, 80);
      } else {
        syncBoardScrollPeers();
      }
      // Vertical scroll is primarily handled by VirtualizedColumnList via focusItemId;
      // this is a best-effort fallback when the card is already mounted.
      if (itemDomId != null) {
        const cardEl = columnEl.querySelector(`[data-contact-id="${escapeAttr(itemDomId)}"]`);
        cardEl?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      return true;
    };

    // Frames + short retry: wait for filtered columns/cards to paint.
    window.requestAnimationFrame(() => {
      if (focusColumn()) return;
      window.requestAnimationFrame(() => {
        if (focusColumn()) return;
        window.setTimeout(focusColumn, 80);
      });
    });
  }, [syncBoardScrollPeers]);

  const goToBoardSearchMatch = useCallback((delta = 1) => {
    if (!boardSearchMatches.length) return;
    setBoardSearchFocusIndex((prev) => {
      const next = (prev + delta + boardSearchMatches.length) % boardSearchMatches.length;
      return next;
    });
  }, [boardSearchMatches.length]);

  const goToLicitacaoSearchMatch = useCallback((delta = 1) => {
    if (!licitacaoSearchMatches.length) return;
    setLicitacaoSearchFocusIndex((prev) => {
      const next = (prev + delta + licitacaoSearchMatches.length) % licitacaoSearchMatches.length;
      return next;
    });
  }, [licitacaoSearchMatches.length]);

  const boardSearchMatchKeyRef = useRef('');
  // Keep focus index in sync with the result set, then scroll to the active match.
  useEffect(() => {
    if (activeView !== 'Board') return;

    if (!searchQuery.trim() || boardSearchMatches.length === 0) {
      boardSearchMatchKeyRef.current = '';
      setBoardSearchFocusIndex(0);
      setFocusedSearchContactId(null);
      pendingBoardFocusContactIdRef.current = null;
      return;
    }

    const resultSetChanged = boardSearchMatchKeyRef.current !== boardSearchMatchKey;
    boardSearchMatchKeyRef.current = boardSearchMatchKey;

    let nextIndex = boardSearchFocusIndex;
    if (resultSetChanged) {
      const pendingId = pendingBoardFocusContactIdRef.current;
      pendingBoardFocusContactIdRef.current = null;
      if (pendingId != null) {
        const pendingIndex = boardSearchMatches.findIndex(
          (match) => String(match.contactId) === String(pendingId)
        );
        nextIndex = pendingIndex >= 0 ? pendingIndex : 0;
      } else {
        nextIndex = 0;
      }
      if (nextIndex !== boardSearchFocusIndex) {
        setBoardSearchFocusIndex(nextIndex);
      }
    } else {
      nextIndex = Math.min(
        Math.max(0, boardSearchFocusIndex),
        boardSearchMatches.length - 1
      );
    }

    const match = boardSearchMatches[nextIndex];
    if (!match) return;
    setFocusedSearchContactId(match.contactId);
    scrollBoardToColumn(match.column, match.contactId);
  }, [
    activeView,
    searchQuery,
    boardSearchFocusIndex,
    boardSearchMatchKey,
    boardSearchMatches,
    scrollBoardToColumn,
  ]);

  const licitacaoSearchMatchKeyRef = useRef('');
  useEffect(() => {
    if (activeView !== 'Licitações' || licitacaoSubview !== 'board') {
      return;
    }

    if (!licitacaoSearch.trim() || licitacaoSearchMatches.length === 0) {
      licitacaoSearchMatchKeyRef.current = '';
      setLicitacaoSearchFocusIndex(0);
      setFocusedSearchOpportunityId(null);
      return;
    }

    const resultSetChanged = licitacaoSearchMatchKeyRef.current !== licitacaoSearchMatchKey;
    licitacaoSearchMatchKeyRef.current = licitacaoSearchMatchKey;

    let nextIndex = licitacaoSearchFocusIndex;
    if (resultSetChanged) {
      nextIndex = 0;
      if (nextIndex !== licitacaoSearchFocusIndex) {
        setLicitacaoSearchFocusIndex(nextIndex);
      }
    } else {
      nextIndex = Math.min(
        Math.max(0, licitacaoSearchFocusIndex),
        licitacaoSearchMatches.length - 1
      );
    }

    const match = licitacaoSearchMatches[nextIndex];
    if (!match) return;
    setFocusedSearchOpportunityId(match.opportunityId);
    scrollBoardToColumn(match.column, `opp:${match.opportunityId}`);
  }, [
    activeView,
    licitacaoSubview,
    licitacaoSearch,
    licitacaoSearchFocusIndex,
    licitacaoSearchMatchKey,
    licitacaoSearchMatches,
    scrollBoardToColumn,
  ]);

  const globalSearchResults = useMemo(() => {
    const term = globalSearchQ.trim();
    if (!term || term.length < 2) return [];
    const scored = [];
    contacts.forEach((contact) => {
      if (!contactMatchesQuery(contact, term)) return;
      const stage = contact.custom_attributes?.Funil_Vendas || '';
      const isLead = leadColumns.includes(stage);
      const isCustomer = customerColumns.includes(stage);
      scored.push({
        id: contact.id,
        label: contact.company_name || contact.name || `Contato #${contact.id}`,
        sublabel: [
          contact.company_name && contact.name ? contact.name : null,
          stage || null,
          contact.agent_name ? `Agente: ${contact.agent_name}` : null,
        ].filter(Boolean).join(' · '),
        stage,
        tab: isCustomer && !isLead ? 'customers' : 'leads',
        kind: 'contact',
      });
    });
    // Prefer name starts-with, then shorter labels.
    const q = normalizeText(term);
    scored.sort((a, b) => {
      const aName = normalizeText(a.label);
      const bName = normalizeText(b.label);
      const aStart = aName.startsWith(q) ? 0 : 1;
      const bStart = bName.startsWith(q) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return aName.length - bName.length;
    });
    return scored.slice(0, 8);
  }, [globalSearchQ, contacts, leadColumns, customerColumns]);

  const openGlobalSearchResult = useCallback((result) => {
    if (!result) return;
    setGlobalSearchOpen(false);
    pendingBoardFocusContactIdRef.current = result.id;
    setActiveTab(result.tab === 'customers' ? 'customers' : 'leads');
    setActiveView('Board');
    setSearchQuery(globalSearchQ.trim() || result.label);
  }, [globalSearchQ]);

  const runGlobalSearchToRfb = useCallback(() => {
    const term = globalSearchQ.trim();
    if (!term) return;
    const isCnpj = /^[\d./-]{11,}$/.test(term);
    setRfbFilters((prev) => ({ ...prev, cnpj: isCnpj ? term : '', nome: isCnpj ? '' : term }));
    setActiveView('Busca Lead B2B');
    setRfbPendingSearch(true);
    setGlobalSearchOpen(false);
  }, [globalSearchQ]);

  const runGlobalSearchToBoard = useCallback(() => {
    const term = globalSearchQ.trim();
    if (!term) return;
    setSearchQuery(term);
    setActiveView('Board');
    setGlobalSearchOpen(false);
  }, [globalSearchQ]);

  const updateGlobalSearchPos = useCallback(() => {
    const wrap = globalSearchWrapRef.current;
    if (!wrap) {
      setGlobalSearchPos(null);
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 320), Math.min(380, window.innerWidth - 16));
    const right = Math.max(8, window.innerWidth - rect.right);
    const top = rect.bottom + 6;
    // Keep panel inside viewport height
    const maxHeight = Math.max(180, Math.min(420, window.innerHeight - top - 12));
    setGlobalSearchPos({ top, right, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!globalSearchOpen) {
      setGlobalSearchPos(null);
      return undefined;
    }
    updateGlobalSearchPos();
    const onPointerDown = (event) => {
      const target = event.target;
      const inWrap = globalSearchWrapRef.current?.contains(target);
      const inPanel = globalSearchPanelRef.current?.contains(target);
      if (!inWrap && !inPanel) {
        setGlobalSearchOpen(false);
      }
    };
    const onReposition = () => updateGlobalSearchPos();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onReposition);
    // Capture scroll from board/columns so the panel tracks the input.
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [globalSearchOpen, updateGlobalSearchPos]);

  const updateNotifPos = useCallback(() => {
    const btn = notifBtnRef.current;
    if (!btn) {
      setNotifPos(null);
      return;
    }
    const rect = btn.getBoundingClientRect();
    const pad = 8;
    const width = Math.min(320, Math.max(260, window.innerWidth - pad * 2));
    // Prefer align to button right; clamp so panel stays fully on-screen.
    let right = Math.max(pad, window.innerWidth - rect.right);
    if (right + width > window.innerWidth - pad) {
      right = pad;
    }
    const top = rect.bottom + 8;
    const maxHeight = Math.max(160, Math.min(360, window.innerHeight - top - pad));
    setNotifPos({ top, right, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!showNotifications) {
      setNotifPos(null);
      return undefined;
    }
    updateNotifPos();
    const onPointerDown = (event) => {
      const target = event.target;
      const inBtn = notifBtnRef.current?.contains(target);
      const inPanel = notifPanelRef.current?.contains(target);
      if (!inBtn && !inPanel) {
        setShowNotifications(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setShowNotifications(false);
    };
    const onReposition = () => updateNotifPos();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [showNotifications, updateNotifPos]);

  useEffect(() => {
    setGlobalSearchHighlight(0);
  }, [globalSearchQ]);

  // Only collide against the column under the pointer (+ its cards). With 17 funnel
  // stages this avoids O(all cards) work on every pointer move.
  const collisionDetectionStrategy = useCallback((args) => {
    const containers = args.droppableContainers;
    const columnContainers = [];
    const cardContainers = [];
    containers.forEach((container) => {
      const id = String(container.id);
      if (id.startsWith('column:') || id.startsWith('licitação-column:')) {
        columnContainers.push(container);
      } else {
        cardContainers.push(container);
      }
    });

    const columnHits = pointerWithin({ ...args, droppableContainers: columnContainers });
    if (columnHits.length > 0) {
      const columnId = String(columnHits[0].id);
      const columnName = columnId.startsWith('licitação-column:')
        ? columnId.replace('licitação-column:', '')
        : columnId.replace('column:', '');
      const scoped = cardContainers.filter((container) => {
        const data = container.data?.current;
        return data?.columnId === columnName;
      });
      // Include the column shell so empty columns remain droppable.
      const scopedWithColumn = [
        ...scoped,
        ...columnContainers.filter((container) => String(container.id) === columnId),
      ];
      const cardHits = pointerWithin({ ...args, droppableContainers: scoped });
      if (cardHits.length > 0) {
        return cardHits;
      }
      const cornerHits = closestCorners({ ...args, droppableContainers: scopedWithColumn });
      if (cornerHits.length > 0) {
        return cornerHits;
      }
      return columnHits;
    }

    const anyPointer = pointerWithin(args);
    if (anyPointer.length > 0) {
      const cardHits = anyPointer.filter((collision) => {
        const id = String(collision.id);
        return !id.startsWith('column:') && !id.startsWith('licitação-column:');
      });
      return cardHits.length > 0 ? cardHits : anyPointer;
    }
    return closestCorners(args);
  }, []);

  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const isAuthLoading = !authStatus.checked;
  const showLogin = authStatus.checked && !authStatus.authenticated;

  const appNavGroups = useMemo(() => ([
    {
      label: 'Workspace',
      items: [
        { name: 'Gestão de Leads', view: 'Overview', icon: QueueListIcon },
        { name: 'Funil', view: 'Board', icon: ViewColumnsIcon, badge: openFunnelLeadCount, badgeLabel: 'leads nas etapas abertas (1–12)' },
        { name: 'Metas e Resultados', view: 'Metas', icon: PresentationChartBarIcon, adminOnly: true },
        { name: 'Processo', view: 'Processo', icon: BookOpenIcon },
      ],
    },
    {
      label: 'Prospecção',
      items: [
        { name: 'Busca de leads', view: 'Busca Lead B2B', icon: MagnifyingGlassIcon },
        { name: 'Disparo WhatsApp', view: 'Disparo WhatsApp', icon: ChatBubbleLeftRightIcon },
      ],
    },
    {
      label: 'Licitações',
      items: [
        { name: 'Resumo', view: 'Licitações', sub: 'overview', icon: ScaleIcon },
        { name: 'Busca Editais', view: 'Licitações', sub: 'editais', icon: MagnifyingGlassIcon, badge: editalNewSignalsCount > 0 ? editalNewSignalsCount : null, badgeLabel: 'sinais novos das watchlists' },
        { name: 'Pipeline', view: 'Licitações', sub: 'board', icon: ViewColumnsIcon, badge: operationalLicitacaoCount, badgeLabel: 'oportunidades nas fases operacionais (2–12)' },
        { name: 'Contratos/Resultados', view: 'Licitações', sub: 'resultados', icon: BanknotesIcon },
        { name: 'PCA', view: 'Licitações', sub: 'pca', icon: ViewfinderCircleIcon },
      ],
    },
    {
      label: 'Administração',
      adminOnly: true,
      items: [
        { name: 'Usuários', view: 'Usuários', icon: UsersIcon, adminOnly: true },
        { name: 'Definir Metas', view: 'Definir Metas', icon: PresentationChartBarIcon, adminOnly: true },
      ],
    },
  ]), [openFunnelLeadCount, editalNewSignalsCount, operationalLicitacaoCount]);

  const navigateApp = useCallback((view, sub) => {
    setActiveView(view);
    if (sub) setLicitacaoSubview(sub);
    setMobileNavOpen(false);
    setShowNotifications(false);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  const processNavItems = useMemo(() => {
    const q = processQuery.trim().toLowerCase();
    if (!q) return processBlueprint.map;
    return processBlueprint.map.filter((item) => item.title.toLowerCase().includes(q));
  }, [processQuery]);

  const scrollToProcessSection = (id) => {
    setProcessActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const ProcessSection = ({ id, children }) => {
    const isActive = processActiveSection === id;
    return (
      <section
        id={id}
        className={`scroll-mt-3 rounded-[16px] border border-line bg-surf p-4 lg:p-5 ${
          isActive ? 'border-primary/25' : ''
        } dark:bg-[#141a28] dark:border-[#232c40]`}
      >
        {children}
      </section>
    );
  };

  const ProcessSectionHeader = ({ kicker, title, hint, right }) => (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        {kicker && (
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2">{kicker}</p>
        )}
        {title && <h3 className="mt-0.5 text-[15px] font-semibold text-ink">{title}</h3>}
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );

  const processPanel = 'rounded-[12px] border border-line bg-bg2 px-3 py-2.5 dark:bg-[#0e1220]';

  return (
      <DndContext
        sensors={dndSensors}
        collisionDetection={collisionDetectionStrategy}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.WhileDragging,
          },
        }}
        autoScroll={{
          // Vertical scroll inside fat columns (Inbox) + horizontal board scroll.
          threshold: { x: 0.18, y: 0.18 },
          acceleration: 12,
        }}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {isAuthLoading && (
        <div className="min-h-screen bg-bg text-ink relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_420px_at_8%_-4%,rgba(124,92,255,.16),transparent_60%),radial-gradient(560px_420px_at_100%_0%,rgba(56,214,230,.10),transparent_55%)]" />
          <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
            <div className={`${card} w-full p-8 text-center`}>
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-[11px] bg-[linear-gradient(135deg,#7c5cff,#38d6e6)]">
                <span className="font-display text-lg font-bold text-bg">A</span>
              </div>
              <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-muted2">Aerion Command</p>
              <p className="mt-3 font-display text-xl font-semibold text-ink">Verificando acesso…</p>
              <p className="mt-2 text-sm text-muted">Aguarde um momento.</p>
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <div className="min-h-screen bg-bg text-ink relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_420px_at_8%_-4%,rgba(124,92,255,.16),transparent_60%),radial-gradient(560px_420px_at_100%_0%,rgba(56,214,230,.10),transparent_55%)]" />
          <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-12 md:px-6">
            <div className="grid w-full gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-7">
                <div className="flex items-start gap-4">
                  <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-line bg-surf p-2">
                    <img
                      src="/logo_aerion.png"
                      alt="Aerion Technologies"
                      className="logo-image h-full w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted2">
                      Aerion · Sales Command
                    </p>
                    <h1 className="mt-1.5 font-display text-[32px] font-semibold leading-tight tracking-[-0.02em] text-ink md:text-[36px]">
                      Painel comercial
                    </h1>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
                      Acompanhe funil, processos e indicadores em um único lugar.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      icon: QueueListIcon,
                      kicker: 'Visão integrada',
                      title: 'Leads, clientes e handoff',
                      hint: 'Tudo sincronizado com o Chatwoot.',
                    },
                    {
                      icon: BookOpenIcon,
                      kicker: 'Ritmo comercial',
                      title: 'Resumo de processos e rituais',
                      hint: 'Guia prático para o time.',
                    },
                    {
                      icon: ChartBarIcon,
                      kicker: 'Análise rápida',
                      title: 'Distribuição e valor por etapa',
                      hint: 'Decisões baseadas em dados.',
                    },
                    {
                      icon: CheckBadgeIcon,
                      kicker: 'Segurança',
                      title: 'Acesso restrito',
                      hint: 'Credenciais internas apenas.',
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.kicker}
                        className="rounded-[16px] border border-line bg-surf p-4 transition hover:border-line2 hover:bg-surf2"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted2">
                            {item.kicker}
                          </p>
                        </div>
                        <p className="mt-2.5 text-[13px] font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{item.hint}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[16px] border border-line bg-surf p-6 md:p-8">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] text-muted2">Acesso</p>
                <h2 className="mt-1.5 font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
                  Entrar no dashboard
                </h2>
                <p className="mt-1.5 text-sm text-muted">Use seu e-mail comercial.</p>
                <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2" htmlFor="login-email">
                      E-mail
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      required
                      value={loginForm.email}
                      onChange={(event) => setLoginForm(prev => ({ ...prev, email: event.target.value }))}
                      className={`${input} h-11 w-full`}
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2" htmlFor="login-password">
                      Senha
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={loginForm.password}
                      onChange={(event) => setLoginForm(prev => ({ ...prev, password: event.target.value }))}
                      className={`${input} h-11 w-full`}
                      placeholder="Digite sua senha"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loginLoading}
                    className={`${btnPrimary} h-11 w-full`}
                  >
                    {loginLoading ? 'Entrando…' : 'Entrar'}
                  </button>
                </form>
                {loginError && (
                  <div className="mt-4 rounded-[11px] border border-red/30 bg-red/10 px-3 py-2 text-xs text-red" role="alert">
                    {loginError}
                  </div>
                )}
                <div className="mt-6 rounded-[12px] border border-line bg-bg2 px-4 py-3 text-xs leading-relaxed text-muted">
                  Acesso exclusivo para equipe Aerion. Caso não consiga entrar, confirme suas credenciais.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {authStatus.authenticated && (
        <div className="app-shell flex h-dvh max-h-dvh overflow-hidden bg-surface text-ink pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          {(() => {
            const renderNavGroups = (onPick) => (
              <nav className="space-y-5">
                {appNavGroups.filter(group => !group.adminOnly || authStatus.role === 'admin').map(group => {
                  const groupItems = group.items.filter(item => {
                    if (item.adminOnly) return authStatus.role === 'admin';
                    if (authStatus.role === 'admin') return true;
                    const av = authStatus.allowedViews;
                    if (!av || av.length === 0) return true;
                    return av.includes(item.view);
                  });
                  if (!groupItems.length) return null;
                  return (
                    <div key={group.label} className="space-y-1">
                      <p className="px-3 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] text-muted2">{group.label}</p>
                      {groupItems.map(item => {
                        const active = item.sub
                          ? activeView === item.view && (
                            licitacaoSubview === item.sub
                            || (item.sub === 'editais' && licitacaoSubview === 'editais_watchlist')
                            || (item.sub === 'pca' && licitacaoSubview === 'sinais')
                          )
                          : activeView === item.view && (item.view !== 'Licitações');
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => onPick(item.view, item.sub)}
                            className={`group relative flex min-h-[44px] h-[39px] w-full items-center gap-3 rounded-[11px] px-3 text-[13px] transition ${active ? 'bg-[linear-gradient(135deg,rgba(124,92,255,.22),rgba(56,214,230,.10))] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(124,92,255,.45),0_0_0_1px_rgba(238,241,248,.28)]' : 'font-medium text-muted hover:bg-white/[0.04] hover:text-white'}`}
                          >
                            <Icon className={`h-[18px] w-[18px] shrink-0 transition ${active ? 'text-white' : 'text-muted group-hover:text-[#cbd2dd]'}`} />
                            <span className="min-w-0 truncate">{item.name}</span>
                            {item.badge !== null && item.badge !== undefined && (
                              <span
                                className={`ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold ${active ? 'bg-primary/30 text-[#cbbcff]' : 'bg-surf text-muted2'}`}
                                title={`${item.badge} ${item.badgeLabel || ''}`.trim()}
                                aria-label={`${item.badge} ${item.badgeLabel || ''}`.trim()}
                              >
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
            );

            const userFooter = (
              <div className="shrink-0 border-t border-line p-3">
                <div className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffb24d,#ff5d72)] font-display text-sm font-bold text-white">
                    {(authStatus.name || authStatus.email || 'A').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{authStatus.name || 'Aerion'}</p>
                    <p className="truncate text-[11px] text-muted" title={authStatus.email}>{authStatus.email || (authStatus.role === 'admin' ? 'Administrador' : 'Operação comercial')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Sair"
                    aria-label="Sair"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surf2 hover:text-red"
                  >
                    <ArrowRightOnRectangleIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );

            return (
              <>
          <aside className="hidden md:flex w-[248px] shrink-0 h-full flex-col bg-bg2 border-r border-line text-muted">
            <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
              <img
                src="/logo_aerion.png"
                alt="Aerion Technologies"
                className="h-9 w-auto object-contain [filter:brightness(0)_invert(1)] opacity-95"
              />
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted2">SALES COMMAND</p>
            </div>
            <VerticalScrollArrows
              className="flex-1 px-3 py-2"
              contentClassName="space-y-6 py-3"
              remeasureKey={authStatus.role}
            >
              {renderNavGroups((view, sub) => navigateApp(view, sub))}
            </VerticalScrollArrows>
            {userFooter}
          </aside>

          {mobileNavOpen && createPortal(
            <div className="fixed inset-0 z-overlay md:hidden" role="dialog" aria-modal="true" aria-label="Menu de navegação">
              <button
                type="button"
                className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
                aria-label="Fechar menu"
                onClick={() => setMobileNavOpen(false)}
              />
              <aside className="absolute inset-y-0 left-0 flex w-[min(19.5rem,calc(100vw-2.75rem))] max-w-full flex-col border-r border-line bg-bg2 text-muted shadow-[12px_0_40px_rgba(0,0,0,.45)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img src="/logo_aerion.png" alt="Aerion" className="h-7 w-auto object-contain [filter:brightness(0)_invert(1)] opacity-95" />
                    <p className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-muted2">Menu</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    className={`${iconBtn} h-10 w-10 border border-line bg-bg`}
                    aria-label="Fechar menu"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <VerticalScrollArrows
                  className="min-h-0 flex-1 px-2.5 py-2"
                  contentClassName="space-y-5 py-2"
                  remeasureKey={`${authStatus.role}:${mobileNavOpen}`}
                >
                  {renderNavGroups((view, sub) => navigateApp(view, sub))}
                </VerticalScrollArrows>
                {userFooter}
              </aside>
            </div>,
            document.body
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="shrink-0 px-3 sm:px-4 md:px-6 lg:px-8">
              <div className={`z-header flex min-h-14 sm:min-h-16 items-center justify-between gap-2 sm:gap-3 border-b border-line bg-bg/80 backdrop-blur-[14px] overflow-visible py-2 ${globalSearchOpen ? 'z-overlay' : ''}`}>
                <div className="min-w-0 flex items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    className={`${iconBtn} h-10 w-10 shrink-0 border border-line bg-bg2 md:hidden`}
                    aria-label="Abrir menu"
                    aria-expanded={mobileNavOpen}
                    onClick={() => {
                      setShowNotifications(false);
                      setMobileNavOpen(true);
                    }}
                  >
                    <Bars3Icon className="h-5 w-5" />
                  </button>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.13em] text-muted leading-none truncate">
                      {activeView === 'Licitações'
                        ? `Aerion / Licitações / ${licSubLabel(licitacaoSubview)}`
                        : `Aerion / ${viewLabel(activeView)}`}
                    </p>
                    <h1 className="font-display text-[17px] sm:text-[19px] md:text-[21px] font-semibold leading-tight truncate mt-1">
                      {activeView === 'Licitações'
                        ? `Licitações — ${licSubLabel(licitacaoSubview)}`
                        : viewLabel(activeView)}
                    </h1>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                  <div ref={globalSearchWrapRef} className="relative hidden md:block w-[min(100vw-12rem,320px)]">
                    <div className="relative flex h-9 w-full items-center rounded-xl border border-line bg-bg2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/30">
                      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
                      <input
                        type="search"
                        placeholder="Buscar no CRM, funil ou CNPJ…"
                        value={globalSearchQ}
                        onChange={(event) => {
                          setGlobalSearchQ(event.target.value);
                          setGlobalSearchOpen(true);
                        }}
                        onFocus={() => setGlobalSearchOpen(true)}
                        onKeyDown={(event) => {
                          const term = globalSearchQ.trim();
                          const optionCount = globalSearchResults.length + 2; // contacts + funil + RFB
                          if (event.key === 'Escape') {
                            setGlobalSearchOpen(false);
                            event.currentTarget.blur();
                            return;
                          }
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setGlobalSearchOpen(true);
                            setGlobalSearchHighlight((prev) => (prev + 1) % Math.max(optionCount, 1));
                            return;
                          }
                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setGlobalSearchOpen(true);
                            setGlobalSearchHighlight((prev) => (prev - 1 + Math.max(optionCount, 1)) % Math.max(optionCount, 1));
                            return;
                          }
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          if (!term) return;
                          if (globalSearchResults.length && globalSearchHighlight < globalSearchResults.length) {
                            openGlobalSearchResult(globalSearchResults[globalSearchHighlight]);
                            return;
                          }
                          if (globalSearchHighlight === globalSearchResults.length) {
                            runGlobalSearchToBoard();
                            return;
                          }
                          // Default / last option: RFB (also when no pipeline hits).
                          runGlobalSearchToRfb();
                        }}
                        className="h-full w-full rounded-xl bg-transparent pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted"
                        aria-label="Busca global"
                        aria-expanded={globalSearchOpen}
                        aria-controls="global-search-results"
                        autoComplete="off"
                      />
                    </div>
                    {globalSearchOpen
                      && globalSearchQ.trim().length >= 2
                      && globalSearchPos
                      && createPortal(
                        <div
                          ref={globalSearchPanelRef}
                          id="global-search-results"
                          role="listbox"
                          style={{
                            position: 'fixed',
                            top: globalSearchPos.top,
                            right: globalSearchPos.right,
                            width: globalSearchPos.width,
                            maxHeight: globalSearchPos.maxHeight,
                            zIndex: 50,
                          }}
                          className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surf shadow-[0_18px_48px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.04)]"
                        >
                          <p className="shrink-0 bg-surf px-3 pt-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted2">
                            Resultados
                          </p>
                          {globalSearchResults.length === 0 ? (
                            <p className="bg-surf px-3 pb-2 text-xs text-muted">Nenhum lead no funil com esse termo.</p>
                          ) : (
                            <VerticalScrollArrows
                              className="min-h-0 flex-1 bg-surf"
                              contentClassName="py-1"
                              remeasureKey={globalSearchResults.length}
                              style={{ maxHeight: Math.max(120, (globalSearchPos.maxHeight || 360) - 120) }}
                            >
                              <ul role="presentation">
                                {globalSearchResults.map((result, index) => (
                                  <li key={`gs-${result.id}`}>
                                    <button
                                      type="button"
                                      role="option"
                                      aria-selected={globalSearchHighlight === index}
                                      onMouseEnter={() => setGlobalSearchHighlight(index)}
                                      onClick={() => openGlobalSearchResult(result)}
                                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition ${globalSearchHighlight === index ? 'bg-primary/15 text-ink' : 'text-ink hover:bg-surf2'}`}
                                    >
                                      <span className="truncate text-[13px] font-semibold">{result.label}</span>
                                      {result.sublabel && (
                                        <span className="truncate text-[11px] text-muted">{result.sublabel}</span>
                                      )}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </VerticalScrollArrows>
                          )}
                          <div className="shrink-0 border-t border-line bg-surf p-1.5">
                            <button
                              type="button"
                              role="option"
                              aria-selected={globalSearchHighlight === globalSearchResults.length}
                              onMouseEnter={() => setGlobalSearchHighlight(globalSearchResults.length)}
                              onClick={runGlobalSearchToBoard}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${globalSearchHighlight === globalSearchResults.length ? 'bg-primary/15 text-ink' : 'text-ink hover:bg-surf2'}`}
                            >
                              <ViewColumnsIcon className="h-4 w-4 shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate">
                                Buscar no funil <span className="text-muted">“{globalSearchQ.trim()}”</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={globalSearchHighlight === globalSearchResults.length + 1}
                              onMouseEnter={() => setGlobalSearchHighlight(globalSearchResults.length + 1)}
                              onClick={runGlobalSearchToRfb}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${globalSearchHighlight === globalSearchResults.length + 1 ? 'bg-primary/15 text-ink' : 'text-ink hover:bg-surf2'}`}
                            >
                              <DocumentMagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate">
                                {/^[\d./-]{11,}$/.test(globalSearchQ.trim())
                                  ? 'Consultar CNPJ na Receita'
                                  : 'Buscar empresa na Receita (B2B)'}
                              </span>
                            </button>
                          </div>
                        </div>,
                        document.body
                      )}
                  </div>
                  {(() => {
                    const overdue = Number(licSummary?.overdue_count) || 0;
                    const due48 = Number(licSummary?.due_48h) || 0;
                    const doneJobs = pncpSearchJobs.filter(j => j.status === 'completed').slice(0, 3);
                    const notifCount = (overdue ? 1 : 0) + (due48 ? 1 : 0) + doneJobs.length;
                    return (
                      <>
                        <button
                          ref={notifBtnRef}
                          type="button"
                          onClick={() => {
                            setMobileNavOpen(false);
                            setGlobalSearchOpen(false);
                            setShowNotifications(v => !v);
                          }}
                          className={`${iconBtn} relative h-10 w-10 shrink-0 border border-line bg-bg2 ${showNotifications ? 'text-ink ring-2 ring-primary/25' : ''}`}
                          aria-label="Notificações"
                          aria-expanded={showNotifications}
                          aria-controls="notifications-panel"
                        >
                          <BellIcon className="h-[18px] w-[18px]" />
                          {(overdue > 0 || due48 > 0) && (
                            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red ring-2 ring-bg2" />
                          )}
                        </button>
                        {showNotifications
                          && notifPos
                          && createPortal(
                            <div
                              ref={notifPanelRef}
                              id="notifications-panel"
                              role="menu"
                              aria-label="Notificações"
                              style={{
                                position: 'fixed',
                                top: notifPos.top,
                                right: notifPos.right,
                                width: notifPos.width,
                                maxHeight: notifPos.maxHeight,
                                zIndex: 50,
                              }}
                              className="flex flex-col overflow-hidden rounded-[15px] border border-line bg-surf p-2 shadow-[0_18px_48px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.04)]"
                            >
                              <p className="shrink-0 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted2">
                                Notificações
                              </p>
                              <VerticalScrollArrows
                                className="min-h-0 flex-1"
                                remeasureKey={notifCount}
                                style={{ maxHeight: Math.max(100, (notifPos.maxHeight || 280) - 40) }}
                              >
                                {notifCount === 0 && (
                                  <p className="px-2 pb-2 text-xs text-muted">Nada urgente por aqui.</p>
                                )}
                                {overdue > 0 && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setShowNotifications(false); setActiveView('Licitações'); setLicitacaoSubview('overview'); }}
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-ink hover:bg-surf2"
                                  >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red/15 font-mono text-xs font-bold text-red">{overdue}</span>
                                    <span className="min-w-0 flex-1 leading-snug">licitações atrasadas exigem ação</span>
                                  </button>
                                )}
                                {due48 > 0 && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setShowNotifications(false); setActiveView('Licitações'); setLicitacaoSubview('overview'); }}
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-ink hover:bg-surf2"
                                  >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber/15 font-mono text-xs font-bold text-amber">{due48}</span>
                                    <span className="min-w-0 flex-1 leading-snug">vencendo nas próximas 48h</span>
                                  </button>
                                )}
                                {doneJobs.map(job => (
                                  <button
                                    key={job.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setShowNotifications(false); setActiveView('Licitações'); setLicitacaoSubview('editais'); openPncpSearchJob(job.id); }}
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-ink hover:bg-surf2"
                                  >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-green/15 font-mono text-[10px] font-bold text-green">✓</span>
                                    <span className="min-w-0 flex-1 truncate">
                                      Busca <span className="font-display font-semibold uppercase tracking-wide">"{job.nome || job.filters?.q || 'PNCP'}"</span>
                                      {' '}concluída · {Number(job.total || 0).toLocaleString('pt-BR')} resultados
                                    </span>
                                  </button>
                                ))}
                              </VerticalScrollArrows>
                            </div>,
                            document.body
                          )}
                      </>
                    );
                  })()}
                  <a
                    href="https://chatwoot.tenryu.com.br/app/accounts/2/contacts"
                    target="_blank"
                    rel="noreferrer"
                    className={`${btnPrimary} h-10 shrink-0 px-2.5 sm:px-3 gap-1.5`}
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">Novo lead</span>
                  </a>
                </div>
              </div>

              {activeView === 'Board' && (
                <div className="mt-4 sm:mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
                  <div className="relative w-full md:max-w-md min-w-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-muted">
                      <MagnifyingGlassIcon className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar empresas, contatos, tags, CNPJ…"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (!searchQuery.trim() || boardSearchMatches.length === 0) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          goToBoardSearchMatch(event.shiftKey ? -1 : 1);
                        } else if (event.key === 'F3') {
                          event.preventDefault();
                          goToBoardSearchMatch(event.shiftKey ? -1 : 1);
                        }
                      }}
                      className={`${input} w-full pl-9 ${searchQuery.trim() ? 'pr-[9.5rem]' : 'pr-3'}`}
                      aria-label="Buscar no funil"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {searchQuery.trim() && (
                      <div className="absolute right-1 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-bg2/95 pl-1 dark:bg-[#0e1220]/95">
                        <span className="min-w-[2.25rem] px-1 text-center font-mono text-[11px] tabular-nums text-muted" aria-live="polite">
                          {boardSearchMatches.length === 0
                            ? '0'
                            : `${Math.min(boardSearchFocusIndex, boardSearchMatches.length - 1) + 1}/${boardSearchMatches.length}`}
                        </span>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          disabled={boardSearchMatches.length === 0}
                          onClick={() => goToBoardSearchMatch(-1)}
                          aria-label="Resultado anterior"
                          title="Anterior (Shift+Enter)"
                        >
                          <ChevronLeftIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          disabled={boardSearchMatches.length === 0}
                          onClick={() => goToBoardSearchMatch(1)}
                          aria-label="Próximo resultado"
                          title="Próximo (Enter)"
                        >
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          onClick={() => {
                            setSearchQuery('');
                            setFocusedSearchContactId(null);
                            setBoardSearchFocusIndex(0);
                          }}
                          aria-label="Limpar busca"
                          title="Limpar"
                        >
                          <XMarkIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <select
                      value={priorityFilter}
                      onChange={(event) => setPriorityFilter(event.target.value)}
                      className={`${select} min-w-0 flex-1 sm:flex-none sm:min-w-[9.5rem]`}
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
                      className={`${select} min-w-0 flex-1 sm:flex-none sm:min-w-[9.5rem]`}
                    >
                      <option value="all">Todos agentes</option>
                      {agentOptions.map(agent => (
                        <option key={agent} value={agent}>{agent}</option>
                      ))}
                    </select>
                    <select
                      value={labelFilter}
                      onChange={(event) => setLabelFilter(event.target.value)}
                      className={`${select} min-w-0 flex-1 sm:flex-none sm:min-w-[9.5rem]`}
                    >
                      <option value="all">Todas etiquetas</option>
                      {labelOptions.map(label => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>
                    <select
                      value={sortOption}
                      onChange={(event) => setSortOption(event.target.value)}
                      className={`${select} min-w-0 flex-1 sm:flex-none sm:min-w-[10.5rem]`}
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
                <div className="mt-4 sm:mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
                  <div className="relative w-full md:max-w-md min-w-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-muted">
                      <MagnifyingGlassIcon className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar órgão, UASG, edital, SEI..."
                      value={licitacaoSearch}
                      onChange={(event) => setLicitacaoSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (licitacaoSubview !== 'board') return;
                        if (!licitacaoSearch.trim() || licitacaoSearchMatches.length === 0) return;
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          goToLicitacaoSearchMatch(event.shiftKey ? -1 : 1);
                        } else if (event.key === 'F3') {
                          event.preventDefault();
                          goToLicitacaoSearchMatch(event.shiftKey ? -1 : 1);
                        }
                      }}
                      className={`${input} w-full pl-9 ${licitacaoSearch.trim() && licitacaoSubview === 'board' ? 'pr-[9.5rem]' : 'pr-3'}`}
                      aria-label="Buscar no pipe de licitações"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {licitacaoSearch.trim() && licitacaoSubview === 'board' && (
                      <div className="absolute right-1 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-bg2/95 pl-1 dark:bg-[#0e1220]/95">
                        <span className="min-w-[2.25rem] px-1 text-center font-mono text-[11px] tabular-nums text-muted" aria-live="polite">
                          {licitacaoSearchMatches.length === 0
                            ? '0'
                            : `${Math.min(licitacaoSearchFocusIndex, licitacaoSearchMatches.length - 1) + 1}/${licitacaoSearchMatches.length}`}
                        </span>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          disabled={licitacaoSearchMatches.length === 0}
                          onClick={() => goToLicitacaoSearchMatch(-1)}
                          aria-label="Resultado anterior"
                          title="Anterior (Shift+Enter)"
                        >
                          <ChevronLeftIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          disabled={licitacaoSearchMatches.length === 0}
                          onClick={() => goToLicitacaoSearchMatch(1)}
                          aria-label="Próximo resultado"
                          title="Próximo (Enter)"
                        >
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={`${iconBtn} h-7 w-7 shrink-0`}
                          onClick={() => {
                            setLicitacaoSearch('');
                            setFocusedSearchOpportunityId(null);
                            setLicitacaoSearchFocusIndex(0);
                          }}
                          aria-label="Limpar busca"
                          title="Limpar"
                        >
                          <XMarkIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {licitacaoSearch.trim() && licitacaoSubview !== 'board' && (
                      <button
                        type="button"
                        className={`${iconBtn} absolute right-1 top-1/2 z-[1] h-7 w-7 -translate-y-1/2`}
                        onClick={() => setLicitacaoSearch('')}
                        aria-label="Limpar busca"
                        title="Limpar"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openNewOpportunityForm}
                      className={`${btnPrimary} w-full sm:w-auto`}
                    >
                      <PlusIcon className="h-4 w-4" />
                      Nova licitação
                    </button>
                  </div>
                </div>
              )}
            </header>

          <VerticalScrollArrows
            className="min-h-0 flex-1"
            contentClassName="px-3 sm:px-4 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-6 lg:px-8"
            remeasureKey={`${activeView}:${licitacaoSubview || ''}:${activeTab || ''}`}
          >
          {activeView === 'Board' && (
            <>
              <div className="mt-4 sm:mt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
                  <div className="inline-flex max-w-full items-center gap-1 rounded-xl border border-line bg-bg2 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('leads')}
                      className={`h-9 sm:h-[34px] rounded-[10px] px-3 sm:px-4 text-[12.5px] sm:text-[13px] font-semibold transition ${activeTab === 'leads' ? 'bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] text-white shadow-[0_4px_12px_rgba(124,92,255,.4)]' : 'text-muted hover:text-ink'}`}
                    >
                      Leads · SDR
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('customers')}
                      className={`h-9 sm:h-[34px] rounded-[10px] px-3 sm:px-4 text-[12.5px] sm:text-[13px] font-semibold transition ${activeTab === 'customers' ? 'bg-[#36d39a] text-white shadow-[0_4px_12px_rgba(54,211,154,.35)]' : 'text-muted hover:text-ink'}`}
                    >
                      Clientes · CS
                    </button>
                  </div>
                  <p className="hidden md:block text-[13px] text-muted">{activeTab === 'leads' ? 'Pipeline de leads · SDR' : 'Pipeline de clientes · Customer Success'}</p>
                </div>
                {(() => {
                  const boardContacts = filteredContacts.filter(c => activeColumns.includes(c.custom_attributes?.Funil_Vendas));
                  const val = boardContacts.reduce((s, c) => s + (parseCurrency(c.custom_attributes?.Valor_Oportunidade) || 0), 0);
                  return (
                    <span className="inline-flex items-center gap-2 self-start rounded-xl bg-amber/[0.16] px-3.5 py-2 font-mono text-sm font-semibold text-amber">
                      Pipeline {formatCompactCurrency(val) || 'R$ 0'}
                    </span>
                  );
                })()}
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
                      width: `calc(${s.colCount} * var(--kanban-col-w) + ${s.colCount - 1} * var(--kanban-col-gap))`,
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
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollBoardBy(-1)}
                aria-label="Rolar board para a esquerda"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg2 text-muted transition hover:bg-surf2 hover:text-ink"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <div className="kanban-scrollbar scrollbar-theme flex-1" ref={boardScrollbarRef} onScroll={handleTopScroll}>
                <div style={{ width: boardScrollMetrics.scrollWidth }} />
              </div>
              <button
                type="button"
                onClick={() => scrollBoardBy(1)}
                aria-label="Rolar board para a direita"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg2 text-muted transition hover:bg-surf2 hover:text-ink"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="relative">
            <div
              className={`kanban-board-scroll mt-2 flex gap-[var(--kanban-col-gap)] overflow-x-auto pb-4 -mx-1 px-1 ${activeDragId ? 'snap-none is-dnd-active' : 'snap-x snap-mandatory'}`}
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
                  onMoveToColumn={moveContactToStage}
                  availableColumns={activeColumns}
                  showHeaderMenu={showHeaderMenu}
                  newContactUrl={newContactUrl}
                  isDarkMode={isDarkMode}
                  activeDragId={activeDragId}
                  focusedSearchContactId={focusedSearchContactId}
                />
              ))}
            </div>
          </div>
            </>
          )}

          {activeView === 'Licitações' && (
            <>
              {licitacaoSubview === 'overview' && (
                <div className="mt-4 space-y-4">
                  {/* KPIs — faixa compacta */}
                  <div className="grid gap-2.5 sm:gap-3 grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: 'Oportunidades', value: licSummary?.opportunities_count ?? licitacaoOpportunities.length ?? 0, icon: BuildingLibraryIcon, glow: 'rgba(124,92,255,.45)', accent: 'text-primary' },
                      { label: 'Valor em aberto', value: formatCompactCurrency(licSummary?.total_value) || 'R$ 0', icon: BanknotesIcon, glow: 'rgba(255,178,77,.35)', accent: 'text-secondary' },
                      { label: 'Vencendo em 48h', value: licSummary?.due_48h ?? 0, icon: ChartBarIcon, glow: 'rgba(255,178,77,.35)', accent: 'text-status-warning' },
                      { label: 'Atrasadas', value: licSummary?.overdue_count ?? 0, icon: DocumentTextIcon, glow: 'rgba(255,93,114,.35)', accent: 'text-status-danger' },
                    ].map((kpi, i) => {
                      const Icon = kpi.icon;
                      return (
                        <div key={i} className={`${card} relative overflow-hidden px-3.5 py-3 sm:px-4 sm:py-3.5 transition hover:border-primary/30`}>
                          <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full blur-[22px] opacity-45" style={{ background: kpi.glow }} />
                          <div className="relative flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11.5px] text-muted leading-none">{kpi.label}</p>
                              <p className="mt-2 font-mono text-[22px] sm:text-[24px] font-bold tracking-[-.03em] leading-none text-ink dark:text-white truncate">{kpi.value}</p>
                            </div>
                            <Icon className={`h-4 w-4 shrink-0 opacity-80 ${kpi.accent}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Funil + rail lateral — preenche a largura sem buraco */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4 items-stretch">
                    <div className={`${card} p-3.5 sm:p-5 xl:col-span-8 flex flex-col min-h-0 min-w-0`}>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div className="min-w-0">
                          <h3 className={`${sectionTitle} text-base`}>Funil de licitações</h3>
                          <p className={`${subtle} mt-0.5`}>Fases operacionais 2 a 12</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLicitacaoSubview('board')}
                          className="text-[12.5px] text-primary font-medium hover:underline shrink-0"
                        >
                          Abrir pipeline
                        </button>
                      </div>
                      {(() => {
                        const byStage = {};
                        licitacaoOpportunities.forEach(o => {
                          const key = o.fase || o.status || 'Sem fase';
                          const stageNumber = getStageNumber(key);
                          if (stageNumber < 2 || stageNumber > 12) return;
                          if (!byStage[stageNumber]) {
                            byStage[stageNumber] = { fase: key, stageNumber, count: 0, value: 0 };
                          }
                          byStage[stageNumber].count += 1;
                          byStage[stageNumber].value += Number(o.valor_oportunidade) || 0;
                        });
                        // Sempre mostra 2–12 para o funil ocupar a coluna (sem “fases sumidas”).
                        const list = licitacaoColumns
                          .map(col => {
                            const stageNumber = getStageNumber(col);
                            if (stageNumber < 2 || stageNumber > 12) return null;
                            return byStage[stageNumber] || { fase: col, stageNumber, count: 0, value: 0 };
                          })
                          .filter(Boolean);
                        const max = Math.max(...list.map(g => g.count), 1);
                        const totalOps = list.reduce((s, g) => s + g.count, 0);
                        const macro = LIC_STAGE_GROUPS.filter(g => g.id !== 'encerrado').map(g => {
                          const stages = list.filter(s => s.stageNumber >= g.range[0] && s.stageNumber <= g.range[1]);
                          return {
                            ...g,
                            count: stages.reduce((s, x) => s + x.count, 0),
                            value: stages.reduce((s, x) => s + x.value, 0),
                          };
                        });
                        return (
                          <>
                            <div className="mb-4 grid grid-cols-3 gap-2">
                              {macro.map(g => (
                                <div
                                  key={g.id}
                                  className="rounded-[12px] border border-line bg-bg2 px-3 py-2.5 dark:bg-[#0e1220]"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: g.color }} />
                                    <p className="text-[11px] text-muted truncate">{g.label}</p>
                                  </div>
                                  <p className="mt-1 font-mono text-[17px] font-bold leading-none text-ink dark:text-white">{g.count}</p>
                                  <p className="mt-1 text-[11px] text-muted truncate">{formatCompactCurrency(g.value) || 'R$ 0'}</p>
                                </div>
                              ))}
                            </div>
                            {totalOps === 0 ? (
                              <div className={`${subtle} flex-1 flex items-center justify-center py-10 text-center`}>
                                Nenhuma oportunidade no funil operacional
                              </div>
                            ) : (
                              <div className="space-y-1.5 flex-1">
                                {list.map((g) => {
                                  const group = licGroupForStageNum(g.stageNumber);
                                  const color = group?.color || '#7b87a3';
                                  const shortName = String(g.fase).replace(/^\d+\.\s*/, '');
                                  const barPct = g.count > 0 ? Math.max((g.count / max) * 100, 4) : 0;
                                  return (
                                    <div
                                      key={g.fase}
                                      className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1 ${g.count === 0 ? 'opacity-45' : ''}`}
                                    >
                                      <span className="w-[4.5rem] sm:w-40 shrink-0 text-[12px] text-muted truncate" title={g.fase}>
                                        <span className="font-mono text-[11px] text-muted/80 mr-1">{g.stageNumber}.</span>
                                        <span className="hidden sm:inline">{shortName}</span>
                                        <span className="sm:hidden">{shortName.slice(0, 10)}{shortName.length > 10 ? '…' : ''}</span>
                                      </span>
                                      <div className="flex-1 h-[18px] rounded-md bg-bg2 dark:bg-[#0e1220] overflow-hidden border border-line/60">
                                        {barPct > 0 && (
                                          <div
                                            className="h-full rounded-md transition-[width] duration-200"
                                            style={{ width: `${barPct}%`, background: color }}
                                          />
                                        )}
                                      </div>
                                      <span className="w-7 text-right text-[12px] font-bold tabular-nums text-ink dark:text-white">{g.count}</span>
                                      <span className="w-[4.5rem] text-right text-[11.5px] text-muted tabular-nums hidden md:block">
                                        {g.count > 0 ? (formatCompactCurrency(g.value) || 'R$ 0') : '—'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <div className="xl:col-span-4 flex flex-col gap-4 min-h-0">
                      <div className={`${card} p-4`}>
                        <h3 className={`${sectionTitle} text-base mb-3`}>Prazos críticos</h3>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setLicitacaoSubview('board')}
                            className="w-full flex items-center gap-3 rounded-[12px] bg-status-danger/[0.08] border border-status-danger/20 p-2.5 text-left transition hover:bg-status-danger/[0.12]"
                          >
                            <span className="h-9 w-9 rounded-[10px] bg-status-danger/15 text-status-danger flex items-center justify-center shrink-0 font-bold text-sm tabular-nums">
                              {licSummary?.overdue_count ?? 0}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-ink dark:text-white">Atrasadas</p>
                              <p className={subtle}>Ação imediata</p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setLicitacaoSubview('board')}
                            className="w-full flex items-center gap-3 rounded-[12px] bg-status-warning/[0.08] border border-status-warning/20 p-2.5 text-left transition hover:bg-status-warning/[0.12]"
                          >
                            <span className="h-9 w-9 rounded-[10px] bg-status-warning/15 text-status-warning flex items-center justify-center shrink-0 font-bold text-sm tabular-nums">
                              {licSummary?.due_48h ?? 0}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-ink dark:text-white">Vencendo em 48h</p>
                              <p className={subtle}>Priorizar envio</p>
                            </div>
                          </button>
                        </div>
                      </div>

                      <div className={`${card} p-4 flex-1 flex flex-col`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className={`${sectionTitle} text-base`}>Monitoramento de PCA</h3>
                            <p className={`${subtle} mt-0.5`}>Pré-edital fora do funil operacional</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLicitacaoSubview('pca')}
                            className="text-[12.5px] text-primary font-medium hover:underline shrink-0"
                          >
                            Abrir PCA
                          </button>
                        </div>
                        {(() => {
                          const pcaItems = licitacaoOpportunities.filter(o => getStageNumber(o.fase || o.status || '') === 1);
                          const pcaValue = pcaItems.reduce((sum, item) => sum + (Number(item.valor_oportunidade) || 0), 0);
                          return (
                            <div className="mt-3 grid grid-cols-2 gap-2 flex-1 content-start">
                              <div className="rounded-[12px] border border-line bg-bg2 px-3 py-3 dark:bg-[#0e1220]">
                                <p className="text-[11px] text-muted">Itens</p>
                                <p className="mt-1.5 font-mono text-[22px] font-bold leading-none text-ink dark:text-white">{pcaItems.length}</p>
                              </div>
                              <div className="rounded-[12px] border border-line bg-bg2 px-3 py-3 dark:bg-[#0e1220]">
                                <p className="text-[11px] text-muted">Valor mapeado</p>
                                <p className="mt-1.5 font-mono text-[15px] font-bold leading-snug text-ink dark:text-white break-words">
                                  {formatCompactCurrency(pcaValue) || 'R$ 0'}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Top oportunidades — faixa full-width (fecha o buraco inferior) */}
                  <div className={`${card} p-4 sm:p-5`}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className={`${sectionTitle} text-base`}>Top oportunidades</h3>
                        <p className={`${subtle} mt-0.5`}>Maiores valores em aberto no pipeline</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLicitacaoSubview('board')}
                        className="text-[12.5px] text-primary font-medium hover:underline shrink-0"
                      >
                        Ver board
                      </button>
                    </div>
                    {(() => {
                      const top = [...licitacaoOpportunities]
                        .filter(o => !String(o.status || '').toLowerCase().includes('perdido'))
                        .sort((a, b) => (Number(b.valor_oportunidade) || 0) - (Number(a.valor_oportunidade) || 0))
                        .slice(0, 8);
                      return top.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                          {top.map((o, idx) => (
                            <div
                              key={o.id}
                              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg2/80 dark:hover:bg-[#0e1220]/60 transition"
                            >
                              <span className="w-5 shrink-0 text-[11px] font-mono text-muted tabular-nums">{idx + 1}</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-ink dark:text-white truncate">
                                  {o.titulo || o.orgao || 'Oportunidade'}
                                </p>
                                <p className={`${subtle} truncate`}>{o.fase || o.status || '—'}</p>
                              </div>
                              <span className="text-[13px] font-bold tabular-nums text-ink dark:text-white shrink-0">
                                {formatCompactCurrency(o.valor_oportunidade) || 'R$ 0'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`${subtle} py-6 text-center`}>Sem oportunidades</div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {(licitacaoSubview === 'board' || licitacaoSubview === 'editais') && (
              <>
              {licitacaoSubview === 'editais' && (
              <>
              {/* PNCP Search — formulário cria job; cards listam jobs; detalhe + resultados no popup */}
              <div className="mt-6 space-y-5">
                <div className="rounded-[16px] border border-line bg-surf p-4 md:p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className={`${sectionTitle} text-base`}>Nova busca de editais</h3>
                      <p className={`${subtle} mt-0.5`}>
                        Defina termos e filtros de partida. A busca vira um job persistente que continua rodando até concluir, parar ou falhar.
                      </p>
                    </div>
                    <button type="button" onClick={() => setLicitacaoSubview('editais_watchlist')} className={`${btnSecondary} h-8 px-3 text-xs`}>
                      Watchlists
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex min-h-[42px] min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-[11px] border border-line bg-bg2 py-1.5 pl-3 pr-2">
                      <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted" />
                      {pncpAcceptedPositiveTerms.map(term => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setPncpAcceptedPositiveTerms(prev => prev.filter(item => item !== term))}
                          title="Remover termo da nova busca"
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 font-display text-[11.5px] font-semibold uppercase tracking-wide text-primary hover:bg-primary/20"
                        >
                          {term} <span className="text-primary/70 normal-case">×</span>
                        </button>
                      ))}
                      <input
                        type="text"
                        placeholder={pncpAcceptedPositiveTerms.length ? 'outro termo… (vírgula adiciona)' : 'drones para mapeamento — vírgula adiciona termo'}
                        value={pncpSearchFilters.q}
                        onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, q: event.target.value }))}
                        onKeyDown={(event) => {
                          const value = String(pncpSearchFilters.q || '').trim();
                          if (event.key === ',') {
                            event.preventDefault();
                            if (value) {
                              setPncpAcceptedPositiveTerms(prev => Array.from(new Set([...prev, value])));
                              setPncpSearchFilters(prev => ({ ...prev, q: '' }));
                            }
                          } else if (event.key === 'Enter') {
                            runPncpSearch(1);
                          } else if (event.key === 'Backspace' && !value && pncpAcceptedPositiveTerms.length) {
                            setPncpAcceptedPositiveTerms(prev => prev.slice(0, -1));
                          }
                        }}
                        className="h-7 min-w-[140px] flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-muted"
                      />
                      <button
                        type="button"
                        onClick={() => setPncpSearchFilters(prev => ({ ...prev, usar_ia: !prev.usar_ia }))}
                        title={pncpSearchFilters.usar_ia ? 'IA expande termos correlatos ao iniciar a busca' : 'IA desligada'}
                        className={`ml-auto shrink-0 rounded-md px-2 py-1 text-[10.5px] font-bold transition ${pncpSearchFilters.usar_ia ? 'bg-cyan/10 text-cyan' : 'bg-bg text-muted2'}`}
                      >
                        ✦ IA expande termos
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => runPncpSearch(1)}
                      disabled={pncpSearchLoading || (!String(pncpSearchFilters.q || '').trim() && pncpAcceptedPositiveTerms.length === 0)}
                      className={`${btnPrimary} h-[42px] px-8`}
                    >
                      {pncpSearchLoading ? 'Iniciando…' : 'Iniciar busca'}
                    </button>
                  </div>

                  {(pncpSuggestedTerms.positivos.length > 0 || pncpSuggestedTerms.negativos.length > 0 || pncpAcceptedNegativeTerms.length > 0 || pncpSuggestionLoading) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted2">Sugestões para a nova busca</span>
                      {pncpSuggestionLoading && <span>pensando…</span>}
                      {pncpSuggestedTerms.positivos.filter(term => !pncpAcceptedPositiveTerms.includes(term) && normalizeText(term) !== normalizeText(pncpSearchFilters.q)).slice(0, 6).map(term => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setPncpAcceptedPositiveTerms(prev => Array.from(new Set([...prev, term])))}
                          className="rounded-lg border border-line bg-bg2 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide hover:border-primary hover:text-primary"
                        >
                          + {term}
                        </button>
                      ))}
                      {pncpAcceptedNegativeTerms.map(term => (
                        <button
                          key={`neg-${term}`}
                          type="button"
                          onClick={() => setPncpAcceptedNegativeTerms(prev => prev.filter(item => item !== term))}
                          className="rounded-lg bg-amber/15 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide text-amber hover:bg-amber/25"
                        >
                          − {term} <span className="normal-case">×</span>
                        </button>
                      ))}
                      {pncpSuggestedTerms.negativos.filter(term => !pncpAcceptedNegativeTerms.includes(term)).slice(0, 4).map(term => (
                        <button
                          key={`negsug-${term}`}
                          type="button"
                          onClick={() => setPncpAcceptedNegativeTerms(prev => Array.from(new Set([...prev, term])))}
                          className="rounded-lg border border-line bg-bg2 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide hover:border-amber hover:text-amber"
                        >
                          − {term}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <select value={pncpSearchFilters.tipos_documento} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, tipos_documento: event.target.value }))} className={`${select} h-8 w-full rounded-[10px] text-xs`}>
                        <option value="edital">Editais</option>
                        <option value="ata">Atas de Registro</option>
                        <option value="contrato">Contratos</option>
                        <option value="edital,ata">Editais e Atas</option>
                        <option value="edital,ata,contrato">Todos</option>
                      </select>
                      <select value={pncpSearchFilters.status} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, status: event.target.value }))} className={`${select} h-8 w-full rounded-[10px] text-xs`}>
                        <option value="recebendo_proposta">Recebendo proposta</option>
                        <option value="encerrada">Encerrada</option>
                        <option value="suspensa">Suspensa</option>
                        <option value="todos">Todos os status</option>
                      </select>
                      <select value={pncpSearchFilters.modalidade_licitacao_id} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, modalidade_licitacao_id: event.target.value }))} className={`${select} h-8 w-full rounded-[10px] text-xs`}>
                        <option value="">Todas modalidades</option>
                        {modalidadeOptions.map(item => (
                          <option key={item.id} value={item.id}>{item.nome}</option>
                        ))}
                      </select>
                      <select value={pncpSearchFilters.uf} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, uf: event.target.value }))} className={`${select} h-8 w-full rounded-[10px] text-xs`}>
                        <option value="">Todos os estados</option>
                        {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                          <option key={uf} value={uf}>{uf}</option>
                        ))}
                      </select>
                      <input value={pncpSearchFilters.negative_terms} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, negative_terms: event.target.value }))} onKeyDown={(event) => event.key === 'Enter' && runPncpSearch(1)} placeholder="Excluir termos (partida)" className={`${input} h-8 w-full rounded-[10px] text-xs`} />
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                      <button type="button" onClick={() => setPncpSearchExpanded(!pncpSearchExpanded)} className={`${btnSecondary} h-8 px-3 text-xs`}>
                        {pncpSearchExpanded ? 'Menos filtros de partida' : 'Mais filtros de partida'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted2">
                    Esses filtros definem como o job consulta o PNCP. Depois que a busca existir, o aprofundamento nos resultados fica no popup do card.
                  </p>

                  {pncpSearchExpanded && (
                    <div className="space-y-5 rounded-[14px] border border-line bg-bg2/40 p-4">
                      <section>
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Classificação</h4>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="min-w-0">
                            <label className="mb-1.5 block text-xs font-medium text-muted">Esfera</label>
                            <select value={pncpSearchFilters.esfera_id} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, esfera_id: event.target.value }))} className={`${select} w-full text-xs`}>
                              <option value="">Todas as esferas</option>
                              <option value="F">Federal</option>
                              <option value="E">Estadual</option>
                              <option value="M">Municipal</option>
                            </select>
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1.5 block text-xs font-medium text-muted">Tipo de instrumento</label>
                            <select value={pncpSearchFilters.tipo_id} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, tipo_id: event.target.value }))} className={`${select} w-full text-xs`}>
                              <option value="">Todos os tipos</option>
                              {pncpEditalTipoInstrumentoOptions.map(item => (
                                <option key={item.id} value={item.id}>
                                  {item.bucket === 'resultado' ? `${item.nome} (resultado/autorização)` : item.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1.5 block text-xs font-medium text-muted">Modo de disputa</label>
                            <select value={pncpSearchFilters.modo_disputa_id} onChange={(event) => setPncpSearchFilters(prev => ({ ...prev, modo_disputa_id: event.target.value }))} className={`${select} w-full text-xs`}>
                              <option value="">Todos os modos</option>
                              {modoDisputaOptions.map(item => (
                                <option key={item.id} value={item.id}>{item.nome}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </section>

                      <section className="border-t border-line pt-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Órgão e unidade</h4>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="min-w-0 space-y-1.5 rounded-[12px] border border-line bg-surf p-3">
                            <label className="block text-xs font-medium text-muted">Órgão</label>
                            <input
                              className={`${input} w-full text-xs`}
                              placeholder="Buscar órgão (nome ou CNPJ)"
                              value={pncpOrgaoLookupQuery}
                              onChange={(event) => {
                                setPncpOrgaoLookupQuery(event.target.value);
                                setPncpSearchFilters(prev => ({ ...prev, orgao_cnpj: '', unidade_codigo: '' }));
                                setPncpUasgLookupQuery('');
                              }}
                            />
                            <select
                              className={`${select} w-full text-xs`}
                              value={pncpSearchFilters.orgao_cnpj}
                              onChange={(event) => {
                                const selected = pncpOrgaoOptions.find(item => String(item.cnpj || '') === String(event.target.value));
                                setPncpSearchFilters(prev => ({ ...prev, orgao_cnpj: event.target.value, unidade_codigo: '' }));
                                setPncpUasgLookupQuery('');
                                if (selected) setPncpOrgaoLookupQuery(selected.nome || selected.cnpj || '');
                              }}
                            >
                              <option value="">{pncpOrgaoLookupLoading ? 'Carregando…' : filteredPncpOrgaoOptions.length > 0 ? 'Selecione o órgão' : 'Digite 2+ caracteres'}</option>
                              {filteredPncpOrgaoOptions.map(item => (
                                <option key={item.cnpj || item.codigo} value={item.cnpj || ''}>{item.nome} {item.cnpj ? `- ${item.cnpj}` : ''}</option>
                              ))}
                            </select>
                          </div>
                          <div className="min-w-0 space-y-1.5 rounded-[12px] border border-line bg-surf p-3">
                            <label className="block text-xs font-medium text-muted">UASG</label>
                            <input
                              className={`${input} w-full text-xs`}
                              placeholder="Buscar UASG por código/nome"
                              value={pncpUasgLookupQuery}
                              onChange={(event) => {
                                setPncpUasgLookupQuery(event.target.value);
                                setPncpSearchFilters(prev => ({ ...prev, unidade_codigo: '' }));
                              }}
                            />
                            <select
                              className={`${select} w-full text-xs`}
                              value={pncpSearchFilters.unidade_codigo}
                              onChange={(event) => {
                                const selected = pncpUasgOptions.find(item => String(item.codigo || '') === String(event.target.value));
                                setPncpSearchFilters(prev => ({ ...prev, unidade_codigo: event.target.value }));
                                if (selected) setPncpUasgLookupQuery(`${selected.codigo} - ${selected.nome || selected.codigo}`);
                              }}
                            >
                              <option value="">{pncpUasgLookupLoading ? 'Carregando…' : filteredPncpUasgOptions.length > 0 ? 'Selecione a UASG' : 'Digite para buscar'}</option>
                              {filteredPncpUasgOptions.map(item => (
                                <option key={item.codigo} value={item.codigo}>{item.codigo} - {item.nome || item.codigo}{item.orgao_nome ? ` (${item.orgao_nome})` : ''}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className={`${sectionTitle} text-[15px]`}>Minhas buscas</h3>
                      <p className={subtle}>
                        Cada card é um job persistente. Clique para abrir resultados, termos e auditoria no popup.
                        {pncpSearchJobs.some(j => isPncpJobLive(j.status)) ? ' · Atualizando status ao vivo…' : ''}
                      </p>
                    </div>
                    <button type="button" onClick={loadPncpSearchJobs} className={`${btnSecondary} h-8 px-3 text-xs inline-flex items-center gap-1.5`}>
                      <ArrowPathIcon className="h-3.5 w-3.5" /> Atualizar
                    </button>
                  </div>

                  {pncpSearchJobs.length === 0 ? (
                    <div className="mt-3 rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
                      <p className="text-sm font-semibold text-ink">Nenhuma busca ainda</p>
                      <p className={`${subtle} mt-1 mx-auto max-w-md`}>
                        Monte os termos e filtros acima e clique em <strong>Iniciar busca</strong>. O job fica salvo e continua coletando até terminar.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {pncpSearchJobs.slice(0, 18).map(job => {
                        const meta = getPncpJobStatusMeta(job.status);
                        const done = Number(job.progress?.terms_done || 0);
                        const total = Math.max(Number(job.progress?.terms_total || job.terms?.length || 0), 1);
                        const live = isPncpJobLive(job.status);
                        const finished = ['completed', 'failed', 'cancelled'].includes(job.status);
                        const pct = finished ? 100 : Math.min(98, Math.round((done / total) * 100));
                        const title = job.nome || job.filters?.q || 'Pesquisa PNCP';
                        const termsPreview = (job.terms || []).slice(0, 3);
                        const age = formatPncpJobAge(job.updated_at || job.completed_at || job.created_at);
                        const filterBits = [
                          job.filters?.uf,
                          job.filters?.status && job.filters.status !== 'todos' ? String(job.filters.status).replace(/_/g, ' ') : null,
                          job.filters?.tipos_documento,
                        ].filter(Boolean);
                        return (
                          <div
                            key={job.id}
                            className={`group flex flex-col rounded-[14px] border bg-surf p-3.5 transition hover:border-primary/40 hover:bg-surf2 ${live ? 'border-primary/35' : 'border-line'}`}
                          >
                            <button type="button" onClick={() => openPncpSearchJob(job.id)} className="min-w-0 flex-1 text-left">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-display text-[13px] font-semibold uppercase tracking-wide text-ink group-hover:text-primary">{title}</p>
                                  <p className="mt-0.5 font-mono text-[10px] text-muted2">
                                    {age ? `atualizado ${age}` : 'job salvo'}
                                    {job.watchlist_id ? ' · watchlist' : ''}
                                  </p>
                                </div>
                                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                                  {meta.live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                                  {meta.label}
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-3 gap-2">
                                <div className="rounded-lg border border-line/80 bg-bg2 px-2 py-1.5">
                                  <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Resultados</p>
                                  <p className="mt-0.5 font-mono text-sm font-bold text-ink">{Number(job.total || 0).toLocaleString('pt-BR')}</p>
                                </div>
                                <div className="rounded-lg border border-line/80 bg-bg2 px-2 py-1.5">
                                  <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Termos</p>
                                  <p className="mt-0.5 font-mono text-sm font-bold text-ink">{done}/{total}</p>
                                </div>
                                <div className="rounded-lg border border-line/80 bg-bg2 px-2 py-1.5">
                                  <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Progresso</p>
                                  <p className="mt-0.5 font-mono text-sm font-bold text-ink">{pct}%</p>
                                </div>
                              </div>

                              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bg2">
                                <div
                                  className={`h-full rounded-full transition-all ${live ? 'bg-[linear-gradient(90deg,#7c5cff,#38d6e6)]' : job.status === 'failed' ? 'bg-status-danger/70' : 'bg-primary/45'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>

                              <p className="mt-1.5 truncate font-mono text-[10px] text-muted2">
                                {live
                                  ? (job.status === 'paused_rate_limit'
                                    ? 'Aguardando limite do PNCP — retoma sozinho'
                                    : <>coletando · <span className="font-display font-semibold uppercase tracking-wide text-muted">{job.progress?.current_term || 'preparando…'}</span></>)
                                  : job.status === 'failed'
                                    ? (job.error || 'falhou')
                                    : job.status === 'cancelled'
                                      ? 'parada pelo usuário'
                                      : 'coleta finalizada'}
                              </p>

                              {(termsPreview.length > 0 || filterBits.length > 0) && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {termsPreview.map(term => (
                                    <span key={term} className="max-w-[9rem] truncate rounded-md bg-primary/10 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-primary">{term}</span>
                                  ))}
                                  {(job.terms || []).length > 3 && (
                                    <span className="rounded-md bg-bg2 px-1.5 py-0.5 text-[10px] text-muted">+{(job.terms || []).length - 3}</span>
                                  )}
                                  {filterBits.slice(0, 2).map(bit => (
                                    <span key={bit} className="rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-[10px] text-muted">{bit}</span>
                                  ))}
                                </div>
                              )}
                            </button>

                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-2.5">
                              <button
                                type="button"
                                onClick={() => openPncpSearchJob(job.id)}
                                className="h-7 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/15"
                              >
                                Abrir
                              </button>
                              {live && (
                                <button
                                  type="button"
                                  onClick={() => cancelPncpSearchJob(job.id)}
                                  title="Para a coleta e mantém os resultados já salvos"
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-bg2 px-2.5 text-[11px] text-muted hover:border-amber/40 hover:text-amber"
                                >
                                  <StopIcon className="h-3.5 w-3.5" /> Parar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => convertPncpSearchJobToWatchlist(job.id)}
                                disabled={Boolean(job.watchlist_id)}
                                className="h-7 rounded-lg border border-line bg-bg2 px-2.5 text-[11px] font-semibold text-cyan hover:bg-cyan/10 disabled:opacity-50 disabled:text-muted"
                              >
                                {job.watchlist_id ? 'Watchlist ✓' : 'Watchlist'}
                              </button>
                              <button
                                type="button"
                                onClick={() => deletePncpSearchJob(job.id)}
                                title="Excluir busca e resultados"
                                className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-bg2 px-2.5 text-[11px] text-muted hover:border-status-danger/40 hover:text-status-danger"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Popup do job: tudo relacionado à busca */}
              {pncpJobModalOpen && activePncpSearchJobId && (
                <div className={modalOverlay} onClick={closePncpSearchJobModal} role="presentation">
                  <div
                    className="flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-lift dark:bg-[#111827] dark:border-[#1f2937]"
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Detalhe da busca de editais"
                  >
                    {(() => {
                      const job = activePncpSearchJob;
                      const meta = getPncpJobStatusMeta(job?.status);
                      const live = isPncpJobLive(job?.status);
                      const title = job?.nome || job?.filters?.q || 'Pesquisa PNCP';
                      return (
                        <>
                          <div className="shrink-0 border-b border-line px-4 py-3.5 sm:px-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="truncate font-display text-base font-semibold uppercase tracking-wide text-ink">{title}</h3>
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                                    {meta.live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                                    {meta.label}
                                  </span>
                                </div>
                                <p className="mt-1 font-mono text-[11px] text-muted">
                                  {Number(pncpSearchResults.total || job?.total || 0).toLocaleString('pt-BR')} resultado(s)
                                  {' · '}
                                  {activePncpJobProgress.done}/{activePncpJobProgress.total} termo(s)
                                  {live ? (
                                    <>
                                      {' · '}
                                      <span className="font-display font-semibold uppercase tracking-wide text-ink">
                                        {activePncpJobProgress.currentTerm || 'preparando'}
                                      </span>
                                    </>
                                  ) : null}
                                  {job?.error ? ` · ${job.error}` : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {live && (
                                  <button type="button" onClick={() => cancelPncpSearchJob(activePncpSearchJobId)} className={`${btnSecondary} h-8 px-3 text-xs inline-flex items-center gap-1`}>
                                    <StopIcon className="h-3.5 w-3.5" /> Parar
                                  </button>
                                )}
                                <button type="button" onClick={() => convertPncpSearchJobToWatchlist(activePncpSearchJobId)} disabled={Boolean(job?.watchlist_id)} className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`}>
                                  {job?.watchlist_id ? 'Watchlist ✓' : 'Virar watchlist'}
                                </button>
                                <button type="button" onClick={() => deletePncpSearchJob(activePncpSearchJobId)} className={`${btnSecondary} h-8 px-3 text-xs inline-flex items-center gap-1 text-status-danger`}>
                                  <TrashIcon className="h-3.5 w-3.5" /> Excluir
                                </button>
                                <button type="button" onClick={closePncpSearchJobModal} className={iconBtn} aria-label="Fechar">
                                  <XMarkIcon className="h-5 w-5" />
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg2">
                              <div
                                className={`h-full rounded-full transition-all ${live ? 'bg-[linear-gradient(90deg,#7c5cff,#38d6e6)]' : 'bg-primary/50'}`}
                                style={{ width: `${activePncpJobProgress.pct}%` }}
                              />
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <div className="rounded-lg border border-line bg-bg2 px-2.5 py-2">
                                <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Classificados</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-ink">{Number(pncpSearchResults.total || 0).toLocaleString('pt-BR')}</p>
                              </div>
                              <div className="rounded-lg border border-line bg-bg2 px-2.5 py-2">
                                <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Valor total</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-ink">{formatCompactCurrency(pncpSearchSummary.total_value) || 'R$ 0'}</p>
                              </div>
                              <div className="rounded-lg border border-line bg-bg2 px-2.5 py-2">
                                <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Ocultos</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-ink">{Number(pncpVisibilityCounts.hidden || 0).toLocaleString('pt-BR')}</p>
                              </div>
                              <div className="rounded-lg border border-line bg-bg2 px-2.5 py-2">
                                <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">No pipeline</p>
                                <p className="mt-0.5 font-mono text-sm font-bold text-ink">{Number(pncpVisibilityCounts.pipeline || 0).toLocaleString('pt-BR')}</p>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1">
                              {[
                                ['resultados', 'Resultados'],
                                ['termos', 'Termos e filtros'],
                                ['auditoria', 'Auditoria'],
                              ].map(([key, label]) => (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setPncpJobModalTab(key)}
                                  className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${pncpJobModalTab === key ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-bg2 hover:text-ink'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="px-4 py-4 sm:px-5">
                            {pncpJobModalTab === 'termos' && (() => {
                              const partidaChips = getPncpPartidaFilterChips(job?.filters || {}, {
                                modalidades: modalidadeOptions,
                                tipos: pncpEditalTipoInstrumentoOptions,
                                modos: modoDisputaOptions,
                              });
                              return (
                              <div className="space-y-5">
                                <div>
                                  <h4 className={`${sectionTitle} text-sm`}>Termos da coleta</h4>
                                  <p className={`${subtle} mt-0.5`}>Cada termo é uma frente da busca profunda. Anexar termos continua o job (ou reabre se já terminou).</p>
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {(job?.terms || []).map(term => (
                                      <span key={term} className="rounded-lg bg-primary/10 px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-wide text-primary">{term}</span>
                                    ))}
                                    {!(job?.terms || []).length && <span className="text-xs text-muted">Nenhum termo registrado.</span>}
                                  </div>
                                  {(job?.negative_terms || []).length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {(job.negative_terms || []).map(term => (
                                        <span key={`n-${term}`} className="rounded-lg bg-amber/15 px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-wide text-amber">− {term}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <input
                                    className={`${input} h-9 min-w-0 flex-1 text-xs`}
                                    placeholder="Adicionar termo a este job"
                                    value={pncpActiveJobTermInput}
                                    onChange={(event) => setPncpActiveJobTermInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addTermsToActivePncpJob();
                                      }
                                    }}
                                  />
                                  <button type="button" onClick={addTermsToActivePncpJob} className={`${btnPrimary} h-9 px-4 text-xs`}>
                                    Anexar termo
                                  </button>
                                </div>

                                {pncpSuggestedTerms.positivos?.length > 0 && (
                                  <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Sugestões da IA</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {pncpSuggestedTerms.positivos
                                        .filter(term => !(job?.terms || []).some(existing => normalizeText(existing) === normalizeText(term)))
                                        .slice(0, 8)
                                        .map(term => (
                                          <button
                                            key={term}
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                await postPncpSearchJobTerms(activePncpSearchJobId, { terms: [term] });
                                                await openPncpSearchJob(activePncpSearchJobId, { refreshJobs: true, openModal: true });
                                              } catch (error) {
                                                alert(`Erro: ${error.response?.data?.error || error.message}`);
                                              }
                                            }}
                                            className="rounded-lg border border-line bg-bg2 px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-wide text-muted hover:border-primary hover:text-primary"
                                          >
                                            + {term}
                                          </button>
                                        ))}
                                    </div>
                                  </div>
                                )}

                                <div className="rounded-[12px] border border-line bg-bg2/40 p-3.5">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <h4 className={`${sectionTitle} text-sm`}>Filtros de partida</h4>
                                      <p className={`${subtle} mt-0.5`}>
                                        Como este job consulta o PNCP. Diferente do filtro local em Resultados.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!pncpJobFiltersEditing) seedPncpJobFilterDraft(job?.filters || {});
                                        setPncpJobFiltersEditing(v => !v);
                                      }}
                                      className={`${btnSecondary} h-8 px-3 text-xs`}
                                    >
                                      {pncpJobFiltersEditing ? 'Fechar edição' : 'Editar e rodar de novo'}
                                    </button>
                                  </div>

                                  {!pncpJobFiltersEditing && (
                                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                                      {partidaChips.length > 0 ? partidaChips.map(chip => (
                                        <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border border-line bg-surf px-2 py-0.5 text-[11px] text-ink">
                                          <span className="font-mono text-[10px] uppercase tracking-wide text-muted2">{chip.label}</span>
                                          <span className="font-semibold">{chip.value}</span>
                                        </span>
                                      )) : (
                                        <span className="text-xs text-muted">Nenhum filtro de partida além dos termos.</span>
                                      )}
                                    </div>
                                  )}

                                  {pncpJobFiltersEditing && (
                                    <div className="mt-3 space-y-3 border-t border-line pt-3">
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Documento</label>
                                          <select value={pncpJobFilterDraft.tipos_documento} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, tipos_documento: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="edital">Editais</option>
                                            <option value="ata">Atas de Registro</option>
                                            <option value="contrato">Contratos</option>
                                            <option value="edital,ata">Editais e Atas</option>
                                            <option value="edital,ata,contrato">Todos</option>
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Status</label>
                                          <select value={pncpJobFilterDraft.status} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, status: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="recebendo_proposta">Recebendo proposta</option>
                                            <option value="encerrada">Encerrada</option>
                                            <option value="suspensa">Suspensa</option>
                                            <option value="todos">Todos os status</option>
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">UF</label>
                                          <select value={pncpJobFilterDraft.uf} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, uf: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="">Todos os estados</option>
                                            {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                                              <option key={uf} value={uf}>{uf}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Modalidade</label>
                                          <select value={pncpJobFilterDraft.modalidade_licitacao_id} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, modalidade_licitacao_id: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="">Todas modalidades</option>
                                            {modalidadeOptions.map(item => (
                                              <option key={item.id} value={item.id}>{item.nome}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Esfera</label>
                                          <select value={pncpJobFilterDraft.esfera_id} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, esfera_id: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="">Todas as esferas</option>
                                            <option value="F">Federal</option>
                                            <option value="E">Estadual</option>
                                            <option value="M">Municipal</option>
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Tipo de instrumento</label>
                                          <select value={pncpJobFilterDraft.tipo_id} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, tipo_id: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="">Todos os tipos</option>
                                            {pncpEditalTipoInstrumentoOptions.map(item => (
                                              <option key={item.id} value={item.id}>{item.nome}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Modo de disputa</label>
                                          <select value={pncpJobFilterDraft.modo_disputa_id} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, modo_disputa_id: e.target.value }))} className={`${select} h-8 w-full text-xs`}>
                                            <option value="">Todos os modos</option>
                                            {modoDisputaOptions.map(item => (
                                              <option key={item.id} value={item.id}>{item.nome}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">CNPJ do órgão</label>
                                          <input className={`${input} h-8 w-full text-xs`} placeholder="Opcional" value={pncpJobFilterDraft.orgao_cnpj} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, orgao_cnpj: e.target.value }))} />
                                        </div>
                                        <div className="min-w-0">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">UASG</label>
                                          <input className={`${input} h-8 w-full text-xs`} placeholder="Código da unidade" value={pncpJobFilterDraft.unidade_codigo} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, unidade_codigo: e.target.value }))} />
                                        </div>
                                        <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                                          <label className="mb-1 block text-[11px] font-medium text-muted">Excluir termos (partida)</label>
                                          <input className={`${input} h-8 w-full text-xs`} placeholder="Termos a excluir, separados por vírgula" value={pncpJobFilterDraft.negative_terms} onChange={(e) => setPncpJobFilterDraft(prev => ({ ...prev, negative_terms: e.target.value }))} />
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={applyPncpJobFiltersAndRerun} disabled={pncpJobFiltersSaving} className={`${btnPrimary} h-9 px-4 text-xs disabled:opacity-50`}>
                                          {pncpJobFiltersSaving ? 'Aplicando…' : 'Aplicar e coletar de novo'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            seedPncpJobFilterDraft(job?.filters || {});
                                            setPncpJobFiltersEditing(false);
                                          }}
                                          className={`${btnSecondary} h-9 px-3 text-xs`}
                                        >
                                          Cancelar
                                        </button>
                                        <p className={`${subtle} max-w-md`}>
                                          Reaplica no job e reenfileira a coleta. Resultados já salvos permanecem.
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              );
                            })()}

                            {pncpJobModalTab === 'auditoria' && (
                              <div className="space-y-3">
                                <div className="rounded-[12px] border border-line bg-bg2/40 p-3 text-xs text-muted">
                                  <p className="font-semibold text-ink">Auditoria da coleta</p>
                                  <p className="mt-1">
                                    {pncpSearchResults.query_plan?.term_runs?.length || 0} termo(s) executado(s)
                                    {pncpSearchResults.query_plan?.cache_hit ? ' · cache' : ''}
                                    {pncpSearchResults.query_plan?.pncp_status_sent
                                      ? ` · status PNCP: ${pncpSearchResults.query_plan.pncp_status_sent}`
                                      : ' · status filtrado localmente'}
                                  </p>
                                </div>
                                <div className="grid gap-2 md:grid-cols-3">
                                  <div className="rounded-lg border border-line bg-surf p-2.5 text-xs text-muted">
                                    <p className="font-semibold text-ink">Filtros locais</p>
                                    <p className="mt-1">Recebendo proposta: {pncpSearchResults.query_plan?.local_filters?.receiving_proposal ? 'sim' : 'não'}</p>
                                    <p>Órgão: {pncpSearchResults.query_plan?.local_filters?.orgao || 'n/d'}</p>
                                    <p>Unidade: {pncpSearchResults.query_plan?.local_filters?.unidade || 'n/d'}</p>
                                  </div>
                                  <div className="rounded-lg border border-line bg-surf p-2.5 text-xs text-muted md:col-span-2">
                                    <p className="font-semibold text-ink">Checar edital específico nesta busca</p>
                                    <input
                                      value={pncpDebugControlId}
                                      onChange={(event) => setPncpDebugControlId(event.target.value)}
                                      placeholder="Ex.: 18715532000170/2026/54"
                                      className={`${input} mt-2 h-8 w-full text-xs`}
                                    />
                                    {pncpDebugLookup && (
                                      <p className="mt-2">
                                        {pncpDebugLookup.found
                                          ? `Encontrado: ${pncpDebugLookup.status === 'visible' ? 'visível' : pncpDebugLookup.status === 'pipeline' ? 'já no pipeline' : 'oculto'}`
                                          : 'Não retornou nesta página/escopo atual.'}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="max-h-72 overflow-auto rounded-lg border border-line">
                                  <table className="w-full text-left text-[11px]">
                                    <thead className="sticky top-0 bg-bg2 text-muted">
                                      <tr>
                                        <th className="px-2 py-1.5">Termo</th>
                                        <th className="px-2 py-1.5">Fonte</th>
                                        <th className="px-2 py-1.5">Pág.</th>
                                        <th className="px-2 py-1.5">Coletados</th>
                                        <th className="px-2 py-1.5">Total API</th>
                                        <th className="px-2 py-1.5">Parada</th>
                                        <th className="px-2 py-1.5">Erro</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(pncpSearchResults.query_plan?.term_runs || []).map((run, index) => (
                                        <tr key={`${run.term}-${index}`} className="border-t border-line">
                                          <td className="px-2 py-1.5 font-medium text-ink">{run.term || 'vazio'}</td>
                                          <td className="px-2 py-1.5 text-muted">{run.source}</td>
                                          <td className="px-2 py-1.5 text-muted">{run.pages_completed}/{run.pages_requested}</td>
                                          <td className="px-2 py-1.5 text-muted">{Number(run.items_collected || 0).toLocaleString('pt-BR')}</td>
                                          <td className="px-2 py-1.5 text-muted">{Number(run.total_reported || 0).toLocaleString('pt-BR')}</td>
                                          <td className="px-2 py-1.5 text-muted">{String(run.stop_reason || 'n/d').replace(/_/g, ' ')}</td>
                                          <td className="px-2 py-1.5 text-status-danger">{Array.isArray(run.errors) && run.errors.length ? run.errors.join('; ') : '—'}</td>
                                        </tr>
                                      ))}
                                      {!(pncpSearchResults.query_plan?.term_runs || []).length && (
                                        <tr>
                                          <td colSpan={7} className="px-2 py-6 text-center text-muted">Sem runs de auditoria ainda — a coleta pode estar na fila.</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {pncpJobModalTab === 'resultados' && (
                              <div className="space-y-3">
                                <div className="rounded-[12px] border border-line bg-bg2/40 p-3">
                                  <div>
                                    <p className="text-xs font-semibold text-ink">Aprofundar nos resultados obtidos</p>
                                    <p className={`${subtle} mt-0.5`}>Filtra o que já foi coletado neste job — não relança a busca no PNCP.</p>
                                  </div>
                                  <div className="mt-2.5 flex flex-col gap-2 lg:flex-row lg:items-center">
                                    <input
                                      className={`${input} h-8 min-w-0 flex-1 text-xs`}
                                      placeholder="Filtrar nesta lista (título, órgão, UF…)"
                                      value={pncpResultLocalQuery}
                                      onChange={(event) => setPncpResultLocalQuery(event.target.value)}
                                    />
                                    <select
                                      value={pncpSearchFilters.ordenacao}
                                      onChange={(event) => {
                                        const ordenacao = event.target.value;
                                        setPncpSearchFilters(prev => ({ ...prev, ordenacao }));
                                        if (activePncpSearchJobId) loadPncpJobResults(activePncpSearchJobId, 1, { ordenacao });
                                      }}
                                      className={`${select} h-8 w-full text-xs lg:w-52`}
                                    >
                                      <option value="relevancia_desc">Maior aderência</option>
                                      <option value="valor_desc_data_desc">Maior valor</option>
                                      <option value="valor_asc_data_desc">Menor valor</option>
                                      <option value="data_desc">Mais recentes</option>
                                      <option value="data_asc">Mais antigos</option>
                                    </select>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {[
                                      ['all', 'Todos', pncpVisibilityCounts.all],
                                      ['hidden', 'Ocultos', pncpVisibilityCounts.hidden],
                                      ['pipeline', 'Já no pipeline', pncpVisibilityCounts.pipeline],
                                    ].map(([scope, label, count]) => (
                                      <button
                                        key={scope}
                                        type="button"
                                        onClick={() => {
                                          setPncpResultScope(scope);
                                          setShowPncpHidden(false);
                                          if (activePncpSearchJobId) loadPncpJobResults(activePncpSearchJobId, 1, { scope });
                                        }}
                                        className={`h-7 rounded-lg border px-2.5 text-[11px] font-semibold ${pncpResultScope === scope ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:bg-surf'}`}
                                      >
                                        {label} ({Number(count || 0).toLocaleString('pt-BR')})
                                      </button>
                                    ))}
                                    {pncpHiddenIds.length > 0 && (
                                      <button type="button" onClick={restoreAllPncpItems} className="h-7 rounded-lg border border-line px-2.5 text-[11px] text-muted hover:text-ink">
                                        Restaurar ocultos
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {live && (
                                  <div className="rounded-[12px] border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted">
                                    <strong className="text-ink">Job em coleta.</strong> Novos resultados entram aqui conforme as frentes terminam.
                                  </div>
                                )}

                                {visiblePncpResults.length > 0 ? (
                                  <div className="space-y-2.5">
                                    {visiblePncpResults.map((item) => (
                                      <div key={item.id} className="rounded-[12px] border border-line bg-surf p-3.5 transition hover:border-primary/40">
                                        <div className="grid gap-3 lg:grid-cols-[1fr_150px]">
                                          <div className="min-w-0">
                                            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold ${getPncpScoreClass(item.score)}`}>
                                                {Number(item.score || 0)} · {item.score_label || 'Aderência'}
                                              </span>
                                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${getPncpUrgencyClass(item.prazo_info?.urgency)}`}>
                                                {item.prazo_info?.label || 'Prazo n/d'}
                                              </span>
                                              <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                                {item.modalidade?.nome || 'Modalidade n/d'}
                                              </span>
                                              <span className="inline-flex items-center rounded-md border border-line bg-bg2 px-2 py-0.5 text-[11px] text-muted">
                                                {item.esfera?.nome ? `${item.esfera.nome} · ` : ''}{item.uf || 'BR'}
                                              </span>
                                              {item.__visibility !== 'visible' && (
                                                <span className="inline-flex items-center rounded-md bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">
                                                  {item.__visibility === 'pipeline' ? 'Já no pipeline' : 'Oculto'}
                                                </span>
                                              )}
                                            </div>
                                            <h4 className="truncate text-sm font-semibold text-ink">
                                              {item.url ? (
                                                <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.titulo}</a>
                                              ) : item.titulo}
                                            </h4>
                                            <p className="mt-1 line-clamp-2 text-xs text-muted">{item.descricao}</p>
                                            <p className="mt-2 text-xs text-muted">
                                              <span className="font-mono text-[10px] uppercase tracking-wide text-muted2">Órgão</span>{' '}
                                              {item.orgao?.nome || 'n/d'}
                                              {item.criterio_julgamento ? <> · {item.criterio_julgamento}</> : null}
                                            </p>
                                          </div>
                                          <div className="flex flex-col gap-1.5 lg:border-l lg:border-line lg:pl-3">
                                            <div>
                                              <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Valor</p>
                                              <p className="mt-0.5 font-mono text-base font-bold text-ink">
                                                {getBestEstimatedValue(item) ? formatCurrency(getBestEstimatedValue(item)) : 'n/d'}
                                              </p>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => importPncpLicitacao(item)}
                                              disabled={pncpImportingId === item.id || item.__visibility === 'pipeline'}
                                              className="h-8 rounded-[10px] bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] px-3 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
                                            >
                                              {pncpImportingId === item.id ? 'Importando…' : 'Importar'}
                                            </button>
                                            {item.url && (
                                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex h-8 items-center justify-center rounded-[10px] border border-line bg-bg2 text-xs font-semibold hover:bg-surf2">
                                                PNCP ↗
                                              </a>
                                            )}
                                            {item.__visibility === 'hidden' ? (
                                              <button type="button" onClick={() => restorePncpItem(item.id)} className="h-8 rounded-[10px] border border-line bg-bg2 text-xs font-semibold text-muted hover:bg-surf2">
                                                Restaurar
                                              </button>
                                            ) : (
                                              <button type="button" onClick={() => hidePncpItem(item.id)} className="h-8 rounded-[10px] border border-line bg-bg2 text-xs font-semibold text-muted hover:bg-surf2">
                                                Ocultar
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-[12px] border border-dashed border-line px-4 py-10 text-center">
                                    <p className="text-sm font-semibold text-ink">
                                      {live ? 'Ainda coletando…' : pncpSearchResults.total > 0 ? 'Nenhum item neste filtro' : 'Sem resultados nesta busca'}
                                    </p>
                                    <p className={`${subtle} mt-1`}>
                                      {live
                                        ? 'Os primeiros editais aparecem assim que cada frente terminar uma página.'
                                        : pncpSearchResults.total > 0
                                          ? 'Ajuste o filtro local, o escopo ou a ordenação acima.'
                                          : 'Tente anexar novos termos na aba Termos e frentes.'}
                                    </p>
                                  </div>
                                )}

                                {pncpSearchResults.totalPaginas > 1 && (
                                  <div className="flex items-center justify-center gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => loadPncpJobResults(activePncpSearchJobId, pncpSearchResults.pagina - 1)}
                                      disabled={pncpSearchResults.pagina <= 1}
                                      className="h-8 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-50 hover:bg-bg2"
                                    >
                                      Anterior
                                    </button>
                                    <span className="font-mono text-xs text-muted">
                                      {pncpSearchResults.pagina} / {pncpSearchResults.totalPaginas}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => loadPncpJobResults(activePncpSearchJobId, pncpSearchResults.pagina + 1)}
                                      disabled={pncpSearchResults.pagina >= pncpSearchResults.totalPaginas}
                                      className="h-8 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-50 hover:bg-bg2"
                                    >
                                      Próxima
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </VerticalScrollArrows>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
              </>
              )}
              {showNewOpportunityForm && createPortal(
                <div
                  className="fixed inset-0 z-modal flex items-center justify-center p-3 sm:p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="nova-licitacao-title"
                >
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/55"
                    aria-label="Fechar formulário"
                    onClick={resetNewOpportunityFormState}
                  />
                  <div className="relative flex w-full max-w-5xl max-h-[min(92vh,900px)] flex-col overflow-hidden rounded-[16px] border border-line bg-surf shadow-lift dark:bg-[#141a28] dark:border-[#232c40]">
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                      <div className="min-w-0">
                        <h3 id="nova-licitacao-title" className="font-display text-base font-semibold text-ink sm:text-lg">
                          Nova licitação
                        </h3>
                        <p className="mt-0.5 text-[12px] text-muted truncate">
                          {isPncpImportDraft ? 'Rascunho importado do PNCP — revise antes de salvar' : 'Preencha os dados principais da oportunidade'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetNewOpportunityFormState}
                        className={`${iconBtn} shrink-0`}
                        aria-label="Fechar"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>

                    <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="space-y-4 px-4 py-4 sm:px-5">
                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Dados gerais</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                          <div className="min-w-0 sm:col-span-2 lg:col-span-6">
                            <label className="mb-1 block text-xs font-medium text-muted">Título</label>
                            <input className={`${input} w-full text-sm`} placeholder="Título da oportunidade" value={newOpportunityForm.titulo} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, titulo: event.target.value }))} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Fase</label>
                            <select className={`${select} w-full text-sm`} value={newOpportunityForm.fase} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, fase: event.target.value }))}>
                              {licitacaoColumns.map(column => (<option key={column} value={column}>{column}</option>))}
                            </select>
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Status</label>
                            <select className={`${select} w-full text-sm`} value={newOpportunityForm.status} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, status: event.target.value }))}>
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
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Origem</label>
                            <select className={`${select} w-full text-sm`} value={newOpportunityForm.origem_oportunidade} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, origem_oportunidade: event.target.value }))}>
                              <option value="direta">Origem direta</option>
                              <option value="automatica_api">Automática via API</option>
                              <option value="pca_pncp">PCA PNCP</option>
                            </select>
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Valor da oportunidade</label>
                            <input className={`${input} w-full text-sm`} placeholder="0,00" inputMode="decimal" value={newOpportunityForm.valor_oportunidade} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, valor_oportunidade: event.target.value.replace(/\./g, ',') }))} />
                          </div>
                          <div className="min-w-0 sm:col-span-2 lg:col-span-6">
                            <label className="mb-1 block text-xs font-medium text-muted">Palavras-chave</label>
                            <input className={`${input} w-full text-sm`} placeholder="Separadas por vírgula" value={newOpportunityForm.palavras_chave} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, palavras_chave: event.target.value }))} />
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Órgão e unidade</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 space-y-1.5">
                            <label className="block text-xs font-medium text-muted">Órgão</label>
                            <input
                              className={`${input} w-full text-sm`}
                              placeholder="Buscar órgão (mín. 2 letras)"
                              value={orgaoLookupQuery}
                              onChange={(event) => {
                                const value = event.target.value;
                                setOrgaoLookupQuery(value);
                                setNewOpportunityForm(prev => ({ ...prev, orgao_nome: value }));
                              }}
                            />
                            <select
                              className={`${select} w-full text-sm`}
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
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">CNPJ do órgão</label>
                            <input className={`${input} w-full text-sm`} placeholder="00.000.000/0000-00" value={newOpportunityForm.orgao_cnpj || ''} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, orgao_cnpj: event.target.value, uasg_codigo: '', uasg_nome: '' }))} />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <label className="block text-xs font-medium text-muted">UASG</label>
                            <input
                              className={`${input} w-full text-sm`}
                              placeholder="Buscar UASG por código/nome"
                              value={uasgLookupQuery}
                              onChange={(event) => setUasgLookupQuery(event.target.value)}
                            />
                            <select
                              className={`${select} w-full text-sm`}
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
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Nome da UASG</label>
                            <input className={`${input} w-full text-sm`} placeholder="Nome da unidade" value={newOpportunityForm.uasg_nome} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, uasg_nome: event.target.value }))} />
                          </div>
                        </div>
                      </section>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Identificação da compra</h4>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="min-w-0 space-y-1.5 sm:col-span-2">
                              <label className="block text-xs font-medium text-muted">Modalidade</label>
                              <input
                                className={`${input} w-full text-sm`}
                                placeholder="Buscar modalidade"
                                value={modalidadeLookupQuery}
                                onChange={(event) => setModalidadeLookupQuery(event.target.value)}
                              />
                              <select
                                className={`${select} w-full text-sm`}
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
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Nº edital</label>
                              <input className={`${input} w-full text-sm`} placeholder="Nº edital" value={newOpportunityForm.numero_edital} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_edital: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Processo SEI</label>
                              <input className={`${input} w-full text-sm`} placeholder="Nº processo SEI" value={newOpportunityForm.numero_processo_sei} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_processo_sei: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Nº compra</label>
                              <input className={`${input} w-full text-sm`} placeholder="Nº compra" value={newOpportunityForm.numero_compra} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, numero_compra: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Tipo de item</label>
                              <select className={`${select} w-full text-sm`} value={newOpportunityForm.item_tipo} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, item_tipo: event.target.value }))}>
                                <option value="material">Material</option>
                                <option value="servico">Serviço</option>
                              </select>
                            </div>
                            <div className="min-w-0 space-y-1.5 sm:col-span-2">
                              <label className="block text-xs font-medium text-muted">Código item (catálogo)</label>
                              <input
                                className={`${input} w-full text-sm`}
                                placeholder="Buscar código item"
                                value={catalogoLookupQuery}
                                onChange={(event) => setCatalogoLookupQuery(event.target.value)}
                              />
                              <select
                                className={`${select} w-full text-sm`}
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
                          </div>
                        </section>

                        <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Datas importantes</h4>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Publicação do aviso</label>
                              <input type="date" className={`${input} w-full text-sm`} value={newOpportunityForm.data_publicacao} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_publicacao: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Início da proposta</label>
                              <input type="datetime-local" className={`${input} w-full text-sm`} value={newOpportunityForm.data_sessao} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_sessao: event.target.value }))} />
                            </div>
                            <div className="min-w-0 sm:col-span-2">
                              <label className="mb-1 block text-xs font-medium text-status-danger">Fim da proposta</label>
                              <input type="datetime-local" className={`${input} w-full border-status-danger/30 text-sm`} value={newOpportunityForm.data_envio_proposta_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_envio_proposta_limite: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Assinatura da ata</label>
                              <input type="datetime-local" className={`${input} w-full text-sm`} value={newOpportunityForm.data_assinatura_ata_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_assinatura_ata_limite: event.target.value }))} />
                            </div>
                            <div className="min-w-0">
                              <label className="mb-1 block text-xs font-medium text-muted">Entrega final</label>
                              <input type="datetime-local" className={`${input} w-full text-sm`} value={newOpportunityForm.data_entrega_limite} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, data_entrega_limite: event.target.value }))} />
                            </div>
                            <div className="min-w-0 sm:col-span-2">
                              <label className="mb-1 block text-xs font-medium text-muted">Dias após assinatura</label>
                              <input type="number" className={`${input} w-full text-sm`} placeholder="Dias" value={newOpportunityForm.prazo_entrega_dias_apos_assinatura} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, prazo_entrega_dias_apos_assinatura: event.target.value }))} />
                            </div>
                          </div>
                        </section>
                      </div>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Links</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link do edital</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={newOpportunityForm.links_edital} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_edital: event.target.value }))} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link SEI</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={newOpportunityForm.links_sei} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_sei: event.target.value }))} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link PNCP</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={newOpportunityForm.links_pncp} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_pncp: event.target.value }))} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link Compras.gov</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={newOpportunityForm.links_compras} onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, links_compras: event.target.value }))} />
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Itens da licitação <span className="font-normal normal-case tracking-normal text-muted2">(opcional)</span></h4>
                          {isPncpImportDraft && newOpportunityItemsDraft.length > 0 && (
                            <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setNewOpportunityItemsDraft([])}>
                              Remover todos
                            </button>
                          )}
                        </div>
                        {isPncpImportDraft && (
                          <p className="mb-3 rounded-[10px] border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] text-primary">
                            Itens importados do PNCP. Revise e remova o que não for pertinente antes de salvar.
                          </p>
                        )}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                          <input className={`${input} h-9 w-full text-sm sm:col-span-2`} placeholder="Nº item" value={newOpportunityItemForm.numero_item} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, numero_item: event.target.value }))} />
                          <input className={`${input} h-9 w-full text-sm sm:col-span-4`} placeholder="Descrição do item" value={newOpportunityItemForm.descricao} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, descricao: event.target.value }))} />
                          <input className={`${input} h-9 w-full text-sm sm:col-span-2`} placeholder="Modelo" value={newOpportunityItemForm.modelo_produto} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, modelo_produto: event.target.value }))} />
                          <input className={`${input} h-9 w-full text-sm sm:col-span-2`} inputMode="decimal" placeholder="Qtd" value={newOpportunityItemForm.quantidade} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, quantidade: event.target.value.replace(/\./g, ',') }))} />
                          <div className="flex gap-2 sm:col-span-2">
                            <input className={`${input} h-9 min-w-0 flex-1 text-sm`} inputMode="decimal" placeholder="Custo total" value={newOpportunityItemForm.custo_total_item} onChange={(event) => setNewOpportunityItemForm(prev => ({ ...prev, custo_total_item: event.target.value.replace(/\./g, ',') }))} />
                            <button type="button" className={`${btnSecondary} h-9 shrink-0 px-3 text-xs`} onClick={addDraftItem}>Add</button>
                          </div>
                        </div>

                        <VerticalScrollArrows className="mt-3 max-h-56" contentClassName="space-y-2 pr-0.5">
                          {newOpportunityItemsDraft.map(item => {
                            const reqForm = newOpportunityItemRequirementForm[item.id] || { requisito: '', status: 'verificar', observacao: '', custo_subitem: '' };
                            const requirements = item.requirements || [];
                            const okCount = requirements.filter(req => req.status === 'ok').length;
                            const totalCount = requirements.length;
                            const pending = requirements.some(req => req.status !== 'ok');
                            const statusLabel = requirements.length === 0
                              ? 'Sem checklist'
                              : pending ? 'Pendências' : 'Completo';
                            return (
                              <div key={item.id} className="rounded-[12px] border border-line bg-surf p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
                                    Item {item.numero_item || '—'} · {item.descricao}
                                  </p>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[11px] text-muted">{statusLabel} ({okCount}/{totalCount})</span>
                                    <button type="button" className="text-[12px] font-semibold text-status-danger" onClick={() => removeDraftItem(item.id)}>Remover</button>
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                  <input className={`${input} h-8 w-full text-xs`} placeholder="Nº" value={item.numero_item || ''} onChange={(event) => updateDraftItem(item.id, { numero_item: event.target.value })} />
                                  <input className={`${input} h-8 w-full text-xs col-span-2`} placeholder="Descrição" value={item.descricao || ''} onChange={(event) => updateDraftItem(item.id, { descricao: event.target.value })} />
                                  <input className={`${input} h-8 w-full text-xs`} placeholder="Modelo" value={item.modelo_produto || ''} onChange={(event) => updateDraftItem(item.id, { modelo_produto: event.target.value })} />
                                  <input className={`${input} h-8 w-full text-xs`} inputMode="decimal" placeholder="Qtd" value={toPtBrInputSafe(item.quantidade)} onChange={(event) => updateDraftItem(item.id, { quantidade: event.target.value.replace(/\./g, ',') })} />
                                  <input className={`${input} h-8 w-full text-xs`} inputMode="decimal" placeholder="Total" value={toPtBrInputSafe(item.custo_total_item)} onChange={(event) => updateDraftItem(item.id, { custo_total_item: event.target.value.replace(/\./g, ',') })} />
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-12">
                                  <button type="button" className={`${iconBtn} h-8 w-8 sm:col-span-1`} onClick={() => setExpandedDraftChecklist(prev => ({ ...prev, [item.id]: !prev[item.id] }))} title="Checklist técnico">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                                      <path d="M9 12l2 2 4-4" />
                                      <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                                    </svg>
                                  </button>
                                  <input className={`${input} h-8 w-full text-xs sm:col-span-4`} placeholder="Requisito técnico" value={reqForm.requisito || ''} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, requisito: event.target.value } }))} />
                                  <select className={`${select} h-8 w-full text-xs sm:col-span-2`} value={reqForm.status || 'verificar'} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, status: event.target.value } }))}>
                                    <option value="ok">OK</option>
                                    <option value="nao_ok">Não OK</option>
                                    <option value="verificar">Verificar</option>
                                  </select>
                                  <input className={`${input} h-8 w-full text-xs sm:col-span-3`} placeholder="Observação" value={reqForm.observacao || ''} onChange={(event) => setNewOpportunityItemRequirementForm(prev => ({ ...prev, [item.id]: { ...reqForm, observacao: event.target.value } }))} />
                                  <button type="button" className={`${btnSecondary} h-8 px-2 text-xs sm:col-span-2`} onClick={() => addDraftItemRequirement(item.id)}>Requisito</button>
                                </div>
                                {expandedDraftChecklist[item.id] && (
                                  <div className="mt-2 space-y-1">
                                    {requirements.map((req, index) => (
                                      <div key={req.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg2 px-2 py-1 text-xs">
                                        <span className="truncate min-w-0">{index + 1}. {req.requisito} — {req.status}</span>
                                        <button type="button" className="shrink-0 font-semibold text-status-danger" onClick={() => removeDraftItemRequirement(item.id, req.id)}>Excluir</button>
                                      </div>
                                    ))}
                                    {requirements.length === 0 && (
                                      <p className="text-[11px] text-muted px-1">Nenhum requisito ainda.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {newOpportunityItemsDraft.length === 0 && (
                            <p className="text-xs text-muted py-2">Nenhum item adicionado ainda.</p>
                          )}
                        </VerticalScrollArrows>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Contatos Chatwoot</h4>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                          <div className="min-w-0 sm:col-span-5">
                            <input
                              className={`${input} h-9 w-full min-w-0 text-sm`}
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
                          <select className={`${select} h-9 min-w-0 text-sm sm:col-span-3`} value={newOpportunityContact.papel} onChange={(event) => setNewOpportunityContact(prev => ({ ...prev, papel: event.target.value }))}>
                            <option value="">Papel do contato</option>
                            {contactRoleOptions.map(option => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                          <input className={`${input} h-9 min-w-0 text-sm sm:col-span-2`} placeholder="Observação" value={newOpportunityContact.observacao} onChange={(event) => setNewOpportunityContact(prev => ({ ...prev, observacao: event.target.value }))} />
                          <button type="button" className={`${btnSecondary} h-9 px-3 text-sm sm:col-span-2`} onClick={addContactToNewOpportunity}>Adicionar</button>
                        </div>
                        <VerticalScrollArrows className="mt-3 max-h-36" contentClassName="space-y-2 pr-0.5">
                          {newOpportunityForm.linked_contacts.map(item => {
                            const contact = contacts.find(c => String(c.id) === String(item.contact_id));
                            const contactUrl = getChatwootContactUrl(contact);
                            const contactDisplayName = getCompanyContactDisplay(
                              contact?.company_name,
                              contact?.name,
                              `Contato ${item.contact_id}`
                            );
                            return (
                              <div key={item.contact_id} className="flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-line bg-surf px-3 py-2 text-xs">
                                <div className="min-w-0 break-words text-ink">
                                  {contactUrl ? (
                                    <a href={contactUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                                      {contactDisplayName}
                                    </a>
                                  ) : (
                                    <span className="font-semibold">{contactDisplayName}</span>
                                  )}
                                  <span className="text-muted">{item.papel ? ` · ${item.papel}` : ''}{item.observacao ? ` (${item.observacao})` : ''}</span>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button type="button" className="text-xs font-semibold text-primary" onClick={() => setPrincipalContactForNewOpportunity(item.contact_id)}>
                                    {item.principal ? 'Principal' : 'Definir principal'}
                                  </button>
                                  <button type="button" className="text-xs font-semibold text-status-danger" onClick={() => removeContactFromNewOpportunity(item.contact_id)}>
                                    Remover
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </VerticalScrollArrows>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Comentário inicial</h4>
                        <textarea
                          className={`${textarea} w-full text-sm`}
                          placeholder="Adicionar comentário inicial da licitação..."
                          value={newOpportunityForm.comentario_inicial || ''}
                          onChange={(event) => setNewOpportunityForm(prev => ({ ...prev, comentario_inicial: event.target.value }))}
                          rows={3}
                        />
                      </section>
                    </VerticalScrollArrows>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surf/95 px-4 py-3 sm:px-5 dark:bg-[#141a28]/95">
                      <button type="button" onClick={resetNewOpportunityFormState} className={btnSecondary}>
                        Cancelar
                      </button>
                      <button type="button" onClick={createOpportunity} className={btnPrimary} disabled={!String(newOpportunityForm.titulo || '').trim()}>
                        Salvar licitação
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}


              {licitacaoSubview === 'board' && (
              <>
              {licitacaoLoading && (
                <div className={`mt-4 ${subtle}`}>Carregando licitações...</div>
              )}

              <div className="mt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <p className="text-[13px] text-muted">Pipeline de licitações · 15 fases (Lei 14.133)</p>
                <span className="inline-flex items-center gap-2 self-start rounded-xl bg-amber/[0.16] px-3.5 py-2 font-mono text-sm font-semibold text-amber">
                  Valor em aberto {formatCompactCurrency(licSummary?.total_value) || 'R$ 0'}
                </span>
              </div>

              <div ref={groupBarRef} className="kanban-group-bar mt-4 mb-2">
                <div className="kanban-group-bar-track">
                  {(() => {
                    const spans = [];
                    licitacaoColumns.forEach((column) => {
                      const g = licGroupForStageNum(getStageNumber(column)) || { id: 'outros', label: 'Outros', color: '#7b87a3' };
                      const last = spans[spans.length - 1];
                      if (last && last.id === g.id) last.colCount += 1;
                      else spans.push({ id: g.id, label: g.label, color: g.color, colCount: 1 });
                    });
                    return spans.map((s) => (
                      <div
                        key={s.id}
                        className="kanban-group-span"
                        style={{
                          width: `calc(${s.colCount} * var(--kanban-col-w) + ${s.colCount - 1} * var(--kanban-col-gap))`,
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
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => scrollBoardBy(-1)}
                    aria-label="Rolar board para a esquerda"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg2 text-muted transition hover:bg-surf2 hover:text-ink"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <div className="kanban-scrollbar scrollbar-theme flex-1" ref={boardScrollbarRef} onScroll={handleTopScroll}>
                    <div style={{ width: boardScrollMetrics.scrollWidth }} />
                  </div>
                  <button
                    type="button"
                    onClick={() => scrollBoardBy(1)}
                    aria-label="Rolar board para a direita"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg2 text-muted transition hover:bg-surf2 hover:text-ink"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="relative">
                <div
                className={`kanban-board-scroll mt-2 flex gap-[var(--kanban-col-gap)] overflow-x-auto pb-4 -mx-1 px-1 ${activeDragId ? 'snap-none is-dnd-active' : 'snap-x snap-mandatory'}`}
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
                    activeDragId={activeDragId}
                    focusedSearchOpportunityId={focusedSearchOpportunityId}
                  />
                ))}
              </div>
              </div>

              {selectedOpportunity && createPortal(
                <div
                  className="fixed inset-0 z-modal flex items-center justify-center p-3 sm:p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="licitacao-detail-title"
                >
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/55"
                    aria-label="Fechar detalhes"
                    onClick={() => {
                      setSelectedOpportunity(null);
                      setContactLinkQuery('');
                    }}
                  />
                  <div className="relative flex w-full max-w-5xl max-h-[min(92vh,920px)] flex-col overflow-hidden rounded-[16px] border border-line bg-surf shadow-lift dark:bg-[#141a28] dark:border-[#232c40]">
                    {/* Header */}
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <h3 id="licitacao-detail-title" className="font-display text-base font-semibold text-ink truncate sm:text-lg">
                          {selectedOpportunity.titulo || 'Oportunidade'}
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {selectedOpportunity.fase && (
                            <span className="inline-flex items-center rounded-md border border-line bg-bg2 px-2 py-0.5 text-[11px] font-medium text-muted">
                              {selectedOpportunity.fase}
                            </span>
                          )}
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            selectedOpportunity.status === 'ativo' ? 'border-status-success/30 bg-status-success/10 text-status-success'
                              : selectedOpportunity.status === 'ganho' ? 'border-status-success/30 bg-status-success/10 text-status-success'
                              : selectedOpportunity.status === 'perdido' || selectedOpportunity.status === 'cancelado' ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
                              : 'border-line bg-bg2 text-muted'
                          }`}>
                            {selectedOpportunity.status || 'ativo'}
                          </span>
                          {selectedOpportunity.uasg_codigo && (
                            <span className="inline-flex items-center rounded-md border border-line bg-bg2 px-2 py-0.5 font-mono text-[11px] text-muted">
                              UASG {selectedOpportunity.uasg_codigo}
                            </span>
                          )}
                          <span className="inline-flex items-center rounded-md border border-amber/25 bg-amber/[0.12] px-2 py-0.5 font-mono text-[11px] font-semibold text-amber">
                            {formatCompactCurrency(selectedOpportunity.valor_oportunidade) || 'R$ 0'}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={deleteSelectedOpportunity}
                          className="h-8 rounded-[10px] border border-status-danger/30 bg-status-danger/10 px-3 text-xs font-semibold text-status-danger transition hover:bg-status-danger/20"
                        >
                          Excluir
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOpportunity(null);
                            setContactLinkQuery('');
                          }}
                          className={iconBtn}
                          aria-label="Fechar"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="space-y-4 px-4 py-4 sm:px-5">
                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Dados do processo</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                          <div className="min-w-0 sm:col-span-2 lg:col-span-6">
                            <label className="mb-1 block text-xs font-medium text-muted">Título da oportunidade</label>
                            <input className={`${input} w-full text-sm`} value={selectedOpportunity.titulo || ''} onChange={(event) => updateSelectedOpportunity({ titulo: event.target.value })} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Número do edital</label>
                            <input className={`${input} w-full text-sm`} value={selectedOpportunity.numero_edital || ''} onChange={(event) => updateSelectedOpportunity({ numero_edital: event.target.value })} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Processo SEI</label>
                            <input className={`${input} w-full text-sm`} value={selectedOpportunity.numero_processo_sei || ''} onChange={(event) => updateSelectedOpportunity({ numero_processo_sei: event.target.value })} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">UASG</label>
                            <input className={`${input} w-full text-sm`} value={selectedOpportunity.uasg_codigo || ''} onChange={(event) => updateSelectedOpportunity({ uasg_codigo: event.target.value })} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Órgão</label>
                            <input className={`${input} w-full text-sm`} value={selectedOpportunity.orgao_nome || ''} onChange={(event) => updateSelectedOpportunity({ orgao_nome: event.target.value })} />
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Fase</label>
                            <select className={`${select} w-full text-sm`} value={selectedOpportunity.fase || ''} onChange={(event) => updateSelectedOpportunity({ fase: event.target.value })}>
                              {licitacaoColumns.map(column => (<option key={column} value={column}>{column}</option>))}
                            </select>
                          </div>
                          <div className="min-w-0 lg:col-span-3">
                            <label className="mb-1 block text-xs font-medium text-muted">Status</label>
                            <select className={`${select} w-full text-sm`} value={selectedOpportunity.status || 'ativo'} onChange={(event) => updateSelectedOpportunity({ status: event.target.value })}>
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
                          <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                            <label className="mb-1 block text-xs font-medium text-muted">Valor da oportunidade</label>
                            <input
                              className={`${input} w-full text-sm disabled:opacity-60`}
                              inputMode="decimal"
                              value={selectedOpportunityValueInput}
                              onChange={(event) => setSelectedOpportunityValueInput(event.target.value.replace(/\./g, ','))}
                              onBlur={commitSelectedOpportunityValue}
                              onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }}
                              disabled={hasItemsDrivingOpportunityValue}
                              title={hasItemsDrivingOpportunityValue ? 'Valor calculado automaticamente pelos itens de participação.' : ''}
                            />
                            {hasItemsDrivingOpportunityValue && (
                              <p className="mt-1 text-[11px] text-muted">Calculado automaticamente pelos itens (qtd × preço de referência).</p>
                            )}
                          </div>
                          <div className="min-w-0 sm:col-span-2 lg:col-span-8 flex items-end">
                            <p className="text-[12px] text-muted pb-2 truncate" title={selectedOpportunity.orgao_nome || ''}>
                              {selectedOpportunity.orgao_nome
                                ? `Órgão: ${selectedOpportunity.orgao_nome}`
                                : 'Sem órgão informado'}
                              {selectedOpportunity.numero_edital ? ` · Edital ${selectedOpportunity.numero_edital}` : ''}
                            </p>
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Links</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link do edital</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={selectedOpportunity.links?.edital || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, edital: event.target.value || null } })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link SEI</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={selectedOpportunity.links?.sei || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, sei: event.target.value || null } })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link PNCP</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={selectedOpportunity.links?.pncp || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, pncp: event.target.value || null } })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Link Compras.gov</label>
                            <input className={`${input} w-full text-sm`} placeholder="https://..." value={selectedOpportunity.links?.compras || ''} onChange={(event) => updateSelectedOpportunity({ links: { ...selectedOpportunity.links, compras: event.target.value || null } })} />
                          </div>
                        </div>
                        {(selectedOpportunity.links?.edital || selectedOpportunity.links?.sei || selectedOpportunity.links?.pncp || selectedOpportunity.links?.compras) && (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {selectedOpportunity.links?.edital && (
                              <a href={selectedOpportunity.links.edital} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-primary hover:underline">Abrir edital ↗</a>
                            )}
                            {selectedOpportunity.links?.sei && (
                              <a href={selectedOpportunity.links.sei} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-primary hover:underline">Abrir SEI ↗</a>
                            )}
                            {selectedOpportunity.links?.pncp && (
                              <a href={selectedOpportunity.links.pncp} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-primary hover:underline">Abrir PNCP ↗</a>
                            )}
                            {selectedOpportunity.links?.compras && (
                              <a href={selectedOpportunity.links.compras} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-primary hover:underline">Abrir Compras.gov ↗</a>
                            )}
                          </div>
                        )}
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Datas importantes</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Publicação do aviso</label>
                            <input type="date" className={`${input} w-full text-sm`} value={selectedOpportunity.data_publicacao ? String(selectedOpportunity.data_publicacao).slice(0, 10) : ''} onChange={(event) => updateSelectedOpportunity({ data_publicacao: event.target.value || null })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Início da proposta</label>
                            <input type="datetime-local" className={`${input} w-full text-sm`} value={selectedOpportunity.data_sessao ? new Date(selectedOpportunity.data_sessao).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_sessao: event.target.value || null })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-status-danger">Fim da proposta</label>
                            <input type="datetime-local" className={`${input} w-full border-status-danger/30 text-sm`} value={selectedOpportunity.data_envio_proposta_limite ? new Date(selectedOpportunity.data_envio_proposta_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_envio_proposta_limite: event.target.value || null })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Assinatura da ata</label>
                            <input type="datetime-local" className={`${input} w-full text-sm`} value={selectedOpportunity.data_assinatura_ata_limite ? new Date(selectedOpportunity.data_assinatura_ata_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_assinatura_ata_limite: event.target.value || null })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Entrega final</label>
                            <input type="datetime-local" className={`${input} w-full text-sm`} value={selectedOpportunity.data_entrega_limite ? new Date(selectedOpportunity.data_entrega_limite).toISOString().slice(0, 16) : ''} onChange={(event) => updateSelectedOpportunity({ data_entrega_limite: event.target.value || null })} />
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-medium text-muted">Dias após assinatura</label>
                            <input type="number" className={`${input} w-full text-sm`} value={selectedOpportunity.prazo_entrega_dias_apos_assinatura || ''} onChange={(event) => updateSelectedOpportunity({ prazo_entrega_dias_apos_assinatura: event.target.value ? Number(event.target.value) : null })} />
                          </div>
                        </div>
                      </section>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4 flex flex-col min-h-0">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Checklist comercial</h4>
                            <span className="text-[11px] tabular-nums text-muted">
                              {selectedCommercialRequirements.filter(r => r.status === 'ok').length}/{selectedCommercialRequirements.length}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <input
                              className={`${input} h-8 min-w-0 flex-1 text-xs`}
                              placeholder="Novo requisito comercial..."
                              value={newRequirementForm.titulo}
                              onChange={(event) => setNewRequirementForm({ titulo: event.target.value })}
                              onKeyDown={(event) => event.key === 'Enter' && addRequirement()}
                            />
                            <button type="button" className={`${btnPrimary} h-8 shrink-0 px-3 text-xs`} onClick={addRequirement}>Adicionar</button>
                          </div>
                          <VerticalScrollArrows className="mt-3 max-h-64 flex-1" contentClassName="space-y-2 pr-0.5">
                            {selectedCommercialRequirements.map(requirement => (
                              <div
                                key={requirement.id}
                                className={`rounded-[12px] border p-2.5 space-y-2 ${
                                  requirement.status === 'ok' ? 'border-status-success/30 bg-status-success/5'
                                    : requirement.status === 'nao_ok' ? 'border-status-danger/30 bg-status-danger/5'
                                    : 'border-line bg-surf'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-bg2 px-0.5">
                                    <button type="button" className={`h-6 w-7 rounded text-[10px] font-bold ${requirement.status === 'ok' ? 'bg-status-success text-white' : 'text-muted hover:bg-status-success/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'ok' })} title="OK">OK</button>
                                    <button type="button" className={`h-6 w-7 rounded text-[10px] font-bold ${requirement.status === 'nao_ok' ? 'bg-status-danger text-white' : 'text-muted hover:bg-status-danger/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'nao_ok' })} title="Não OK">X</button>
                                    <button type="button" className={`h-6 w-7 rounded text-[10px] font-bold ${requirement.status === 'pendente' ? 'bg-status-warning text-white' : 'text-muted hover:bg-status-warning/10'}`} onClick={() => updateRequirement(requirement.id, { status: 'pendente' })} title="Pendente">?</button>
                                  </div>
                                  <input className={`${input} h-7 min-w-0 flex-1 text-xs`} value={requirement.titulo} onChange={(event) => updateRequirement(requirement.id, { titulo: event.target.value })} />
                                  <button type="button" className="h-7 w-7 shrink-0 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger text-xs font-bold" onClick={() => deleteRequirement(requirement.id)} title="Excluir">×</button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  <input className={`${input} h-7 text-xs`} placeholder="Observação" value={requirement.observacao || ''} onChange={(event) => updateRequirement(requirement.id, { observacao: event.target.value })} />
                                  <input className={`${input} h-7 text-xs`} placeholder="Custo previsto" value={requirement.custo_previsto || ''} onChange={(event) => updateRequirement(requirement.id, { custo_previsto: event.target.value ? Number(String(event.target.value).replace(',', '.')) : null })} />
                                  <input className={`${input} h-7 text-xs`} placeholder="Custo real" value={requirement.custo_real || ''} onChange={(event) => updateRequirement(requirement.id, { custo_real: event.target.value ? Number(String(event.target.value).replace(',', '.')) : null })} />
                                </div>
                              </div>
                            ))}
                            {selectedCommercialRequirements.length === 0 && (
                              <p className="py-3 text-center text-xs text-muted">Nenhum requisito comercial.</p>
                            )}
                          </VerticalScrollArrows>
                        </section>

                        <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4 flex flex-col min-h-0">
                          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Contatos Chatwoot</h4>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                            <div className="min-w-0 sm:col-span-5">
                              <input
                                className={`${input} h-8 w-full min-w-0 text-xs`}
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
                            <select className={`${select} h-8 min-w-0 text-xs sm:col-span-3`} value={contactLinkForm.papel} onChange={(event) => setContactLinkForm(prev => ({ ...prev, papel: event.target.value }))}>
                              <option value="">Papel</option>
                              {contactRoleOptions.map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                            <input className={`${input} h-8 min-w-0 text-xs sm:col-span-2`} placeholder="Obs." value={contactLinkForm.observacao} onChange={(event) => setContactLinkForm(prev => ({ ...prev, observacao: event.target.value }))} />
                            <button type="button" className={`${btnSecondary} h-8 px-2 text-xs sm:col-span-2`} onClick={addLinkedContact}>Vincular</button>
                          </div>
                          <VerticalScrollArrows className="mt-3 max-h-64 flex-1" contentClassName="space-y-1.5 pr-0.5">
                            {selectedLinkedContacts.map(link => {
                              const contact = contacts.find(c => String(c.id) === String(link.contact_id || link.id));
                              const contactUrl = getChatwootContactUrl(contact || { id: link.contact_id || link.id, account_id: link.account_id });
                              const contactDisplayName = getCompanyContactDisplay(
                                link.company_name,
                                link.contact_name,
                                `Contato ${link.contact_id || link.id}`
                              );
                              return (
                                <div key={link.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-line bg-surf px-3 py-2 text-xs">
                                  <div className="min-w-0 break-words text-ink">
                                    {contactUrl ? (
                                      <a href={contactUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                                        {contactDisplayName}
                                      </a>
                                    ) : (
                                      <span className="font-semibold">{contactDisplayName}</span>
                                    )}
                                    <span className="text-muted">{link.papel ? ` · ${link.papel}` : ''}{link.observacao ? ` (${link.observacao})` : ''}</span>
                                  </div>
                                  <button type="button" className="shrink-0 text-xs font-semibold text-status-danger" onClick={() => removeLinkedContact(link.id)}>
                                    Remover
                                  </button>
                                </div>
                              );
                            })}
                            {selectedLinkedContacts.length === 0 && (
                              <p className="py-3 text-center text-xs text-muted">Nenhum contato vinculado.</p>
                            )}
                          </VerticalScrollArrows>
                        </section>
                      </div>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Itens de participação</h4>
                            <p className="mt-0.5 text-[11px] text-muted">Clique no item para expandir o checklist técnico</p>
                          </div>
                          <p className="text-[12px] text-muted">
                            Total: <strong className="font-mono text-ink">{formatCurrency(itemsParticipationTotal) || 'R$ 0,00'}</strong>
                          </p>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                          <input className={`${input} h-8 w-full text-xs sm:col-span-2`} placeholder="Item #" value={newItemForm.numero_item} onChange={(event) => setNewItemForm(prev => ({ ...prev, numero_item: event.target.value }))} />
                          <input className={`${input} h-8 w-full text-xs sm:col-span-4`} placeholder="Descrição" value={newItemForm.descricao} onChange={(event) => setNewItemForm(prev => ({ ...prev, descricao: event.target.value }))} />
                          <input className={`${input} h-8 w-full text-xs sm:col-span-2`} placeholder="Modelo" value={newItemForm.modelo_produto} onChange={(event) => setNewItemForm(prev => ({ ...prev, modelo_produto: event.target.value }))} />
                          <input className={`${input} h-8 w-full text-xs sm:col-span-1`} placeholder="Qtd" value={newItemForm.quantidade} onChange={(event) => setNewItemForm(prev => ({ ...prev, quantidade: event.target.value }))} />
                          <input className={`${input} h-8 w-full text-xs sm:col-span-2`} placeholder="Preço ref." inputMode="decimal" value={newItemForm.valor_referencia || ''} onChange={(event) => setNewItemForm(prev => ({ ...prev, valor_referencia: event.target.value.replace(/\./g, ',') }))} />
                          <button type="button" className={`${btnPrimary} h-8 px-2 text-xs sm:col-span-1`} onClick={addItem}>Add</button>
                        </div>

                        <div className="mt-3 space-y-2">
                          {selectedItems.map(item => {
                            const checklistStatus = getItemChecklistStatus(item.id);
                            const itemRequirements = itemRequirementsMap[item.id] || [];
                            const checklistCostTotal = itemRequirements.reduce((sum, req) => sum + (parseCurrency(req.valor_ofertado) || 0), 0);
                            const isExpanded = checklistModalItemId === item.id;
                            return (
                              <div key={item.id} className={`overflow-hidden rounded-[12px] border ${isExpanded ? 'border-primary/45 bg-surf' : 'border-line bg-surf'}`}>
                                <div
                                  className={`flex cursor-pointer items-center gap-2 p-2.5 transition hover:bg-bg2/60 ${isExpanded ? 'bg-primary/[0.06]' : ''}`}
                                  onClick={() => setChecklistModalItemId(isExpanded ? null : item.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      setChecklistModalItemId(isExpanded ? null : item.id);
                                    }
                                  }}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <span className={`shrink-0 text-[10px] text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  <strong className="shrink-0 text-xs text-primary">#{item.numero_item || '—'}</strong>
                                  <span className={`min-w-0 flex-1 text-xs text-ink ${isExpanded ? 'whitespace-normal break-words' : 'truncate'}`}>{item.descricao || 'Sem descrição'}</span>
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${checklistStatus.className}`}>{checklistStatus.counts}</span>
                                  <span className="hidden shrink-0 font-mono text-[10px] text-muted sm:inline">{formatCurrency(getItemParticipationTotal(item)) || 'R$ 0'}</span>
                                  <button
                                    type="button"
                                    className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-status-danger hover:bg-status-danger/10"
                                    onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                                  >
                                    Excluir
                                  </button>
                                </div>

                                {isExpanded && (
                                  <div className="border-t border-line bg-bg2/40 p-3">
                                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                      <div className="min-w-0 col-span-2">
                                        <label className="mb-1 block text-[10px] font-medium text-muted">Descrição</label>
                                        <input className={`${input} h-7 w-full text-xs`} value={item.descricao || ''} onChange={(event) => updateItem(item.id, { descricao: event.target.value })} />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="mb-1 block text-[10px] font-medium text-muted">Modelo</label>
                                        <input className={`${input} h-7 w-full text-xs`} value={item.modelo_produto || ''} onChange={(event) => updateItem(item.id, { modelo_produto: event.target.value })} />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="mb-1 block text-[10px] font-medium text-muted">Quantidade</label>
                                        <input
                                          className={`${input} h-7 w-full text-xs`}
                                          inputMode="decimal"
                                          value={itemQuantityInputMap[item.id] ?? toPtBrInputSafe(item.quantidade)}
                                          onChange={(event) => setItemNumericInput('quantidade', item.id, event.target.value)}
                                          onBlur={() => commitItemNumericInput('quantidade', item)}
                                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="mb-1 block text-[10px] font-medium text-muted">Preço ref.</label>
                                        <input
                                          className={`${input} h-7 w-full text-xs`}
                                          inputMode="decimal"
                                          value={itemReferenceInputMap[item.id] ?? toPtBrInputSafe(item.valor_referencia)}
                                          onChange={(event) => setItemNumericInput('valor_referencia', item.id, event.target.value)}
                                          onBlur={() => commitItemNumericInput('valor_referencia', item)}
                                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="mb-1 block text-[10px] font-medium text-muted">Total</label>
                                        <input className={`${input} h-7 w-full text-xs`} value={formatCurrency(getItemParticipationTotal(item)) || ''} readOnly />
                                      </div>
                                    </div>

                                    <div className="border-t border-line pt-3">
                                      <div className="mb-2 flex items-center justify-between gap-2">
                                        <h5 className="text-xs font-semibold text-ink">Checklist técnico</h5>
                                        <span className="text-[10px] text-muted">
                                          {itemRequirements.filter(r => r.status === 'ok').length}/{itemRequirements.length} · {formatCurrency(checklistCostTotal) || 'R$ 0'}
                                        </span>
                                      </div>
                                      <div className="mb-2 flex gap-2">
                                        <input
                                          className={`${input} h-7 min-w-0 flex-1 text-xs`}
                                          placeholder="Novo requisito técnico..."
                                          value={(newItemRequirementForm[item.id]?.requisito) || ''}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(event) => setNewItemRequirementForm(prev => ({
                                            ...prev,
                                            [item.id]: { ...(prev[item.id] || { status: 'verificar', observacao: '', custo_subitem: '' }), requisito: event.target.value },
                                          }))}
                                          onKeyDown={(event) => { if (event.key === 'Enter') addItemRequirement(item.id); }}
                                        />
                                        <button type="button" className={`${btnPrimary} h-7 shrink-0 px-3 text-[10px]`} onClick={(e) => { e.stopPropagation(); addItemRequirement(item.id); }}>
                                          Adicionar
                                        </button>
                                      </div>
                                      <VerticalScrollArrows className="max-h-48" contentClassName="space-y-1 pr-0.5">
                                        {itemRequirements.map((req, index) => (
                                          <div
                                            key={req.id}
                                            className={`flex flex-wrap items-center gap-1.5 rounded-[10px] border p-1.5 sm:flex-nowrap ${
                                              req.status === 'ok' ? 'border-status-success/30 bg-status-success/5'
                                                : req.status === 'nao_ok' ? 'border-status-danger/30 bg-status-danger/5'
                                                : 'border-line bg-surf'
                                            }`}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted">{index + 1}</span>
                                            <div className="flex h-6 shrink-0 items-center gap-0.5 rounded border border-line bg-bg2 px-0.5">
                                              <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'ok' ? 'bg-status-success text-white' : 'text-muted hover:bg-status-success/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'ok' })}>OK</button>
                                              <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'nao_ok' ? 'bg-status-danger text-white' : 'text-muted hover:bg-status-danger/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'nao_ok' })}>X</button>
                                              <button type="button" className={`h-5 w-6 rounded text-[9px] font-bold ${req.status === 'verificar' || req.status === 'pendente' ? 'bg-status-warning text-white' : 'text-muted hover:bg-status-warning/10'}`} onClick={() => updateItemRequirement(item.id, req.id, { status: 'verificar' })}>?</button>
                                            </div>
                                            <input className={`${input} h-6 min-w-0 flex-1 text-[11px]`} value={req.requisito || ''} onChange={(event) => updateItemRequirement(item.id, req.id, { requisito: event.target.value })} />
                                            <input className={`${input} h-6 w-20 shrink-0 text-[11px] sm:w-24`} placeholder="Obs" value={req.observacao || ''} onChange={(event) => updateItemRequirement(item.id, req.id, { observacao: event.target.value })} />
                                            <input
                                              className={`${input} h-6 w-16 shrink-0 text-[11px] sm:w-20`}
                                              placeholder="Custo"
                                              inputMode="decimal"
                                              value={itemRequirementCostInputMap[`${item.id}:${req.id}`] ?? toPtBrDecimalInput(req.valor_ofertado)}
                                              onChange={(event) => setItemRequirementCostInput(item.id, req.id, event.target.value)}
                                              onBlur={() => commitItemRequirementCost(item.id, req.id, req.valor_ofertado)}
                                              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                            />
                                            <button type="button" className="h-6 w-6 shrink-0 rounded border border-status-danger/30 bg-status-danger/10 text-[10px] font-bold text-status-danger" onClick={() => deleteItemRequirement(item.id, req.id)}>×</button>
                                          </div>
                                        ))}
                                        {itemRequirements.length === 0 && (
                                          <p className="py-2 text-center text-[10px] text-muted">Nenhum requisito técnico.</p>
                                        )}
                                      </VerticalScrollArrows>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {selectedItems.length === 0 && (
                            <p className="py-4 text-center text-xs text-muted">Nenhum item cadastrado.</p>
                          )}
                        </div>
                      </section>

                      <section className="rounded-[14px] border border-line bg-bg2/50 p-3.5 sm:p-4">
                        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Comentários ({selectedComments.length})
                        </h4>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <textarea
                            value={newCommentText}
                            onChange={(event) => setNewCommentText(event.target.value)}
                            onKeyDown={(event) => event.key === 'Enter' && event.ctrlKey && addComment()}
                            placeholder="Adicionar comentário… (Ctrl+Enter)"
                            className={`${textarea} min-h-[4.5rem] flex-1 resize-y text-sm`}
                            rows={2}
                          />
                          <button
                            type="button"
                            onClick={addComment}
                            disabled={!newCommentText.trim()}
                            className={`${btnPrimary} h-9 shrink-0 self-end px-4 text-xs disabled:opacity-50`}
                          >
                            Adicionar
                          </button>
                        </div>
                        <VerticalScrollArrows className="mt-3 max-h-56" contentClassName="space-y-2">
                          {selectedComments.length === 0 ? (
                            <p className="text-xs italic text-muted">Nenhum comentário ainda.</p>
                          ) : (
                            selectedComments.map(comment => (
                              <div key={comment.id} className="rounded-[12px] border border-line bg-surf p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                                      <span className="font-semibold text-ink">{comment.author || 'Admin'}</span>
                                      <span aria-hidden>·</span>
                                      <span>
                                        {new Date(comment.created_at).toLocaleString('pt-BR', {
                                          day: '2-digit', month: '2-digit', year: 'numeric',
                                          hour: '2-digit', minute: '2-digit',
                                        })}
                                      </span>
                                    </div>
                                    <p className="whitespace-pre-wrap text-sm text-ink">{comment.content}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => deleteComment(comment.id)}
                                    className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-status-danger hover:bg-status-danger/10"
                                  >
                                    Excluir
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </VerticalScrollArrows>
                      </section>
                    </VerticalScrollArrows>
                  </div>
                </div>,
                document.body
              )}

              </>
              )}
              </>
              )}

              {licitacaoSubview === 'resultados' && (
                <div className="mt-6 space-y-5">
                  <div className="rounded-[16px] border border-line bg-surf p-4 md:p-5 space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <h2 className={`${sectionTitle} text-base`}>Contratos e resultados</h2>
                        <p className={`${subtle} mt-0.5`}>
                          Vencedores, valores homologados, contratos e atas — por produto, fornecedor ou órgão.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => runPncpOutcomeSearch(1)}
                        disabled={pncpOutcomeLoading}
                        className={`${btnPrimary} h-9 px-4 shrink-0`}
                      >
                        <MagnifyingGlassIcon className="h-4 w-4" />
                        {pncpOutcomeLoading ? 'Buscando…' : 'Buscar'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="min-w-0 md:col-span-2 xl:col-span-1">
                        <label className="mb-1.5 block text-xs font-medium text-muted">Produto / descrição</label>
                        <input
                          className={`${input} w-full text-xs`}
                          placeholder="Produto, item ou descrição"
                          value={pncpOutcomeFilters.q}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, q: event.target.value }))}
                          onKeyDown={(event) => { if (event.key === 'Enter') runPncpOutcomeSearch(1); }}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-xs font-medium text-muted">Fornecedor</label>
                        <input
                          className={`${input} w-full text-xs`}
                          placeholder="Nome do fornecedor"
                          value={pncpOutcomeFilters.fornecedor}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, fornecedor: event.target.value }))}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-xs font-medium text-muted">Tipo</label>
                        <select
                          className={`${select} w-full text-xs`}
                          value={pncpOutcomeFilters.tipo}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, tipo: event.target.value }))}
                        >
                          <option value="todos">Todos</option>
                          <option value="resultado">Resultado</option>
                          <option value="contrato">Contrato</option>
                          <option value="ata">Ata</option>
                        </select>
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-xs font-medium text-muted">CNPJ/CPF do fornecedor</label>
                        <input
                          className={`${input} w-full text-xs`}
                          placeholder="Documento do fornecedor"
                          value={pncpOutcomeFilters.fornecedor_ni}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, fornecedor_ni: event.target.value }))}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-xs font-medium text-muted">CNPJ do órgão</label>
                        <input
                          className={`${input} w-full text-xs`}
                          placeholder="00.000.000/0000-00"
                          value={pncpOutcomeFilters.orgao_cnpj}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, orgao_cnpj: event.target.value }))}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-xs font-medium text-muted">UF</label>
                        <select
                          className={`${select} w-full text-xs`}
                          value={pncpOutcomeFilters.uf || ''}
                          onChange={(event) => setPncpOutcomeFilters(prev => ({ ...prev, uf: event.target.value }))}
                        >
                          <option value="">Todas</option>
                          {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                            <option key={uf} value={uf}>{uf}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {pncpOutcomeError && (
                      <div className="rounded-[12px] border border-status-danger/30 bg-status-danger/10 px-3 py-2.5 text-xs text-status-danger">
                        {pncpOutcomeError}
                      </div>
                    )}
                  </div>

                  {pncpOutcomeResults.items.length > 0 && (
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <div className="rounded-[12px] border border-line bg-surf px-3 py-2.5">
                        <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Exibidos</p>
                        <p className="mt-0.5 font-mono text-lg font-bold text-ink">{pncpOutcomeResults.summary?.count || pncpOutcomeResults.items.length}</p>
                      </div>
                      <div className="rounded-[12px] border border-line bg-surf px-3 py-2.5">
                        <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Valor encontrado</p>
                        <p className="mt-0.5 font-mono text-lg font-bold text-ink">{formatCurrency(pncpOutcomeResults.summary?.total_value) || 'R$ 0,00'}</p>
                      </div>
                      <div className="rounded-[12px] border border-line bg-surf px-3 py-2.5">
                        <p className="font-mono text-[9px] uppercase tracking-wide text-muted2">Total cache/busca</p>
                        <p className="mt-0.5 font-mono text-lg font-bold text-ink">{Number(pncpOutcomeResults.total || 0).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {(pncpOutcomeResults.items || []).map(item => {
                      const stageLabel = item.etapa_comercial === 'contracted' ? 'Contratada'
                        : item.etapa_comercial === 'ata_available' ? 'Ata disponível'
                        : item.etapa_comercial === 'resulted' ? 'Com resultado'
                        : item.etapa_comercial === 'direct_authorized' ? 'Contratação direta'
                        : 'Sem etapa';
                      return (
                        <div key={item.pncp_key} className="rounded-[14px] border border-line bg-surf p-3.5 transition hover:border-primary/40">
                          <div className="grid gap-3 lg:grid-cols-[1fr_140px]">
                            <div className="min-w-0">
                              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{stageLabel}</span>
                                {item.uf && <span className="rounded-md border border-line bg-bg2 px-2 py-0.5 font-mono text-[10px] text-muted">{item.uf}</span>}
                                {item.modalidade && <span className="rounded-md border border-line bg-bg2 px-2 py-0.5 text-[11px] text-muted">{item.modalidade}</span>}
                              </div>
                              <h3 className="text-sm font-semibold text-ink">{item.titulo || item.descricao || item.pncp_key}</h3>
                              {item.descricao && item.titulo && <p className="mt-1 line-clamp-2 text-xs text-muted">{item.descricao}</p>}
                              <div className="mt-2.5 grid gap-1.5 text-xs text-muted sm:grid-cols-2">
                                <p><span className="font-mono text-[10px] uppercase tracking-wide text-muted2">Órgão</span> {item.orgao_nome || item.orgao_cnpj || 'n/d'}</p>
                                <p><span className="font-mono text-[10px] uppercase tracking-wide text-muted2">Fornecedor</span> {item.fornecedor_nome || item.fornecedor_ni || 'n/d'}</p>
                                <p><span className="font-mono text-[10px] uppercase tracking-wide text-muted2">Estimado</span> <span className="font-mono text-ink">{formatCurrency(item.valor_estimado) || 'n/d'}</span></p>
                                <p><span className="font-mono text-[10px] uppercase tracking-wide text-muted2">Homologado</span> <span className="font-mono font-semibold text-ink">{formatCurrency(item.valor_homologado) || 'n/d'}</span></p>
                              </div>
                            </div>
                            <div className="flex flex-row gap-1.5 lg:flex-col lg:border-l lg:border-line lg:pl-3">
                              <button
                                type="button"
                                onClick={() => openPncpOutcomeDossier(item)}
                                className={`${btnPrimary} h-8 px-3 text-xs`}
                              >
                                Dossiê
                              </button>
                              {item.url && (
                                <a href={item.url} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} h-8 px-3 text-xs`}>
                                  PNCP ↗
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!pncpOutcomeLoading && pncpOutcomeResults.items.length === 0 && (
                      <div className="rounded-[14px] border border-dashed border-line bg-surf/60 px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-ink">Nenhum resultado ainda</p>
                        <p className={`${subtle} mt-1 mx-auto max-w-md`}>Busque por produto, fornecedor ou órgão para consultar contratos e resultados no PNCP.</p>
                      </div>
                    )}
                    {pncpOutcomeLoading && (
                      <div className={`${subtle} py-8 text-center`}>Buscando no PNCP…</div>
                    )}
                  </div>

                  {pncpOutcomeResults.totalPaginas > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`} disabled={pncpOutcomeResults.pagina <= 1 || pncpOutcomeLoading} onClick={() => runPncpOutcomeSearch(pncpOutcomeResults.pagina - 1)}>Anterior</button>
                      <span className="font-mono text-xs text-muted">{pncpOutcomeResults.pagina} / {pncpOutcomeResults.totalPaginas}</span>
                      <button type="button" className={`${btnSecondary} h-8 px-3 text-xs disabled:opacity-50`} disabled={pncpOutcomeResults.pagina >= pncpOutcomeResults.totalPaginas || pncpOutcomeLoading} onClick={() => runPncpOutcomeSearch(pncpOutcomeResults.pagina + 1)}>Próxima</button>
                    </div>
                  )}

                  {pncpOutcomeDossier && (
                    <div className={modalOverlay} onClick={() => setPncpOutcomeDossier(null)} role="presentation">
                      <div
                        className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-lift dark:bg-[#111827] dark:border-[#1f2937]"
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                      >
                        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
                          <div className="min-w-0">
                            <h3 className={`${sectionTitle} text-base`}>Dossiê PNCP</h3>
                            <p className={`${subtle} mt-0.5 truncate`}>{pncpOutcomeDossier.normalized_item?.titulo || pncpOutcomeDossier.compra?.objetoCompra || 'Compra PNCP'}</p>
                          </div>
                          <button type="button" className={iconBtn} aria-label="Fechar" onClick={() => setPncpOutcomeDossier(null)}>
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                        <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="px-4 py-4 sm:px-5">
                          {pncpOutcomeDossierLoading ? (
                            <div className={`${subtle} py-8 text-center`}>Carregando dossiê…</div>
                          ) : (
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="rounded-[12px] border border-line bg-bg2/40 p-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Totais</h4>
                                <div className="mt-2 space-y-1.5 text-xs text-muted">
                                  <p>Estimado: <strong className="font-mono text-ink">{formatCurrency(pncpOutcomeDossier.totais?.valor_estimado) || 'n/d'}</strong></p>
                                  <p>Itens pertinentes: <strong className="font-mono text-ink">{formatCurrency(pncpOutcomeDossier.totais?.valor_itens_pertinentes) || 'n/d'}</strong></p>
                                  <p>Homologado: <strong className="font-mono text-ink">{formatCurrency(pncpOutcomeDossier.totais?.valor_homologado) || 'n/d'}</strong></p>
                                  <p>Itens: <strong className="font-mono text-ink">{pncpOutcomeDossier.totais?.total_itens || 0}</strong></p>
                                </div>
                              </div>
                              <div className="rounded-[12px] border border-line bg-bg2/40 p-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Resultados / vencedores</h4>
                                <VerticalScrollArrows className="mt-2 max-h-48" contentClassName="space-y-1.5">
                                  {(pncpOutcomeDossier.resultados || []).slice(0, 30).map((row, index) => (
                                    <div key={`${row.numeroItem || index}-${row.niFornecedor || index}`} className="rounded-lg border border-line bg-surf px-2.5 py-1.5 text-xs">
                                      <p className="font-semibold text-ink">{row.nomeRazaoSocialFornecedor || row.niFornecedor || 'Fornecedor n/d'}</p>
                                      <p className="text-muted">Item {row.numeroItem || 'n/d'} · <span className="font-mono">{formatCurrency(row.valorTotalHomologado) || 'n/d'}</span></p>
                                    </div>
                                  ))}
                                  {(pncpOutcomeDossier.resultados || []).length === 0 && <p className="text-xs text-muted">Nenhum resultado retornado.</p>}
                                </VerticalScrollArrows>
                              </div>
                              <div className="rounded-[12px] border border-line bg-bg2/40 p-3 lg:col-span-2">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Itens</h4>
                                <VerticalScrollArrows className="mt-2 max-h-72" contentClassName="divide-y divide-line">
                                  {(pncpOutcomeDossier.itens || []).slice(0, 80).map((row, index) => (
                                    <div key={`${row.numeroItem || index}`} className="py-2 text-xs">
                                      <p className="font-medium text-ink">#{row.numeroItem || index + 1} {row.descricao || 'Item sem descrição'}</p>
                                      <p className="text-muted">Qtd. {row.quantidade || 'n/d'} · <span className="font-mono">{formatCurrency(row.valorTotal) || 'n/d'}</span> · {row.materialOuServicoNome || ''}</p>
                                    </div>
                                  ))}
                                </VerticalScrollArrows>
                              </div>
                            </div>
                          )}
                        </VerticalScrollArrows>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {licitacaoSubview === 'pca' && (
                <PcaExplorer
                  onPromoted={() => loadLicitacoes()}
                  onSwitchToBoard={() => setLicitacaoSubview('board')}
                  onSwitchToWatchlist={() => setLicitacaoSubview('sinais')}
                  onOpenOpportunity={async (opportunityId) => {
                    setLicitacaoSubview('board');
                    let target = licitacaoOpportunities.find(item => String(item.id) === String(opportunityId));
                    if (!target) {
                      const refreshed = await loadLicitacoes();
                      target = (refreshed || []).find(item => String(item.id) === String(opportunityId));
                    }
                    if (target) {
                      openOpportunity(target);
                    }
                  }}
                />
              )}

              {licitacaoSubview === 'sinais' && (
                <PcaWatchlistPage onPromoted={() => loadLicitacoes()} />
              )}

              {licitacaoSubview === 'editais_watchlist' && (
                <EditalWatchlistPage
                  onNewCountChange={setEditalNewSignalsCount}
                  onImportSignal={async (item, signalId) => {
                    await importPncpLicitacao(item);
                    if (signalId) {
                      try {
                        await axios.put(`/api/licitacoes/editais/signals/${signalId}/status`, { status: 'visto' });
                        await refreshEditalNewSignalsCount();
                      } catch {}
                    }
                  }}
                />
              )}
            </>
          )}

          {activeView === 'Overview' && (
            <div className="mt-6">
              {overviewLoading && (
                <div className={`${subtle} py-10 text-center`}>Carregando gestão de leads…</div>
              )}

              {!overviewLoading && (
                <>
                  <div className="grid gap-2.5 sm:gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 mb-4 sm:mb-6">
                    {[
                      { label: 'Leads totais', value: formatCompactNumber(overviewData.summary?.leads_count ?? 0) || (overviewData.summary?.leads_count ?? 0), icon: UsersIcon, glow: 'rgba(124,92,255,.5)' },
                      { label: 'Clientes ativos', value: overviewData.summary?.customers_count ?? 0, icon: CheckBadgeIcon, glow: 'rgba(54,211,154,.45)' },
                      { label: 'Pipeline aberto', value: formatCompactCurrency(overviewData.summary?.total_value) || 'R$ 0', icon: BanknotesIcon, glow: 'rgba(255,178,77,.4)' },
                      { label: 'Em negociação', value: stageGroupData.filter(g => ['Meio', 'Fundo'].includes(g.group)).reduce((s, g) => s + (g.count || 0), 0), icon: ChartBarIcon, glow: 'rgba(56,214,230,.4)' },
                    ].map((kpi, i) => {
                      const Icon = kpi.icon;
                      return (
                        <div key={i} className={`${card} relative overflow-hidden p-3.5 sm:p-[18px] transition hover:border-primary/30 min-w-0`}>
                          <div className="pointer-events-none absolute -right-8 -top-8 h-[90px] w-[90px] rounded-full blur-[26px] opacity-50" style={{ background: kpi.glow }} />
                          <div className="relative flex items-center justify-between">
                            <Icon className="h-[18px] w-[18px] text-ink/90" />
                          </div>
                          <p className="font-mono text-[29px] font-bold tracking-[-.03em] leading-none mt-3.5 text-ink dark:text-white truncate">{kpi.value}</p>
                          <p className="text-[12.5px] text-muted mt-1.5">{kpi.label}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Linha 1: Ritmo (esquerda) + Evolução do funil (direita) */}
                  <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
                    <div className="xl:col-span-4">
                      {(() => {
                        const monthlyMeta = vendaMeta?.meta != null ? Number(vendaMeta.meta) : processBlueprint.revenueEngine.monthly.revenue;
                        const funnelStages = buildFunnelTargets(monthlyMeta);
                        const paceAgents = Array.isArray(funnelPace?.agents) && funnelPace.agents.length
                          ? funnelPace.agents
                          : (overviewData.byAgent || [])
                            .filter((a) => a.agent_id != null)
                            .map((a) => ({ id: a.agent_id, name: a.agent || `Agente #${a.agent_id}` }));
                        return (
                          <TeamPaceCard
                            className="h-full"
                            stages={funnelStages}
                            pace={funnelPace}
                            agents={paceAgents}
                            agentId={paceAgentId}
                            onAgentChange={setPaceAgentId}
                            metric={paceMetric}
                            onMetricChange={setPaceMetric}
                            revenueMeta={monthlyMeta}
                            onOpenDetails={() => setShowFunnelPaceModal(true)}
                          />
                        );
                      })()}
                    </div>

                    <div className={`${card} flex min-h-0 flex-col p-4 xl:col-span-8 xl:p-5`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Evolução do funil</h3>
                          <p className={`${subtle} mt-0.5`}>
                            {historyMetric === 'count' ? 'Série por quantidade' : 'Série por valor de pipeline'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <MetricToggle value={historyMetric} onChange={setHistoryMetric} />
                          <div className="hidden items-center gap-2 lg:flex">
                            {historySeries.map(serie => (
                              <span key={serie.id} className="flex items-center gap-1 text-[11px] text-muted">
                                <span className="h-2 w-2 rounded-[2px]" style={{ background: colorForGroupLabel(serie.id) }} />
                                {serie.id}
                              </span>
                            ))}
                          </div>
                          <select value={historyGranularity} onChange={(event) => setHistoryGranularity(event.target.value)} className={`${select} h-8 text-xs`}>
                            <option value="day">Diário</option>
                            <option value="week">Semanal</option>
                            <option value="month">Mensal</option>
                          </select>
                        </div>
                      </div>
                      <div className="relative h-[300px] w-full xl:h-[380px]">
                        {historySeries.length ? (
                          <ResponsiveLine
                            data={historySeries}
                            margin={{ top: 12, right: 16, bottom: 48, left: 40 }}
                            xScale={{ type: 'point' }}
                            yScale={{ type: 'linear', min: 0, max: 'auto', stacked: true }}
                            curve="linear"
                            axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: 0, tickValues: historyTicks, format: historyTickFormat }}
                            axisLeft={{ tickSize: 0, tickPadding: 6, tickValues: 4, format: value => historyMetric === 'value' ? (formatCompactCurrency(value) || 'R$ 0') : (formatCompactNumber(value) || value) }}
                            colors={({ id }) => colorForGroupLabel(id)}
                            enableArea
                            defs={[{
                              id: 'areaFade',
                              type: 'linearGradient',
                              colors: [
                                { offset: 0, color: 'inherit', opacity: 0.42 },
                                { offset: 100, color: 'inherit', opacity: 0 },
                              ],
                            }]}
                            fill={[{ match: '*', id: 'areaFade' }]}
                            enableGridX={false}
                            gridYValues={4}
                            lineWidth={2}
                            enablePoints={false}
                            useMesh
                            enableSlices="x"
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
                                        <span className="font-medium">{historyMetric === 'value' ? (formatCompactCurrency(point.data.y) || 'R$ 0') : (formatCompactNumber(point.data.y) || point.data.y)}</span>
                                      </div>
                                    ))}
                                    <div className="border-t border-border mt-1 pt-1 flex justify-between font-semibold">
                                      <span>Total</span>
                                      <span>{historyMetric === 'value' ? (formatCompactCurrency(total) || 'R$ 0') : (formatCompactNumber(total) || total)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                            theme={chartTheme}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center"><span className={subtle}>Sem dados para exibir</span></div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Linha 2: Segmentação densa — mapa + canal + etiqueta */}
                  <div className="mt-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className={subtle}>Clique em estado, canal ou etiqueta para cruzar os filtros.</p>
                      {segData.active && (
                        <button
                          type="button"
                          onClick={() => setSegFilter({ uf: null, channel: null, label: null })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
                        >
                          {[segFilter.uf, segFilter.channel, segFilter.label].filter(Boolean).join(' · ')} ×
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    {(() => {
                      const toRows = (map, metric) => {
                        const key = metric === 'count' ? 'count' : 'value';
                        return Array.from(map.entries())
                          .map(([k, v]) => ({ key: k, metric: v[key] || 0 }))
                          .filter(row => row.metric > 0)
                          .sort((a, b) => b.metric - a.metric);
                      };
                      const fmtBy = (metric) => (n) => (
                        metric === 'count'
                          ? (formatCompactNumber(n) || n)
                          : (formatCompactCurrency(n) || 'R$ 0')
                      );
                      const ufRows = toRows(segData.byUf, mapMetric);
                      const channelRows = toRows(segData.byChannel, channelMetric).slice(0, 8);
                      const labelRows = toRows(segData.byLabel, labelMetric).slice(0, 8);
                      const ufMax = Math.max(...ufRows.map(r => r.metric), 1);
                      const chMax = Math.max(...channelRows.map(r => r.metric), 1);
                      const lbMax = Math.max(...labelRows.map(r => r.metric), 1);
                      const fmtMap = fmtBy(mapMetric);
                      const fmtChannel = fmtBy(channelMetric);
                      const fmtLabel = fmtBy(labelMetric);
                      const chPalette = ['#38d6e6', '#5a93ff', '#7c5cff', '#a78bff', '#ffb24d', '#36d39a'];
                      const lbPalette = ['#ff5d72', '#a78bff', '#ffb24d', '#7b87a3', '#36d39a', '#5a93ff', '#38d6e6'];
                      const plotUf = (uf) => {
                        const coords = BR_STATE_COORDS[uf];
                        if (!coords) return null;
                        const [lat, lon] = coords;
                        return {
                          left: 12 + ((lon + 73.99) / 40.2) * 76,
                          top: 8 + ((5.3 - lat) / 39.2) * 84,
                        };
                      };
                      return (
                        <>
                    <div className={`${card} p-4 lg:col-span-6 xl:col-span-5`}>
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Leads por estado</h3>
                          <p className={`${subtle} mt-0.5`}>Heatmap por {mapMetric === 'count' ? 'volume' : 'valor'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted">{ufRows.length} UFs</span>
                          <MetricToggle value={mapMetric} onChange={setMapMetric} />
                        </div>
                      </div>
                      {ufRows.length ? (
                        <BrazilChoroplethMap
                          metricByUf={Object.fromEntries(ufRows.map((r) => [r.key, r.metric]))}
                          ufMax={ufMax}
                          selectedUf={segFilter.uf}
                          onSelectUf={(uf) => setSegFilter((prev) => ({ ...prev, uf: prev.uf === uf ? null : uf }))}
                          fmtMetric={fmtMap}
                          plotUf={plotUf}
                          ufRows={ufRows}
                        />
                      ) : (
                        <div className={`${subtle} py-8 text-center`}>Sem dados por estado</div>
                      )}
                    </div>

                    <div className={`${card} p-4 lg:col-span-3 xl:col-span-3`}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Por canal</h3>
                          <p className={`${subtle} mt-0.5`}>{channelMetric === 'count' ? 'Origem dos leads' : 'Valor por origem'}</p>
                        </div>
                        <MetricToggle value={channelMetric} onChange={setChannelMetric} />
                      </div>
                      {channelRows.length ? (
                        <div className="space-y-1.5">
                          {channelRows.map((row, idx) => {
                            const selected = segFilter.channel === row.key;
                            return (
                              <button
                                key={row.key}
                                type="button"
                                onClick={() => setSegFilter(prev => ({ ...prev, channel: selected ? null : row.key }))}
                                className={`grid w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-surf2 ${channelMetric === 'value' ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr_auto]'} ${selected ? 'bg-primary/10' : ''}`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`truncate text-[12px] ${selected ? 'font-semibold text-primary' : 'text-muted'}`}>{row.key}</span>
                                    <span className="shrink-0 font-mono text-[11px] text-ink">{fmtChannel(row.metric)}</span>
                                  </div>
                                  <div className="mt-1 h-1.5 rounded-full bg-bg2">
                                    <div className="h-full rounded-full" style={{ width: `${Math.max((row.metric / chMax) * 100, 4)}%`, background: chPalette[idx % chPalette.length] }} />
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={`${subtle} py-6 text-center`}>Sem canal</div>
                      )}
                    </div>

                    <div className={`${card} p-4 lg:col-span-3 xl:col-span-4`}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Por etiqueta</h3>
                          <p className={`${subtle} mt-0.5`}>{labelMetric === 'count' ? 'Tags no funil' : 'Valor por tag'}</p>
                        </div>
                        <MetricToggle value={labelMetric} onChange={setLabelMetric} />
                      </div>
                      {labelRows.length ? (
                        <div className="space-y-1.5">
                          {labelRows.map((row, idx) => {
                            const selected = segFilter.label === row.key;
                            return (
                              <button
                                key={row.key}
                                type="button"
                                onClick={() => setSegFilter(prev => ({ ...prev, label: selected ? null : row.key }))}
                                className={`grid w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-surf2 ${selected ? 'bg-primary/10' : ''}`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`truncate text-[12px] ${selected ? 'font-semibold text-primary' : 'text-muted'}`}>{row.key}</span>
                                    <span className="shrink-0 font-mono text-[11px] text-ink">{fmtLabel(row.metric)}</span>
                                  </div>
                                  <div className="mt-1 h-1.5 rounded-full bg-bg2">
                                    <div className="h-full rounded-full" style={{ width: `${Math.max((row.metric / lbMax) * 100, 4)}%`, background: lbPalette[idx % lbPalette.length] }} />
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={`${subtle} py-6 text-center`}>Sem etiqueta</div>
                      )}
                    </div>
                        </>
                      );
                    })()}
                    </div>
                  </div>

                  {/* Linha 3: Faturamento + Ações (lado a lado, ações compactas + paginação) */}
                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <div className={`${card} p-4 xl:col-span-4`}>
                      <h3 className={`${sectionTitle} text-base mb-3`}>Faturamento por vendedor</h3>
                      {overviewData.faturamentoVendedores.length ? (
                        <div className="space-y-3">
                          {(() => {
                            const rows = [...overviewData.faturamentoVendedores]
                              .map(row => ({
                                vendedor: row.vendedor || 'Sem vendedor',
                                receita: Number(row.receita) || 0,
                                vendas: Number(row.vendas) || 0,
                              }))
                              .filter(row => row.receita > 0 || row.vendas > 0)
                              .sort((a, b) => b.receita - a.receita)
                              .slice(0, 6);
                            const max = Math.max(...rows.map(row => row.receita), 1);
                            return rows.map((row, idx) => (
                              <div key={row.vendedor || idx} className="min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-[12px] font-semibold text-ink dark:text-white">{row.vendedor}</p>
                                  <span className="shrink-0 font-mono text-[12px] font-bold text-ink dark:text-white">{formatCompactCurrency(row.receita) || 'R$ 0'}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cardAlt">
                                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#36d39a,#38d6e6)]" style={{ width: `${Math.max((row.receita / max) * 100, 3)}%` }} />
                                  </div>
                                  <span className="font-mono text-[10px] text-muted">{row.vendas}</span>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      ) : (
                        <div className={`${subtle} py-6 text-center`}>Sem faturamento</div>
                      )}
                    </div>

                    <div className={`${card} overflow-hidden xl:col-span-8`}>
                      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Ações recentes</h3>
                          <p className={`${subtle} mt-0.5`}>Painel e Chatwoot</p>
                        </div>
                        <div className="inline-flex self-start rounded-lg border border-line bg-bg2 p-0.5 sm:self-auto">
                          {[
                            ['all', 'Todas'],
                            ['platform', 'Painel'],
                            ['chatwoot', 'Chatwoot'],
                          ].map(([source, label]) => (
                            <button
                              key={source}
                              type="button"
                              onClick={() => { setRecentActionsSource(source); setRecentActionsPage(0); }}
                              className={`h-7 rounded-md px-2.5 text-xs font-semibold transition ${recentActionsSource === source ? 'bg-surf text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(() => {
                        const actions = overviewData.recentActions.filter(action => recentActionsSource === 'all' || action.source === recentActionsSource);
                        const totalPages = Math.max(1, Math.ceil(actions.length / RECENT_ACTIONS_PAGE_SIZE));
                        const page = Math.min(recentActionsPage, totalPages - 1);
                        const pageActions = actions.slice(page * RECENT_ACTIONS_PAGE_SIZE, (page + 1) * RECENT_ACTIONS_PAGE_SIZE);
                        const describeAction = (action) => {
                          if (action.action === 'move_card') return <>moveu <strong className="font-semibold text-ink">{action.entity_name}</strong> de <span className="text-ink">{action.from_stage || 'sem etapa'}</span> para <span className="text-ink">{action.to_stage}</span></>;
                          if (action.action === 'start_conversation') return <>iniciou conversa com <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          if (action.action === 'new_contact') return <>adicionou <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          if (action.action === 'create_opportunity') return <>criou <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          if (action.action === 'update_opportunity') return <>atualizou <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          if (action.action === 'move_opportunity') return <>moveu <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          if (action.action === 'delete_opportunity') return <>excluiu <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                          return <>{action.action} <strong className="font-semibold text-ink">{action.entity_name}</strong></>;
                        };
                        if (!actions.length) {
                          return <div className={`${subtle} py-6 text-center`}>Nenhuma atividade nesta origem.</div>;
                        }
                        return (
                          <>
                            <div className="divide-y divide-line">
                              {pageActions.map((action) => {
                                const isChatwoot = action.source === 'chatwoot';
                                const rawActorName = String(action.actor_name || '').trim();
                                const actorName = isChatwoot && /^(sistema|system)$/i.test(rawActorName)
                                  ? 'Chatwoot'
                                  : rawActorName || (isChatwoot ? 'Chatwoot' : 'Plataforma');
                                const actionVisual = {
                                  move_card: { Icon: ViewColumnsIcon, className: 'bg-primary/15 text-primary' },
                                  start_conversation: { Icon: ChatBubbleLeftRightIcon, className: 'bg-cyan/15 text-cyan' },
                                  new_contact: { Icon: UserPlusIcon, className: 'bg-emerald-500/15 text-emerald-500' },
                                  create_opportunity: { Icon: PlusIcon, className: 'bg-emerald-500/15 text-emerald-500' },
                                  update_opportunity: { Icon: PencilSquareIcon, className: 'bg-amber-400/15 text-amber-400' },
                                  move_opportunity: { Icon: ViewColumnsIcon, className: 'bg-primary/15 text-primary' },
                                  delete_opportunity: { Icon: TrashIcon, className: 'bg-red-500/15 text-red-400' },
                                }[action.action] || { Icon: BellIcon, className: isChatwoot ? 'bg-cyan/15 text-cyan' : 'bg-primary/15 text-primary' };
                                const ActionIcon = actionVisual.Icon;
                                return (
                                  <div key={`${action.source}-${action.id}`} className="flex items-center gap-2.5 px-3 py-2">
                                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${actionVisual.className}`}>
                                      <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[12px] leading-snug text-muted">
                                        <span className="font-semibold text-ink">{actorName}</span>{' '}
                                        {describeAction(action)}
                                      </p>
                                    </div>
                                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${isChatwoot ? 'bg-cyan/10 text-cyan' : 'bg-primary/10 text-primary'}`}>
                                        {isChatwoot ? 'CW' : 'Painel'}
                                      </span>
                                      <span className="font-mono text-[10px] text-muted">
                                        {action.occurred_at ? new Date(action.occurred_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
                              <span className="font-mono text-[11px] text-muted">
                                {actions.length === 0 ? '0' : `${page * RECENT_ACTIONS_PAGE_SIZE + 1}–${Math.min((page + 1) * RECENT_ACTIONS_PAGE_SIZE, actions.length)}`}
                                {' '}de {actions.length}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={page <= 0}
                                  onClick={() => setRecentActionsPage((p) => Math.max(0, p - 1))}
                                  className={`${btnGhost} h-7 px-2 text-xs disabled:opacity-40`}
                                >
                                  Anterior
                                </button>
                                <span className="min-w-[3.5rem] text-center font-mono text-[11px] text-muted">
                                  {page + 1}/{totalPages}
                                </span>
                                <button
                                  type="button"
                                  disabled={page >= totalPages - 1}
                                  onClick={() => setRecentActionsPage((p) => Math.min(totalPages - 1, p + 1))}
                                  className={`${btnGhost} h-7 px-2 text-xs disabled:opacity-40`}
                                >
                                  Próxima
                                </button>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </>
              )}

              {showFunnelPaceModal && (() => {
                const monthlyMeta = vendaMeta?.meta != null ? Number(vendaMeta.meta) : processBlueprint.revenueEngine.monthly.revenue;
                const funnelStages = buildFunnelTargets(monthlyMeta);
                const stockByKey = Object.fromEntries(
                  funnelStages.map((step) => [step.key, countStockForStages(stageFunnelData, step.stockStages)])
                );
                const revenueDone = vendaMeta?.configured && vendaMeta?.receita != null ? Number(vendaMeta.receita) : null;
                const day = funnelPace?.day || {};
                const month = funnelPace?.month || {};
                const actualByKey = Object.fromEntries(
                  funnelStages.map((step) => {
                    if (step.key === 'contatos') {
                      return [step.key, {
                        day: Number(day.contatos?.total) || 0,
                        month: Number(month.contatos?.total) || 0,
                        breakdown: {
                          messages: Number(day.contatos?.messages) || 0,
                          notes: Number(day.contatos?.notes) || 0,
                        },
                      }];
                    }
                    return [step.key, {
                      day: Number(day[step.key]) || 0,
                      month: Number(month[step.key]) || 0,
                    }];
                  })
                );
                return (
                  <div
                    className={modalOverlay}
                    onClick={() => setShowFunnelPaceModal(false)}
                    role="presentation"
                  >
                    <div
                      className={`${modalPanel} flex max-h-[90vh] max-w-2xl flex-col overflow-hidden`}
                      onClick={(e) => e.stopPropagation()}
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="funnel-pace-title"
                    >
                      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-muted">Ritmo do time</p>
                          <h2 id="funnel-pace-title" className="font-display text-xl font-semibold text-ink dark:text-white">
                            Como lemos o funil
                          </h2>
                          <p className={`${subtle} mt-1`}>
                            O card mostra o dia a dia. Aqui: metas, taxas e o que conta em cada etapa.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowFunnelPaceModal(false)}
                          className={iconBtn}
                          aria-label="Fechar"
                        >
                          <XMarkIcon className="h-5 w-5" />
                        </button>
                      </div>
                      <VerticalScrollArrows className="min-h-0 flex-1">
                        <PaceDetailsPanel
                          stages={funnelStages}
                          stockByKey={stockByKey}
                          actualByKey={actualByKey}
                          revenueMeta={monthlyMeta}
                          revenueDone={revenueDone}
                          rules={funnelPace?.rules || null}
                          stageGroups={stageGroupData}
                        />
                      </VerticalScrollArrows>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeView === 'Disparo WhatsApp' && (() => {
            const audienceCount = disparoFunil.length + disparoTags.length + disparoCanais.length + disparoDDDs.length + disparoContatos.length;
            const activeAudienceGroups = [
              disparoFunil.length ? 'Funil' : null,
              disparoTags.length ? 'Tags' : null,
              disparoCanais.length ? 'Canal' : null,
              disparoDDDs.length ? 'DDD' : null,
              disparoContatos.length ? 'Contatos' : null,
            ].filter(Boolean);
            const disparoContatosSet = new Set(disparoContatos.map(String));
            const getContactLabels = (contact) => (
              Array.isArray(contact.labels)
                ? contact.labels.map(label => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
                : []
            );
            const getContactPhoneRaw = (contact) => {
              const attrs = contact.custom_attributes || {};
              const add = contact.additional_attributes || {};
              return contact.phone_number
                || attrs.Telefone
                || attrs.WhatsApp
                || attrs.whatsapp
                || attrs.ddd_telefone_1
                || attrs.ddd_telefone_2
                || add.phone_number
                || add.phone
                || '';
            };
            const getContactDdd = (contact) => {
              const digits = String(getContactPhoneRaw(contact)).replace(/\D/g, '');
              if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2, 4);
              if (digits.length >= 10) return digits.slice(0, 2);
              return '';
            };
            const contactHasWhatsappPhone = (contact) => {
              const digits = String(getContactPhoneRaw(contact)).replace(/\D/g, '');
              return digits.length >= 10;
            };
            const formatContactPhone = (contact) => {
              const digits = String(getContactPhoneRaw(contact)).replace(/\D/g, '');
              if (!digits) return 'sem telefone';
              const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
              if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
              if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
              return digits;
            };
            const matchesAudience = (contact, exceptGroup) => {
              const attrs = contact.custom_attributes || {};
              if (exceptGroup !== 'funil' && disparoFunil.length && !disparoFunil.includes(attrs.Funil_Vendas)) return false;
              if (exceptGroup !== 'tags' && disparoTags.length) {
                const labels = getContactLabels(contact);
                if (!disparoTags.some(tag => labels.includes(tag))) return false;
              }
              if (exceptGroup !== 'canal' && disparoCanais.length && !disparoCanais.includes(String(attrs.Canal || '').trim())) return false;
              if (exceptGroup !== 'ddd' && disparoDDDs.length && !disparoDDDs.includes(getContactDdd(contact))) return false;
              if (exceptGroup !== 'contatos' && disparoContatos.length && !disparoContatosSet.has(String(contact.id))) return false;
              return true;
            };
            const countAudienceOption = (group, value) => contacts.filter(contact => {
              if (!matchesAudience(contact, group)) return false;
              const attrs = contact.custom_attributes || {};
              if (group === 'funil') return attrs.Funil_Vendas === value;
              if (group === 'tags') return getContactLabels(contact).includes(value);
              if (group === 'canal') return String(attrs.Canal || '').trim() === value;
              if (group === 'ddd') return getContactDdd(contact) === value;
              return false;
            }).length;
            const matchedContactList = audienceCount > 0
              ? contacts.filter(contact => matchesAudience(contact) && contactHasWhatsappPhone(contact))
              : [];
            const matchedContacts = matchedContactList.length;
            const toggleDisparoContato = (contactId) => {
              const id = String(contactId);
              setDisparoContatos(prev => (
                prev.map(String).includes(id)
                  ? prev.filter(x => String(x) !== id)
                  : [...prev, Number(contactId) || id]
              ));
            };
            const disparoContatosSelecionados = disparoContatos
              .map(id => contacts.find(c => String(c.id) === String(id)) || { id, name: `Contato #${id}` })
              .filter(Boolean);
            const disparoContatosBuscaList = (() => {
              const query = normalizeText(disparoContatoBusca).trim();
              const base = contacts.filter(contact => {
                if (!contactHasWhatsappPhone(contact)) return false;
                if (!matchesAudience(contact, 'contatos')) return false;
                if (!query) return true;
                return contactMatchesQuery(contact, disparoContatoBusca);
              });
              // Selecionados primeiro, depois por nome.
              return base
                .sort((a, b) => {
                  const aOn = disparoContatosSet.has(String(a.id)) ? 0 : 1;
                  const bOn = disparoContatosSet.has(String(b.id)) ? 0 : 1;
                  if (aOn !== bOn) return aOn - bOn;
                  return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
                })
                .slice(0, 80);
            })();
            const messageCount = disparoMensagens.filter(m => (m.texto || '').trim() || m.arquivo_base64).length;
            const incompleteMedia = disparoMensagens.some(m => m.tipo && m.tipo !== 'texto' && !m.arquivo_base64);
            const openInstances = disparoInstancias.filter(i => String(i.connection_state || i.status).toLowerCase() === 'open').length;
            const instancesOk = disparoInstanciasSel.length > 0
              && disparoInstanciasStatus.verificado
              && disparoInstancias.every(i => !disparoInstanciasSel.includes(String(i.id ?? i.instancia_nome ?? i.nome)) || String(i.connection_state || i.status).toLowerCase() === 'open');
            const rhythmOk = Number(disparoConfig.maxPerDay) > 0
              && Number(disparoConfig.minInterval) >= 30
              && Number(disparoConfig.maxInterval) >= Number(disparoConfig.minInterval)
              && Array.isArray(disparoConfig.diasSemana) && disparoConfig.diasSemana.length > 0;
            const audienceOk = audienceCount > 0 && matchedContacts > 0;
            const messagesOk = messageCount > 0 && !incompleteMedia;
            const readyToLaunch = audienceOk && messagesOk && instancesOk && rhythmOk && !disparoSending;
            const firstMessage = disparoMensagens.find(m => (m.texto || '').trim())?.texto || '';
            const firstMedia = disparoMensagens.find(m => m.arquivo_base64 || (m.tipo && m.tipo !== 'texto'));
            // Prévia real: contacts.name do Chatwoot no recorte (mesmo campo que o backend usa).
            const previewContact = matchedContactList[0] || null;
            const previewNomeCompleto = String(previewContact?.name || '').trim();
            const previewNome = previewNomeCompleto.split(/\s+/).filter(Boolean)[0] || '';
            const previewIsReal = Boolean(previewNome);
            const personalizarPreview = (texto) => {
              if (!texto) return texto;
              const nome = previewNome || 'cliente';
              const completo = previewNomeCompleto || nome;
              const empresa = String(previewContact?.additional_attributes?.company_name || previewContact?.company_name || '').trim() || completo;
              return String(texto)
                .replace(/\{nome_completo\}/gi, completo)
                .replace(/\{empresa\}/gi, empresa)
                .replace(/\{nome\}/gi, nome);
            };
            const periodLabel = { integral: '24h', comercial: '8h–18h', tarde: '12h–18h' }[disparoConfig.sendPeriod] || disparoConfig.sendPeriod;
            const dayLabels = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };
            const selectedDays = [...disparoConfig.diasSemana].sort((a, b) => a - b).map(d => dayLabels[d]).join(' · ') || '—';
            const healthOk = disparoConfigured && disparoInstanciasStatus.verificado && !disparoInstanciasStatus.error;
            const healthLabel = !disparoConfigured
              ? 'Webhook não configurado'
              : disparoInstanciasStatus.error
                ? 'Falha ao verificar instâncias'
                : disparoInstanciasStatus.verificado
                  ? `${openInstances} instância${openInstances === 1 ? '' : 's'} online`
                  : 'Verificando instâncias…';
            const chipOn = 'border-primary/40 bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgba(124,92,255,.12)]';
            const chipOff = 'border-line bg-bg2 text-muted hover:border-line2 hover:text-ink';
            const modoTabs = [
              { key: 'funil', label: 'Funil', count: disparoFunil.length },
              { key: 'tags', label: 'Tags', count: disparoTags.length },
              { key: 'canal', label: 'Canal', count: disparoCanais.length },
              { key: 'ddd', label: 'DDD', count: disparoDDDs.length },
              { key: 'contatos', label: 'Contatos', count: disparoContatos.length },
            ];
            const steps = [
              {
                id: 'publico',
                label: 'Público',
                short: 'Quem recebe',
                ok: audienceOk,
                summary: audienceOk
                  ? `${matchedContacts.toLocaleString('pt-BR')} contato${matchedContacts === 1 ? '' : 's'} · ${activeAudienceGroups.join(' + ')}`
                  : audienceCount > 0
                    ? 'Filtros sem contatos no recorte'
                    : 'Selecione funil, tags, canal, DDD ou contatos',
                blockReason: audienceCount === 0
                  ? 'Selecione ao menos um filtro de público para continuar.'
                  : matchedContacts === 0
                    ? 'O recorte atual não tem contatos. Ajuste os filtros.'
                    : '',
              },
              {
                id: 'mensagens',
                label: 'Mensagens',
                short: 'O que enviar',
                ok: messagesOk,
                summary: messagesOk
                  ? `${messageCount} mensagem${messageCount === 1 ? '' : 'ns'} no pool`
                  : incompleteMedia
                    ? 'Há mídia sem arquivo anexado'
                    : 'Escreva ao menos uma mensagem',
                blockReason: incompleteMedia
                  ? 'Anexe o arquivo das mensagens de mídia ou troque o tipo para texto.'
                  : messageCount === 0
                    ? 'Escreva ou anexe ao menos uma mensagem completa.'
                    : '',
              },
              {
                id: 'instancias',
                label: 'Instâncias',
                short: 'Por onde envia',
                ok: instancesOk,
                summary: instancesOk
                  ? `${disparoInstanciasSel.length} selecionada${disparoInstanciasSel.length === 1 ? '' : 's'} · ${disparoNome.trim() || 'sem nome'}`
                  : !disparoInstanciasStatus.verificado
                    ? 'Estado das instâncias ainda não verificado'
                    : 'Selecione ao menos uma instância online',
                blockReason: !disparoInstanciasStatus.verificado
                  ? 'Aguarde a verificação das instâncias (ou recarregue a página).'
                  : disparoInstanciasSel.length === 0
                    ? 'Selecione ao menos uma instância conectada.'
                    : 'Uma das instâncias selecionadas não está online.',
              },
              {
                id: 'ritmo',
                label: 'Ritmo',
                short: 'Quando e quanto',
                ok: rhythmOk,
                summary: rhythmOk
                  ? `${disparoConfig.maxPerDay}/dia · ${periodLabel} · ${selectedDays}`
                  : 'Defina limites, intervalo e dias da semana',
                blockReason: Number(disparoConfig.maxPerDay) <= 0
                  ? 'Informe um máximo diário maior que zero.'
                  : Number(disparoConfig.minInterval) < 30
                    ? 'Intervalo mínimo deve ser pelo menos 30 segundos.'
                    : Number(disparoConfig.maxInterval) < Number(disparoConfig.minInterval)
                      ? 'Intervalo máximo deve ser ≥ ao mínimo.'
                      : !disparoConfig.diasSemana?.length
                        ? 'Selecione ao menos um dia da semana.'
                        : '',
              },
              {
                id: 'revisao',
                label: 'Revisão',
                short: 'Confirmar e enviar',
                ok: readyToLaunch || (!disparoSending && audienceOk && messagesOk && instancesOk && rhythmOk),
                summary: readyToLaunch || (audienceOk && messagesOk && instancesOk && rhythmOk)
                  ? 'Tudo preenchido — pronto para disparar'
                  : 'Complete as etapas anteriores',
                blockReason: '',
              },
            ];
            const maxReachable = (() => {
              let idx = 0;
              while (idx < steps.length - 1 && steps[idx].ok) idx += 1;
              return idx;
            })();
            const currentStep = Math.min(Math.max(disparoStep, 0), steps.length - 1);
            const step = steps[currentStep];
            const canGoNext = currentStep < steps.length - 1 && step.ok;
            const goNext = () => {
              if (!canGoNext) return;
              setDisparoStep(s => Math.min(s + 1, steps.length - 1));
            };
            const goBack = () => setDisparoStep(s => Math.max(s - 1, 0));
            const goToStep = (idx) => {
              if (idx <= maxReachable) setDisparoStep(idx);
            };
            const renderOptionChip = (key, label, on, count, onToggle) => (
              <button
                key={key}
                type="button"
                onClick={onToggle}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-left text-xs font-medium transition ${on ? chipOn : chipOff}`}
              >
                <span className="min-w-0 truncate">{label}</span>
                <span className={`font-mono text-[11px] tabular-nums ${on ? 'text-primary/80' : 'text-muted2'}`}>{count}</span>
              </button>
            );
            const emptyAudience = (
              <div className="flex min-h-[7rem] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-bg2/60 px-4 py-6 text-center">
                <p className="text-sm font-medium text-ink">Nenhuma opção com contatos</p>
                <p className={`${subtle} mt-1 max-w-sm`}>Ajuste os outros filtros ou importe leads para liberar segmentos nesta aba.</p>
              </div>
            );

            const stepBody = (() => {
              if (currentStep === 0) {
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className={`${sectionTitle} text-lg`}>Quem vai receber?</h3>
                        <p className={`${subtle} mt-0.5`}>Filtros se cruzam (AND). Contatos únicos também entram no recorte. Contagens já refletem o recorte atual.</p>
                      </div>
                      {audienceCount > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${matchedContacts > 0 ? 'bg-primary/12 text-primary' : 'bg-status-warning/10 text-status-warning'}`}>
                            {matchedContacts.toLocaleString('pt-BR')} contatos
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setDisparoFunil([]);
                              setDisparoTags([]);
                              setDisparoCanais([]);
                              setDisparoDDDs([]);
                              setDisparoContatos([]);
                              setDisparoContatoBusca('');
                            }}
                            className={`${btnGhost} h-7 px-2 text-[11px]`}
                          >
                            Limpar filtros
                          </button>
                        </div>
                      )}
                    </div>

                    {audienceCount > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {disparoFunil.map(v => (
                          <button key={`f-${v}`} type="button" onClick={() => setDisparoFunil(prev => prev.filter(x => x !== v))} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                            <span className="min-w-0 truncate">{v}</span>
                            <XMarkIcon className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ))}
                        {disparoTags.map(v => (
                          <button key={`t-${v}`} type="button" onClick={() => setDisparoTags(prev => prev.filter(x => x !== v))} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                            <span className="min-w-0 truncate">{v}</span>
                            <XMarkIcon className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ))}
                        {disparoCanais.map(v => (
                          <button key={`c-${v}`} type="button" onClick={() => setDisparoCanais(prev => prev.filter(x => x !== v))} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                            <span className="min-w-0 truncate">{v || 'Sem canal'}</span>
                            <XMarkIcon className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ))}
                        {disparoDDDs.map(v => (
                          <button key={`d-${v}`} type="button" onClick={() => setDisparoDDDs(prev => prev.filter(x => x !== v))} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-medium text-primary">
                            DDD {v}
                            <XMarkIcon className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ))}
                        {disparoContatosSelecionados.map(c => (
                          <button
                            key={`ct-${c.id}`}
                            type="button"
                            onClick={() => toggleDisparoContato(c.id)}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                            title={formatContactPhone(c)}
                          >
                            <UsersIcon className="h-3 w-3 shrink-0 opacity-70" />
                            <span className="min-w-0 truncate">{c.name || `Contato #${c.id}`}</span>
                            <XMarkIcon className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-line bg-bg2 p-1 sm:grid-cols-5" role="tablist" aria-label="Tipo de segmentação">
                      {modoTabs.map(tab => {
                        const active = disparoModo === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setDisparoModo(tab.key)}
                            className={`relative flex h-9 items-center justify-center gap-1.5 rounded-[9px] px-2 text-xs font-semibold transition ${active ? 'bg-surf text-ink shadow-card' : 'text-muted hover:text-ink'}`}
                          >
                            {tab.label}
                            {tab.count > 0 && (
                              <span className={`inline-flex min-w-[1.15rem] items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums ${active ? 'bg-primary/15 text-primary' : 'bg-surf2 text-muted2'}`}>
                                {tab.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {disparoModo === 'funil' && (() => {
                      const options = leadColumns
                        .map(col => ({ key: col, label: col, count: countAudienceOption('funil', col), on: disparoFunil.includes(col) }))
                        .filter(o => o.count || o.on);
                      if (!options.length) return emptyAudience;
                      return (
                        <VerticalScrollArrows className="max-h-[22rem]" contentClassName="pr-0.5">
                          <div className="flex flex-wrap gap-1.5">
                            {options.map(o => renderOptionChip(o.key, o.label, o.on, o.count, () => setDisparoFunil(prev => o.on ? prev.filter(x => x !== o.key) : [...prev, o.key])))}
                          </div>
                        </VerticalScrollArrows>
                      );
                    })()}

                    {disparoModo === 'tags' && (() => {
                      if (!labelCountData.length) return <p className={`${subtle} py-4 text-center`}>Sem etiquetas disponíveis nos leads carregados.</p>;
                      const options = [...labelCountData].reverse()
                        .map(row => ({ key: row.label, label: row.label, count: countAudienceOption('tags', row.label), on: disparoTags.includes(row.label) }))
                        .filter(o => o.count || o.on);
                      if (!options.length) return emptyAudience;
                      return (
                        <VerticalScrollArrows className="max-h-[22rem]" contentClassName="pr-0.5">
                          <div className="flex flex-wrap gap-1.5">
                            {options.map(o => renderOptionChip(o.key, o.label, o.on, o.count, () => setDisparoTags(prev => o.on ? prev.filter(x => x !== o.key) : [...prev, o.key])))}
                          </div>
                        </VerticalScrollArrows>
                      );
                    })()}

                    {disparoModo === 'canal' && (() => {
                      if (!channelCountData.length) return <p className={`${subtle} py-4 text-center`}>Sem canais disponíveis nos leads carregados.</p>;
                      const options = [...channelCountData].reverse()
                        .map(row => ({ key: row.channel, label: row.channel || 'Sem canal', count: countAudienceOption('canal', row.channel), on: disparoCanais.includes(row.channel) }))
                        .filter(o => o.count || o.on);
                      if (!options.length) return emptyAudience;
                      return (
                        <VerticalScrollArrows className="max-h-[22rem]" contentClassName="pr-0.5">
                          <div className="flex flex-wrap gap-1.5">
                            {options.map(o => renderOptionChip(o.key || '—', o.label, o.on, o.count, () => setDisparoCanais(prev => o.on ? prev.filter(x => x !== o.key) : [...prev, o.key])))}
                          </div>
                        </VerticalScrollArrows>
                      );
                    })()}

                    {disparoModo === 'ddd' && (() => {
                      const options = DDD_REGIONS
                        .map(([ddd, regiao]) => ({ key: ddd, label: regiao, count: countAudienceOption('ddd', ddd), on: disparoDDDs.includes(ddd) }))
                        .filter(o => o.count || o.on);
                      if (!options.length) return emptyAudience;
                      return (
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className={subtle}>Inclua um ou mais DDDs no recorte.</p>
                            {disparoDDDs.length > 0 && (
                              <button type="button" onClick={() => setDisparoDDDs([])} className="text-[11px] font-medium text-muted hover:text-red">
                                Limpar DDD ({disparoDDDs.length})
                              </button>
                            )}
                          </div>
                          <VerticalScrollArrows className="max-h-[22rem]" contentClassName="grid grid-cols-1 gap-1.5 pr-0.5 sm:grid-cols-2 xl:grid-cols-3">
                            {options.map(o => (
                              <button
                                key={o.key}
                                type="button"
                                onClick={() => setDisparoDDDs(prev => o.on ? prev.filter(d => d !== o.key) : [...prev, o.key])}
                                className={`flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left text-xs transition ${o.on ? chipOn : chipOff}`}
                              >
                                <span className={`font-mono text-sm font-bold tabular-nums ${o.on ? 'text-primary' : 'text-muted2'}`}>{o.key}</span>
                                <span className={`min-w-0 flex-1 truncate ${o.on ? 'text-ink' : ''}`}>{o.label}</span>
                                <span className={`font-mono text-[11px] tabular-nums ${o.on ? 'text-primary/80' : 'text-muted2'}`}>{o.count}</span>
                              </button>
                            ))}
                          </VerticalScrollArrows>
                        </div>
                      );
                    })()}

                    {disparoModo === 'contatos' && (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className={subtle}>Busque por nome, telefone, empresa, CNPJ ou #id e marque contatos únicos.</p>
                          {disparoContatos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setDisparoContatos([])}
                              className="text-[11px] font-medium text-muted hover:text-red"
                            >
                              Limpar contatos ({disparoContatos.length})
                            </button>
                          )}
                        </div>
                        <div className="relative">
                          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                          <input
                            type="search"
                            value={disparoContatoBusca}
                            onChange={(e) => setDisparoContatoBusca(e.target.value)}
                            placeholder="Buscar contato específico…"
                            className={`${input} h-10 w-full pl-9 text-sm`}
                            aria-label="Buscar contatos para o disparo"
                            autoComplete="off"
                          />
                        </div>
                        {!disparoContatosBuscaList.length ? (
                          <div className="flex min-h-[7rem] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-bg2/60 px-4 py-6 text-center">
                            <p className="text-sm font-medium text-ink">
                              {disparoContatoBusca.trim()
                                ? 'Nenhum contato encontrado'
                                : 'Nenhum contato com telefone no recorte'}
                            </p>
                            <p className={`${subtle} mt-1 max-w-sm`}>
                              {disparoContatoBusca.trim()
                                ? 'Tente outro termo (nome, telefone, empresa ou #id).'
                                : 'Ajuste os outros filtros ou cadastre leads com WhatsApp.'}
                            </p>
                          </div>
                        ) : (
                          <VerticalScrollArrows className="max-h-[22rem]" contentClassName="space-y-1 pr-0.5" contentRole="listbox" contentAriaLabel="Contatos disponíveis" contentAriaMultiselectable="true">
                            {disparoContatosBuscaList.map(contact => {
                              const on = disparoContatosSet.has(String(contact.id));
                              const stage = contact.custom_attributes?.Funil_Vendas || '';
                              const company = contact.additional_attributes?.company_name
                                || contact.company_name
                                || '';
                              return (
                                <button
                                  key={contact.id}
                                  type="button"
                                  role="option"
                                  aria-selected={on}
                                  onClick={() => toggleDisparoContato(contact.id)}
                                  className={`flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition ${on ? chipOn : chipOff}`}
                                >
                                  <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? 'border-primary bg-primary text-white' : 'border-line2 bg-bg2 text-transparent'}`}
                                    aria-hidden
                                  >
                                    ✓
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className={`block truncate text-xs font-semibold ${on ? 'text-ink' : 'text-ink'}`}>
                                      {contact.name || `Contato #${contact.id}`}
                                    </span>
                                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted2">
                                      <span className="font-mono tabular-nums">{formatContactPhone(contact)}</span>
                                      {company && company !== contact.name && (
                                        <span className="min-w-0 truncate">{company}</span>
                                      )}
                                      {stage && (
                                        <span className="min-w-0 truncate text-muted">{stage}</span>
                                      )}
                                    </span>
                                  </span>
                                  <span className={`shrink-0 font-mono text-[10px] tabular-nums ${on ? 'text-primary/70' : 'text-muted2'}`}>
                                    #{contact.id}
                                  </span>
                                </button>
                              );
                            })}
                            {disparoContatoBusca.trim() === '' && contacts.filter(c => contactHasWhatsappPhone(c) && matchesAudience(c, 'contatos')).length > 80 && (
                              <p className={`${subtle} px-1 py-2 text-center`}>
                                Mostrando 80 contatos — digite para refinar a busca.
                              </p>
                            )}
                          </VerticalScrollArrows>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              if (currentStep === 1) {
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className={`${sectionTitle} text-lg`}>O que será enviado?</h3>
                        <p className={`${subtle} mt-0.5`}>
                          Use <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">{'{nome}'}</code> (primeiro nome do Chatwoot),
                          {' '}<code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">{'{nome_completo}'}</code>
                          {' '}ou <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">{'{empresa}'}</code>.
                          Várias mensagens alternam no envio.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDisparoMensagens(prev => [...prev, { tipo: 'texto', texto: '' }])}
                        className={`${btnSecondary} h-8 px-3 text-xs`}
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Mensagem
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {disparoMensagens.map((m, idx) => {
                        const setMsg = (patch) => setDisparoMensagens(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x));
                        const isMedia = m.tipo && m.tipo !== 'texto';
                        const accept = { imagem: 'image/*', audio: 'audio/*', video: 'video/*', documento: '*/*' }[m.tipo] || '*/*';
                        const filled = Boolean((m.texto || '').trim() || m.arquivo_base64);
                        const mediaMissing = isMedia && !m.arquivo_base64;
                        return (
                          <div key={idx} className={`${cardAlt} p-3 ${mediaMissing ? 'border-status-warning/40' : filled ? '' : 'border-dashed'}`}>
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold ${filled ? 'bg-primary/15 text-primary' : mediaMissing ? 'bg-status-warning/15 text-status-warning' : 'bg-surf2 text-muted2'}`}>
                                  {idx + 1}
                                </span>
                                <select
                                  value={m.tipo || 'texto'}
                                  onChange={(e) => setMsg({ tipo: e.target.value, arquivo_nome: null, arquivo_tipo: null, arquivo_base64: null })}
                                  className={`${select} h-8 w-auto min-w-[7.5rem] rounded-[9px] px-2 text-xs`}
                                  aria-label={`Tipo da mensagem ${idx + 1}`}
                                >
                                  <option value="texto">Texto</option>
                                  <option value="imagem">Imagem</option>
                                  <option value="audio">Áudio</option>
                                  <option value="video">Vídeo</option>
                                  <option value="documento">Documento</option>
                                </select>
                                {mediaMissing && <span className="text-[11px] font-medium text-status-warning">Arquivo obrigatório</span>}
                              </div>
                              {disparoMensagens.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setDisparoMensagens(prev => prev.filter((_, i) => i !== idx))}
                                  className={`${iconBtn} h-8 w-8 text-muted hover:text-red`}
                                  aria-label={`Remover mensagem ${idx + 1}`}
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                            {isMedia && (
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <label className={`${btnSecondary} h-8 cursor-pointer px-3 text-xs`}>
                                  {m.arquivo_nome ? 'Trocar arquivo' : 'Escolher arquivo'}
                                  <input
                                    type="file"
                                    accept={accept}
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      if (file.size > 16 * 1024 * 1024) { alert('Arquivo acima de 16MB — use um menor.'); return; }
                                      const reader = new FileReader();
                                      reader.onload = () => {
                                        const base64 = String(reader.result || '').split(',')[1] || null;
                                        setMsg({ arquivo_nome: file.name, arquivo_tipo: file.type, arquivo_base64: base64 });
                                      };
                                      reader.readAsDataURL(file);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                                {m.arquivo_nome ? (
                                  <span className="inline-flex max-w-full items-center gap-2 rounded-[9px] border border-line bg-surf px-2.5 py-1 font-mono text-[11px] text-ink">
                                    <span className="min-w-0 truncate">{m.arquivo_nome}</span>
                                    <button type="button" onClick={() => setMsg({ arquivo_nome: null, arquivo_tipo: null, arquivo_base64: null })} className="shrink-0 text-muted hover:text-red" aria-label="Remover arquivo">×</button>
                                  </span>
                                ) : (
                                  <span className={subtle}>Nenhum arquivo · máx. 16MB</span>
                                )}
                              </div>
                            )}
                            <textarea
                              value={m.texto || ''}
                              onChange={(e) => setMsg({ texto: e.target.value })}
                              rows={isMedia ? 2 : 4}
                              className={`${textarea} w-full resize-y`}
                              placeholder={isMedia ? 'Legenda (opcional)…' : 'Escreva a mensagem…'}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {messageCount > 0 && (
                      <div className="overflow-hidden rounded-[12px] border border-line bg-[#0b141a]">
                        <div className="flex items-center gap-2 border-b border-white/5 bg-[#1f2c34] px-3 py-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-status-success/20 text-[10px] font-bold text-status-success">WA</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white/90">
                              Prévia · {previewIsReal ? previewNome : 'sem contato no recorte'}
                            </p>
                            <p className="truncate text-[10px] text-white/45">
                              {previewIsReal
                                ? `Chatwoot: ${previewNomeCompleto}${matchedContacts > 1 ? ` · +${matchedContacts - 1} no recorte` : ''}`
                                : 'Selecione o público para prévia com nome real'}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-2 p-3">
                          {firstMedia?.arquivo_nome && (
                            <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-sm bg-[#005c4b] px-2.5 py-2 text-[11px] text-white/85">
                              📎 {firstMedia.arquivo_nome}
                            </div>
                          )}
                          <div className={`ml-auto max-w-[92%] rounded-lg rounded-tr-sm px-2.5 py-2 text-[13px] leading-relaxed text-white/95 ${firstMessage || firstMedia?.arquivo_nome ? 'bg-[#005c4b]' : 'bg-white/5 text-white/40'}`}>
                            <p className="whitespace-pre-wrap">
                              {firstMessage
                                ? personalizarPreview(firstMessage)
                                : firstMedia?.arquivo_nome
                                  ? 'Mídia sem legenda'
                                  : 'A mensagem aparece aqui.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              if (currentStep === 2) {
                return (
                  <div className="space-y-4">
                    <div>
                      <h3 className={`${sectionTitle} text-lg`}>Por quais números enviar?</h3>
                      <p className={`${subtle} mt-0.5`}>Só instâncias online entram no disparo. Nome da campanha é opcional e ajuda no histórico.</p>
                    </div>
                    <div className={`rounded-[10px] border px-3 py-2.5 text-[12px] leading-snug ${disparoInstanciasStatus.error || !disparoInstanciasStatus.verificado ? 'border-status-warning/30 bg-status-warning/10 text-status-warning' : 'border-status-success/30 bg-status-success/10 text-status-success'}`}>
                      {disparoInstanciasStatus.error
                        || (disparoInstanciasStatus.verificado
                          ? `${openInstances} conectada${openInstances === 1 ? '' : 's'} · estado atualizado`
                          : 'Estado ainda não verificado — o envio fica bloqueado por segurança.')}
                    </div>
                    {disparoInstancias.length ? (
                      <VerticalScrollArrows className="max-h-[20rem]" contentClassName="grid gap-1.5 pr-0.5 sm:grid-cols-2">
                        {disparoInstancias.map(i => {
                          const id = String(i.id ?? i.instancia_nome ?? i.nome);
                          const on = disparoInstanciasSel.includes(id);
                          const open = String(i.connection_state || i.status).toLowerCase() === 'open';
                          return (
                            <label
                              key={id}
                              className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-xs transition ${on ? 'border-primary/40 bg-primary/10' : 'border-line bg-bg2 hover:border-line2'} ${!open ? 'cursor-not-allowed opacity-55' : ''}`}
                            >
                              <input
                                type="checkbox"
                                disabled={!open}
                                checked={on}
                                onChange={() => setDisparoInstanciasSel(prev => on ? prev.filter(x => x !== id) : [...prev, id])}
                                className="accent-primary"
                              />
                              <span className="min-w-0 flex-1 truncate font-medium text-ink">{i.nome || i.instancia_nome || id}</span>
                              <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${open ? 'text-status-success' : 'text-status-warning'}`}>
                                {open ? 'online' : String(i.connection_state || i.status || 'off')}
                              </span>
                              {i.taxa_sucesso != null && (
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted2">{i.taxa_sucesso}%</span>
                              )}
                            </label>
                          );
                        })}
                      </VerticalScrollArrows>
                    ) : (
                      <div className="rounded-[10px] border border-dashed border-line bg-bg2/50 px-3 py-8 text-center">
                        <p className="text-sm font-medium text-ink">Nenhuma instância</p>
                        <p className={`${subtle} mt-1`}>Verifique a conexão com o n8n / Evolution.</p>
                      </div>
                    )}
                    <div>
                      <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-nome">Nome da campanha (opcional)</label>
                      <input
                        id="disparo-nome"
                        value={disparoNome}
                        onChange={(e) => setDisparoNome(e.target.value)}
                        className={`${input} w-full max-w-lg`}
                        placeholder="Ex: Reativação inbox — junho"
                      />
                    </div>
                  </div>
                );
              }

              if (currentStep === 3) {
                return (
                  <div className="space-y-4">
                    <div>
                      <h3 className={`${sectionTitle} text-lg`}>Ritmo e janela de envio</h3>
                      <p className={`${subtle} mt-0.5`}>Limites por instância e horários em que o n8n pode enviar.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-max-day">Máx. por dia / instância</label>
                        <input id="disparo-max-day" type="number" min="1" value={disparoConfig.maxPerDay} onChange={(e) => setDisparoConfig(c => ({ ...c, maxPerDay: Number(e.target.value) || 0 }))} className={`${input} w-full font-mono tabular-nums`} />
                      </div>
                      <div>
                        <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-min-int">Intervalo mín. (s)</label>
                        <input id="disparo-min-int" type="number" min="30" value={disparoConfig.minInterval} onChange={(e) => setDisparoConfig(c => ({ ...c, minInterval: Number(e.target.value) || 30 }))} className={`${input} w-full font-mono tabular-nums`} />
                      </div>
                      <div>
                        <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-max-int">Intervalo máx. (s)</label>
                        <input id="disparo-max-int" type="number" min="30" value={disparoConfig.maxInterval} onChange={(e) => setDisparoConfig(c => ({ ...c, maxInterval: Number(e.target.value) || 60 }))} className={`${input} w-full font-mono tabular-nums`} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-period">Período de envio</label>
                        <select id="disparo-period" value={disparoConfig.sendPeriod} onChange={(e) => setDisparoConfig(c => ({ ...c, sendPeriod: e.target.value }))} className={`${select} w-full`}>
                          <option value="integral">Integral (24h)</option>
                          <option value="comercial">Comercial (8h–18h)</option>
                          <option value="tarde">Tarde (12h–18h)</option>
                        </select>
                      </div>
                      <div>
                        <p className={`${subtle} mb-1.5`}>Dias da semana</p>
                        <div className="grid grid-cols-7 gap-1">
                          {[['Seg', 1], ['Ter', 2], ['Qua', 3], ['Qui', 4], ['Sex', 5], ['Sáb', 6], ['Dom', 7]].map(([lbl, val]) => {
                            const on = disparoConfig.diasSemana.includes(val);
                            return (
                              <button
                                key={val}
                                type="button"
                                aria-label={lbl}
                                aria-pressed={on}
                                onClick={() => setDisparoConfig(c => ({ ...c, diasSemana: on ? c.diasSemana.filter(d => d !== val) : [...c.diasSemana, val] }))}
                                className={`flex h-9 items-center justify-center rounded-[9px] border px-0.5 text-[11px] font-semibold transition ${on ? chipOn : chipOff}`}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className={`${cardAlt} grid gap-2 p-3 sm:grid-cols-3`}>
                      <div>
                        <p className="text-[11px] text-muted">Throughput estimado</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-ink">
                          {(Number(disparoConfig.maxPerDay) || 0) * Math.max(disparoInstanciasSel.length, 1)} / dia
                        </p>
                        <p className="text-[11px] text-muted2">com {Math.max(disparoInstanciasSel.length, 1)} instância(s)</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted">Intervalo</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-ink">{disparoConfig.minInterval}–{disparoConfig.maxInterval}s</p>
                        <p className="text-[11px] text-muted2">entre mensagens</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted">Janela</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{periodLabel}</p>
                        <p className="truncate text-[11px] text-muted2">{selectedDays}</p>
                      </div>
                    </div>

                    <div className="rounded-[12px] border border-line bg-bg2/50 p-3 sm:p-4">
                      <div className="mb-3">
                        <h4 className="text-sm font-semibold text-ink">Proteção anti-spam</h4>
                        <p className={`${subtle} mt-0.5`}>
                          Vale para campanhas por Funil/Tags/Canal/DDD. Se o público for só contatos manuais, o anti-spam é ignorado (envio direto para quem você marcou).
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className={`${subtle} mb-1.5 block`} htmlFor="disparo-cooldown">
                            Cooldown (dias sem reenviar)
                          </label>
                          <input
                            id="disparo-cooldown"
                            type="number"
                            min="0"
                            max="90"
                            value={disparoConfig.cooldownDias}
                            onChange={(e) => setDisparoConfig(c => ({
                              ...c,
                              cooldownDias: Math.max(0, Math.min(90, Number(e.target.value) || 0)),
                            }))}
                            className={`${input} w-full font-mono tabular-nums`}
                          />
                          <p className="mt-1 text-[11px] text-muted2">
                            {Number(disparoConfig.cooldownDias) === 0
                              ? 'Desligado — reenvia mesmo quem recebeu mensagem recente.'
                              : `Pula quem recebeu mensagem nossa nos últimos ${disparoConfig.cooldownDias} dia(s).`}
                          </p>
                        </div>
                        <div className="space-y-2 sm:pt-6">
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-surf px-3 py-2.5 text-xs transition hover:border-line2">
                            <input
                              type="checkbox"
                              checked={Boolean(disparoConfig.pularConversasAbertas)}
                              onChange={(e) => setDisparoConfig(c => ({ ...c, pularConversasAbertas: e.target.checked }))}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block font-semibold text-ink">Pular conversas abertas</span>
                              <span className="mt-0.5 block text-[11px] text-muted2">
                                Não interrompe atendimento em curso no Chatwoot.
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-surf px-3 py-2.5 text-xs transition hover:border-line2">
                            <input
                              type="checkbox"
                              checked={Boolean(disparoConfig.fixarNumero)}
                              onChange={(e) => setDisparoConfig(c => ({ ...c, fixarNumero: e.target.checked }))}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block font-semibold text-ink">Fixar número por lead</span>
                              <span className="mt-0.5 block text-[11px] text-muted2">
                                Reutiliza a instância da última conversa do contato.
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-surf px-3 py-2.5 text-xs transition hover:border-line2">
                            <input
                              type="checkbox"
                              checked={Boolean(disparoConfig.priorizarRecentes)}
                              onChange={(e) => setDisparoConfig(c => ({ ...c, priorizarRecentes: e.target.checked }))}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block font-semibold text-ink">Priorizar leads recentes</span>
                              <span className="mt-0.5 block text-[11px] text-muted2">
                                Quem conversou por último entra na fila primeiro.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                      {(Number(disparoConfig.cooldownDias) === 0 || !disparoConfig.pularConversasAbertas) && (
                        <p className="mt-3 rounded-[9px] border border-status-warning/30 bg-status-warning/10 px-2.5 py-2 text-[11px] leading-snug text-status-warning">
                          Proteções relaxadas — ok para teste. Em campanhas reais, mantenha cooldown ≥ 7 e pule conversas abertas.
                        </p>
                      )}
                    </div>
                  </div>
                );
              }

              // Review step
              return (
                <div className="space-y-4">
                  <div>
                    <h3 className={`${sectionTitle} text-lg`}>Revisar e iniciar</h3>
                    <p className={`${subtle} mt-0.5`}>Confira cada etapa. Se algo faltar, volte e ajuste antes de disparar.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {steps.slice(0, 4).map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => goToStep(idx)}
                        className={`flex items-start gap-3 rounded-[12px] border p-3 text-left transition hover:border-line2 ${s.ok ? 'border-line bg-bg2' : 'border-status-warning/30 bg-status-warning/5'}`}
                      >
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.ok ? 'bg-status-success/20 text-status-success' : 'bg-status-warning/15 text-status-warning'}`}>
                          {s.ok ? (
                            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          ) : (idx + 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-ink">{s.label}</p>
                            <span className="text-[11px] text-primary">Editar</span>
                          </div>
                          <p className={`mt-0.5 text-[12px] ${s.ok ? 'text-muted' : 'text-status-warning'}`}>{s.summary}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className={`${cardAlt} space-y-2 p-4 text-[13px]`}>
                      <div className="flex justify-between gap-2 border-b border-line pb-2">
                        <span className="text-muted">Campanha</span>
                        <span className="text-right font-medium text-ink">{disparoNome.trim() || 'Sem nome'}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Contatos</span>
                        <span className="font-mono tabular-nums text-ink">{matchedContacts.toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Cruzamento</span>
                        <span className="text-right text-ink">{activeAudienceGroups.length ? activeAudienceGroups.join(' + ') : '—'}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Mensagens</span>
                        <span className="font-mono tabular-nums text-ink">{messageCount}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Instâncias</span>
                        <span className="font-mono tabular-nums text-ink">{disparoInstanciasSel.length}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Ritmo</span>
                        <span className="text-right font-mono tabular-nums text-ink">{disparoConfig.maxPerDay}/dia · {periodLabel}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Dias</span>
                        <span className="text-right text-ink">{selectedDays}</span>
                      </div>
                      <div className="flex justify-between gap-2 border-t border-line pt-2">
                        <span className="text-muted">Anti-spam</span>
                        <span className="text-right text-ink">
                          cooldown {Number(disparoConfig.cooldownDias) || 0}d
                          {disparoConfig.pularConversasAbertas ? ' · pula abertas' : ' · inclui abertas'}
                        </span>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-[12px] border border-line bg-[#0b141a]">
                      <div className="flex items-center gap-2 border-b border-white/5 bg-[#1f2c34] px-3 py-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-status-success/20 text-[10px] font-bold text-status-success">WA</span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white/90">
                            Prévia · {previewIsReal ? previewNome : '—'}
                          </p>
                          <p className="truncate text-[10px] text-white/45">
                            {previewIsReal ? previewNomeCompleto : 'Nome do Chatwoot no recorte'}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 p-3">
                        {firstMedia?.arquivo_nome && (
                          <div className="ml-auto max-w-[95%] rounded-lg rounded-tr-sm bg-[#005c4b] px-2.5 py-2 text-[11px] text-white/85">
                            📎 {firstMedia.arquivo_nome}
                          </div>
                        )}
                        <div className={`ml-auto max-w-[95%] rounded-lg rounded-tr-sm px-2.5 py-2 text-[12px] leading-relaxed text-white/95 ${firstMessage || firstMedia?.arquivo_nome ? 'bg-[#005c4b]' : 'bg-white/5 text-white/40'}`}>
                          <p className="whitespace-pre-wrap">
                            {firstMessage
                              ? personalizarPreview(firstMessage)
                              : firstMedia?.arquivo_nome
                                ? 'Mídia sem legenda'
                                : 'Sem mensagem'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {disparoResult && (
                    <div className={`rounded-[10px] border p-3 text-sm leading-snug ${disparoResult.error ? 'border-status-danger/30 bg-status-danger/10 text-status-danger' : disparoResult.configured && disparoResult.ok ? 'border-status-success/30 bg-status-success/10 text-status-success' : 'border-status-warning/30 bg-status-warning/10 text-status-warning'}`}>
                      {disparoResult.error ? (
                        <div className="space-y-1">
                          <p className="font-semibold">{disparoResult.errorTitle || 'Não foi possível iniciar o disparo'}</p>
                          <p className="text-[13px] opacity-95">
                            {disparoResult.errorDetail || disparoResult.error}
                          </p>
                          {disparoResult.resumo?.descartados && (
                            <p className="text-[12px] opacity-80">
                              {[
                                disparoResult.resumo.descartados.cooldown > 0
                                  ? `${disparoResult.resumo.descartados.cooldown} em cooldown`
                                  : null,
                                disparoResult.resumo.descartados.conversas_abertas > 0
                                  ? `${disparoResult.resumo.descartados.conversas_abertas} com conversa aberta`
                                  : null,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      ) : !disparoResult.configured
                        ? 'Registrado, mas o webhook do n8n não está configurado (DISPARO_WEBHOOK_URL).'
                        : disparoResult.campanhaId
                          ? `Disparo iniciado! Campanha #${disparoResult.campanhaId}${disparoResult.totalEnfileirados != null ? ` — ${disparoResult.totalEnfileirados} na fila` : ''}.`
                          : disparoResult.ok ? 'Disparo iniciado no n8n.' : 'O n8n recebeu, mas retornou um aviso.'}
                    </div>
                  )}
                </div>
              );
            })();

            const n = (v) => {
              const x = Number(v);
              return Number.isFinite(x) ? x : 0;
            };
            const fmtDateTime = (value) => {
              if (!value) return '—';
              const d = new Date(value);
              if (Number.isNaN(d.getTime())) return '—';
              return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            };
            const campanhaStatusClass = (status) => {
              const s = String(status || '').toLowerCase();
              if (s === 'ativa' || s === 'running' || s === 'em_andamento') return 'bg-status-success/10 text-status-success';
              if (s === 'pausada' || s === 'paused') return 'bg-status-warning/10 text-status-warning';
              if (s === 'encerrada' || s === 'cancelada' || s === 'cancelled') return 'bg-surf2 text-muted';
              return 'bg-surf2 text-muted2';
            };
            const envioStatusClass = (status) => {
              const s = String(status || '').toLowerCase();
              if (s === 'enviado' || s === 'sent' || s === 'sucesso') return 'text-status-success';
              if (s === 'erro' || s === 'error' || s === 'falha') return 'text-status-danger';
              if (s === 'pendente' || s === 'em_fila' || s === 'processando' || s === 'aguardando') return 'text-status-warning';
              if (s === 'pausado' || s === 'cancelado') return 'text-muted';
              return 'text-muted2';
            };
            const campanhasFiltradas = (() => {
              const q = normalizeText(disparoCampanhaBusca).trim();
              const list = Array.isArray(disparoCampanhas) ? [...disparoCampanhas] : [];
              list.sort((a, b) => {
                const da = new Date(a.data_criacao || a.created_at || 0).getTime();
                const db = new Date(b.data_criacao || b.created_at || 0).getTime();
                return db - da;
              });
              if (!q) return list;
              return list.filter(c => normalizeText(`${c.nome || ''} ${c.campanha_id || c.id || ''}`).includes(q));
            })();
            const enviosFiltrados = (() => {
              let list = disparoEnvios;
              if (disparoEnviosFiltro !== 'todos') {
                list = list.filter(e => String(e.status || '').toLowerCase() === disparoEnviosFiltro);
              }
              const q = normalizeText(disparoEnviosBusca).trim();
              if (q) {
                list = list.filter(e => normalizeText([
                  e.contact_name, e.nome, e.company_name, e.phone_number, e.motivo, e.instancia_nome,
                ].filter(Boolean).join(' ')).includes(q));
              }
              return list;
            })();
            const envioStatusCounts = disparoEnvios.reduce((acc, e) => {
              const key = String(e.status || 'outro').toLowerCase();
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {});
            const erroMotivoResumo = (() => {
              const map = new Map();
              for (const e of disparoEnvios) {
                const st = String(e.status || '').toLowerCase();
                if (st !== 'erro' && st !== 'error' && st !== 'falha') continue;
                if (!e.motivo) continue;
                const f = formatDisparoError(e.motivo);
                const key = f.kind || f.title;
                const prev = map.get(key);
                if (prev) prev.count += 1;
                else map.set(key, { title: f.title, kind: f.kind, count: 1 });
              }
              return [...map.values()].sort((a, b) => b.count - a.count);
            })();
            const dash = disparoDash || {};
            const campanhaSelecionada = disparoCampanhaMeta
              || campanhasFiltradas.find(c => String(c.campanha_id ?? c.id) === String(disparoCampanhaSel))
              || null;

            return (
            <div className="mt-6 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="max-w-2xl text-sm text-muted">
                    {disparoSubview === 'criar'
                      ? 'Monte a campanha em etapas — cada passo precisa estar completo para avançar.'
                      : 'Acompanhe status, envios, erros e destinatários das campanhas no n8n.'}
                  </p>
                  <div className="inline-flex rounded-[12px] border border-line bg-bg2 p-1" role="tablist" aria-label="Áreas do disparo">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={disparoSubview === 'criar'}
                      onClick={() => setDisparoSubview('criar')}
                      className={`h-9 rounded-[9px] px-3 text-xs font-semibold transition ${disparoSubview === 'criar' ? 'bg-surf text-ink shadow-card' : 'text-muted hover:text-ink'}`}
                    >
                      Nova campanha
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={disparoSubview === 'gestao'}
                      onClick={() => { setDisparoSubview('gestao'); carregarDisparoMonitor(); }}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-xs font-semibold transition ${disparoSubview === 'gestao' ? 'bg-surf text-ink shadow-card' : 'text-muted hover:text-ink'}`}
                    >
                      <QueueListIcon className="h-3.5 w-3.5" />
                      Gestão de campanhas
                      {Array.isArray(disparoCampanhas) && disparoCampanhas.length > 0 && (
                        <span className="inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-primary/15 px-1 font-mono text-[10px] tabular-nums text-primary">
                          {disparoCampanhas.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <span className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12px] font-semibold ${healthOk ? 'bg-status-success/10 text-status-success' : 'bg-status-warning/10 text-status-warning'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${healthOk ? 'bg-status-success' : 'bg-status-warning'}`} />
                  {healthLabel}
                </span>
              </div>

              {disparoSubview === 'gestao' ? (
                <div className="space-y-4">
                  {/* KPIs compactos */}
                  <div className={`${card} grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4`}>
                    {[
                      { label: 'Ativas', value: n(dash.campanhas_ativas), hint: 'campanhas' },
                      { label: 'Enviados hoje', value: n(dash.enviados_hoje), hint: 'mensagens', ok: true },
                      { label: 'Erros hoje', value: n(dash.erros_hoje), hint: 'falhas', bad: n(dash.erros_hoje) > 0 },
                      { label: 'Total histórico', value: n(dash.total_enviados), hint: `${n(dash.instancias_ativas)} inst.` },
                    ].map(kpi => (
                      <div key={kpi.label} className="bg-surf px-4 py-3">
                        <p className="text-[11px] font-medium text-muted">{kpi.label}</p>
                        <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight ${kpi.bad ? 'text-status-danger' : kpi.ok ? 'text-status-success' : 'text-ink'}`}>
                          {kpi.value.toLocaleString('pt-BR')}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted2">{kpi.hint}</p>
                      </div>
                    ))}
                  </div>

                  {/* Lista + detalhe: altura fixa para o flex não esmagar a lista de destinatários */}
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:items-stretch">
                    {/* Lista de campanhas */}
                    <div className={`${card} flex h-[min(78vh,52rem)] min-h-[36rem] flex-col overflow-hidden`}>
                      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-ink">Campanhas</h3>
                          <button
                            type="button"
                            onClick={() => carregarDisparoMonitor()}
                            className={`${iconBtn} h-8 w-8`}
                            disabled={disparoMonitorLoading}
                            title="Atualizar"
                            aria-label="Atualizar campanhas"
                          >
                            <ArrowPathIcon className={`h-4 w-4 ${disparoMonitorLoading ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                        <div className="relative">
                          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                          <input
                            type="search"
                            value={disparoCampanhaBusca}
                            onChange={(e) => setDisparoCampanhaBusca(e.target.value)}
                            placeholder="Buscar por nome ou #id"
                            className={`${input} h-9 w-full pl-8 text-xs`}
                          />
                        </div>
                      </div>

                      <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="p-2">
                        {!campanhasFiltradas.length ? (
                          <div className="px-3 py-10 text-center">
                            <p className="text-sm font-medium text-ink">
                              {disparoMonitorLoading ? 'Carregando…' : 'Nenhuma campanha'}
                            </p>
                            <p className={`${subtle} mt-1 text-[12px]`}>
                              {disparoCampanhaBusca.trim() ? 'Ajuste a busca.' : 'Crie uma em “Nova campanha”.'}
                            </p>
                          </div>
                        ) : (
                          <ul className="space-y-1.5">
                            {campanhasFiltradas.map(c => {
                              const id = c.campanha_id ?? c.id;
                              const status = String(c.status || '—');
                              const total = n(c.total_contatos);
                              const enviados = n(c.enviados);
                              const erros = n(c.erros);
                              const pct = Math.min(100, Math.max(0, Number(c.percentual_enviado) || (total ? (enviados / total) * 100 : 0)));
                              const selected = String(disparoCampanhaSel) === String(id);
                              return (
                                <li key={id}>
                                  <button
                                    type="button"
                                    onClick={() => carregarDetalheCampanha(id, c)}
                                    className={`w-full rounded-[12px] border px-3 py-2.5 text-left transition ${
                                      selected
                                        ? 'border-primary/40 bg-primary/[0.08] shadow-[inset_0_0_0_1px_rgba(124,92,255,.12)]'
                                        : 'border-transparent bg-bg2/70 hover:border-line hover:bg-bg2'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-[13px] font-semibold text-ink">{c.nome || `Campanha #${id}`}</p>
                                        <p className="mt-0.5 font-mono text-[10px] text-muted2">#{id} · {fmtDateTime(c.data_criacao || c.created_at)}</p>
                                      </div>
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${campanhaStatusClass(status)}`}>
                                        {status}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex items-center gap-3 text-[11px] tabular-nums">
                                      <span className="text-status-success font-medium">{enviados}<span className="font-normal text-muted2"> ok</span></span>
                                      <span className={erros > 0 ? 'font-medium text-status-danger' : 'text-muted2'}>{erros}<span className="font-normal text-muted2"> err</span></span>
                                      <span className="text-muted2">{total} tot</span>
                                      <span className="ml-auto font-mono text-muted2">{pct.toFixed(0)}%</span>
                                    </div>
                                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                                      <div
                                        className={`h-full rounded-full ${erros > enviados ? 'bg-status-warning' : 'bg-primary'}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </VerticalScrollArrows>
                    </div>

                    {/* Painel de detalhe — altura fixa + lista com scroll real */}
                    <div ref={disparoDetalheRef} className={`${card} flex h-[min(78vh,52rem)] min-h-[36rem] flex-col overflow-hidden`}>
                      {!disparoCampanhaSel ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <QueueListIcon className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-semibold text-ink">Selecione uma campanha</p>
                          <p className={`${subtle} max-w-xs text-[12px]`}>
                            Clique em um item à esquerda para ver destinatários, horários e erros.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Header compacto */}
                          <div className="shrink-0 border-b border-line px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <h3 className="truncate text-sm font-semibold text-ink">
                                    {campanhaSelecionada?.nome || `Campanha #${disparoCampanhaSel}`}
                                  </h3>
                                  {campanhaSelecionada?.status && (
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${campanhaStatusClass(campanhaSelecionada.status)}`}>
                                      {campanhaSelecionada.status}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-[11px] text-muted">
                                  <span className="font-mono">#{disparoCampanhaSel}</span>
                                  {campanhaSelecionada?.ultimo_envio
                                    ? ` · último ${fmtDateTime(campanhaSelecionada.ultimo_envio)}`
                                    : campanhaSelecionada?.data_criacao
                                      ? ` · criada ${fmtDateTime(campanhaSelecionada.data_criacao)}`
                                      : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-1">
                                {(() => {
                                  const status = String(campanhaSelecionada?.status || '').toLowerCase();
                                  const busyBase = String(disparoCampanhaSel);
                                  const canPause = ['ativa', 'running', 'em_andamento'].includes(status);
                                  const canResume = ['pausada', 'paused'].includes(status);
                                  const canCancel = status && !['encerrada', 'cancelada', 'cancelled'].includes(status);
                                  return (
                                    <>
                                      {canPause && (
                                        <button type="button" disabled={disparoCampanhaBusy === `${busyBase}:pausar`} onClick={() => acaoCampanha(disparoCampanhaSel, 'pausar')} className={`${btnSecondary} h-7 px-2 text-[11px]`}>Pausar</button>
                                      )}
                                      {canResume && (
                                        <button type="button" disabled={disparoCampanhaBusy === `${busyBase}:retomar`} onClick={() => acaoCampanha(disparoCampanhaSel, 'retomar')} className={`${btnSecondary} h-7 px-2 text-[11px]`}>Retomar</button>
                                      )}
                                      {canCancel && (
                                        <button
                                          type="button"
                                          disabled={disparoCampanhaBusy === `${busyBase}:cancelar`}
                                          onClick={() => {
                                            if (window.confirm(`Cancelar a campanha #${disparoCampanhaSel}?`)) acaoCampanha(disparoCampanhaSel, 'cancelar');
                                          }}
                                          className={`${btnGhost} h-7 px-2 text-[11px] text-status-danger`}
                                        >
                                          Cancelar
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => carregarDetalheCampanha(disparoCampanhaSel, campanhaSelecionada)}
                                        className={`${iconBtn} h-7 w-7`}
                                        title="Atualizar destinatários"
                                        aria-label="Atualizar destinatários"
                                      >
                                        <ArrowPathIcon className={`h-3.5 w-3.5 ${disparoEnviosLoading ? 'animate-spin' : ''}`} />
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>

                            {campanhaSelecionada && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {[
                                  { label: 'Total', value: n(campanhaSelecionada.total_contatos) },
                                  { label: 'Ok', value: n(campanhaSelecionada.enviados), cls: 'text-status-success' },
                                  { label: 'Erro', value: n(campanhaSelecionada.erros), cls: n(campanhaSelecionada.erros) > 0 ? 'text-status-danger' : '' },
                                  { label: 'Fila', value: n(campanhaSelecionada.em_fila) + n(campanhaSelecionada.pendentes) + n(campanhaSelecionada.processando) },
                                ].map(m => (
                                  <span key={m.label} className="inline-flex items-center gap-1.5 rounded-full bg-bg2 px-2.5 py-1 text-[11px]">
                                    <span className="text-muted2">{m.label}</span>
                                    <span className={`font-mono font-semibold tabular-nums text-ink ${m.cls || ''}`}>{m.value.toLocaleString('pt-BR')}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Filtros compactos */}
                          <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2">
                            <div className="relative">
                              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                              <input
                                type="search"
                                value={disparoEnviosBusca}
                                onChange={(e) => setDisparoEnviosBusca(e.target.value)}
                                placeholder="Filtrar por nome, telefone, motivo…"
                                className={`${input} h-8 w-full pl-8 text-xs`}
                                disabled={disparoEnviosLoading || !disparoEnvios.length}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDisparoEnviosFiltro('todos')}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${disparoEnviosFiltro === 'todos' ? 'bg-primary/15 text-primary' : 'bg-bg2 text-muted hover:text-ink'}`}
                              >
                                Todos {disparoEnvios.length}
                              </button>
                              {Object.entries(envioStatusCounts)
                                .sort((a, b) => b[1] - a[1])
                                .map(([status, count]) => (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => setDisparoEnviosFiltro(status)}
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize transition ${disparoEnviosFiltro === status ? 'bg-primary/15 text-primary' : 'bg-bg2 text-muted hover:text-ink'}`}
                                  >
                                    {status} {count}
                                  </button>
                                ))}
                            </div>
                            {erroMotivoResumo.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted2">Causas</span>
                                {erroMotivoResumo.map(item => (
                                  <span
                                    key={item.kind || item.title}
                                    className="inline-flex items-center gap-1 rounded-full border border-status-danger/20 bg-status-danger/10 px-2 py-0.5 text-[11px] font-medium text-status-danger"
                                    title={item.title}
                                  >
                                    {item.title}
                                    <span className="font-mono tabular-nums opacity-80">{item.count}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Lista — ocupa o resto da altura e rola de verdade */}
                          <VerticalScrollArrows className="min-h-0 flex-1" contentClassName="">
                            {disparoEnviosLoading ? (
                              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 px-4 py-12">
                                <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
                                <p className="text-sm text-muted">Carregando destinatários…</p>
                              </div>
                            ) : disparoEnviosError ? (
                              <div className="m-3 rounded-[12px] border border-status-danger/25 bg-status-danger/10 px-3 py-3 text-sm text-status-danger">
                                {disparoEnviosError}
                              </div>
                            ) : !disparoEnvios.length ? (
                              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center px-6 py-12 text-center">
                                <p className="text-sm font-medium text-ink">Nenhum destinatário nesta campanha</p>
                                <p className={`${subtle} mt-1 max-w-sm text-[12px]`}>
                                  A fila pode estar vazia (total 0) ou o n8n ainda não processou os envios.
                                </p>
                              </div>
                            ) : !enviosFiltrados.length ? (
                              <div className="px-4 py-10 text-center">
                                <p className="text-sm text-muted">Nenhum envio com esse filtro.</p>
                              </div>
                            ) : (
                              <ul className="divide-y divide-line/70">
                                {enviosFiltrados.map((e) => {
                                  const st = String(e.status || '—').toLowerCase();
                                  const isErr = st === 'erro' || st === 'error' || st === 'falha';
                                  const isOk = st === 'enviado' || st === 'sent' || st === 'sucesso';
                                  const errInfo = isErr && e.motivo ? formatDisparoError(e.motivo) : null;
                                  return (
                                    <li key={e.id || `${e.phone_number}-${e.created_at}-${e.status}`} className="px-3 py-2.5">
                                      <div className="flex items-start gap-2.5">
                                        <span
                                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                            isOk ? 'bg-status-success' : isErr ? 'bg-status-danger' : 'bg-status-warning'
                                          }`}
                                          aria-hidden
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                            <p className="truncate text-[13px] font-semibold text-ink">
                                              {e.contact_name || e.nome || 'Sem nome'}
                                            </p>
                                            <span className={`shrink-0 text-[11px] font-semibold ${envioStatusClass(e.status)}`}>
                                              {errInfo ? errInfo.title : (e.status || '—')}
                                            </span>
                                          </div>
                                          <p className="mt-0.5 truncate font-mono text-[12px] tabular-nums text-muted">
                                            {e.phone_number || '—'}
                                            {e.company_name ? ` · ${e.company_name}` : ''}
                                          </p>
                                          <p className="mt-0.5 truncate text-[11px] text-muted2">
                                            {[
                                              e.data_envio ? `Enviado ${fmtDateTime(e.data_envio)}` : null,
                                              e.data_erro ? `Erro ${fmtDateTime(e.data_erro)}` : null,
                                              !e.data_envio && !e.data_erro && e.created_at ? `Criado ${fmtDateTime(e.created_at)}` : null,
                                              e.instancia_nome || e.instancia || null,
                                            ].filter(Boolean).join(' · ')}
                                          </p>
                                          {errInfo && (
                                            <div className="mt-1 rounded-[8px] border border-status-danger/15 bg-status-danger/[0.07] px-2 py-1">
                                              <p className="text-[12px] leading-snug text-status-danger">
                                                {errInfo.detail}
                                                {errInfo.code != null && (
                                                  <span className="ml-1.5 font-mono text-[10px] text-status-danger/55">
                                                    HTTP {errInfo.code}
                                                  </span>
                                                )}
                                              </p>
                                              <details className="mt-0.5">
                                                <summary className="cursor-pointer select-none text-[10px] font-medium text-muted2 hover:text-muted">
                                                  Técnico
                                                </summary>
                                                <p className="mt-0.5 max-h-16 overflow-y-auto break-all font-mono text-[10px] leading-relaxed text-muted2">
                                                  {errInfo.raw.length > 400 ? `${errInfo.raw.slice(0, 400)}…` : errInfo.raw}
                                                </p>
                                              </details>
                                            </div>
                                          )}
                                          {isErr && !errInfo && (
                                            <p className="mt-1 text-[11px] text-status-danger/80">Erro sem motivo informado pelo n8n.</p>
                                          )}
                                        </div>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </VerticalScrollArrows>
                          {disparoEnvios.length > 0 && (
                            <div className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-muted2">
                              Mostrando {enviosFiltrados.length.toLocaleString('pt-BR')} de {disparoEnvios.length.toLocaleString('pt-BR')} destinatários
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
              <>
              {/* Stepper — connectors are half-segments beside each circle so the line never cuts into the ball */}
              <nav className={`${card} overflow-hidden p-3 sm:p-4`} aria-label="Etapas do disparo">
                <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-0">
                  {steps.map((s, idx) => {
                    const active = idx === currentStep;
                    const done = s.ok && idx < currentStep;
                    const reachable = idx <= maxReachable;
                    const locked = !reachable;
                    // Segment to the right of this step is filled once that step is complete / surpassed.
                    const lineAfterFilled = idx < maxReachable || (idx < currentStep && s.ok);
                    const lineBeforeFilled = idx > 0 && (idx - 1 < maxReachable || (idx - 1 < currentStep && steps[idx - 1]?.ok));
                    const circleClass = active
                      ? 'bg-primary text-white shadow-[0_0_0_4px_rgba(124,92,255,0.18)]'
                      : done
                        ? 'bg-status-success text-white'
                        : reachable
                          ? 'bg-surf2 text-muted ring-1 ring-line'
                          : 'bg-bg2 text-muted2 ring-1 ring-line/70';
                    return (
                      <li key={s.id} className="min-w-0">
                        <button
                          type="button"
                          disabled={locked && !active}
                          onClick={() => goToStep(idx)}
                          className={`group flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition sm:flex-col sm:items-stretch sm:gap-0 sm:px-0 sm:py-1 sm:text-center ${active ? 'bg-primary/[0.08] sm:bg-transparent' : reachable ? 'hover:bg-bg2 sm:hover:bg-transparent' : 'opacity-50'} ${locked && !active ? 'cursor-not-allowed' : ''}`}
                          aria-current={active ? 'step' : undefined}
                        >
                          {/* Row: [left line] [circle] [right line] — lines only on sm+ */}
                          <div className="flex shrink-0 items-center sm:w-full">
                            <span
                              className={`hidden h-[2px] flex-1 sm:block ${idx === 0 ? 'bg-transparent' : lineBeforeFilled ? 'bg-primary/55' : 'bg-line'}`}
                              aria-hidden="true"
                            />
                            <span
                              className={`relative z-[1] mx-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition sm:mx-1.5 ${circleClass}`}
                            >
                              {done ? (
                                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                  <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                idx + 1
                              )}
                            </span>
                            <span
                              className={`hidden h-[2px] flex-1 sm:block ${idx === steps.length - 1 ? 'bg-transparent' : lineAfterFilled ? 'bg-primary/55' : 'bg-line'}`}
                              aria-hidden="true"
                            />
                          </div>

                          <span className="min-w-0 flex-1 sm:mt-2.5 sm:px-1">
                            <span className={`block truncate text-[12px] font-semibold leading-tight sm:text-[11px] ${active ? 'text-primary' : done ? 'text-ink' : 'text-ink'}`}>
                              {s.label}
                            </span>
                            <span className={`mt-0.5 block truncate text-[11px] leading-snug sm:text-[10px] ${active ? 'text-primary/80' : 'text-muted2'}`}>
                              {s.short}
                            </span>
                          </span>

                          {/* Mobile: small status pip on the right */}
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full sm:hidden ${active ? 'bg-primary' : done ? 'bg-status-success' : reachable ? 'bg-line2' : 'bg-line'}`}
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </nav>

              {/* Current step content */}
              <section className={`${card} p-4 sm:p-6`} aria-labelledby="disparo-step-title">
                <p id="disparo-step-title" className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  Etapa {currentStep + 1} de {steps.length}
                </p>
                {stepBody}
              </section>

              {/* Footer nav */}
              <div className={`${card} sticky bottom-3 z-[5] flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4`}>
                <div className="min-w-0">
                  {!step.ok && step.blockReason ? (
                    <p className="text-[12px] text-status-warning">{step.blockReason}</p>
                  ) : currentStep === steps.length - 1 ? (
                    <p className={`text-[12px] ${readyToLaunch ? 'text-status-success' : 'text-muted'}`}>
                      {readyToLaunch ? 'Campanha completa — pode iniciar o disparo.' : 'Ainda há etapas incompletas. Use Editar nos cards acima.'}
                    </p>
                  ) : (
                    <p className="truncate text-[12px] text-muted">{step.summary}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={currentStep === 0}
                    className={`${btnSecondary} h-10 px-4 disabled:opacity-40`}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                    Voltar
                  </button>
                  {currentStep < steps.length - 1 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={!canGoNext}
                      className={`${btnPrimary} h-10 px-5 disabled:opacity-45 disabled:shadow-none`}
                    >
                      Continuar
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={sendDisparo}
                      disabled={!readyToLaunch}
                      className={`${btnPrimary} h-10 px-5 disabled:opacity-45 disabled:shadow-none`}
                    >
                      {disparoSending ? 'Iniciando…' : 'Iniciar disparo'}
                    </button>
                  )}
                </div>
              </div>
              </>
              )}
            </div>
            );
          })()}

          {activeView === 'Metas' && authStatus.role === 'admin' && (
            <div className="mt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <p className="text-sm text-muted">
                  Receita em R$: <span className="font-semibold text-ink/80 dark:text-white/80">meta</span> (plano) vs <span className="font-semibold text-ink/80 dark:text-white/80">realizado</span> (faturamento). Por mês e no ano.
                </p>
                <select value={metasYear} onChange={(e) => setMetasYear(Number(e.target.value))} className={`${select} h-10 font-mono`}>
                  {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {metasLoading ? (
                <div className={`${subtle} py-10 text-center`}>Carregando metas e realizado...</div>
              ) : (() => {
                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
                const currentMonth = new Date().getMonth() + 1;
                const isCurrentYear = metasYear === new Date().getFullYear();
                const hasRealizado = realizadoRows.length > 0;
                const realizadoByMes = new Map(realizadoRows.map(r => [Number(r.mes), r]));
                const monthlyRows = months.map((name, index) => {
                  const mes = index + 1;
                  const metaRow = metasRows.find(r => r.mes === mes) || {};
                  const realRow = realizadoByMes.get(mes) || {};
                  const meta = Number(metaRow.receita_meta) || 0;
                  const done = Number(realRow.receita) || 0;
                  return {
                    name,
                    fullName: monthNames[index],
                    mes,
                    meta,
                    done,
                    vendas: Number(realRow.vendas) || 0,
                    pct: meta > 0 ? Math.round((done / meta) * 100) : null,
                  };
                });
                const annualMeta = monthlyRows.reduce((sum, row) => sum + row.meta, 0);
                const annualReal = monthlyRows.reduce((sum, row) => sum + row.done, 0);
                const totalVendas = monthlyRows.reduce((sum, row) => sum + row.vendas, 0);
                const sellerRows = [...realizadoVendedores]
                  .map(row => ({
                    vendedor: row.vendedor || 'Sem vendedor',
                    receita: Number(row.receita) || 0,
                    vendas: Number(row.vendas) || 0,
                  }))
                  .filter(row => row.receita > 0 || row.vendas > 0)
                  .sort((a, b) => b.receita - a.receita);
                const sellerMax = Math.max(...sellerRows.map(row => row.receita), 1);
                const annualProgress = annualMeta ? annualReal / annualMeta : 0;
                const gap = Math.max(annualMeta - annualReal, 0);
                const elapsedMonths = isCurrentYear ? currentMonth : 12;
                const remainingMonths = Math.max(12 - elapsedMonths, 0);
                const elapsedReal = monthlyRows
                  .filter(row => !isCurrentYear || row.mes <= currentMonth)
                  .reduce((sum, row) => sum + row.done, 0);
                const expectedToDate = monthlyRows
                  .filter(row => !isCurrentYear || row.mes <= currentMonth)
                  .reduce((sum, row) => sum + row.meta, 0);
                const projection = elapsedMonths ? (elapsedReal / elapsedMonths) * 12 : annualReal;
                const paceProgress = expectedToDate ? elapsedReal / expectedToDate : 0;
                const requiredPerRemainingMonth = remainingMonths ? gap / remainingMonths : gap;
                const ticket = totalVendas ? annualReal / totalVendas : 0;
                const bestMonth = monthlyRows
                  .filter(row => row.done > 0)
                  .sort((a, b) => b.done - a.done)[0];
                // Mês em foco: corrente no ano atual; senão, último mês com meta/realizado
                const focusMonth = isCurrentYear
                  ? currentMonth
                  : (monthlyRows.slice().reverse().find(r => r.done > 0 || r.meta > 0)?.mes || 12);
                const focusRow = monthlyRows.find(r => r.mes === focusMonth) || monthlyRows[0];
                const monthMeta = focusRow?.meta || 0;
                const monthDone = focusRow?.done || 0;
                const monthGap = Math.max(monthMeta - monthDone, 0);
                const monthPct = monthMeta > 0 ? Math.round((monthDone / monthMeta) * 100) : null;
                const focusIsCurrent = isCurrentYear && focusMonth === currentMonth;
                // Rótulo curto p/ eixo do gráfico (sem truncar "R$ xxx mil")
                const shortBRL = (v) => {
                  if (v == null || !Number.isFinite(Number(v)) || Number(v) === 0) return '—';
                  const n = Number(v);
                  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
                  if (n >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} k`;
                  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
                };
                const maxMonthly = Math.max(...monthlyRows.map(row => Math.max(row.meta, row.done)), 1);
                const chartH = 200;

                return (
                  <div className="space-y-4">
                    {/* KPIs: mês em foco + ano, mesmo ritmo visual */}
                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                      {[
                        {
                          label: `Meta · ${focusRow?.fullName || 'mês'}`,
                          value: formatCompactCurrency(monthMeta) || 'R$ 0',
                          note: focusIsCurrent ? 'Meta do mês atual' : `Meta de ${focusRow?.fullName || ''}`,
                          tone: 'text-primary',
                        },
                        {
                          label: `Realizado · ${focusRow?.name || 'mês'}`,
                          value: hasRealizado ? (formatCompactCurrency(monthDone) || 'R$ 0') : '—',
                          note: monthPct != null ? `${monthPct}% da meta do mês` : 'Sem meta',
                          tone: 'text-green',
                        },
                        {
                          label: 'Meta anual',
                          value: formatCompactCurrency(annualMeta) || 'R$ 0',
                          note: `Plano ${metasYear}`,
                          tone: 'text-primary',
                        },
                        {
                          label: 'Realizado no ano',
                          value: hasRealizado ? (formatCompactCurrency(annualReal) || 'R$ 0') : '—',
                          note: hasRealizado ? `${Math.round(annualProgress * 100)}% da meta anual` : 'Base não conectada',
                          tone: 'text-green',
                        },
                      ].map(item => (
                        <div key={item.label} className={`${card} p-4`}>
                          <p className="text-[11px] text-muted">{item.label}</p>
                          <p className="mt-2 font-mono text-[22px] sm:text-[24px] font-bold leading-none text-ink">{item.value}</p>
                          <p className={`mt-1.5 font-mono text-[11px] ${item.tone}`}>{item.note}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                      {[
                        { label: 'Gap do mês', value: hasRealizado ? (formatCompactCurrency(monthGap) || 'R$ 0') : '—', note: monthPct != null && monthPct >= 100 ? 'Meta batida' : 'Falta no mês', tone: 'text-amber' },
                        { label: 'Gap anual', value: hasRealizado ? (formatCompactCurrency(gap) || 'R$ 0') : '—', note: 'Falta para o ano', tone: 'text-amber' },
                        { label: 'Projeção (run-rate)', value: hasRealizado ? (formatCompactCurrency(projection) || 'R$ 0') : '—', note: hasRealizado && totalVendas ? `Ticket ${formatCompactCurrency(ticket) || '—'} · ${totalVendas} vendas` : 'Extrapolação', tone: 'text-cyan' },
                        { label: 'Ritmo vs esperado', value: `${Math.round(paceProgress * 100)}%`, note: `Meta até agora ${formatCompactCurrency(expectedToDate) || 'R$ 0'}`, tone: paceProgress >= 1 ? 'text-green' : 'text-amber' },
                      ].map(item => (
                        <div key={item.label} className={`${card} p-4`}>
                          <p className="text-[11px] text-muted">{item.label}</p>
                          <p className="mt-2 font-mono text-[20px] font-bold leading-none text-ink">{item.value}</p>
                          <p className={`mt-1.5 font-mono text-[11px] ${item.tone}`}>{item.note}</p>
                        </div>
                      ))}
                    </div>

                    {/* Gráfico full-width — uma coluna por mês (meta fundo + realizado sólido) */}
                    <div className={`${card} p-5 sm:p-6`}>
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Meta × realizado mensal</h3>
                          <p className={`${subtle} mt-0.5`}>
                            Barra clara = meta · barra sólida = realizado (mesma escala em R$).
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-muted">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-2.5 rounded-sm bg-primary/30 ring-1 ring-primary/40" /> Meta
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-2.5 rounded-sm bg-primary" /> Realizado
                          </span>
                        </div>
                      </div>

                      <div className="flex items-end gap-1 sm:gap-1.5">
                        {monthlyRows.map(row => {
                          const metaH = row.meta > 0 ? Math.max((row.meta / maxMonthly) * chartH, 3) : 0;
                          const doneH = row.done > 0 ? Math.max((row.done / maxMonthly) * chartH, 3) : 0;
                          const beat = row.meta > 0 && row.done >= row.meta;
                          const isFocus = row.mes === focusMonth;
                          return (
                            <div
                              key={row.mes}
                              className="flex min-w-0 flex-1 flex-col items-center gap-1"
                              title={`${row.fullName}\nMeta: ${formatCompactCurrency(row.meta) || 'R$ 0'}\nRealizado: ${formatCompactCurrency(row.done) || 'R$ 0'}`}
                            >
                              <div
                                className={`relative w-full max-w-[40px] mx-auto ${isFocus ? 'opacity-100' : 'opacity-90'}`}
                                style={{ height: chartH }}
                              >
                                {/* Meta — volume do plano (fundo) */}
                                {metaH > 0 && (
                                  <div
                                    className="absolute bottom-0 left-1/2 w-[72%] -translate-x-1/2 rounded-t-md bg-primary/25 ring-1 ring-inset ring-primary/35"
                                    style={{ height: metaH }}
                                  />
                                )}
                                {/* Realizado — sobreposto */}
                                {doneH > 0 && (
                                  <div
                                    className={`absolute bottom-0 left-1/2 w-[48%] -translate-x-1/2 rounded-t-md ${beat ? 'bg-green' : 'bg-primary'}`}
                                    style={{ height: doneH }}
                                  />
                                )}
                              </div>
                              <span className={`font-mono text-[11px] font-semibold ${isFocus ? 'text-primary' : 'text-muted'}`}>
                                {row.name}
                              </span>
                              <span className="font-mono text-[10px] font-semibold tabular-nums text-primary leading-none">
                                {shortBRL(row.meta)}
                              </span>
                              <span className="font-mono text-[10px] font-semibold tabular-nums text-green leading-none">
                                {shortBRL(row.done)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
                        <span>
                          <span className="text-primary">Roxo claro</span> = meta do mês (R$)
                        </span>
                        <span>
                          <span className="text-green">Verde / roxo sólido</span> = realizado
                        </span>
                        <span className="ml-auto">
                          Necessário/mês restante: <span className="font-semibold text-ink">{formatCompactCurrency(requiredPerRemainingMonth) || 'R$ 0'}</span>
                          {bestMonth ? (
                            <> · Melhor mês: <span className="font-semibold text-ink">{bestMonth.name} {formatCompactCurrency(bestMonth.done)}</span></>
                          ) : null}
                        </span>
                      </div>
                    </div>

                    {/* Vendedores */}
                    <div className={`${card} p-5 sm:p-6`}>
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h3 className={`${sectionTitle} text-base`}>Realizado por vendedor</h3>
                          <p className={`${subtle} mt-0.5`}>Faturamento do ano</p>
                        </div>
                        <span className="font-mono text-[11px] text-muted">{sellerRows.length} vendedor{sellerRows.length === 1 ? '' : 'es'}</span>
                      </div>
                      {sellerRows.length ? (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {sellerRows.slice(0, 9).map((row, idx) => (
                            <div key={row.vendedor || idx} className="rounded-xl border border-line bg-bg2 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <p className="min-w-0 truncate text-sm font-semibold text-ink">{row.vendedor}</p>
                                <span className="font-mono text-[11px] text-muted shrink-0">{row.vendas} venda{row.vendas === 1 ? '' : 's'}</span>
                              </div>
                              <p className="mt-2 font-mono text-base font-bold text-ink">{formatCompactCurrency(row.receita) || 'R$ 0'}</p>
                              <div className="mt-2 h-1.5 rounded-full bg-bg">
                                <div
                                  className="h-full rounded-full bg-primary/70"
                                  style={{ width: `${Math.max((row.receita / sellerMax) * 100, 2)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`${subtle} rounded-xl border border-line bg-bg2 py-6 text-center`}>
                          Sem faturamento por vendedor para este ano.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeView === 'Definir Metas' && authStatus.role === 'admin' && (
            <div className="mt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <p className="text-sm text-muted">
                  Plano de receita mensal (R$). O realizado de faturamento aparece em Metas e Resultados.
                </p>
                <select value={metasYear} onChange={(e) => setMetasYear(Number(e.target.value))} className={`${select} h-10 font-mono`}>
                  {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {metasLoading ? (
                <div className={`${subtle} py-10 text-center`}>Carregando metas...</div>
              ) : (() => {
                const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
                const hasRealizado = realizadoRows.length > 0;
                const realizadoByMes = new Map(realizadoRows.map(r => [Number(r.mes), r]));
                const annualMeta = monthNames.reduce((sum, _, i) => {
                  const row = metasRows.find(r => r.mes === i + 1) || {};
                  return sum + (Number(row.receita_meta) || 0);
                }, 0);
                const annualReal = realizadoRows.reduce((sum, r) => sum + (Number(r.receita) || 0), 0);
                return (
                  <div className="space-y-5 max-w-3xl">
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                      <div className={`${card} p-5`}>
                        <p className="text-[12px] text-muted">Meta anual (soma)</p>
                        <p className="mt-2 font-mono text-[24px] font-bold text-primary">{formatCompactCurrency(annualMeta) || 'R$ 0'}</p>
                        <p className={`${subtle} mt-1`}>Plano configurado para {metasYear}</p>
                      </div>
                      <div className={`${card} p-5`}>
                        <p className="text-[12px] text-muted">Realizado no ano</p>
                        <p className="mt-2 font-mono text-[24px] font-bold text-green">{hasRealizado ? (formatCompactCurrency(annualReal) || 'R$ 0') : '—'}</p>
                        <p className={`${subtle} mt-1`}>Referência (somente leitura)</p>
                      </div>
                    </div>

                    <div className={`${card} overflow-hidden`}>
                      <div className="border-b border-line px-4 py-3">
                        <h3 className={`${sectionTitle} text-base`}>Metas mensais de receita</h3>
                        <p className={subtle}>Altere o valor e saia do campo para salvar. Usado em Metas e Resultados.</p>
                      </div>
                      <div className="grid grid-cols-[1.2fr_1.4fr_1.3fr] gap-3 px-4 py-3 border-b border-line text-[11px] font-mono font-semibold uppercase tracking-wide text-muted">
                        <span>Mês</span>
                        <span>Meta de receita (R$)</span>
                        <span>Realizado (ref.)</span>
                      </div>
                      {monthNames.map((nome, i) => {
                        const mes = i + 1;
                        const row = metasRows.find(r => r.mes === mes) || {};
                        const real = realizadoByMes.get(mes) || {};
                        const metaValue = Number(row.receita_meta) || 0;
                        const realValue = Number(real.receita) || 0;
                        return (
                          <div key={mes} className="grid grid-cols-[1.2fr_1.4fr_1.3fr] gap-3 px-4 py-2 items-center border-b border-line/60 last:border-0">
                            <span className="text-sm font-medium text-ink dark:text-white">{nome}</span>
                            <input
                              key={`${metasYear}-${mes}`}
                              type="number"
                              step="0.01"
                              defaultValue={metaValue || ''}
                              placeholder="0,00"
                              onBlur={(e) => saveMeta(metasYear, mes, { receita_meta: Number(e.target.value) || 0 }, row)}
                              className={`${input} h-9 w-full font-mono`}
                              aria-label={`Meta de receita de ${nome}`}
                            />
                            <span className="font-mono text-sm text-muted">{hasRealizado ? (formatCompactCurrency(realValue) || 'R$ 0') : '—'}</span>
                          </div>
                        );
                      })}
                      <div className="grid grid-cols-[1.2fr_1.4fr_1.3fr] gap-3 border-t border-line bg-bg2 px-4 py-3 items-center">
                        <span className="text-sm font-semibold text-ink dark:text-white">Total {metasYear}</span>
                        <span className="font-mono text-sm font-semibold text-primary">{formatCompactCurrency(annualMeta) || 'R$ 0'}</span>
                        <span className="font-mono text-sm text-muted">{hasRealizado ? (formatCompactCurrency(annualReal) || 'R$ 0') : '—'}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeView === 'Usuários' && authStatus.role === 'admin' && (
            <div className="mt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <p className="text-sm text-muted">Papéis vêm do Chatwoot. Defina quais páginas cada membro pode ver.</p>
                <button type="button" onClick={loadUsers} className={`${btnSecondary} h-10 px-4`}>Atualizar</button>
              </div>
              {usersLoading ? (
                <div className={`${subtle} py-10 text-center`}>Carregando usuários…</div>
              ) : (
                <div className={`${card} divide-y divide-line`}>
                  {usersList.map(u => {
                    const allViews = ['Overview', 'Board', 'Busca Lead B2B', 'Licitações', 'Processo'];
                    const isAdminUser = u.role === 'admin';
                    const current = Array.isArray(u.allowed_views) && u.allowed_views.length ? u.allowed_views : (isAdminUser ? allViews : []);
                    return (
                      <div key={u.id} className="flex flex-col lg:flex-row lg:items-center gap-4 p-4">
                        <div className="flex items-center gap-3 lg:w-64 shrink-0">
                          <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {String(u.name || u.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink dark:text-white truncate">{u.name}</p>
                            <p className={`${subtle} truncate`}>{u.email}</p>
                          </div>
                        </div>
                        <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-semibold shrink-0 ${isAdminUser ? 'bg-secondary/15 text-secondary' : 'bg-bg2 text-muted border border-line'}`}>
                          {isAdminUser ? 'Admin' : 'Membro'}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {isAdminUser ? (
                            <span className={subtle}>Acesso total (admin)</span>
                          ) : allViews.map(v => {
                            const on = current.includes(v);
                            return (
                              <button
                                key={v}
                                type="button"
                                onClick={() => {
                                  const next = on ? current.filter(x => x !== v) : [...current, v];
                                  saveUserAccess(u.id, next);
                                }}
                                className={`h-7 px-2.5 rounded-full text-[12px] font-medium border transition ${on ? 'bg-primary/10 text-primary border-primary/30' : 'bg-cardAlt text-muted border-border hover:text-ink'}`}
                              >
                                {viewLabel(v)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {!usersList.length && <div className={`${subtle} p-6 text-center`}>Nenhum usuário encontrado.</div>}
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
            const buildFilterParams = (snap) => {
              const f = snap?.filters || rfbFilters;
              const ops = snap?.ops || rfbOps;
              const capitalRange = snap?.capitalRange || rfbCapitalRange;
              const aberturaRange = snap?.aberturaRange || rfbAberturaRange;
              const endereco = snap?.endereco != null ? snap.endereco : rfbEndereco;
              const enderecoOp = snap?.enderecoOp || rfbEnderecoOp;
              const endereco2 = snap?.endereco2 != null ? snap.endereco2 : rfbEndereco2;
              const endereco2Op = snap?.endereco2Op || rfbEndereco2Op;
              const enderecoLogic = snap?.enderecoLogic || rfbEnderecoLogic;
              const nome2 = snap?.nome2 != null ? snap.nome2 : rfbNome2;
              const nome2Op = snap?.nome2Op || rfbNome2Op;
              const nomeLogic = snap?.nomeLogic || rfbNomeLogic;
              const socio2 = snap?.socio2 != null ? snap.socio2 : rfbSocio2;
              const socio2Op = snap?.socio2Op || rfbSocio2Op;
              const socioLogic = snap?.socioLogic || rfbSocioLogic;
              const simples = snap?.simples != null ? snap.simples : rfbSimples;
              const mei = snap?.mei != null ? snap.mei : rfbMei;
              const onlyMatriz = snap?.onlyMatriz != null ? snap.onlyMatriz : rfbOnlyMatriz;
              const cnaeOnlyPrincipal = snap?.cnaeOnlyPrincipal != null ? snap.cnaeOnlyPrincipal : rfbCnaeOnlyPrincipal;
              const fp = new URLSearchParams();
              if ((f.cnpj || '').trim()) fp.set('cnpj', f.cnpj.trim());
              if ((f.nome || '').trim()) { fp.set('nome', stripAccents(f.nome.trim())); fp.set('nome_op', ops.nome); }
              if ((nome2 || '').trim()) { fp.set('nome2', stripAccents(nome2.trim())); fp.set('nome2_op', nome2Op); }
              if ((f.nome || '').trim() && (nome2 || '').trim()) fp.set('nome_logic', nomeLogic);
              if ((f.socio || '').trim()) { fp.set('socio', stripAccents(f.socio.trim())); fp.set('socio_op', ops.socio); }
              if ((socio2 || '').trim()) { fp.set('socio2', stripAccents(socio2.trim())); fp.set('socio2_op', socio2Op); }
              if ((f.socio || '').trim() && (socio2 || '').trim()) fp.set('socio_logic', socioLogic);
              if ((f.uf || '').trim()) fp.set('uf', f.uf.trim());
              if ((f.municipio || '').trim()) fp.set('municipio', f.municipio.trim());
              if ((f.cnae || []).length > 0) fp.set('cnae', f.cnae.join(','));
              if ((f.cnaeNot || []).length > 0) fp.set('cnae_not', f.cnaeNot.join(','));
              if (((f.cnae || []).length > 0 || (f.cnaeNot || []).length > 0) && cnaeOnlyPrincipal) fp.set('cnae_only_principal', 'true');
              if ((f.situacao || []).length > 0) fp.set('situacao', f.situacao.join(','));
              if ((f.porte || '').trim()) fp.set('porte', f.porte.trim());
              if ((f.natureza || []).length > 0) fp.set('natureza', f.natureza.join(','));
              if ((capitalRange?.[0] || 0) > 0) fp.set('capital_min', capitalRange[0]);
              if ((capitalRange?.[1] || 0) > 0) fp.set('capital_max', capitalRange[1]);
              if ((aberturaRange?.[0] || 0) > 0) fp.set('abertura_min_anos', aberturaRange[0]);
              if ((aberturaRange?.[1] || 0) > 0) fp.set('abertura_max_anos', aberturaRange[1]);
              if ((endereco || '').trim()) { fp.set('endereco', stripAccents(endereco.trim())); fp.set('endereco_op', enderecoOp); }
              if ((endereco2 || '').trim()) { fp.set('endereco2', stripAccents(endereco2.trim())); fp.set('endereco2_op', endereco2Op); }
              if ((endereco || '').trim() && (endereco2 || '').trim()) fp.set('endereco_logic', enderecoLogic);
              if (simples) fp.set('simples', simples);
              if (mei) fp.set('mei', mei);
              if (!onlyMatriz) fp.set('only_matriz', 'false');
              return fp;
            };
            // Exposta para a busca global do header disparar a pesquisa após navegar até aqui.
            rfbSearchTriggerRef.current = (...args) => handleRfbSearch(...args);
            const handleRfbSearch = async (pageOverride, pageSizeOverride, orderByOverride, filterSnap) => {
              const pg = pageOverride     != null ? pageOverride     : rfbPage;
              const ps = pageSizeOverride != null ? pageSizeOverride : rfbPageSize;
              const ob = orderByOverride  != null ? orderByOverride  : rfbOrderBy;
              if (pg === 1) setRfbExpanded(null);

              const fp = buildFilterParams(filterSnap);
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
                  try {
                    localStorage.setItem('rfb_search', JSON.stringify({
                      filters: filterSnap?.filters || rfbFilters,
                      ops: filterSnap?.ops || rfbOps,
                      orderBy: ob,
                      pageSize: ps,
                      capitalRange: filterSnap?.capitalRange || rfbCapitalRange,
                      aberturaRange: filterSnap?.aberturaRange || rfbAberturaRange,
                      endereco: filterSnap?.endereco != null ? filterSnap.endereco : rfbEndereco,
                      enderecoOp: filterSnap?.enderecoOp || rfbEnderecoOp,
                      simples: filterSnap?.simples != null ? filterSnap.simples : rfbSimples,
                      mei: filterSnap?.mei != null ? filterSnap.mei : rfbMei,
                      onlyMatriz: filterSnap?.onlyMatriz != null ? filterSnap.onlyMatriz : rfbOnlyMatriz,
                      cnaeOnlyPrincipal: filterSnap?.cnaeOnlyPrincipal != null ? filterSnap.cnaeOnlyPrincipal : rfbCnaeOnlyPrincipal,
                    }));
                  } catch {}
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

            const applyTrendsSuggestion = (s) => {
              const f = s?.filters || {};
              const nextFilters = {
                cnpj: '',
                nome: f.nome || '',
                socio: '',
                uf: f.uf || '',
                municipio: '',
                cnae: Array.isArray(f.cnae) ? f.cnae : [],
                cnaeNot: [],
                situacao: Array.isArray(f.situacao) && f.situacao.length ? f.situacao : ['2'],
                porte: f.porte || '',
                natureza: [],
              };
              const capitalRange = [Number(f.capital_min) || 0, Number(f.capital_max) || 0];
              const aberturaRange = [Number(f.abertura_min_anos) || 0, Number(f.abertura_max_anos) || 0];
              const onlyMatriz = f.only_matriz !== false;
              const mei = f.mei || '';
              const simples = f.simples || '';
              setRfbFilters(nextFilters);
              setRfbCapitalRange(capitalRange);
              setRfbAberturaRange(aberturaRange);
              setRfbOnlyMatriz(onlyMatriz);
              setRfbMei(mei);
              setRfbSimples(simples);
              setRfbMunicipioInput('');
              setRfbShowFilters(true);
              if ((f.cnae_labels || []).length) {
                setRfbCnaes((prev) => {
                  const map = new Map(prev.map((c) => [c.codigo, c]));
                  f.cnae_labels.forEach((c) => {
                    if (c?.codigo && !map.has(c.codigo)) {
                      map.set(c.codigo, { codigo: c.codigo, descricao: c.descricao || c.codigo });
                    }
                  });
                  return Array.from(map.values());
                });
              }
              handleRfbSearch(1, null, null, {
                filters: nextFilters,
                capitalRange,
                aberturaRange,
                onlyMatriz,
                mei,
                simples,
                endereco: '',
                endereco2: '',
                nome2: '',
                socio2: '',
              });
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
                    <p className="text-sm text-muted mb-4">Dados abertos da Receita Federal — importação local</p>

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
                <div className="rounded-[18px] border border-line bg-surf p-5 shadow-card mb-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Prospecção</p>
                      <p className="mt-1 text-sm text-muted">
                        Dados abertos da Receita Federal — uso local
                        {rfbStatus?.dev_limit > 0 && (
                          <span className="ml-2 text-xs bg-status-warning/10 text-status-warning border border-status-warning/30 rounded-full px-2 py-0.5">
                            amostra ({rfbStatus.dev_limit} arq./cat.)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span className="rounded-xl border border-line bg-bg2 px-3 py-2"><span className="font-mono font-semibold text-ink">{(rfbStatus?.records?.estabelecimentos || 0).toLocaleString('pt-BR')}</span> estabelecimentos</span>
                      <span className="rounded-xl border border-line bg-bg2 px-3 py-2"><span className="font-mono font-semibold text-ink">{(rfbStatus?.records?.empresas || 0).toLocaleString('pt-BR')}</span> empresas</span>
                      <span className="rounded-xl border border-line bg-bg2 px-3 py-2"><span className={`font-mono font-semibold ${Math.max(0, rfbStatus?.records?.socios || 0) === 0 ? 'text-status-warning' : 'text-ink'}`}>{Math.max(0, rfbStatus?.records?.socios || 0).toLocaleString('pt-BR')}</span> sócios</span>
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
                  <div className={modalOverlay} onClick={() => setRfbUpdateConfirm(false)}>
                    <div className={`${modalPanel} flex flex-col gap-4`} onClick={e => e.stopPropagation()}>
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
                          className={btnSecondary}
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
                  <div className={modalOverlay} onClick={() => setRfbReimportConfirm(false)}>
                    <div className={`${modalPanel} flex flex-col gap-5`} onClick={e => e.stopPropagation()}>
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
                          className={btnSecondary}
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
                    <div className={modalOverlay} onClick={() => setRfbImportDialog(null)}>
                      <div className={`${modalPanel} flex max-h-[90vh] flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="shrink-0">
                          <p className="text-xs text-muted uppercase tracking-wide mb-0.5">{isDup ? 'Atualizar contato' : 'Importar para o Chatwoot'}</p>
                          <p className="font-semibold text-ink text-base leading-tight">{row.razao_social}</p>
                          {row.nome_fantasia && <p className="text-sm text-muted">{row.nome_fantasia}</p>}
                          <p className="text-xs text-muted font-mono mt-1">{fmtCNPJ(row.cnpj)}</p>
                        </div>

                        <VerticalScrollArrows className="mt-4 min-h-0 flex-1" contentClassName="space-y-4 pr-0.5">
                          {/* Sócio */}
                          <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Sócio (contato principal)</label>
                            <input
                              type="text"
                              className={`${input} w-full`}
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
                              className={`${input} w-full`}
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
                              className={`${input} w-full`}
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
                              className={`${select} w-full`}
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
                        </VerticalScrollArrows>

                        {/* Ações */}
                        <div className="flex shrink-0 gap-2 justify-end border-t border-border pt-3 mt-3">
                          <button
                            onClick={() => setRfbImportDialog(null)}
                            className={btnSecondary}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleRfbImport(row, { stage: rfbImportDialogStage, labels: rfbImportDialogLabels })}
                            className={`${btnPrimary} ${isDup ? '!bg-status-warning hover:!bg-status-warning/90' : ''}`}
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

                {/* Filtros no topo: faixa compacta sempre visível + painel completo expansível */}
                <div className="flex flex-col gap-4">

                  {/* Google Trends → sugestões IA de prospecção */}
                  <div className={`${card} overflow-hidden`}>
                    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (trendsPanelOpen) {
                            setTrendsPanelOpen(false);
                            return;
                          }
                          setTrendsPanelOpen(true);
                          // Gera sob demanda na 1ª abertura (cache do dia se já existir no backend).
                          if (!trendsIntel && !trendsIntelLoading && !trendsRefreshing) {
                            loadTrendsIntel({ force: false });
                          }
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-ink">Radar Trends</p>
                            <span className="rounded-full border border-line bg-bg2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                              BR
                            </span>
                            {trendsIntel?.day && (
                              <span className="font-mono text-[10px] text-muted">{trendsIntel.day}</span>
                            )}
                            {(trendsIntel?.intel?.suggestions || []).length > 0 && (
                              <span className="font-mono text-[10px] text-muted">
                                {(trendsIntel.intel.suggestions || []).length} busca{(trendsIntel.intel.suggestions || []).length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {trendsPanelOpen
                              ? (trendsIntel?.intel?.opportunity_day
                                || trendsIntel?.intel?.summary
                                || (trendsIntelLoading || trendsRefreshing
                                  ? 'Gerando sugestões a partir dos trends…'
                                  : 'Oportunidades de prospecção: setores, ICPs, obras, energia, segurança, canais e o que estiver em alta'))
                              : 'Expandir para gerar sugestões de prospecção (setores, ICPs, CNAE, UF, porte) a partir dos trends'}
                          </p>
                        </div>
                        <span className="shrink-0 text-muted" aria-hidden>{trendsPanelOpen ? '▾' : '▸'}</span>
                      </button>
                      {trendsPanelOpen && (
                        <button
                          type="button"
                          disabled={trendsRefreshing || trendsIntelLoading}
                          onClick={(e) => {
                            e.stopPropagation();
                            loadTrendsIntel({ force: true });
                          }}
                          className={`${btnSecondary} shrink-0`}
                        >
                          {trendsRefreshing || trendsIntelLoading ? 'Gerando…' : 'Atualizar'}
                        </button>
                      )}
                    </div>

                    {trendsPanelOpen && (
                      <div className="px-4 py-3">
                        {trendsIntelError && (
                          <p className="mb-3 rounded-[11px] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
                            {trendsIntelError}
                          </p>
                        )}

                        {trendsIntelLoading && !trendsIntel ? (
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {[1, 2, 3].map((i) => (
                              <div key={i} className="h-36 animate-pulse rounded-[12px] bg-bg2" />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {(trendsIntel?.trends || []).length > 0 && (
                              <div>
                                <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2">
                                  Em alta hoje
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {trendsIntel.trends.slice(0, 12).map((t) => (
                                    <span
                                      key={t.title}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg2 px-2.5 py-1 text-[11px] text-ink"
                                      title={(t.news || []).map((n) => n.title).filter(Boolean).join(' · ')}
                                    >
                                      <span className="font-medium">{t.title}</span>
                                      {t.traffic && (
                                        <span className="font-mono text-[10px] text-muted">{t.traffic}</span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div>
                              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2">
                                Sugestões de busca RFB
                              </p>
                              {(trendsIntel?.intel?.suggestions || []).length === 0 ? (
                                <p className="text-xs text-muted">
                                  {trendsIntel?.intel?.summary || 'Sem sugestões ainda. Clique em Atualizar.'}
                                </p>
                              ) : (
                                <div className="grid items-stretch gap-2 md:grid-cols-2 xl:grid-cols-3">
                                  {trendsIntel.intel.suggestions.map((s, idx) => {
                                    const f = s.filters || {};
                                    const porteLabel = f.porte === '01' ? 'ME' : f.porte === '03' ? 'EPP' : f.porte === '05' ? 'Demais' : f.porte;
                                    const borderClass = s.priority === 'alta'
                                      ? 'border-status-success/35 bg-status-success/5'
                                      : s.priority === 'baixa'
                                        ? 'border-line bg-bg2'
                                        : 'border-primary/25 bg-primary/[0.04]';
                                    const prioClass = s.priority === 'alta'
                                      ? 'bg-status-success/15 text-status-success'
                                      : s.priority === 'baixa'
                                        ? 'bg-bg2 text-muted border border-line'
                                        : 'bg-primary/12 text-primary';
                                    return (
                                      <div key={`${s.title}-${idx}`} className={`flex h-full flex-col rounded-[12px] border px-3 py-2.5 ${borderClass}`}>
                                        <div className="min-h-0 flex-1">
                                          <div className="flex items-start justify-between gap-2">
                                            <p className="text-sm font-semibold text-ink">{s.title}</p>
                                            {s.priority && (
                                              <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${prioClass}`}>
                                                {s.priority}
                                              </span>
                                            )}
                                          </div>
                                          {(s.company_profile || s.product_fit) && (
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted">
                                              {[s.company_profile, s.product_fit].filter(Boolean).join(' · ')}
                                            </p>
                                          )}
                                          <div className="mt-2 flex flex-wrap gap-1">
                                            <span className="rounded-md bg-surf px-1.5 py-0.5 font-mono text-[10px] text-primary">
                                              {f.uf ? `UF ${f.uf}` : 'Nacional'}
                                            </span>
                                            {porteLabel && (
                                              <span className="rounded-md bg-surf px-1.5 py-0.5 font-mono text-[10px] text-muted">
                                                Porte {porteLabel}
                                              </span>
                                            )}
                                            {(f.capital_min > 0 || f.capital_max > 0) && (
                                              <span className="rounded-md bg-surf px-1.5 py-0.5 font-mono text-[10px] text-muted">
                                                Capital {f.capital_min > 0 ? `≥${Number(f.capital_min).toLocaleString('pt-BR')}` : ''}
                                                {f.capital_max > 0 ? ` ≤${Number(f.capital_max).toLocaleString('pt-BR')}` : ''}
                                              </span>
                                            )}
                                            {(f.abertura_min_anos > 0 || f.abertura_max_anos > 0) && (
                                              <span className="rounded-md bg-surf px-1.5 py-0.5 font-mono text-[10px] text-muted">
                                                Idade {f.abertura_min_anos || 0}–{f.abertura_max_anos || '∞'}a
                                              </span>
                                            )}
                                            {(f.cnae_labels || []).slice(0, 3).map((c) => (
                                              <span
                                                key={c.codigo}
                                                className="rounded-md bg-surf px-1.5 py-0.5 font-mono text-[10px] text-muted"
                                                title={c.descricao}
                                              >
                                                {c.codigo}
                                              </span>
                                            ))}
                                          </div>
                                          {s.rationale && (
                                            <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted">{s.rationale}</p>
                                          )}
                                          {(s.related_trends || []).length > 0 && (
                                            <p className="mt-1 text-[10px] text-muted2">
                                              Trends: {(s.related_trends || []).slice(0, 4).join(' · ')}
                                            </p>
                                          )}
                                        </div>
                                        <div className="mt-2.5 shrink-0">
                                          <button
                                            type="button"
                                            className={`${btnPrimary} w-full`}
                                            onClick={() => applyTrendsSuggestion(s)}
                                          >
                                            Aplicar filtros
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {(trendsIntel?.meta?.ai?.provider || trendsIntel?.cache) && (
                          <p className="mt-3 border-t border-line pt-2 font-mono text-[10px] text-muted2">
                            {trendsIntel?.meta?.ai?.provider && (
                              <span>
                                IA: {trendsIntel.meta.ai.provider}
                                {trendsIntel.meta.ai.model ? ` · ${trendsIntel.meta.ai.model}` : ''}
                                {trendsIntel.meta.ai.fallback ? ' · fallback' : ''}
                              </span>
                            )}
                            {trendsIntel?.cache && trendsIntel.cache !== 'fresh' && (
                              <span>{trendsIntel?.meta?.ai?.provider ? ' · ' : ''}cache: {trendsIntel.cache}</span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid items-center gap-2.5 rounded-[16px] border border-line bg-surf p-3 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_150px_auto_auto_auto]">
                    {!rfbShowFilters && (
                      <>
                        <div className="relative flex h-9 min-w-0 items-center rounded-[11px] border border-line bg-bg2 sm:col-span-2 lg:col-span-1">
                          <MagnifyingGlassIcon className="absolute left-3 h-4 w-4 text-muted" />
                          <input
                            type="text"
                            placeholder="Nome ou razão social…"
                            value={rfbFilters.nome}
                            onChange={e => setRfbFilters(p => ({ ...p, nome: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }}
                            className="h-full w-full rounded-[11px] bg-transparent pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted"
                          />
                        </div>
                        <select
                          value={rfbFilters.uf}
                          onChange={e => setRfbFilters(p => ({ ...p, uf: e.target.value, municipio: '' }))}
                          className={`${select} w-full`}
                        >
                          <option value="">Todas UFs</option>
                          {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                        </select>
                        <button
                          onClick={() => handleRfbSearch(1)}
                          disabled={rfbLoading}
                          className={`${btnPrimary} w-full px-6 lg:w-auto`}
                        >
                          {rfbLoading ? 'Buscando…' : 'Buscar'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setRfbShowFilters(p => !p)}
                      className={`${btnSecondary} w-full px-3.5 lg:w-auto ${rfbShowFilters ? 'lg:ml-auto' : ''}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M10 20h4"/></svg>
                      {rfbShowFilters ? 'Recolher filtros' : 'Todos os filtros'}
                    </button>
                    {rfbResults.length > 0 && (
                      <span className="font-mono text-xs text-muted lg:justify-self-end">
                        {rfbTotal >= 10001 ? '+10.000' : rfbTotal.toLocaleString('pt-BR')} resultado{rfbTotal !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* ── Painel completo de filtros (expansível, seções em grade) ── */}
                  <div className={`${rfbShowFilters ? 'flex' : 'hidden'} w-full flex-col gap-5 rounded-[18px] border border-line bg-surf p-4 shadow-card sm:p-5`}>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Filtros de busca</p>
                        <p className="mt-1 text-xs text-muted">Refine antes de importar para manter o CRM limpo.</p>
                      </div>
                    </div>

                    {(() => {
                      const OP_LIST = [['contains','∋'],['not_contains','∌'],['starts','^'],['ends','$'],['exact','=']];
                      const OP_TITLES = { contains:'Contém', not_contains:'Não contém', starts:'Começa com', ends:'Termina com', exact:'Igual a' };
                      // Uniform field shell: fixed label row (h-5) + fixed control row (h-9)
                      // so every column lines up across the grid.
                      const fieldShell = 'flex min-w-0 flex-col gap-1.5';
                      const fieldHead = 'flex h-5 items-center justify-between gap-2';
                      const fieldLabel = 'text-xs font-medium text-muted';
                      const fieldInput = `${input} w-full text-xs`;
                      const fieldSelect = `${select} w-full text-xs`;
                      const sectionHead = 'mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted';
                      const eouBtn = 'shrink-0 text-[11px] font-medium text-primary transition hover:opacity-70';
                      const OpPills = ({ val, set, compact }) => (
                        <div className={`flex shrink-0 items-center gap-0.5 ${compact ? '' : 'flex-wrap'}`}>
                          {OP_LIST.map(([op, sym]) => (
                            <button key={op} type="button" onClick={() => set(op)} title={OP_TITLES[op]}
                              className={`h-6 min-w-[22px] rounded-md border px-1 text-[11px] leading-none transition ${val === op ? 'border-primary bg-primary text-white' : 'border-transparent text-muted2 hover:border-line hover:bg-bg2 hover:text-ink'}`}
                            >{sym}</button>
                          ))}
                        </div>
                      );
                      const LogicToggle = ({ val, set }) => (
                        <div className="flex gap-0.5">
                          {['AND','OR'].map(l => (
                            <button key={l} type="button" onClick={() => set(l)}
                              className={`h-6 rounded-md border px-2 text-[11px] font-medium leading-none transition ${val === l ? 'border-primary bg-primary/90 text-white' : 'border-line bg-bg2 text-muted hover:text-ink'}`}
                            >{l === 'AND' ? 'E' : 'OU'}</button>
                          ))}
                        </div>
                      );
                      // Ops sit as a left addon inside the same h-9 control — inputs share one baseline.
                      const OpInput = ({ op, setOp, value, onChange, placeholder }) => (
                        <div className="flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-[11px] border border-line bg-bg2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/30">
                          <div className="flex items-center gap-0.5 border-r border-line bg-raise/30 px-1">
                            <OpPills val={op} set={setOp} compact />
                          </div>
                          <input
                            type="text"
                            className="min-w-0 flex-1 bg-transparent px-2.5 text-xs text-ink outline-none placeholder:text-muted"
                            placeholder={placeholder}
                            value={value}
                            onChange={onChange}
                            onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }}
                          />
                        </div>
                      );
                      const SecondTerm = ({ logic, setLogic, op, setOp, value, onChange, placeholder }) => (
                        <div className="mt-1.5 space-y-1.5 rounded-[11px] border border-dashed border-line bg-bg2/60 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <LogicToggle val={logic} set={setLogic} />
                            <span className="text-[10px] text-muted2">segundo termo</span>
                          </div>
                          <OpInput op={op} setOp={setOp} value={value} onChange={onChange} placeholder={placeholder} />
                        </div>
                      );
                      const natQuery = rfbNatInput.trim().toLowerCase();
                      const filteredNats = natQuery.length >= 1
                        ? rfbNaturezas.filter(n => !rfbFilters.natureza.includes(n.codigo) && (n.codigo.includes(natQuery) || n.descricao.toLowerCase().includes(natQuery))).slice(0, 20)
                        : [];

                      return (
                        <>
                          {/* Identificação */}
                          <section>
                            <h4 className={sectionHead}>Identificação</h4>
                            <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                              <div className={fieldShell}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>CNPJ</label>
                                </div>
                                <input
                                  type="text"
                                  className={fieldInput}
                                  placeholder="00.000.000/0000-00"
                                  value={rfbFilters.cnpj}
                                  onChange={e => setRfbFilters(p => ({ ...p, cnpj: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRfbSearch(1); }}
                                />
                              </div>

                              <div className={fieldShell}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>Nome / Razão Social</label>
                                  <button type="button" onClick={() => setRfbNomeExpanded(p => !p)} className={eouBtn}>
                                    {rfbNomeExpanded ? '− menos' : '+ E/OU'}
                                  </button>
                                </div>
                                <OpInput
                                  op={rfbOps.nome}
                                  setOp={op => setRfbOps(p => ({ ...p, nome: op }))}
                                  value={rfbFilters.nome}
                                  onChange={e => setRfbFilters(p => ({ ...p, nome: e.target.value }))}
                                  placeholder="Ex. Farmácia…"
                                />
                                {rfbNomeExpanded && (
                                  <SecondTerm
                                    logic={rfbNomeLogic} setLogic={setRfbNomeLogic}
                                    op={rfbNome2Op} setOp={setRfbNome2Op}
                                    value={rfbNome2} onChange={e => setRfbNome2(e.target.value)}
                                    placeholder="Segundo termo…"
                                  />
                                )}
                              </div>

                              <div className={fieldShell}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>Sócio</label>
                                  <button type="button" onClick={() => setRfbSocioExpanded(p => !p)} className={eouBtn}>
                                    {rfbSocioExpanded ? '− menos' : '+ E/OU'}
                                  </button>
                                </div>
                                <OpInput
                                  op={rfbOps.socio}
                                  setOp={op => setRfbOps(p => ({ ...p, socio: op }))}
                                  value={rfbFilters.socio}
                                  onChange={e => setRfbFilters(p => ({ ...p, socio: e.target.value }))}
                                  placeholder="Nome do sócio…"
                                />
                                {rfbSocioExpanded && (
                                  <SecondTerm
                                    logic={rfbSocioLogic} setLogic={setRfbSocioLogic}
                                    op={rfbSocio2Op} setOp={setRfbSocio2Op}
                                    value={rfbSocio2} onChange={e => setRfbSocio2(e.target.value)}
                                    placeholder="Segundo sócio…"
                                  />
                                )}
                              </div>
                            </div>
                          </section>

                          {/* Localização */}
                          <section className="border-t border-line pt-5">
                            <h4 className={sectionHead}>Localização</h4>
                            <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                              <div className={`${fieldShell} sm:col-span-2 xl:col-span-6`}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>Endereço / Bairro / CEP</label>
                                  <button type="button" onClick={() => setRfbEnderecoExpanded(p => !p)} className={eouBtn}>
                                    {rfbEnderecoExpanded ? '− menos' : '+ E/OU'}
                                  </button>
                                </div>
                                <OpInput
                                  op={rfbEnderecoOp}
                                  setOp={setRfbEnderecoOp}
                                  value={rfbEndereco}
                                  onChange={e => setRfbEndereco(e.target.value)}
                                  placeholder="Rua, bairro, CEP…"
                                />
                                {rfbEnderecoExpanded && (
                                  <SecondTerm
                                    logic={rfbEnderecoLogic} setLogic={setRfbEnderecoLogic}
                                    op={rfbEndereco2Op} setOp={setRfbEndereco2Op}
                                    value={rfbEndereco2} onChange={e => setRfbEndereco2(e.target.value)}
                                    placeholder="Segundo termo…"
                                  />
                                )}
                              </div>

                              <div className={`${fieldShell} xl:col-span-2`}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>UF</label>
                                </div>
                                <select
                                  className={fieldSelect}
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
                                  <option value="">Estado…</option>
                                  {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </div>

                              <div className={`${fieldShell} xl:col-span-4`}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>Município</label>
                                </div>
                                <div className="relative">
                                  <input
                                    type="text"
                                    className={fieldInput}
                                    placeholder={munLabel ? munLabel : 'Buscar município…'}
                                    value={rfbMunicipioInput}
                                    onChange={e => { setRfbMunicipioInput(e.target.value); setRfbMunicipioDropdownOpen(true); }}
                                    onFocus={() => setRfbMunicipioDropdownOpen(true)}
                                    onBlur={() => setTimeout(() => setRfbMunicipioDropdownOpen(false), 200)}
                                  />
                                  {rfbMunicipioDropdownOpen && filteredMunicipios.length > 0 && (
                                    <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-[11px] border border-line bg-surf shadow-card"><VerticalScrollArrows className="max-h-48">
                                      {filteredMunicipios.map(m => (
                                        <button
                                          key={m.codigo}
                                          type="button"
                                          onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, municipio: m.codigo })); setRfbMunicipioInput(''); setRfbMunicipioDropdownOpen(false); }}
                                          className="w-full border-b border-line/60 px-3 py-2 text-left text-xs text-ink last:border-0 hover:bg-bg2"
                                        >
                                          {m.descricao}
                                        </button>
                                      ))}
                                    </VerticalScrollArrows></div>
                                  )}
                                </div>
                                {munLabel && (
                                  <span className="inline-flex max-w-full items-center gap-1 self-start rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                                    <span className="truncate">{munLabel}</span>
                                    <button type="button" onClick={() => { setRfbFilters(p => ({ ...p, municipio: '' })); setRfbMunicipioInput(''); }} className="flex-shrink-0 leading-none hover:text-status-danger" aria-label="Limpar município">×</button>
                                  </span>
                                )}
                              </div>
                            </div>
                          </section>

                          {/* Atividade (CNAE) */}
                          <section className="border-t border-line pt-5">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Atividade (CNAE)</h4>
                              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted">
                                <input
                                  type="checkbox"
                                  className="accent-primary"
                                  checked={rfbCnaeOnlyPrincipal}
                                  onChange={e => setRfbCnaeOnlyPrincipal(e.target.checked)}
                                />
                                <span>Apenas CNAE principal</span>
                              </label>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="min-w-0 rounded-[14px] border border-line bg-bg2/50 p-3">
                                <div className="mb-1.5 flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-status-success">∋ Contém</span>
                                  <span className="text-[11px] text-muted">qualquer um</span>
                                </div>
                                {rfbFilters.cnae.length > 0 && (
                                  <div className="mb-1.5 flex flex-wrap gap-1">
                                    {rfbFilters.cnae.map(cod => (
                                      <span key={cod} className="inline-flex items-center gap-1 rounded-full border border-status-success/30 bg-status-success/10 px-2 py-0.5 text-xs text-status-success">
                                        <span className="font-mono flex-shrink-0">{cod}</span>
                                        <button type="button" onClick={() => setRfbFilters(p => ({ ...p, cnae: p.cnae.filter(c => c !== cod) }))} className="flex-shrink-0 leading-none hover:text-status-danger">×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="relative">
                                  <input
                                    type="text"
                                    className={fieldInput}
                                    placeholder="Adicionar CNAE para incluir…"
                                    value={rfbCnaeInput}
                                    onChange={e => { setRfbCnaeInput(e.target.value); setRfbCnaeDropdownOpen(true); }}
                                    onFocus={() => setRfbCnaeDropdownOpen(true)}
                                    onBlur={() => setTimeout(() => setRfbCnaeDropdownOpen(false), 200)}
                                  />
                                  {rfbCnaeDropdownOpen && filteredCnaes.length > 0 && (
                                    <div className="absolute left-0 z-30 mt-1 w-max min-w-full max-w-sm overflow-hidden rounded-[11px] border border-line bg-surf shadow-card"><VerticalScrollArrows className="max-h-48">
                                      {filteredCnaes.map(c => (
                                        <button
                                          key={c.codigo}
                                          type="button"
                                          onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, cnae: p.cnae.includes(c.codigo) ? p.cnae : [...p.cnae, c.codigo] })); setRfbCnaeInput(''); setRfbCnaeDropdownOpen(false); }}
                                          className="flex w-full gap-2 border-b border-line/60 px-3 py-2 text-left text-xs text-ink last:border-0 hover:bg-bg2"
                                        >
                                          <span className="font-mono flex-shrink-0 text-muted">{c.codigo}</span>
                                          <span>{c.descricao}</span>
                                        </button>
                                      ))}
                                    </VerticalScrollArrows></div>
                                  )}
                                </div>
                              </div>

                              <div className="min-w-0 rounded-[14px] border border-line bg-bg2/50 p-3">
                                <div className="mb-1.5 flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-status-danger">∌ Não contém</span>
                                  <span className="text-[11px] text-muted">nenhum</span>
                                </div>
                                {rfbFilters.cnaeNot.length > 0 && (
                                  <div className="mb-1.5 flex flex-wrap gap-1">
                                    {rfbFilters.cnaeNot.map(cod => (
                                      <span key={cod} className="inline-flex items-center gap-1 rounded-full border border-status-danger/30 bg-status-danger/10 px-2 py-0.5 text-xs text-status-danger">
                                        <span className="font-mono flex-shrink-0">{cod}</span>
                                        <button type="button" onClick={() => setRfbFilters(p => ({ ...p, cnaeNot: p.cnaeNot.filter(c => c !== cod) }))} className="flex-shrink-0 leading-none hover:text-status-danger">×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="relative">
                                  <input
                                    type="text"
                                    className={fieldInput}
                                    placeholder="Adicionar CNAE para excluir…"
                                    value={rfbCnaeNotInput}
                                    onChange={e => { setRfbCnaeNotInput(e.target.value); setRfbCnaeNotDropdownOpen(true); }}
                                    onFocus={() => setRfbCnaeNotDropdownOpen(true)}
                                    onBlur={() => setTimeout(() => setRfbCnaeNotDropdownOpen(false), 200)}
                                  />
                                  {rfbCnaeNotDropdownOpen && filteredCnaesNot.length > 0 && (
                                    <div className="absolute left-0 z-30 mt-1 w-max min-w-full max-w-sm overflow-hidden rounded-[11px] border border-line bg-surf shadow-card"><VerticalScrollArrows className="max-h-48">
                                      {filteredCnaesNot.map(c => (
                                        <button
                                          key={c.codigo}
                                          type="button"
                                          onMouseDown={e => { e.preventDefault(); setRfbFilters(p => ({ ...p, cnaeNot: p.cnaeNot.includes(c.codigo) ? p.cnaeNot : [...p.cnaeNot, c.codigo] })); setRfbCnaeNotInput(''); setRfbCnaeNotDropdownOpen(false); }}
                                          className="flex w-full gap-2 border-b border-line/60 px-3 py-2 text-left text-xs text-ink last:border-0 hover:bg-bg2"
                                        >
                                          <span className="font-mono flex-shrink-0 text-muted">{c.codigo}</span>
                                          <span>{c.descricao}</span>
                                        </button>
                                      ))}
                                    </VerticalScrollArrows></div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </section>

                          {/* Perfil da empresa */}
                          <section className="border-t border-line pt-5">
                            <h4 className={sectionHead}>Perfil da empresa</h4>
                            <div className="space-y-4">
                              <div className={fieldShell}>
                                <div className={fieldHead}>
                                  <label className={fieldLabel}>Situação</label>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {[['2','Ativa'],['3','Suspensa'],['4','Inapta'],['8','Baixada'],['1','Nula']].map(([code, label]) => {
                                    const checked = rfbFilters.situacao.includes(code);
                                    return (
                                      <button
                                        key={code}
                                        type="button"
                                        onClick={() => setRfbFilters(p => ({ ...p, situacao: checked ? p.situacao.filter(s => s !== code) : [...p.situacao, code] }))}
                                        className={`h-9 rounded-[11px] border px-3 text-xs transition ${checked ? 'border-primary/40 bg-primary/15 font-medium text-primary' : 'border-line bg-bg2 text-muted hover:border-primary/30 hover:text-ink'}`}
                                      >{label}</button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                                <div className={fieldShell}>
                                  <div className={fieldHead}>
                                    <label className={fieldLabel}>Porte</label>
                                  </div>
                                  <select
                                    className={fieldSelect}
                                    value={rfbFilters.porte}
                                    onChange={e => setRfbFilters(p => ({ ...p, porte: e.target.value }))}
                                  >
                                    <option value="">Selecionar porte…</option>
                                    <option value="01">Micro Empresa</option>
                                    <option value="03">Empresa de Pequeno Porte</option>
                                    <option value="05">Demais</option>
                                    <option value="00">Não informado</option>
                                  </select>
                                </div>

                                <div className={fieldShell}>
                                  <div className={fieldHead}>
                                    <label className={fieldLabel}>Natureza jurídica</label>
                                  </div>
                                  <div className="relative">
                                    <input
                                      type="text"
                                      className={fieldInput}
                                      placeholder="Buscar natureza…"
                                      value={rfbNatInput}
                                      onChange={e => setRfbNatInput(e.target.value)}
                                    />
                                    {filteredNats.length > 0 && (
                                      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[11px] border border-line bg-surf shadow-card"><VerticalScrollArrows className="max-h-40">
                                        {filteredNats.map(n => (
                                          <button
                                            key={n.codigo}
                                            type="button"
                                            className="w-full px-2.5 py-1.5 text-left text-xs text-ink hover:bg-bg2"
                                            onClick={() => { setRfbFilters(p => ({ ...p, natureza: [...p.natureza, n.codigo] })); setRfbNatInput(''); }}
                                          >
                                            <span className="mr-1 font-mono text-muted">{n.codigo}</span>{n.descricao}
                                          </button>
                                        ))}
                                      </VerticalScrollArrows></div>
                                    )}
                                  </div>
                                  {rfbFilters.natureza.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {rfbFilters.natureza.map(cod => {
                                        const nat = rfbNaturezas.find(n => n.codigo === cod);
                                        return (
                                          <span key={cod} className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                                            <span className="truncate">{nat ? `${nat.codigo} — ${nat.descricao}` : cod}</span>
                                            <button type="button" onClick={() => setRfbFilters(p => ({ ...p, natureza: p.natureza.filter(c => c !== cod) }))} className="flex-shrink-0 hover:text-status-danger">×</button>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                <div className={`${fieldShell} rounded-[14px] border border-line bg-bg2/40 p-3 sm:col-span-1`}>
                                  <div className={fieldHead}>
                                    <label className={fieldLabel}>Trazer na busca</label>
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                                    <label className="flex cursor-pointer select-none items-center gap-2">
                                      <input
                                        type="checkbox"
                                        className="accent-primary"
                                        checked={rfbSimples !== 'N'}
                                        onChange={e => setRfbSimples(e.target.checked ? '' : 'N')}
                                      />
                                      <span className="text-xs text-ink">Simples Nacional</span>
                                    </label>
                                    <label className="flex cursor-pointer select-none items-center gap-2">
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

                                <div className="flex min-h-[calc(1.25rem+0.375rem+2.25rem)] items-center rounded-[14px] border border-line bg-bg2/40 px-3">
                                  <label className="flex cursor-pointer select-none items-center gap-2">
                                    <input
                                      type="checkbox"
                                      className="accent-primary"
                                      checked={rfbOnlyMatriz}
                                      onChange={e => setRfbOnlyMatriz(e.target.checked)}
                                    />
                                    <span className="text-xs font-medium text-ink">Somente matriz</span>
                                  </label>
                                </div>
                              </div>
                            </div>
                          </section>

                          {/* Faixas */}
                          <section className="border-t border-line pt-5">
                            <h4 className={sectionHead}>Faixas</h4>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="min-w-0 rounded-[14px] border border-line bg-bg2/50 p-3">
                                <label className={fieldLabel}>Capital social</label>
                                <div className="space-y-1.5">
                                  <div className="flex justify-between text-xs text-muted">
                                    <span>{rfbCapitalRange[0] > 0 ? `R$ ${(rfbCapitalRange[0]/1000).toFixed(0)}k` : 'Mín'}</span>
                                    <span>{rfbCapitalRange[1] > 0 ? `R$ ${rfbCapitalRange[1] >= 1000000 ? (rfbCapitalRange[1]/1000000).toFixed(1)+'M' : (rfbCapitalRange[1]/1000).toFixed(0)+'k'}` : 'Máx'}</span>
                                  </div>
                                  <input type="range" min="0" max="5000000" step="50000"
                                    className="h-1 w-full accent-primary"
                                    value={rfbCapitalRange[0]}
                                    onChange={e => setRfbCapitalRange(p => [Math.min(Number(e.target.value), p[1] || 5000000), p[1]])}
                                  />
                                  <input type="range" min="0" max="5000000" step="50000"
                                    className="h-1 w-full accent-primary"
                                    value={rfbCapitalRange[1] || 5000000}
                                    onChange={e => setRfbCapitalRange(p => [p[0], Math.max(Number(e.target.value), p[0])])}
                                  />
                                  {(rfbCapitalRange[0] > 0 || rfbCapitalRange[1] > 0) && (
                                    <button type="button" onClick={() => setRfbCapitalRange([0, 0])} className="text-xs text-muted hover:text-status-danger">× limpar</button>
                                  )}
                                </div>
                              </div>

                              <div className="min-w-0 rounded-[14px] border border-line bg-bg2/50 p-3">
                                <label className={fieldLabel}>Tempo de abertura</label>
                                <div className="space-y-1.5">
                                  <div className="flex justify-between text-xs text-muted">
                                    <span>{rfbAberturaRange[0] > 0 ? `${rfbAberturaRange[0]} anos` : 'Mín'}</span>
                                    <span>{rfbAberturaRange[1] > 0 ? `${rfbAberturaRange[1]} anos` : 'Máx'}</span>
                                  </div>
                                  <input type="range" min="0" max="50" step="1"
                                    className="h-1 w-full accent-primary"
                                    value={rfbAberturaRange[0]}
                                    onChange={e => setRfbAberturaRange(p => [Math.min(Number(e.target.value), p[1] || 50), p[1]])}
                                  />
                                  <input type="range" min="0" max="50" step="1"
                                    className="h-1 w-full accent-primary"
                                    value={rfbAberturaRange[1] || 50}
                                    onChange={e => setRfbAberturaRange(p => [p[0], Math.max(Number(e.target.value), p[0])])}
                                  />
                                  {(rfbAberturaRange[0] > 0 || rfbAberturaRange[1] > 0) && (
                                    <button type="button" onClick={() => setRfbAberturaRange([0, 0])} className="text-xs text-muted hover:text-status-danger">× limpar</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </section>

                          {/* Ações + import */}
                          <section className="border-t border-line pt-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                              <div className="min-w-0 sm:w-52">
                                <label className={fieldLabel}>Estágio padrão (import)</label>
                                <select
                                  className={fieldSelect}
                                  value={leadImportSettings.defaultStage}
                                  onChange={e => setLeadImportSettings(p => ({ ...p, defaultStage: e.target.value }))}
                                >
                                  {leadColumns.map(col => <option key={col} value={col}>{col}</option>)}
                                </select>
                              </div>
                              <div className="flex flex-wrap items-center gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => handleRfbSearch(1)}
                                  disabled={rfbLoading}
                                  className={`${btnPrimary} px-8`}
                                >
                                  {rfbLoading ? 'Buscando…' : 'Buscar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleClear}
                                  className={`${btnSecondary} px-4`}
                                >
                                  Limpar filtros
                                </button>
                              </div>
                            </div>
                          </section>

                          {/* Filtros salvos */}
                          <section className="border-t border-line pt-5">
                            <h4 className={sectionHead}>Filtros salvos</h4>
                            {rfbSavedFilters.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {rfbSavedFilters.map((sf, i) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => applyRfbSavedFilter(sf)}
                                      className="max-w-[220px] truncate rounded-[11px] border border-line bg-bg2 px-2.5 py-1.5 text-left text-xs text-ink transition hover:border-primary/40 hover:text-primary"
                                      title={sf.name}
                                    >{sf.name}</button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = rfbSavedFilters.filter((_, j) => j !== i);
                                        setRfbSavedFilters(updated);
                                        localStorage.setItem('rfb_saved_filters', JSON.stringify(updated));
                                      }}
                                      className="flex-shrink-0 px-1 text-sm leading-none text-muted hover:text-status-danger"
                                      title="Remover"
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex max-w-md gap-2">
                              <input
                                type="text"
                                className={`${fieldInput} min-w-0 flex-1`}
                                placeholder="Nome do filtro…"
                                value={rfbSaveFilterName}
                                onChange={e => setRfbSaveFilterName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveRfbFilter(); }}
                              />
                              <button
                                type="button"
                                onClick={saveRfbFilter}
                                disabled={!rfbSaveFilterName.trim()}
                                className="h-9 shrink-0 rounded-[11px] border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-40"
                              >Salvar</button>
                            </div>
                          </section>
                        </>
                      );
                    })()}
                  </div>

                  {/* ── Painel de resultados ───────────────────────────── */}
                  <div className="min-w-0 space-y-3">

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
                      <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-line bg-surf p-3 text-sm shadow-card">
                        <span className="text-muted">
                          Mostrando <span className="font-semibold text-ink">{((rfbPage - 1) * rfbPageSize) + 1}–{Math.min(rfbPage * rfbPageSize, rfbTotal)}</span> de <span className="font-semibold text-ink">{rfbTotal >= 10001 ? '+10.000' : rfbTotal.toLocaleString('pt-BR')}</span> resultados
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <select
                            className={`${select} text-xs`}
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
                            className={`${select} text-xs`}
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

                    {/* Results cards */}
                    {!rfbLoading && rfbResults.length > 0 && (() => {
                      const detailLabel = 'mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2';
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
                          <div className="border-t border-line bg-bg2/50 px-4 py-4 sm:px-5">
                            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3">
                                <p className={detailLabel}>Endereço</p>
                                <p className="leading-relaxed text-ink">
                                  {[row.tipo_de_logradouro, row.logradouro, row.numero, row.complemento].filter(Boolean).join(' ')}{row.bairro ? `, ${row.bairro}` : ''}
                                </p>
                                <p className="mt-1 text-muted">{row.cep ? `CEP ${String(row.cep).replace(/(\d{5})(\d{3})/, '$1-$2')}` : ''}{row.municipio_nome ? ` · ${row.municipio_nome}/${row.uf}` : ''}</p>
                              </div>
                              <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3">
                                <p className={detailLabel}>Contato</p>
                                {row.correio_eletronico ? <p className="truncate text-primary">{row.correio_eletronico}</p> : <p className="text-muted">Sem e-mail</p>}
                                {row.ddd1 && row.telefone1 && <p className="mt-0.5 text-ink">({row.ddd1}) {row.telefone1}</p>}
                                {row.ddd2 && row.telefone2 && <p className="text-ink">({row.ddd2}) {row.telefone2}</p>}
                                {!row.ddd1 && !row.telefone1 && !row.ddd2 && !row.telefone2 && <p className="text-muted">Sem telefone</p>}
                              </div>
                              <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3">
                                <p className={detailLabel}>Empresa</p>
                                {row.capital_social != null && row.capital_social !== '' && <p className="text-ink">Capital: <span className="font-medium">{fmtCapital(row.capital_social)}</span></p>}
                                {row.porte_da_empresa && <p className="text-muted">Porte: {row.porte_da_empresa}</p>}
                                {row.natureza_juridica_descricao && <p className="text-muted">Natureza: <span className="font-mono text-[11px]">{row.natureza_juridica}</span> — {row.natureza_juridica_descricao}</p>}
                                {row.data_de_inicio_da_atividade && <p className="text-muted">Abertura: {fmtDate(row.data_de_inicio_da_atividade)}{calcAge(row.data_de_inicio_da_atividade) ? ` · ${calcAge(row.data_de_inicio_da_atividade)}` : ''}</p>}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {row.opcao_pelo_mei === 'S' && <span className={badge}>MEI</span>}
                                  {row.opcao_pelo_simples === 'S' && row.opcao_pelo_mei !== 'S' && <span className={badge}>Simples</span>}
                                </div>
                              </div>
                              {row.cnae_fiscal_principal && (
                                <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3 sm:col-span-2 lg:col-span-3">
                                  <p className={detailLabel}>CNAE principal</p>
                                  <p className="text-ink"><span className="font-mono text-muted">{row.cnae_fiscal_principal}</span>{row.cnae_descricao ? ` — ${row.cnae_descricao}` : ''}</p>
                                </div>
                              )}
                              {Array.isArray(row.cnaes_secundarios) && row.cnaes_secundarios.length > 0 && (
                                <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3 sm:col-span-2 lg:col-span-3">
                                  <p className={detailLabel}>CNAEs secundários ({row.cnaes_secundarios.length})</p>
                                  <ul className="space-y-0.5">
                                    {row.cnaes_secundarios.map(c => (
                                      <li key={c.codigo} className="text-sm text-ink">
                                        <span className="font-mono text-muted">{c.codigo}</span>{c.descricao ? ` — ${c.descricao}` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="rounded-[12px] border border-line/80 bg-surf/60 p-3 sm:col-span-2 lg:col-span-3">
                                <p className={detailLabel}>Sócios</p>
                                <p className="leading-relaxed text-ink">{row.socios_nomes || <span className="text-muted">—</span>}</p>
                              </div>
                            </div>

                            {(() => {
                              const enrichState = rfbEnriching[row.cnpj];
                              return (
                                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
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
                                    className="rounded-[11px] border border-line bg-surf px-3 py-1.5 text-xs text-muted transition hover:border-primary/40 hover:text-ink disabled:opacity-50"
                                  >
                                    {enrichState === true ? 'Consultando Receita…' : enrichState === 'done' ? '✓ Atualizado da Receita' : enrichState === 'error' ? '✗ Erro ao consultar' : '↺ Atualizar dados da Receita Federal'}
                                  </button>
                                  {!enrichState && <span className="text-xs text-muted">Consulta a RF e atualiza a base local</span>}
                                </div>
                              );
                            })()}

                            {row.filiais_count > 0 && (
                              <div className="mt-3 border-t border-line pt-3">
                                <div className="mb-2 flex items-center gap-3">
                                  <p className={detailLabel + ' mb-0'}>{row.filiais_count} filia{row.filiais_count === 1 ? 'l' : 'is'}</p>
                                  {filiais === undefined && (
                                    <button type="button" onClick={loadFiliais} className="text-xs font-medium text-primary hover:underline">Carregar filiais</button>
                                  )}
                                  {filiais === null && <span className="text-xs text-muted">Carregando…</span>}
                                </div>
                                {Array.isArray(filiais) && filiais.length > 0 && (
                                  <div className="space-y-1.5">
                                    {filiais.map(f => {
                                      const fCNPJ = String(f.cnpj || '').replace(/\D/g, '');
                                      const fDup = Boolean(leadExistingCNPJs[fCNPJ]);
                                      return (
                                        <div key={fCNPJ} className="flex flex-wrap items-center gap-2 rounded-[11px] border border-line bg-surf px-3 py-2 text-xs">
                                          <span className="flex-shrink-0 font-mono text-muted">{fmtCNPJ(f.cnpj)}</span>
                                          <span className="min-w-0 flex-1 truncate text-ink">{f.nome_fantasia || '—'}</span>
                                          <span className="flex-shrink-0 text-muted">{f.municipio_nome || '—'}/{f.uf || '—'}</span>
                                          <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 font-medium ${situacaoClass(f.situacao_cadastral)}`}>
                                            {situacaoLabel(f.situacao_cadastral)}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => openImportDialog({ ...f, razao_social: row.razao_social, capital_social: row.capital_social, porte_da_empresa: row.porte_da_empresa, opcao_pelo_simples: row.opcao_pelo_simples, opcao_pelo_mei: row.opcao_pelo_mei, socios_nomes: row.socios_nomes, primeiro_socio: row.primeiro_socio }, fDup)}
                                            disabled={leadImportLoading}
                                            className={`flex-shrink-0 rounded-[9px] border px-2 py-1 text-xs transition disabled:opacity-40 ${fDup ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20' : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'}`}
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
                        <div className="space-y-2">
                          {rfbResults.map((row, idx) => {
                            const cleanCNPJ = String(row.cnpj || '').replace(/\D/g, '');
                            const crmContact = leadExistingCNPJs[cleanCNPJ] || null;
                            const isDup = Boolean(crmContact);
                            const crmUrl = crmContact ? `${CHATWOOT_BASE_URL}/app/accounts/2/contacts/${crmContact.id}` : null;
                            const isExp = rfbExpanded === cleanCNPJ;
                            const toggleExpand = () => {
                              setRfbExpanded(isExp ? null : cleanCNPJ);
                            };
                            const location = [row.municipio_nome, row.uf].filter(Boolean).join('/');
                            const metaBits = [
                              row.nome_fantasia && { key: 'nf', node: <span className="truncate text-muted" title={row.nome_fantasia}>{row.nome_fantasia}</span> },
                              location && { key: 'loc', node: <span className="shrink-0 text-muted">{location}</span> },
                              row.capital_social != null && row.capital_social !== '' && row.capital_social !== 0 && { key: 'cap', node: <span className="shrink-0 tabular-nums text-muted">{fmtCapital(row.capital_social)}</span> },
                              row.filiais_count > 0 && { key: 'fil', node: <span className="shrink-0 rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-[11px] text-muted">{row.filiais_count} filia{row.filiais_count === 1 ? 'l' : 'is'}</span> },
                            ].filter(Boolean);

                            return (
                              <article
                                key={cleanCNPJ || idx}
                                className={`overflow-hidden rounded-[14px] border transition ${isExp ? 'border-primary/35 bg-primary/[0.06] shadow-card' : 'border-line bg-surf shadow-card hover:border-line2 hover:bg-surf2/40'}`}
                              >
                                <div className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:px-5">
                                  <div
                                    className="min-w-0 flex-1 cursor-pointer"
                                    onClick={toggleExpand}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } }}
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={isExp}
                                  >
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      {crmUrl ? (
                                        <a
                                          href={crmUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="max-w-full truncate text-sm font-semibold text-primary hover:underline"
                                        >
                                          {row.razao_social || '—'}
                                        </a>
                                      ) : (
                                        <h3 className="max-w-full truncate text-sm font-semibold text-ink">{row.razao_social || '—'}</h3>
                                      )}
                                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${situacaoClass(row.situacao_cadastral)}`}>
                                        {situacaoLabel(row.situacao_cadastral)}
                                      </span>
                                      {isDup && (
                                        <span className="shrink-0 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[11px] font-medium text-status-warning">
                                          Já no CRM
                                        </span>
                                      )}
                                      {row.opcao_pelo_mei === 'S' && <span className="shrink-0 text-[11px] font-medium text-primary">MEI</span>}
                                      {row.opcao_pelo_simples === 'S' && row.opcao_pelo_mei !== 'S' && <span className="shrink-0 text-[11px] font-medium text-primary">Simples</span>}
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                                      <span className="shrink-0 font-mono text-[12px] text-muted2">{fmtCNPJ(row.cnpj)}</span>
                                      {metaBits.map(bit => (
                                        <React.Fragment key={bit.key}>
                                          <span className="text-line2" aria-hidden>·</span>
                                          {bit.node}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openImportDialog(row, isDup)}
                                      disabled={leadImportLoading}
                                      className={`h-9 rounded-[11px] border px-3 text-xs font-semibold transition disabled:opacity-40 ${isDup ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20' : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'}`}
                                    >
                                      {isDup ? 'Atualizar' : 'Importar'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={toggleExpand}
                                      aria-label={isExp ? 'Recolher detalhes' : 'Expandir detalhes'}
                                      className={`inline-flex h-9 w-9 items-center justify-center rounded-[11px] border text-sm transition ${isExp ? 'border-primary/30 bg-primary/10 text-primary' : 'border-line bg-bg2 text-muted hover:border-primary/30 hover:text-ink'}`}
                                    >
                                      {isExp ? '↑' : '↓'}
                                    </button>
                                  </div>
                                </div>

                                {isExp && <ExpandedPanel row={row} />}
                              </article>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Empty state */}
                    {!rfbLoading && rfbResults.length === 0 && rfbTotal === 0 && !rfbError && (
                      <div className={`text-center py-16 ${subtle}`}>
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
            <div className="mt-5 space-y-4">
              <header className={`${card} px-4 py-3.5 lg:px-5`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">Playbook comercial</h2>
                      <span className="rounded-full border border-line bg-bg2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Referência
                      </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-xs text-muted">
                      Processo, critérios e scripts — consulta livre, sem onboarding sequencial.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {processBlueprint.stats.map((stat) => (
                      <div key={stat.label} className="min-w-[88px] rounded-[11px] border border-line bg-bg2 px-2.5 py-1.5 text-center dark:bg-[#0e1220]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{stat.label}</p>
                        <p className="text-sm font-semibold tabular-nums text-ink">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </header>

              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
                <aside className={`${card} flex max-h-[min(70vh,36rem)] flex-col overflow-hidden p-2.5 lg:sticky lg:top-3 lg:max-h-[calc(100vh-7.5rem)]`}>
                  <p className="shrink-0 px-2 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted2">
                    Índice
                  </p>
                  <div className="shrink-0 px-1 pb-2">
                    <input
                      type="search"
                      value={processQuery}
                      onChange={(e) => setProcessQuery(e.target.value)}
                      placeholder="Filtrar…"
                      className={`${input} w-full text-xs`}
                      aria-label="Filtrar seções do processo"
                    />
                  </div>
                  <VerticalScrollArrows
                    className="min-h-0 flex-1"
                    contentClassName="flex flex-col gap-0.5"
                    remeasureKey={`${processNavItems.length}:${processQuery}`}
                  >
                    <nav className="flex flex-col gap-0.5" aria-label="Navegação do playbook">
                      {processNavItems.length === 0 && (
                        <p className="px-2 py-2 text-xs text-muted">Nenhuma seção.</p>
                      )}
                      {processNavItems.map((item) => {
                        const isActive = processActiveSection === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => scrollToProcessSection(item.id)}
                            className={`w-full rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] font-medium transition ${
                              isActive
                                ? 'bg-primary/12 text-primary'
                                : 'text-muted hover:bg-surf2 hover:text-ink'
                            }`}
                          >
                            {item.title}
                          </button>
                        );
                      })}
                    </nav>
                  </VerticalScrollArrows>
                  <div className="mt-2 shrink-0 border-t border-line px-2 pt-2">
                    <a
                      href="https://chatwoot.tenryu.com.br/app/accounts/2"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Chatwoot ↗
                    </a>
                  </div>
                </aside>

                <main className="min-w-0 space-y-3">
                  <ProcessSection id="metas-2026">
                    <ProcessSectionHeader
                      kicker="Motor de receita"
                      title="Metas 2026 — modelo alto volume"
                      right={<span className="text-[11px] text-muted">Receita previsível</span>}
                    />

                    <div className="mt-3 rounded-[12px] border border-line bg-bg2 px-4 py-3 dark:bg-[#0e1220]">
                      <p className="text-center font-mono text-xs font-semibold text-primary sm:text-sm">{processBlueprint.revenueEngine.formula}</p>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xl font-semibold tabular-nums text-ink">240</p>
                          <p className="text-[11px] text-muted">SQLs/mês</p>
                        </div>
                        <div>
                          <p className="text-xl font-semibold tabular-nums text-ink">7%</p>
                          <p className="text-[11px] text-muted">Conversão</p>
                        </div>
                        <div>
                          <p className="text-xl font-semibold tabular-nums text-ink">R$ 30k</p>
                          <p className="text-[11px] text-muted">Ticket médio</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-sm font-semibold text-ink">Funil comercial (volume/mês)</p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                        {processBlueprint.funnel.map((step) => (
                          <div
                            key={step.key || step.stage}
                            className={`rounded-[11px] border border-line bg-bg2 px-2 py-2 text-center dark:bg-[#0e1220] ${step.isActivity ? 'border-primary/40' : ''}`}
                          >
                            <p className="truncate text-[10px] text-muted">{step.conversionLabel || '—'}</p>
                            <p className="text-base font-semibold tabular-nums text-ink">{step.volume}</p>
                            <p className="text-[11px] font-medium text-muted">{step.stage}</p>
                            {step.daily != null && (
                              <p className="mt-0.5 font-mono text-[10px] text-primary">{step.daily}/dia</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        Alavanca principal: <span className="font-semibold text-ink">contatos diários</span>. Time multi-chapéu.
                      </p>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <div className="rounded-[12px] border border-line bg-bg2 px-3.5 py-3 dark:bg-[#0e1220]">
                        <p className="text-sm font-semibold text-ink">SDR · {processBlueprint.sdrGoals.teamSize} pessoas</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-lg font-semibold tabular-nums text-ink">{processBlueprint.sdrGoals.teamGoal}</p>
                            <p className="text-[11px] text-muted">SQLs/mês time</p>
                          </div>
                          <div>
                            <p className="text-lg font-semibold tabular-nums text-ink">{processBlueprint.sdrGoals.individualGoal}</p>
                            <p className="text-[11px] text-muted">SQLs/mês indiv.</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {processBlueprint.sdrGoals.kpis.map((kpi) => (
                            <span key={kpi} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{kpi}</span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[12px] border border-line bg-bg2 px-3.5 py-3 dark:bg-[#0e1220]">
                        <p className="text-sm font-semibold text-ink">AE · {processBlueprint.aeGoals.teamSize} pessoas</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-lg font-semibold tabular-nums text-ink">{processBlueprint.aeGoals.teamGoal}</p>
                            <p className="text-[11px] text-muted">Vendas/mês time</p>
                          </div>
                          <div>
                            <p className="text-lg font-semibold tabular-nums text-ink">R$ 510k</p>
                            <p className="text-[11px] text-muted">Receita/mês time</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {processBlueprint.aeGoals.kpis.map((kpi) => (
                            <span key={kpi} className="rounded-full bg-status-success/10 px-2 py-0.5 text-[10px] font-semibold text-status-success">{kpi}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
                      <div>
                        <p className="text-[11px] text-muted">Resultado anual projetado</p>
                        <p className="text-xl font-semibold tabular-nums text-primary">R$ 6.2M</p>
                      </div>
                      <p className="text-xs text-muted">207 vendas · ticket médio R$ 30k</p>
                    </div>
                  </ProcessSection>

                  <ProcessSection id="visao-geral">
                    <ProcessSectionHeader kicker="Visão geral" title="Princípios que guiam o processo" />
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {processBlueprint.pillars.map((pillar) => (
                        <div key={pillar.title} className={processPanel}>
                          <h4 className="text-sm font-semibold text-ink">{pillar.title}</h4>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted">{pillar.text}</p>
                        </div>
                      ))}
                    </div>
                    <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                      {processBlueprint.overview.map((item) => (
                        <li key={item} className="px-3 py-2 text-xs leading-relaxed text-ink">· {item}</li>
                      ))}
                    </ul>
                  </ProcessSection>

                  <ProcessSection id="treinamento-produtos">
                    <ProcessSectionHeader
                      kicker="Produtos"
                      title="Linha Autel e equivalência por categoria"
                      hint="Referência comercial por uso e faixa técnica — não substitui PoC."
                    />
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {processBlueprint.productTraining.map((item) => (
                        <div key={item.product} className={processPanel}>
                          <p className="text-sm font-semibold text-ink">{item.product}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.summary}</p>
                          <p className="mt-2 text-[11px] font-semibold text-primary">{item.equivalent}</p>
                          <p className="mt-1 text-[11px] text-muted"><span className="font-medium text-ink">Quando:</span> {item.useWhen}</p>
                        </div>
                      ))}
                    </div>
                  </ProcessSection>

                  <ProcessSection id="icps-aerion">
                    <ProcessSectionHeader kicker="ICPs" title="Quatro perfis prioritários Autel" />
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {processBlueprint.icps.map((icp) => (
                        <article key={icp.id} className={processPanel}>
                          <h4 className="text-sm font-semibold text-ink">{icp.name}</h4>
                          <dl className="mt-2 space-y-0.5 text-[11px] text-muted">
                            <div><span className="font-medium text-ink">Setor:</span> {icp.sector}</div>
                            <div><span className="font-medium text-ink">Porte:</span> {icp.profile}</div>
                            <div><span className="font-medium text-ink">Decisor:</span> {icp.decisionMaker}</div>
                            <div><span className="font-medium text-ink">Dores:</span> {icp.pains}</div>
                            <div><span className="font-medium text-ink">Produtos:</span> {icp.products}</div>
                            <div className="font-semibold text-primary">Ticket médio: {icp.ticket}</div>
                          </dl>
                          <div className="mt-2.5 grid gap-2 border-t border-line pt-2 sm:grid-cols-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted2">Sinais de fit</p>
                              <ul className="mt-1 space-y-0.5">
                                {icp.fitSignals.map((signal) => (
                                  <li key={signal} className="text-[11px] leading-snug text-muted">· {signal}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted2">Red flags</p>
                              <ul className="mt-1 space-y-0.5">
                                {icp.redFlags.map((flag) => (
                                  <li key={flag} className="text-[11px] leading-snug text-muted">· {flag}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </ProcessSection>

                  <ProcessSection id="guia-sales-command">
                    <ProcessSectionHeader
                      kicker="Sales Command"
                      title="Guia da plataforma"
                      hint="Menus, kanbans e rotina de cada tela — espelha o app atual."
                    />

                    <div className="mt-3">
                      <p className="mb-2 text-sm font-semibold text-ink">Kanbans</p>
                      <div className="grid gap-2 md:grid-cols-3">
                        {processBlueprint.boards.map((board) => (
                          <div key={board.name} className="flex flex-col rounded-[12px] border border-line bg-bg2 px-3 py-2.5 dark:bg-[#0e1220]">
                            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted2">{board.area}</p>
                            <p className="mt-0.5 text-sm font-semibold text-ink">{board.name}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted">{board.purpose}</p>
                            <p className="mt-2 font-mono text-[10px] font-semibold text-primary">{board.stages}</p>
                            {board.stageHint && (
                              <p className="mt-0.5 text-[10px] leading-snug text-muted2">{board.stageHint}</p>
                            )}
                            <ul className="mt-2 space-y-1 border-t border-line pt-2">
                              {board.usage.map((item) => (
                                <li key={item} className="text-[11px] leading-snug text-muted">· {item}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-sm font-semibold text-ink">Mapa de módulos</p>
                      <p className="mt-0.5 text-[11px] text-muted">Ordem do menu lateral.</p>
                      <div className="mt-2 space-y-3">
                        {['Workspace', 'Prospecção', 'Licitações', 'Administração'].map((groupName) => {
                          const items = processBlueprint.funnelGuide.filter((item) => item.group === groupName);
                          if (!items.length) return null;
                          return (
                            <div key={groupName}>
                              <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted2">{groupName}</p>
                              <div className="overflow-hidden rounded-[12px] border border-line">
                                <div className="hidden grid-cols-[140px_1fr_1fr] gap-2 border-b border-line bg-bg2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted2 md:grid dark:bg-[#0e1220]">
                                  <span>Tela</span>
                                  <span>Uso</span>
                                  <span>Rotina</span>
                                </div>
                                <ul className="divide-y divide-line">
                                  {items.map((item) => (
                                    <li key={`${item.group}-${item.tab}`} className="grid gap-1 px-3 py-2 md:grid-cols-[140px_1fr_1fr] md:gap-2 md:items-start">
                                      <p className="text-xs font-semibold text-primary">{item.tab}</p>
                                      <p className="text-[11px] leading-relaxed text-muted">{item.use}</p>
                                      <p className="text-[11px] leading-relaxed text-muted">{item.routine}</p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-sm font-semibold text-ink">Glossário</p>
                      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                        {processBlueprint.glossary.map((item) => (
                          <div key={item.term} className="border-b border-line pb-2">
                            <dt className="text-xs font-semibold text-primary">{item.term}</dt>
                            <dd className="mt-0.5 text-[11px] text-muted">{item.meaning}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      {[
                        { title: 'Vantagens competitivas', items: processBlueprint.marketAdvantages },
                        { title: 'Contexto de concorrência', items: processBlueprint.competitorContext },
                        { title: 'Fraquezas atuais', items: processBlueprint.marketWeaknesses },
                      ].map((col) => (
                        <div key={col.title} className="min-w-0">
                          <p className="mb-1.5 text-xs font-semibold text-ink">{col.title}</p>
                          <ul className="divide-y divide-line rounded-[12px] border border-line">
                            {col.items.map((item) => (
                              <li key={item} className="px-2.5 py-1.5 text-[11px] leading-snug text-muted">{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </ProcessSection>

                  <ProcessSection id="pipeline">
                    <ProcessSectionHeader
                      kicker="Pipeline"
                      title="Do lead ao handoff"
                      right={<span className="font-mono text-[10px] text-muted">{processBlueprint.pipelineSteps.length} etapas</span>}
                    />
                    <ol className="mt-3 divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                      {processBlueprint.pipelineSteps.map((step, index) => (
                        <li key={step.title} className="flex items-start gap-3 px-3 py-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-[11px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{step.title}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{step.text}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </ProcessSection>

                  <ProcessSection id="checklist">
                    <ProcessSectionHeader kicker="Checklist" title="Obrigatório antes de avançar" />
                    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {processBlueprint.checklist.map((item) => (
                        <li key={item} className={`${processPanel} text-xs leading-relaxed text-ink`}>
                          · {item}
                        </li>
                      ))}
                    </ul>
                  </ProcessSection>

                  <ProcessSection id="venda-consultiva">
                    <ProcessSectionHeader kicker="Venda consultiva" title="Script BANT+U (Chris Voss)" />
                    <div className={`${processPanel} mt-3`}>
                      <p className="text-sm font-semibold text-ink">Abertura (~30s)</p>
                      <div className="mt-1.5 space-y-1">
                        {processBlueprint.consultiveSales.opening.map((line) => (
                          <p key={line} className="text-[11px] leading-relaxed text-muted">{line}</p>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {processBlueprint.consultiveSales.bantu.map((block) => (
                        <div key={block.key} className={processPanel}>
                          <p className="text-sm font-semibold text-ink">{block.key}</p>
                          <ul className="mt-1.5 space-y-1">
                            {block.prompts.map((prompt) => (
                              <li key={prompt} className="text-[11px] leading-snug text-muted">· {prompt}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className={`${processPanel} mt-2`}>
                      <p className="text-sm font-semibold text-ink">Fechamento e agendamento</p>
                      <ul className="mt-1.5 space-y-1">
                        {processBlueprint.consultiveSales.close.map((line) => (
                          <li key={line} className="text-[11px] leading-snug text-muted">· {line}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-3">
                      <p className="mb-1.5 text-sm font-semibold text-ink">Objeções e respostas</p>
                      <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                        {processBlueprint.objections.map((item) => (
                          <li key={item.objection} className="px-3 py-2.5">
                            <p className="text-xs font-semibold text-ink">{item.objection}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.answer}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </ProcessSection>

                  <ProcessSection id="playbook-operacional">
                    <ProcessSectionHeader kicker="Playbook" title="Guia operacional no Sales Command" />
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {processBlueprint.playbook.map((block) => (
                        <div key={block.title} className={processPanel}>
                          <p className="text-sm font-semibold text-ink">{block.title}</p>
                          <ul className="mt-1.5 space-y-1">
                            {block.items.map((item) => (
                              <li key={item} className="text-[11px] leading-snug text-muted">· {item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </ProcessSection>

                  {processBlueprint.streams.map((stream) => (
                    <ProcessSection key={stream.id} id={stream.id}>
                      <ProcessSectionHeader
                        kicker={stream.owner}
                        title={stream.title}
                        hint={stream.objective}
                        right={(
                          <div className="flex shrink-0 flex-col gap-1 text-[10px] text-muted sm:max-w-[220px] sm:items-end">
                            <span className="line-clamp-2 rounded-[8px] border border-line bg-bg2 px-2 py-1 dark:bg-[#0e1220]">
                              <span className="font-semibold text-ink">In</span> {stream.inputs}
                            </span>
                            <span className="line-clamp-2 rounded-[8px] border border-line bg-bg2 px-2 py-1 dark:bg-[#0e1220]">
                              <span className="font-semibold text-ink">Out</span> {stream.outputs}
                            </span>
                          </div>
                        )}
                      />
                      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {stream.actions.map((action) => (
                          <li key={action} className={`${processPanel} text-[11px] leading-relaxed text-ink`}>
                            {action}
                          </li>
                        ))}
                      </ul>
                    </ProcessSection>
                  ))}

                  <ProcessSection id="rituais">
                    <ProcessSectionHeader kicker="Rituais" title="Cadência comercial" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {processBlueprint.rituals.map((ritual) => (
                        <div key={ritual.title} className={processPanel}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-ink">{ritual.title}</p>
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">{ritual.cadence}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted">{ritual.focus}</p>
                        </div>
                      ))}
                    </div>
                  </ProcessSection>

                  <ProcessSection id="ferramentas">
                    <ProcessSectionHeader kicker="Stack" title="Ferramentas e registros" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {processBlueprint.tools.map((tool) => (
                        <div key={tool.name} className={processPanel}>
                          <p className="text-sm font-semibold text-ink">{tool.name}</p>
                          <p className="mt-1 text-[11px] text-muted">{tool.purpose}</p>
                        </div>
                      ))}
                    </div>
                  </ProcessSection>

                  <ProcessSection id="erp-sankhya">
                    <ProcessSectionHeader kicker="Pós-venda" title="ERP Sankhya" />
                    <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                      {processBlueprint.erp.map((item) => (
                        <li key={item} className="px-3 py-2 text-xs leading-relaxed text-ink">· {item}</li>
                      ))}
                    </ul>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {processBlueprint.erpDeepDive.map((block) => (
                        <div key={block.title} className={processPanel}>
                          <p className="text-sm font-semibold text-ink">{block.title}</p>
                          <ul className="mt-1.5 space-y-1">
                            {block.items.map((item) => (
                              <li key={item} className="text-[11px] leading-snug text-muted">· {item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className={`${processPanel} mt-2`}>
                      <p className="text-[11px] text-muted">Referência oficial Sankhya</p>
                      <a
                        href="https://ajuda.sankhya.com.br/hc/pt-br/categories/360003333814-Documenta%C3%A7%C3%A3o-de-Telas-Manual"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-block text-sm font-semibold text-primary hover:underline"
                      >
                        Documentação de Telas (Manual) ↗
                      </a>
                    </div>
                  </ProcessSection>

                  <ProcessSection id="documentacao">
                    <ProcessSectionHeader kicker="Anexos" title="Documentação complementar" />
                    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {processBlueprint.documentation.map((item) => (
                        <li key={item} className={`${processPanel} text-xs leading-relaxed text-ink`}>
                          · {item}
                        </li>
                      ))}
                    </ul>
                  </ProcessSection>
                </main>
              </div>
            </div>
          )}
          </VerticalScrollArrows>
        </div>
        </>
      );
          })()}
      </div>
      )}
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: '0',
              },
            },
          }),
        }}
      >
        {dragOverlayPayload?.type === 'opp' ? (
          <div className="kanban-card is-overlay w-[270px] rounded-[13px] border border-line bg-surf px-[13px] py-3 shadow-card">
            <h4 className="text-sm font-semibold text-ink truncate">
              {dragOverlayPayload.titulo}
            </h4>
            <p className="text-xs text-muted mt-1 truncate">
              {dragOverlayPayload.orgao}
            </p>
            <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted truncate">Edital: {dragOverlayPayload.edital}</span>
              <span className="font-mono font-semibold text-ink">
                {dragOverlayPayload.valor}
              </span>
            </div>
          </div>
        ) : dragOverlayPayload?.type === 'contact' ? (
          <div className="w-[270px]">
            <CardPreview contact={dragOverlayPayload.contact} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default App;
