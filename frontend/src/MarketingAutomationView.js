import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { btnSecondarySm, input, select } from './ui';

const stateLabel = { operational: 'Operacional', awaiting_external_processing: 'Aguardando processamento externo', existing_requires_rule_review: 'Existente · conferir regras', administrator_action: 'Ação do administrador', pending: 'Na fila', running: 'Em processamento', retry: 'Nova tentativa agendada', done: 'Concluído', draft: 'Aguardando revisão', approved: 'Aprovado', published: 'Publicado', rejected: 'Rejeitado', stale: 'Desatualizado' };
const issueLabel = { not_published: 'Fora de publicação', missing_sku: 'SKU ausente', duplicate_sku: 'SKU duplicado', missing_real_image: 'Imagem real ausente', missing_url: 'URL ausente', missing_description: 'Descrição ausente', invalid_consumer_price: 'Preço público inválido', missing_brand_or_gtin: 'Marca ou GTIN ausente', unknown_availability: 'Estoque não confirmado', missing_future_availability_date: 'Pré-venda sem data futura', classification_required: 'Classificar categoria' };
const diagnosticLabel = { cross_domain_canonical_review_required: 'Revisar canonical entre domínio principal e loja', canonical_missing_or_multiple: 'Canonical ausente ou repetido', invalid_canonical: 'Canonical inválido', noindex: 'Página impede indexação', not_html: 'URL não retornou uma página HTML', product_schema_missing_or_invalid: 'Dados estruturados de produto ausentes ou inválidos', schema_sku_mismatch: 'SKU dos dados estruturados diverge da loja', merchant_unavailable: 'Leitura do Merchant indisponível', not_received: 'Oferta ainda não recebida', received: 'Oferta recebida', pending_initial_policy_review_free_listings: 'Aguardando análise inicial das listagens gratuitas' };
const name = { products: 'Produtos da loja', google_catalog: 'Catálogo Google', meta_catalog: 'Catálogo Meta', measurement: 'Medição e compras', audiences: 'Públicos', visitors: 'Visitantes', product_interest: 'Interesse em produtos', cart: 'Carrinho', checkout: 'Checkout', paid_buyers: 'Compradores pagos' };
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : 'Sem atualização';
const money = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
function DataTable({ caption, columns, rows, empty }) {
  return <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-surf"><table className="w-full text-left text-sm">
    <caption className="p-4 text-left font-semibold">{caption}</caption>
    <thead className="border-y border-line bg-bg2 text-xs text-muted"><tr>{columns.map(([key, label]) => <th scope="col" key={key} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
    <tbody className="divide-y divide-line">{rows.map((row, i) => <tr key={row.id || i}>{columns.map(([key, , render]) => <td key={key} className="max-w-sm px-4 py-3 align-top break-words">{render ? render(row) : row[key] == null || row[key] === '' ? '—' : row[key]}</td>)}</tr>)}</tbody>
  </table>{!rows.length && <p className="p-4 text-sm text-muted">{empty}</p>}</div>;
}
export default function MarketingAutomationView({ data, isAdmin, onRefresh }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failure, setFailure] = useState(false);
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
  const [budget, setBudget] = useState({ total: '', google: '', meta: '' });
  const [exclusionsReviewed, setExclusionsReviewed] = useState(false);
  const planVersion = JSON.stringify(data?.campaign);
  useEffect(() => setExclusionsReviewed(false), [planVersion]);
  const [content, setContent] = useState({ productId: '', kind: 'creative', approach: 'demonstração', copy: '', title: '', description: '' });
  const act = async (url, body = {}, method = 'post') => {
    setBusy(true); setMessage(''); setFailure(false);
    try { await axios[method](`/api/ecommerce/marketing/${url}`, body); setMessage('Alteração salva. O painel será atualizado.'); onRefresh(); }
    catch (e) { setFailure(true); setMessage(e.response?.data?.error || 'Não foi possível salvar. Tente novamente.'); }
    finally { setBusy(false); }
  };
  if (!data) return <p className="py-8 text-sm text-muted">A automação ainda não está disponível nesta versão do servidor.</p>;
  const products = (data.products || []).filter(p => (filter === 'all' || (filter === 'eligible' ? p.eligible : !p.eligible)) && `${p.sku} ${p.name}`.toLowerCase().includes(query.toLowerCase()));
  const diagnostics = data.diagnostics || [];
  return <section className="min-w-0 space-y-6" aria-label="Automação de marketing">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-semibold">Produtos, conteúdo e prontidão</h3><p className="mt-1 text-xs text-muted">WooCommerce · preço público do consumidor · {date(data.coverage?.products?.observedAt)}</p></div>
      {isAdmin && <div className="flex flex-wrap gap-2"><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('reconcile')}>Conciliar produtos</button><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('meta/sync')}>Consultar catálogo Meta</button></div>}
    </div>
    {message && <p role={failure ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${failure ? 'border-red/30' : 'border-line'} bg-surf`}>{message}</p>}
    <div className="flex flex-wrap gap-3"><label className="min-w-0"><span className="mb-1 block text-xs text-muted">Buscar produto ou SKU</span><input className={`${input} max-w-full`} value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="mb-1 block text-xs text-muted">Elegibilidade</span><select className={select} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos</option><option value="eligible">Elegíveis</option><option value="pending">Com pendências</option></select></label></div>
    <DataTable caption={`Elegibilidade dos produtos · ${products.length}`} rows={products.slice(0, 200)} empty="Aguardando a primeira projeção de produtos. Consulte as ações no diagnóstico abaixo."
      columns={[
        ['sku', 'SKU'], ['name', 'Produto'], ['price', 'Preço público', p => money(p.price)], ['group', 'Categoria'],
        ['eligible', 'Situação', p => p.eligible ? 'Elegível' : 'Com pendências'],
        ['issues', 'Pendências', p => [...p.issues, ...p.warnings].map(i => issueLabel[i] || i).join(' · ') || '—'],
      ]} />
    <DataTable caption="Recebimento no Google" rows={(data.googleReconciliation?.rows || []).slice(0, 200)} empty="A conciliação aparecerá após a projeção da loja."
      columns={[
        ['sku', 'SKU'], ['received', 'Recebido', p => p.received == null ? 'Indisponível' : p.received ? 'Sim' : 'Não'],
        ['approved', 'Aprovado no Brasil', p => p.approved == null ? 'Indisponível' : p.approved ? 'Sim, em ao menos um destino' : 'Ainda não'],
        ['reason', 'Diagnóstico', p => p.issues?.length ? p.issues.map(i => i.description || diagnosticLabel[i.code] || i.code).join(' · ') : diagnosticLabel[p.reason] || p.reason], ['observedAt', 'Última leitura', p => date(p.observedAt)],
      ]} />
    <DataTable caption={`Importações do catálogo Meta${data.metaCatalog ? ` · ${date(data.metaCatalog.observedAt)}` : ''}`} rows={data.metaCatalog?.uploads || []}
      empty={data.metaCatalog ? 'Nenhuma importação retornada para a fonte configurada.' : 'Leitura do catálogo Meta indisponível. Consulte a prontidão das integrações abaixo.'}
      columns={[
        ['id', 'Importação'], ['start', 'Início', p => date(p.start)], ['end', 'Conclusão', p => p.end ? date(p.end) : 'Em processamento'],
        ['detected', 'Itens detectados'], ['persisted', 'Itens recebidos'], ['invalid', 'Itens inválidos'],
      ]} />
    <DataTable caption="Públicos da loja · regras por eventos" rows={data.audiences?.store || []} empty="Regras ainda indisponíveis."
      columns={[
        ['id', 'Público', p => name[p.id] || p.id], ['days', 'Janela', p => `${p.days} dias`],
        ['excludePaidDays', 'Exclusão de pagos', p => p.excludePaidDays ? `${p.excludePaidDays} dias` : 'Recompra e exclusão'],
        ['status', 'Sincronização', p => stateLabel[p.status] || p.status], ['size', 'Tamanho disponível', p => p.size == null ? 'Indisponível' : p.size],
      ]} />
    {isAdmin && <div className="flex flex-wrap gap-2"><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('meta/setup')}>Configurar fonte e conjuntos Meta</button><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('audiences/meta')}>Preparar públicos Meta da loja</button><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('audiences/google')}>Preparar públicos GA4</button><button type="button" className={btnSecondarySm} disabled={busy || !data.enabled} onClick={() => act('audiences/customers')}>Sincronizar cadastros elegíveis</button></div>}
    {data.audiences?.google && <DataTable caption="Públicos GA4 e vínculo com Google Ads" rows={data.audiences.google.store || []} empty="Nenhum público retornado."
      columns={[
        ['id', 'Público', p => name[p.id] || p.id], ['days', 'Janela', p => `${p.days} dias`], ['status', 'Situação', p => stateLabel[p.status] || p.status],
        ['exclusionApplied', 'Exclusão de compradores', p => p.excludePaidDays ? 'Aplicar público de compradores 180d na campanha' : 'Público de referência'],
        ['adsPersonalizationEnabled', 'Publicidade', p => p.adsPersonalizationEnabled == null ? 'Não confirmada' : p.adsPersonalizationEnabled ? 'Habilitada' : 'Desabilitada'],
      ]} />}
    {data.audiences?.customers && <DataTable caption="Cadastros elegíveis · loja e CRM separados" rows={data.audiences.customers.lists || []} empty="Nenhuma lista configurada."
      columns={[
        ['source', 'Origem', p => p.source === 'crm' ? 'CRM / distribuição' : 'Loja'], ['segment', 'Segmento'], ['platform', 'Plataforma'],
        ['eligible', 'Cadastros elegíveis'], ['added', 'Inclusões'], ['removed', 'Remoções'], ['status', 'Processamento', p => stateLabel[p.status] || p.status],
      ]} />}
    <DataTable caption="Diagnóstico técnico diário" rows={diagnostics} empty="As URLs serão auditadas depois da projeção de produtos."
      columns={[
        ['productId', 'Produto'], ['httpStatus', 'HTTP'], ['indexable', 'Indexável', r => r.indexable ? 'Sim' : 'Não'],
        ['issues', 'Pendências', r => r.issues?.map(i => diagnosticLabel[i] || i).join(' · ') || 'Nenhuma nas verificações executadas'], ['observedAt', 'Verificado em', r => date(r.observedAt)],
      ]} />
    <DataTable caption="Oportunidades de SEO · períodos completos de 28 dias" rows={data.seo?.rows || []}
      empty={data.seo?.available ? 'Nenhuma página atingiu os critérios nesta janela.' : 'São necessários 56 dias completos de dados finalizados do Search Console.'}
      columns={[
        ['url', 'Página'], ['impressions', 'Impressões'], ['clicks', 'Cliques'], ['ctr', 'CTR', p => `${p.ctr?.toFixed(2)}%`],
        ['position', 'Posição', p => p.position?.toFixed(1)], ['decline', 'Variação de cliques', p => p.decline == null ? '—' : `${p.decline.toFixed(1)}%`],
      ]} />
    {isAdmin && <>
      <form className="space-y-4 border-t border-line pt-5" onSubmit={e => { e.preventDefault(); act('content', content); }}>
        <h3 className="font-semibold">Preparar conteúdo para revisão</h3>
        <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs text-muted">Produto</span><select className={`${select} w-full max-w-full`} required value={content.productId} onChange={e => setContent(c => ({ ...c, productId: e.target.value }))}><option value="">Selecione o produto</option>{(data.products || []).filter(p => p.url).map(p => <option value={p.id} key={p.id}>{p.sku || p.id} · {p.name}</option>)}</select></label>
          <label><span className="mb-1 block text-xs text-muted">Destino</span><select className={select} value={content.kind} onChange={e => setContent(c => ({ ...c, kind: e.target.value }))}><option value="creative">Criativo / Content Hub</option><option value="seo">SEO</option></select></label>
          <label><span className="mb-1 block text-xs text-muted">Abordagem</span><select className={select} value={content.approach} onChange={e => setContent(c => ({ ...c, approach: e.target.value }))}>{['demonstração', 'comparação', 'objeções', 'recuperação', 'acessórios'].map(a => <option key={a}>{a}</option>)}</select></label></div>
        {content.kind === 'seo' ? <><label className="block"><span className="mb-1 block text-xs text-muted">Título SEO proposto</span><input className={`${input} w-full`} required maxLength={200} value={content.title} onChange={e => setContent(c => ({ ...c, title: e.target.value }))} /></label><label className="block"><span className="mb-1 block text-xs text-muted">Descrição SEO proposta</span><textarea className={`${input} min-h-28 w-full`} required maxLength={500} value={content.description} onChange={e => setContent(c => ({ ...c, description: e.target.value }))} /></label></> : <label className="block"><span className="mb-1 block text-xs text-muted">Texto proposto para revisão</span><textarea className={`${input} min-h-28 w-full`} maxLength={12000} value={content.copy} onChange={e => setContent(c => ({ ...c, copy: e.target.value }))} /></label>}
        <button type="submit" className={btnSecondarySm} disabled={busy}>Salvar briefing e proposta</button>
      </form>
    </>}
    <DataTable caption="Conteúdos e aprovações" rows={data.contents || []} empty="Nenhuma proposta preparada."
      columns={[
        ['kind', 'Tipo'], ['data', 'Produto / proposta', c => <><span className="font-medium">{c.data.sku} · {c.data.name}</span><p className="mt-2 whitespace-pre-wrap">{c.data.copy || 'Briefing sem texto proposto.'}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-muted">Briefing para Content Hub</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(c.data, null, 2)}</pre></details></>],
        ['status', 'Situação', c => stateLabel[c.status] || c.status],
        ['review', 'Revisão', c => isAdmin && c.status === 'draft' ? <div className="flex flex-wrap gap-2"><button type="button" className={btnSecondarySm} disabled={busy || !c.data.copy?.trim()} onClick={() => act(`content/${c.id}/review`, { status: 'approved' })}>Aprovar versão</button><button type="button" className={btnSecondarySm} disabled={busy} onClick={() => act(`content/${c.id}/review`, { status: 'rejected' })}>Rejeitar</button></div> : isAdmin && c.status === 'approved' && c.kind === 'seo' ? <button type="button" className={btnSecondarySm} disabled={busy} onClick={() => act(`content/${c.id}/publish-seo`)}>Publicar SEO aprovado</button> : date(c.reviewed_at)],
      ]} />
    {isAdmin && <form className="space-y-4 border-t border-line pt-5" onSubmit={e => { e.preventDefault(); act('campaign-plan', budget, 'put'); }}>
      <h3 className="font-semibold">Planejar campanhas pausadas</h3><p className="text-sm text-muted">Teto mensal em reais, com parcelas fixas. As estruturas ficam em rascunho para revisão das plataformas e das exclusões.</p>
      <div className="flex flex-wrap items-end gap-3">{[['total', 'Total mensal'], ['google', 'Parcela Google'], ['meta', 'Parcela Meta']].map(([key, label]) => <label key={key} className="min-w-0"><span className="mb-1 block text-xs text-muted">{label}</span><input className={`${input} w-40 max-w-full`} type="number" min="0.01" step="0.01" required value={budget[key]} onChange={e => setBudget(b => ({ ...b, [key]: e.target.value }))} /></label>)}<button type="submit" className={btnSecondarySm} disabled={busy}>Salvar planejamento</button></div>
      {data.campaign && <p className="text-sm">Planejamento salvo: {money(data.campaign.total)}/mês · Google {money(data.campaign.google)} · Meta {money(data.campaign.meta)} · Pausado · {data.campaign.remotelyCreated ? 'Criado nas plataformas' : 'Rascunho local'}</p>}
    </form>}
    {data.observedSpend && <p className="text-sm text-muted">Investimento observado ({data.observedSpend.from} a {data.observedSpend.to}): Google {money(data.observedSpend.google)} · Meta {money(data.observedSpend.meta)}. Ritmo equivalente em 30,4 dias: Google {money(data.observedSpend.google == null || !data.observedSpend.days ? null : data.observedSpend.google / data.observedSpend.days * 30.4)} · Meta {money(data.observedSpend.meta == null || !data.observedSpend.days ? null : data.observedSpend.meta / data.observedSpend.days * 30.4)}. Estimativa pela média da janela, incluindo dias parciais; a cobrança segue cada plataforma.</p>}
    {isAdmin && data.campaign && <div className="space-y-3 border-t border-line pt-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={exclusionsReviewed} onChange={e => setExclusionsReviewed(e.target.checked)} /><span>Revisei as exclusões de conteúdo, aplicativos e posicionamentos para estas novas estruturas.</span></label><button type="button" className={btnSecondarySm} disabled={busy || !exclusionsReviewed || !data.campaign.contentIds?.length} onClick={() => act('campaigns/stage', { exclusionsReviewed: true })}>Criar estruturas pausadas nas plataformas</button><p className="text-xs text-muted">A ativação exige grupos de recursos, arquivos, metas de compra, exclusões de compradores e catálogo elegível validados.</p></div>}
    {!!data.stagedCampaigns?.length && <DataTable caption="Estruturas criadas · aguardando recursos e revisão" rows={data.stagedCampaigns} empty="Nenhuma estrutura criada." columns={[
      ['platform', 'Plataforma'], ['id', 'Identificador'], ['status', 'Situação', r => r.status === 'PAUSED' ? 'Pausada' : r.status], ['monthlyPlannedBudget', 'Parcela planejada mensal', r => money(r.monthlyPlannedBudget)], ['observedAt', 'Verificado em', r => date(r.observedAt)],
    ]} />}
    <DataTable caption="Prontidão das integrações" rows={data.readiness || []} empty="Diagnóstico ainda indisponível."
      columns={[
        ['integration', 'Integração', r => name[r.integration] || r.integration], ['status', 'Situação', r => stateLabel[r.status] || r.status],
        ['account', 'Conta'], ['action', 'Próxima ação', r => <>{r.action}{r.link && <a href={r.link} target="_blank" rel="noreferrer" className="mt-2 block text-primary underline">Abrir configuração</a>}{r.lastError && <p className="mt-2 text-xs">Último erro: {r.lastError}</p>}</>],
      ]} />
    <details className="border-t border-line pt-3 text-xs text-muted"><summary className="cursor-pointer py-2 font-medium">Histórico, cobertura e critérios</summary><div className="space-y-4 py-3">
      <p>Fuso: America/Sao_Paulo. Dados do Google, Meta e Search Console permanecem separados. Feed recebido não comprova aprovação; preço e condições alterados exigem nova revisão de conteúdo. CRM e loja usam públicos separados. Campanhas existentes são preservadas.</p>
      <p>Compras de servidor: aguardando auditoria da origem atual e consentimento. Core Web Vitals e vínculo Search Console–GA4: ainda não verificados. Aprovação de texto não publica conteúdo nem ativa anúncios.</p>
      <DataTable caption="Trabalhos persistentes" rows={data.jobs || []} empty="Nenhum trabalho agendado." columns={[
        ['kind', 'Trabalho'], ['resource', 'Recurso'], ['status', 'Situação', r => stateLabel[r.status] || r.status], ['attempts', 'Tentativas'], ['error', 'Último erro'], ['next_run_at', 'Próxima execução', r => date(r.next_run_at)],
      ]} />
      <DataTable caption="Últimas execuções" rows={data.history || []} empty="Nenhuma execução concluída." columns={[
        ['kind', 'Trabalho'], ['resource', 'Recurso'], ['outcome', 'Resultado', r => stateLabel[r.outcome] || r.outcome], ['error', 'Erro'], ['created_at', 'Data', r => date(r.created_at)],
      ]} />
    </div></details>
  </section>;
}
