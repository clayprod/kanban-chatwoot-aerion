// Each company has exactly one revenue source. An enabled ERP source never
// adds or silently falls back to that company's old reporting import.
function revenueSource(configs) {
  const automatic = company => configs.some(c => c.company_id === company && c.feed_realizado);
  if (automatic(100) && automatic(102)) return 'sankhya_100_102_invoices';
  if (automatic(100)) return 'hybrid_100_invoices_102_database';
  return automatic(102) ? 'hybrid_100_database_102_invoices' : 'existing_reporting_database';
}
async function hybridRealizado({ pool, legacyPool, year, month = null, bySeller = false }) {
  const configs = (await pool.query('SELECT * FROM sankhya_reporting_connections WHERE company_id IN (100,102) AND enabled')).rows;
  const source = revenueSource(configs);
  if (source === 'existing_reporting_database') return null;
  const streams = (await pool.query("SELECT * FROM sankhya_reporting_streams WHERE company_id IN (100,102) AND resource='invoices'")).rows;
  const sources = [];
  const documents = [];
  let skipped = 0;
  for (const company of [100, 102]) {
    const config = configs.find(c => c.company_id === company && c.feed_realizado);
    const stream = streams.find(s => s.company_id === company);
    const current = config
      ? { company, source: 'sankhya_invoices', basis: 'notas_autorizadas_produtos', available: Boolean(stream?.last_success_at), last_success_at: stream?.last_success_at || null }
      : { company, source: 'reporting_database', basis: 'faturamento_produtos', available: Boolean(legacyPool) };
    sources.push(current);
    if (!config && legacyPool) {
      try {
        const { rows } = await legacyPool.query(`SELECT mes,coalesce(numero_unico::text,numero_nota::text) AS document_id,
          codigo_vendedor::text AS seller_code,coalesce(nullif(trim(descricao_vendedor),''),'Sem vendedor') AS seller,
          sum(valor_total_prod)::float AS value
        FROM vendas WHERE empresa=$3 AND ano=$1 AND ($2::int IS NULL OR mes=$2)
          AND natureza_nf2='Venda' AND cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
        GROUP BY mes,numero_unico,numero_nota,codigo_vendedor,descricao_vendedor`, [year, month, company]);
        for (const row of rows) documents.push({ company, id: row.document_id, month: Number(row.mes),
          sellerCode: row.seller_code, seller: row.seller, cents: Math.round(Number(row.value) * 100) });
      } catch { current.available = false; current.error = `A base da empresa ${company} está indisponível.`; }
    }
    if (config && stream?.last_success_at) {
      const { rows } = await pool.query(`SELECT d.data FROM sankhya_reporting_documents d
      JOIN sankhya_reporting_streams s ON s.company_id=d.company_id AND s.resource=d.resource AND s.published_generation=d.generation
      WHERE d.company_id=$3 AND d.resource='invoices' AND d.date>=make_date($1,1,1) AND d.date<make_date($1+1,1,1)
        AND ($2::int IS NULL OR extract(month FROM d.date)=$2)`, [year, month, company]);
      for (const { data: row } of rows) {
        const operation = String(row.operationName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        // Confirmed/non-pending orders are not proof of invoicing.
        if (row.resource !== 'invoices' || !row.authorized || row.invoiceStatus !== '1' || operation.includes('orcamento')) continue;
        const brl = row.currency === 'BRL' || (row.currencyCode === '0' && config.national_currency === 'BRL');
        if (!brl || row.productValue == null || !Number.isFinite(row.productValue)) { skipped++; continue; }
        documents.push({ company, id: row.id, month: Number(row.date.slice(5, 7)), sellerCode: row.sellerCode,
          seller: row.sellerName || 'Sem vendedor', cents: Math.round(row.productValue * 100) });
      }
    }
  }
  const groups = new Map();
  const empty = () => ({ cents: 0, c100: 0, c102: 0, ids: new Set(), ids100: new Set(), ids102: new Set() });
  for (const row of documents) {
    const sellerKey = row.sellerCode && row.sellerCode !== '0' ? `code:${row.sellerCode}` : `name:${row.seller.toLowerCase()}`;
    const key = bySeller ? sellerKey : row.month;
    if (!groups.has(key)) groups.set(key, { ...empty(), vendedor: row.seller, mes: row.month });
    const group = groups.get(key), id = `${row.company}:${row.id}`;
    group.cents += row.cents; group[`c${row.company}`] += row.cents;
    group.ids.add(id); group[`ids${row.company}`].add(id);
  }
  const output = group => ({ receita: group.cents / 100, receita_100: group.c100 / 100, receita_102: group.c102 / 100,
    vendas: group.ids.size, vendas_100: group.ids100.size, vendas_102: group.ids102.size });
  const metadata = { configured: sources.some(s => s.available), ano: year, source,
    scope: 'companies_100_102', basis: 'faturamento_notas_autorizadas', sources,
    partial: sources.some(s => !s.available) || skipped > 0, excludedIncompleteDocuments: skipped };
  if (bySeller) return { ...metadata, ...(month ? { mes: month } : {}), vendedores: [...groups.values()]
    .map(group => ({ vendedor: group.vendedor, ...output(group) })).sort((a, b) => b.receita - a.receita) };
  if (month) return { ...metadata, mes: month, ...output(groups.get(month) || empty()) };
  return { ...metadata, meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ...output(groups.get(i + 1) || empty()) })) };
}
module.exports = { hybridRealizado, revenueSource };
