# Handoff: Aerion Command — Redesign de UI/UX (dark)

## Visão geral
Redesenho completo da UI/UX do app **kanban-chatwoot-aerion** (CRM de funil + Chatwoot + Licitações públicas). Nova identidade visual **dark "command center"**, navegação unificada e três focos pedidos pelo time: **Overview** (com segmentação por estado/canal/etiqueta + mapa), **Funil/Board** (Kanban com drag-and-drop estilo Trello), **Metas** (meta×realizado + funil de prospecção) e **Licitações** (Overview, Busca Editais, Board e PCA — cada uma como página no menu).

## Sobre os arquivos de design
O arquivo `Aerion Command.dc.html` deste pacote é uma **referência de design feita em HTML** — um protótipo que mostra a aparência e o comportamento pretendidos. **Não é código de produção para copiar e colar.** A tarefa é **recriar este design no codebase real** (React 18 + Create React App + Tailwind, arquivo `frontend/src/App.js`), reutilizando os padrões já existentes (estado `activeView`/`licitaçãoSubview`, componentes `KanbanCard`/`KanbanColumn`/`LicitacaoCard`/`PcaExplorer`, helpers `getPncpScoreClass`/`getBestEstimatedValue`, `@dnd-kit`, gráficos `@nivo`).

Abra o `.dc.html` em qualquer navegador para interagir (trocar telas pelo menu, arrastar cards no Board, navegar entre as páginas de Licitações).

## Fidelidade
**Alta (hi-fi).** Cores, tipografia, espaçamentos e interações são finais. Recrie pixel-a-pixel usando Tailwind. As escolhas abaixo (paleta, fontes) **substituem** o tema claro atual (Manrope/indigo) — ver "Migração do design system".

---

## Migração do design system (o que muda no que já existe)

### `frontend/tailwind.config.js`
Trocar a paleta `theme.extend.colors` e a fonte. O app já alterna `.theme-dark` no `<body>` — **definir dark como padrão** (ou aplicar `.theme-dark` sempre). Novos tokens:

```js
fontFamily: {
  sans: ['Hanken Grotesk','ui-sans-serif','system-ui','sans-serif'],
  display: ['Space Grotesk','Hanken Grotesk','sans-serif'],
  mono: ['JetBrains Mono','ui-monospace','monospace'],
},
colors: {
  bg:'#0a0d14', bg2:'#0e1220', surf:'#141a28', surf2:'#1a2233', raise:'#202a3e',
  line:'#232c40', line2:'#2f3a52',
  ink:'#eef1f8', muted:'#8b95ad', muted2:'#5d6781',
  primary:{ DEFAULT:'#7c5cff', strong:'#5a3ff0', soft:'#9d86ff' },
  cyan:'#38d6e6', amber:'#ffb24d', green:'#36d39a', red:'#ff5d72',
  stage:{ topo:'#5a93ff', meio:'#a78bff', fundo:'#ffb24d', outros:'#7b87a3', recompra:'#36d39a' },
}
```

