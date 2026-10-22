const SEGMENTS = [
  { id: 'customers', label: 'Clientes e recompra', stages: '13, 18 e 23', use: 'Excluir da aquisição; avaliar recompra e acessórios' },
  { id: 'qualified', label: 'Qualificados e oportunidades', stages: '6 a 12', use: 'Remarketing comercial e referência de qualidade' },
  { id: 'early', label: 'Inbox e primeiros contatos', stages: '1 a 5', use: 'Qualificar antes de usar como referência de comprador' },
  { id: 'nurturing', label: 'Pausados e nutrição', stages: '15 e 17', use: 'Conteúdo de consideração, conforme o interesse' },
  { id: 'excluded', label: 'Perdidos e descartados', stages: '14 e 16', use: 'Separar das bases de compradores e qualificados' },
  { id: 'unclassified', label: 'Sem classificação comercial', stages: 'Outras ou sem etapa', use: 'Revisar o cadastro e a etapa antes de segmentar' },
];

async function crmAudiencePreview(pool, accountId) {
  // Aggregate inside PostgreSQL. No email, phone, contact ID or customer name
  // leaves this endpoint, and a preview never exports/uploads an audience.
  const { rows } = await pool.query(`
    WITH base AS (
      SELECT coalesce(nullif(trim(custom_attributes->>'Funil_Vendas'),''),'Sem etapa') AS stage,
             coalesce(nullif(trim(custom_attributes->>'Tipo_Cliente'),''),'Não informado') AS profile,
             lower(trim(email)) AS email,
             EXISTS (SELECT 1 FROM unnest(ARRAY['opt_out','nao_contatar','bloqueado']) AS flags(flag)
                       WHERE lower(coalesce(custom_attributes->>flag,'')) IN ('true','1','yes','sim')
                          OR lower(coalesce(additional_attributes->>flag,'')) IN ('true','1','yes','sim')) AS suppressed
      FROM contacts WHERE account_id=$1
    ), classified AS (
      SELECT *, CASE
        WHEN substring(stage from '^([0-9]+)')::int IN (13,18,23) THEN 'customers'
        WHEN substring(stage from '^([0-9]+)')::int BETWEEN 6 AND 12 THEN 'qualified'
        WHEN substring(stage from '^([0-9]+)')::int BETWEEN 1 AND 5 THEN 'early'
        WHEN substring(stage from '^([0-9]+)')::int IN (15,17) THEN 'nurturing'
        WHEN substring(stage from '^([0-9]+)')::int IN (14,16) THEN 'excluded'
        ELSE 'unclassified' END AS segment,
        coalesce(email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$',false) AS email_format
      FROM base
    )
    SELECT kind,name,count(*)::int AS contacts,
           count(*) FILTER (WHERE suppressed)::int AS suppressed,
           count(DISTINCT email) FILTER (WHERE email_format AND NOT suppressed)::int AS emails
    FROM classified CROSS JOIN LATERAL (VALUES ('segment',segment),('stage',stage),('profile',profile),('total','all')) AS labels(kind,name)
    GROUP BY kind,name`, [accountId]);
  const empty = { contacts: 0, suppressed: 0, emails: 0 };
  return { available: true, observedAt: new Date().toISOString(), uploaded: false,
    summary: rows.find(row => row.kind === 'total') || empty,
    segments: SEGMENTS.map(segment => ({ ...segment, ...(rows.find(row => row.kind === 'segment' && row.name === segment.id) || empty) })),
    stages: rows.filter(row => row.kind === 'stage').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
    profiles: rows.filter(row => row.kind === 'profile').sort((a, b) => b.contacts - a.contacts),
  };
}
module.exports = { crmAudiencePreview };
