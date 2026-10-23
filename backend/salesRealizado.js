// Commercial result: company 100 stays in the reporting database; 102 comes
// exclusively from the published ERP snapshot. Never add the old 102 import.
async function hybridRealizado({ pool, legacyPool, year, month = null, bySeller = false }) {
  const config = (await pool.query('SELECT * FROM sankhya_reporting_connections WHERE company_id=102 AND enabled')).rows[0];
  if (!config?.feed_realizado) return null;
  const stream = (await pool.query("SELECT * FROM sankhya_reporting_streams WHERE company_id=102 AND resource='orders'")).rows[0];
  const sources = [
    { company: 100, source: 'reporting_database', basis: 'faturamento_produtos', available: Boolean(legacyPool) },
    { company: 102, source: 'sankhya_orders', basis: 'pedidos_confirmados_produtos', available: Boolean(stream?.last_success_at), last_success_at: stream?.last_success_at || null },
  ];
  const documents = [];
  if (legacyPool) {
    try {
      const { rows } = await legacyPool.query(`SELECT mes,coalesce(numero_unico::text,numero_nota::text) AS document_id,
          codigo_vendedor::text AS seller_code,coalesce(nullif(trim(descricao_vendedor),''),'Sem vendedor') AS seller,
          sum(valor_total_prod)::float AS value
        FROM vendas WHERE empresa=100 AND ano=$1 AND ($2::int IS NULL OR mes=$2)
          AND natureza_nf2='Venda' AND cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
        GROUP BY mes,numero_unico,numero_nota,codigo_vendedor,descricao_vendedor`, [year, month]);
      for (const row of rows) documents.push({ company: 100, id: row.document_id, month: Number(row.mes),
        sellerCode: row.seller_code, seller: row.seller, cents: Math.round(Number(row.value) * 100) });
    } catch { sources[0].available = false; sources[0].error = 'A base da empresa 100 está indisponível.'; }
  }
  let skipped = 0;
  if (stream?.last_success_at) {
    const { rows } = await pool.query(`SELECT d.data FROM sankhya_reporting_documents d
      JOIN sankhya_reporting_streams s ON s.company_id=d.company_id AND s.resource=d.resource AND s.published_generation=d.generation
      WHERE d.company_id=102 AND d.resource='orders' AND d.date>=make_date($1,1,1) AND d.date<make_date($1+1,1,1)
        AND ($2::int IS NULL OR extract(month FROM d.date)=$2)`, [year, month]);
    for (const { data: row } of rows) {
      const operation = String(row.operationName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!row.confirmed || row.pending || operation.includes('orcamento')) continue;
      const brl = row.currency === 'BRL' || (row.currencyCode === '0' && config.national_currency === 'BRL');
      if (!brl || row.productValue == null || !Number.isFinite(row.productValue)) { skipped++; continue; }
      documents.push({ company: 102, id: row.id, month: Number(row.date.slice(5, 7)), sellerCode: row.sellerCode,
        seller: row.sellerName || 'Sem vendedor', cents: Math.round(row.productValue * 100) });
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
  const metadata = { configured: sources.some(s => s.available), ano: year, source: 'hybrid_100_database_102_orders',
    scope: 'companies_100_102', basis: 'faturamento_100_pedidos_confirmados_102', sources,
    partial: sources.some(s => !s.available) || skipped > 0, excludedIncompleteDocuments: skipped };
  if (bySeller) return { ...metadata, ...(month ? { mes: month } : {}), vendedores: [...groups.values()]
    .map(group => ({ vendedor: group.vendedor, ...output(group) })).sort((a, b) => b.receita - a.receita) };
  if (month) return { ...metadata, mes: month, ...output(groups.get(month) || empty()) };
  return { ...metadata, meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ...output(groups.get(i + 1) || empty()) })) };
}
module.exports = { hybridRealizado };