### `frontend/public/index.html`
Adicionar os links das fontes Google:
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```
Números, valores monetários, contagens, scores, datas → sempre `font-mono` (JetBrains Mono). Títulos de seção/card → `font-display` (Space Grotesk). Corpo/UI → Hanken Grotesk.

### `frontend/src/ui.js`
Reestilizar as constantes mantendo a API:
- `btnPrimary`: fundo `linear-gradient(135deg,#7c5cff,#5a3ff0)`, texto branco, `rounded-xl`, sombra `0 6px 16px rgba(124,92,255,.4)`.
- `card`: `bg-surf border border-line rounded-[18px]`.
- `chip`: `bg-bg2 border border-line text-muted rounded-lg`.
- `input`/`select`: `bg-bg2 border-line text-ink`, foco `ring-primary/30`.

### `frontend/src/App.css`
Atualizar `.theme-dark` (cores acima), scrollbars (`thumb #2a3550 / track transparent`), e remover os estilos do funil legado se forem substituídos pelos novos componentes.

---

## Detalhes visuais globais
- **Fundo:** `#0a0d14` com glow radial decorativo (manter — o time aprovou degradês/brilho): `radial-gradient(620px 420px at 8% -4%, rgba(124,92,255,.16), transparent 60%), radial-gradient(560px 420px at 100% 0%, rgba(56,214,230,.10), transparent 55%)`, posição `fixed`, `z-index:0`.
- **Sidebar (248px):** fundo `#0e1220`, borda direita `1px #232c40`. Logo: quadrado 34px com gradiente `135deg, #7c5cff→#38d6e6`, letra "A" em Space Grotesk sobre `#0a0d14`. Grupos de menu com label uppercase 10px `#5d6781` letter-spacing .13em, fonte mono.
- **Item de menu:** altura 39px, radius 11px. Ativo: `linear-gradient(135deg,rgba(124,92,255,.22),rgba(56,214,230,.10))` + `inset 0 0 0 1px rgba(124,92,255,.35)`, texto branco. Inativo: transparente, texto `#8b95ad`. Ícone 18px stroke à esquerda; badge de contagem (mono) à direita.
- **Header (sticky):** `rgba(10,13,20,.82)` + `backdrop-filter: blur(14px)`, borda inferior `#232c40`. Esquerda: breadcrumb (mono 11px) + título (Space Grotesk 21px). Direita: busca (230px), sino com badge vermelho, botão "Novo lead" (gradiente primário).
- **Cards/painéis:** `bg #141a28`, borda `#232c40`, radius 18px, padding 18–22px.
- **Ícones:** SVG stroke 1.7–2, sem fundo colorido (brancos `#eef1f8` opacity .92 nos KPIs — ajuste pedido pelo time).

---

## Telas

### 1. Sidebar / Navegação (estrutura nova)
Resolve a confusão atual (breadcrumb + select + pills). Menu único agrupado:
- **WORKSPACE:** Overview · Funil (Board) `312` · **Metas** (movido pra cá)
- **LICITAÇÕES:** Overview · Busca Editais `126` · Board `48` · PCA — **cada subview é um item do menu** (não mais abas internas). Cada item seta `activeView='Licitações'` + `licitaçãoSubview=<x>`.
- **PROSPECÇÃO:** Busca Lead B2B · Disparo WhatsApp
- **ADMINISTRAÇÃO:** Usuários
- Rodapé: avatar + nome + cargo.

### 2. Overview (`activeView === 'Overview'`)
- **Linha de KPIs (4):** Leads ativos `312`, Clientes ativos `87`, Pipeline aberto `R$ 9,4M`, Em negociação `63`. Card `bg-surf`, glow circular sutil no canto, ícone branco topo-esquerda, trend (mono, verde/vermelho) topo-direita, valor 29px mono, label 12.5px muted.
- **Grid 1.7fr / 1fr:**
  - Esq: **Evolução do funil** (área empilhada Topo/Meio — usar `@nivo/line` com `enableArea`, cores stage; eixo X datas). **Funil de vendas** (barras horizontais por grupo Topo/Meio/Fundo/Outros/Recompra com valor à direita).
  - Dir: **Meta do mês** (card gradiente, valor mono 30px, barra de progresso `linear-gradient(90deg,#7c5cff,#38d6e6)`, 77%). **Desempenho por agente** (ranking com avatar colorido + barra). 
- **Linha de SEGMENTAÇÃO (3 cards) — NOVO:**
  - **Leads por estado:** mini-mapa do Brasil em **tile-grid (statebins)** — grid 6 colunas × 8 linhas, cada UF é um quadrado 22px radius 6px, cor = `rgba(124,92,255, 0.16 + intensidade*0.74)` (heatmap por volume), código UF em mono 8px. Ao lado, ranking de top estados (SP/MG/PR/RS/RJ/SC) com barra. Posições UF (col,linha) no `buildSegments()` do protótipo. **Dados já existem:** `overviewData.byState` (`stateCountData`/`stateValueData`).
  - **Por canal:** barras (Inbound/Outbound/Indicação/Eventos/Parcerias/Licitações). Pode exigir endpoint novo ou derivar de `custom_attributes`.
  - **Por etiqueta:** barras das tags (`overviewData.byLabel` → `labelCountData`).

### 3. Funil / Board (`activeView === 'Board'`)
- **Topo:** segmented Leads·SDR / Clientes·CS (ativo = gradiente primário; CS = verde). Botão Filtros + pill "Pipeline R$ 3.7M" (âmbar). 
- **Barra de grupos (alinhada às colunas):** spans coloridos Topo/Meio/Fundo/Encerramento (leads) cobrindo a largura das colunas do grupo. Mesma faixa de scroll horizontal que as colunas (largura = nº_colunas×296 + gaps).
- **Colunas (296px):** `bg-bg2`, header com bolinha da cor do grupo + título + badge de contagem (mono) + total mono. Scroll vertical interno.
- **Card (`KanbanCard`):** empresa (13.5px 600), pessoa (muted), cidade/UF com ícone pin, **valor mono 16px**, chips (prioridade Alta/Média/Baixa coloridas, tipo, agente, labels). Hover: `translateY(-2px)` + sombra.
- **Drag-and-drop estilo Trello — NOVO/aprimorar:** o repo já usa `@dnd-kit`. Visual ao arrastar: card com `opacity:.4; transform:rotate(2deg) scale(.97)` + sombra forte; coluna-alvo destaca borda primária + `background:rgba(124,92,255,.08)`. Drop move o card para a fase (já existe `moveContactToStage`). Stages: `leadColumns` (17) e `customerColumns` (9).

### 4. Metas (`activeView === 'Metas'`, em Workspace) — NOVO
- **KPIs (4):** Receita realizada `R$ 4,8M` (77% da meta), Gap `R$ 1,4M`, Projeção `R$ 5,9M`, Ticket médio `R$ 31k`.
- **Meta × Realizado mensal (estilo Metabase):** barras por mês (realizado) com **linha tracejada da meta** sobreposta por mês. Barra verde quando bate a meta, primária quando abaixo. Fonte dos dados: `/api/vendas/meta` + faturamento.
- **Meta anual:** card gradiente com barra de progresso (77%, gap).
- **Funil de metas — prospecção & pipeline (o destaque pedido):** funil vertical de **tiras que vão preenchendo**, estreitando de cima pra baixo (largura 35%→100% por `meta/maxMeta`). Tiers mensais com realizado/meta e **% de conversão entre etapas**:
  - Leads 920/1200 · SQLs 198/240 · Demos 94/120 · Propostas 52/68 · Vendas 13/17.
  - Cada tira: fundo `bg2`, fill colorido proporcional a realizado% (cor por tier: cyan→azul→violet→roxo→verde), % à direita (verde ≥85, âmbar ≥70, vermelho <70), barrinha de progresso embaixo. Entre tiras, pill com seta + "% conversão".
  - Números-base vêm de `processBlueprint.stats` (240 SQLs/mês, 17 vendas/mês, R$ 6,2M/ano) e da aba **Processo** (pipeline ponta a ponta).

### 5. Licitações (`activeView === 'Licitações'`) — 4 páginas no menu
**5a. Overview** (`licitaçãoSubview === 'overview'`): KPIs (Oportunidades 48, Valor aberto R$ 12,4M, Vencendo 48h 5, Atrasadas 3); Funil por fase (barras); Prazos críticos (atrasadas/48h); Top oportunidades. Dados: `licSummary`, `licitaçãoOpportunities`.

**5b. Busca Editais** (`licitaçãoSubview === 'editais'`) — **redesenho que limpa a tela poluída atual:**
- Barra de busca grande com tag "✦ IA expande termos"; abaixo, filtros compactos como chips-dropdown (Tipo de documento, Status, Modalidade, UF, Excluir termos) + termos ativos.
- Faixa de resumo enxuta: total + valor + contagem por aderência (Alta/Média/Baixa) + "Ordenar". **Mover auditoria/diagnósticos/term-runs/debug para um drawer "Ver auditoria" recolhido** (hoje estão todos abertos = causa da confusão).
- **Card de resultado (redesenhado):** linha de badges → **score de aderência** (`getPncpScoreClass`/`getPncpScoreLabel`, thresholds 68/38: ≥68 verde, ≥38 âmbar, <38 vermelho), **urgência de prazo** (`getPncpUrgencyClass`: ok verde/warning âmbar/critical vermelho), modalidade, UF. Título (link PNCP), descrição (2 linhas), meta-infos (Órgão, Critério, Itens pertinentes). Painel direito separado por divisória: **Valor estimado** (mono 18px, `getBestEstimatedValue`) + ações **Importar** (→`importPncpLicitacao`), **PNCP ↗**, **Ocultar** (`hidePncpItem`). Manter scopes (Visíveis/Todos/Ocultos/Pipeline) como toggle discreto.

**5c. Board** (`licitaçãoSubview === 'board'`): Kanban das fases da Lei 14.133, agrupadas Inteligência / Disputa / Recursal / Encerrado. **Importante: remover "1. Monitoramento de PCA" do funil** (virou etapa pré-edital, agora vive na página PCA). Cards: órgão+UF, título, valor mono, urgência de prazo, modalidade. Mesmo DnD do Board principal. Stages: `licitaçãoColumns` sem o item 1.

**5d. PCA** (`licitaçãoSubview === 'pca'`, componente `PcaExplorer`): busca por palavra-chave + "✦ Busca IA"; resultados de contratações (órgão/UF, objeto, score de aderência, nº itens pertinentes, valor previsto, prazo de contratação) com ações **Promover itens** e **+ Watchlist**.

---

## Interações & comportamento
- **Troca de tela:** `activeView` (e `licitaçãoSubview` para Licitações), setados pelos itens do menu.
- **Board toggle:** Leads·SDR / Clientes·CS troca `activeTab` → muda `leadColumns`/`customerColumns`.
- **Drag-and-drop:** `@dnd-kit`. `onDragStart` aplica estilo de arraste no card; `onDragOver` destaca coluna; `onDrop`/`onDragEnd` chama `moveContactToStage` (Board) ou o equivalente de licitações. Visual: tilt + opacity + sombra; coluna-alvo com borda/fundo primário.
- **Hover:** cards sobem 2px + sombra; itens de menu/linhas mudam de fundo.
- **Transições:** `transition: all .15s`.
- **Responsivo:** grids 4-col → 2-col em telas menores; boards com scroll-x.

## State (já existente no App.js — reaproveitar)
`activeView`, `activeTab`, `licitaçãoSubview`, `contacts`, `licitaçãoOpportunities`, `overviewData` (`byStage`/`byState`/`byLabel`/`byAgent`), `licSummary`, `pncpSearchResults`/`pncpResultsWithVisibility`, `vendaMeta`, `processBlueprint`. Novo: estado de drag (`dragId`/`overCol`) para o feedback visual do DnD.

## Design tokens
- **Cores:** ver "Migração do design system".
- **Tipografia:** Space Grotesk (display) / Hanken Grotesk (corpo) / JetBrains Mono (números). Tamanhos: título tela 21px, título card 15.5px, KPI 27–30px, corpo 12.5–14px, mono dados 11–16px.
- **Radius:** card 18px · inner 13–16px · pill/badge 8–11px · barra 999px.
- **Sombras:** card hover `0 10px 22px rgba(0,0,0,.35)`; botão primário `0 6px 16px rgba(124,92,255,.4)`; arraste `0 16px 30px rgba(0,0,0,.5)`.
- **Score editais:** Alta ≥68 (verde) · Média ≥38 (âmbar) · Baixa <38 (vermelho).

## Assets
- Fontes: Google Fonts (links acima). Sem imagens externas — todos os ícones são SVG stroke inline (substituíveis por `@heroicons/react`, já no projeto). Mantra: não desenhar SVGs complexos; o mapa do Brasil é um **tile-grid de quadrados** (statebins), não um SVG geográfico.

## Arquivos
- `Aerion Command.dc.html` — protótipo hi-fi navegável (todas as telas e o drag-and-drop funcionando). Referência visual e de comportamento.
- Codebase alvo: `frontend/src/App.js` (monólito ~11.6k linhas), `frontend/tailwind.config.js`, `frontend/src/ui.js`, `frontend/src/App.css`, `frontend/public/index.html`.
