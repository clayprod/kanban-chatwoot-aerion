const { eligibleProducts } = require('./marketingDomain');
const SOURCES = [
  { name: 'Google: estrutura de PMax', kind: 'Orientação da plataforma', url: 'https://support.google.com/google-ads/answer/14587068' },
  { name: 'Google: segurança de posicionamentos', kind: 'Funcionamento dos controles', url: 'https://support.google.com/google-ads/answer/13607727' },
  { name: 'SMEC: State of PMax 2025', kind: 'Estudo observacional; mais de 4.000 campanhas e 500 contas', url: 'https://a.smarter-ecommerce.com/f/42081/x/f6d2fe0783/state-of-pmax-2025-final.pdf' },
  { name: 'Tinuiti: benchmark Q4 2025', kind: 'Dados de clientes da agência; não é experimento causal nem referência específica do Brasil', url: 'https://tinuiti.com/research-insights/research/digital-ads-benchmark-report-q4-2025/' },
  { name: 'Jon Loomer: orçamento Advantage', kind: 'Análise de especialista; distribuição desigual e consolidação', url: 'https://www.jonloomer.com/advantage-campaign-budget-best-practices/' },
  { name: 'Gordon et al.: mensuração de anúncios', kind: 'Pesquisa acadêmica, Marketing Science 2019; atribuição não comprova efeito incremental', url: 'https://www.kellogg.northwestern.edu/academics-research/research/detail/2019/a-comparison-of-approaches-to-advertising-measurement-evidence-from/' },
];
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
function economics(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) invalid('Informe os dados de margem como objeto.');
  const supplied = ['averageOrderValue', 'contributionMarginPercent', 'reservePerOrder'].filter(k => input[k] !== '' && input[k] != null);
  if (!supplied.length) return null;
  const aov = Number(input.averageOrderValue), margin = Number(input.contributionMarginPercent), reserve = Number(input.reservePerOrder || 0);
  if (!Number.isFinite(aov) || aov <= 0 || aov > 1e8 || !Number.isFinite(margin) || margin <= 0 || margin >= 100 || !Number.isFinite(reserve) || reserve < 0) invalid('Informe ticket positivo, margem de contribuição entre 0 e 100% e reserva não negativa.');
  const contribution = aov * margin / 100, allowed = contribution - reserve;
  if (!(allowed >= 0.01)) invalid('A contribuição após a reserva precisa permitir ao menos R$ 0,01 de mídia por pedido.');
  return { source: 'user_supplied_scenario', averageOrderValue: aov, contributionMarginPercent: margin, reservePerOrder: reserve,
    contributionPerOrder: Math.round(contribution * 100) / 100, maximumAcquisitionCost: Math.floor(allowed * 100 + 1e-7) / 100,
    breakEvenRoas: 100 / margin, minimumScenarioRoas: aov / allowed, biddingTargetApplied: false };
}
function buildCampaignStrategy(products, input = {}) {
  const scope = input.scope || 'product', family = String(input.family || '');
  if (!['product', 'family', 'sale'].includes(scope)) invalid('Escolha produto, família ou produtos com preço promocional.');
  const assessed = eligibleProducts(products), available = assessed.filter(p => p.eligible && p.availability !== 'out_of_stock');
  if (scope === 'family' && !['Drones', 'Kits', 'Payloads', 'Acessórios', 'Outros'].includes(family)) invalid('Escolha uma família existente do catálogo.');
  const ids = input.productIds?.map(String) || [];
  let pool = available.filter(p => scope === 'family' ? p.group === family : scope === 'sale' ? p.price < p.regularPrice : !ids.length || ids.includes(p.id));
  if (scope === 'product' && !ids.length) pool = pool.sort((a, b) => Number(!['Drones', 'Kits'].includes(a.group)) - Number(!['Drones', 'Kits'].includes(b.group)) || Number(a.availability !== 'in_stock') - Number(b.availability !== 'in_stock') || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 3);
  if (!pool.length) throw Object.assign(new Error('Não há produtos elegíveis e disponíveis para essa seleção.'), { status: 409 });
  return { version: 1, objective: 'first_paid_orders', objectiveLabel: 'Primeiras compras pagas na loja', context: 'ecommerce',
    scope, family: scope === 'family' ? family : null, productIds: pool.map(p => p.id), productSkus: pool.map(p => p.sku), productCount: pool.length,
    excludedCount: assessed.length - available.length, economics: economics(input.economics),
    grouping: 'Começar com uma oferta ou família coerente. Separar campanhas quando objetivo, margem, público, prazo ou verba exigirem controle próprio.',
    promotion: scope === 'sale' ? 'Preço promocional real não comprova participação na Black November. Confirmar os SKUs, regras e datas da ação antes de anunciar.' : null,
    choices: [
      { id: 'pmax', platform: 'Google', name: 'Performance Max com catálogo', role: 'Candidata para vendas automatizadas',
        reason: 'Combina o feed e os criativos em vários canais. Manter as proteções existentes e avaliar compras pagas, margem e ganho incremental.',
        tradeoff: 'Os públicos são sinais, não uma fronteira de segmentação. Grupos de recursos não recebem parcelas fixas da verba.',
        prerequisites: ['Compra paga e valor confiáveis', 'Exclusões da conta e do MCC conferidas', 'Posicionamentos, conteúdo infantil, jogos e apostas revisados', 'Produtos e destinos coerentes'] },
      { id: 'shopping', platform: 'Google', name: 'Shopping tradicional', role: 'Alternativa para testar o catálogo com maior controle de inventário',
        reason: 'Exibe produto, imagem e preço para quem pesquisa. Pode ser o ponto de comparação da PMax.',
        tradeoff: 'Alcance e formatos mais restritos. Não rodar uma comparação informal com os mesmos produtos e chamar isso de teste A/B.', prerequisites: ['Feed aprovado', 'Parceiros de pesquisa revisados', 'Lances e teto compatíveis com a margem'] },
      { id: 'search', platform: 'Google', name: 'Pesquisa por intenção de compra', role: 'Capturar buscas específicas',
        reason: 'Testar termos de compra, modelos e aplicações com anúncio e destino correspondentes.',
        tradeoff: 'Separar marca Aerion de novas buscas; revisar termos negativos, expansão e parceiros. Nem toda busca gera volume suficiente.', prerequisites: ['Demanda pesquisada', 'Palavras e negativas revisadas', 'Página correspondente à busca'] },
      { id: 'meta_sales', platform: 'Meta', name: 'Vendas com Advantage+ e catálogo', role: 'Descoberta e conversão com criativos de produto',
        reason: 'Começar com estrutura enxuta, demonstração real e catálogo coerente; permitir otimização dentro da verba aprovada.',
        tradeoff: 'Entrega e gasto não serão iguais entre produtos. Sugestões de público podem expandir; restrições e exclusões precisam ser conferidas na configuração efetiva.', prerequisites: ['Otimização para compra paga', 'Catálogo e eventos correspondentes', 'Posicionamentos, inventário e restrições conferidos'] },
    ],
    budgetRules: ['Google e Meta mantêm parcelas fixas; nenhuma transferência automática.', 'A plataforma distribui a verba de acordo com o objetivo, sem garantir gasto por SKU.', 'Se um produto precisa de verba reservada, planejar estrutura específica e avaliar a perda de concentração de dados.'],
    audienceRules: ['Aquisição: começar com hipóteses e criativos relevantes, sem dezenas de conjuntos por interesse.', 'Remarketing: visitantes/interesse 30d, carrinho 14d, checkout 7d; excluir compradores 180d quando aplicável.', 'Não reservar verba de remarketing sem conferir tamanho e entrega; público criado ainda pode estar vazio.', 'CRM e vendas consultivas ficam separados; não usar lead como se fosse compra online.'],
    mediaSafety: { status: 'verification_required', preserveExisting: true, automaticCampaignChanges: false,
      requirements: ['Conferir exclusões herdadas da conta e MCC, além das configurações da campanha.', 'Revisar apps, jogos, conteúdo infantil, apostas e sites/canais identificados como inadequados.', 'Conferir região atendida, restrições de público e expansão de destino.', 'Monitorar posicionamentos e termos; impressões em um local não comprovam gasto ou desperdício nesse local.'],
      limitation: 'Exclusões reduzem o risco, mas não são garantia absoluta de inventário. Público e posicionamento são controles diferentes.' },
    evaluation: ['Comparar compras pagas e receita WooCommerce com o gasto total. Não somar vendas atribuídas por Google e Meta.', 'Usar CAC, margem após mídia e receita total; cliques, CTR e carrinho são diagnósticos.', 'Testar uma hipótese por vez e considerar atraso de conversão e amostra antes de decidir.', 'Definir limite de gasto do teste e critério de continuidade antes de ativar.'],
    evidence: { salesHistory: 'not_supplied', audienceDelivery: 'not_verified', sourceReviewedAt: '2026-11-04', externalResultsAreForecast: false },
    sources: SOURCES, recommendationStatus: 'review_required', platformSelection: null, activationAllowed: false,
  };
}
function mediaSafetyEvidence(states) {
  const google = states.google_media_safety, meta = states.meta_media_safety;
  const criteria = google?.datasets?.accountExclusions;
  return { google: google ? { accountId: google.accountId, observedAt: google.observedAt, readComplete: google.complete,
    exclusionsAvailable: Boolean(criteria?.available), exclusionsPreserved: Boolean(criteria?.preserved), exclusionsObservedAt: criteria?.observedAt,
    exclusionTypes: (criteria?.rows || []).reduce((counts, row) => { const key = row.customerNegativeCriterion?.type || 'UNKNOWN';counts[key] = (counts[key] || 0) + 1;return counts; }, {}),
    contentLabels: (criteria?.rows || []).map(row => row.customerNegativeCriterion?.contentLabel?.type).filter(Boolean),
    campaignSettingsAvailable: Boolean(google.datasets?.campaigns?.available),
    campaigns: (google.datasets?.campaigns?.rows || []).slice(0, 30).map(row => row.campaign), limitations: google.limitations,
  } : { status: 'not_audited' }, meta: meta ? { accountId: meta.accountId, observedAt: meta.observedAt, adsets: meta.adsets?.slice(0, 30), limitations: meta.limitations } : { status: 'not_audited' },
  verifiedInventoryGuarantee: false, instruction: 'Preservar as proteções existentes. Conferir data e cobertura; leitura incompleta ou antiga não comprova configuração atual. Não cancelar PMax ou desabilitar Advantage+ por princípio.' };
}
module.exports = { buildCampaignStrategy, economics, mediaSafetyEvidence };
