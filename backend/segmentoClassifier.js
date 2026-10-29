// Classificação diária do SEGMENTO do cliente em etiquetas do Chatwoot (contato e conversa).
//
// O Chatwoot já tem as etiquetas de segmento da Aerion (construcao_e_topografia,
// aerolevantamentos...). Medido em 2026-10-29: 1.869 de 3.868 contatos não tinham etiqueta
// nenhuma, então relatório e campanha por segmento enxergam só metade da base.
//
// Regras: só etiqueta quem NÃO tem etiqueta de segmento; nunca remove nem troca etiqueta
// existente; na dúvida não etiqueta (etiqueta errada contamina campanha). Roda 1x/dia.
const { sqlExcluiSistema } = require('./sistemaContatos');

const SEGMENT_LOG_TABLE = 'ai_segment_log';

// Segmentos que a IA pode atribuir (title das labels do Chatwoot). Etiquetas de
// origem/vendedor/campanha (comercial_aerion, ian_aerion, key_account, prospeccao-ia...)
// NÃO são segmento e nunca entram aqui.
const SEGMENTOS = {
  construcao_e_topografia: 'construtoras, incorporadoras, topografia, georreferenciamento, loteamentos, obras',
  aerolevantamentos: 'empresas de aerolevantamento, mapeamento, fotogrametria, LiDAR, geoprocessamento',
  inspecao_industrial_e_energia: 'inspeção industrial, energia, linhas de transmissão, solar, mineração, óleo e gás',
  agricultura: 'agro, fazendas, agricultura de precisão, pulverização, cooperativas',
  seguranca_publica_e_defesa_civil: 'polícia, bombeiros, defesa civil, guardas municipais, órgãos públicos de segurança',
  'segurança_privada': 'empresas de segurança privada, vigilância, monitoramento patrimonial',
  resgate_e_emergencias: 'resgate, salvamento, emergências, APH, busca e salvamento',
  revenda_dji: 'revendedores/lojistas de drones e eletrônicos que revendem DJI ou concorrentes',
  'informática': 'empresas de TI, informática, integradores, telecom',
  consumer: 'pessoa física, hobby, uso pessoal, fotografia amadora',
};

const flag = (nome, padrao = false) => {
  const v = process.env[nome];
  if (v === undefined || v === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).trim().toLowerCase());
};
const inteiro = (nome, padrao) => {
  const v = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(v) ? v : padrao;
};

// Defaults no código SÃO os de produção; perder env nunca liga escrita sozinho.
const carregarConfigSegmento = () => ({
  enabled: flag('AI_SEGMENT_ENABLED', false),
  dryRun: flag('AI_SEGMENT_DRY_RUN', true),
  maxPorDia: inteiro('AI_SEGMENT_MAX_PER_DAY', 40),
  maxPorTick: inteiro('AI_SEGMENT_MAX_PER_TICK', 10),
  minConfianca: Number.parseFloat(process.env.AI_SEGMENT_MIN_CONFIDENCE ?? '') || 0.8,
  conversasPorContato: inteiro('AI_SEGMENT_CONVERSATIONS_PER_CONTACT', 5),
  reavaliarDias: inteiro('AI_SEGMENT_RETRY_DAYS', 30),
});

const createSegmentLogTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SEGMENT_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT NOT NULL,
      segmento TEXT,
      confidence NUMERIC,
      motivo TEXT,
      status TEXT NOT NULL,
      skip_reason TEXT,
      provider TEXT,
      model TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${SEGMENT_LOG_TABLE}_contact ON ${SEGMENT_LOG_TABLE} (account_id, contact_id, created_at DESC)`
  );
};

const registrarSegmento = (pool, d) => pool.query(
  `INSERT INTO ${SEGMENT_LOG_TABLE}
     (account_id, contact_id, segmento, confidence, motivo, status, skip_reason, provider, model, error)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [d.accountId, d.contactId, d.segmento ?? null, Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : null,
    d.motivo ?? null, d.status, d.skipReason ?? null, d.provider ?? null, d.model ?? null, d.error ?? null]
);

// Contatos com conversa, sem NENHUMA etiqueta de segmento, ainda não avaliados na janela.
// Os mais recentes primeiro: quem conversou agora rende mais para campanha.
const buscarCandidatosSegmento = async (pool, { accountId, config, limite }) => {
  const { rows } = await pool.query(
    `
    SELECT c.id AS contact_id, c.name, c.additional_attributes->>'company_name' AS empresa,
           c.custom_attributes AS atributos, MAX(cv.last_activity_at) AS ultima
      FROM contacts c
      JOIN conversations cv ON cv.contact_id = c.id AND cv.account_id = $1
     WHERE c.account_id = $1
       ${sqlExcluiSistema('c')}
       AND NOT EXISTS (
         SELECT 1 FROM taggings g JOIN tags t ON t.id = g.tag_id
          WHERE g.taggable_type = 'Contact' AND g.taggable_id = c.id
            AND g.context = 'labels' AND t.name = ANY($2::text[])
       )
       AND NOT EXISTS (
         SELECT 1 FROM ${SEGMENT_LOG_TABLE} l
          WHERE l.account_id = $1 AND l.contact_id = c.id
            AND l.created_at >= NOW() - make_interval(days => $3)
       )
     GROUP BY c.id
     ORDER BY MAX(cv.last_activity_at) DESC NULLS LAST
     LIMIT $4
    `,
    [accountId, Object.keys(SEGMENTOS), config.reavaliarDias, limite]
  );
  return rows;
};

const contarHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${SEGMENT_LOG_TABLE}
      WHERE account_id = $1 AND status IN ('applied', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
    [accountId]
  );
  return rows[0]?.total || 0;
};

const montarPromptSegmento = ({ contato, historico }) => {
  const system = [
    'Você classifica o SEGMENTO de atuação de um cliente da Aerion (distribuidora de drones Autel no Brasil).',
    'Escolha UM segmento da lista, exatamente como escrito, ou "nenhum" se não der para saber.',
    'Segmentos:',
    ...Object.entries(SEGMENTOS).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'Julgue pelo que a EMPRESA faz (nome, empresa, conversa), não pelo produto que ela perguntou.',
    'Etiqueta errada contamina campanha: se não houver indício claro, responda "nenhum".',
    'Mensagens automáticas de boas-vindas/menu não dizem o que a empresa faz.',
    '',
    'Responda SOMENTE JSON: {"segmento": "<chave>|nenhum", "confianca": <0 a 1>, "motivo": "<indício em uma frase>"}',
  ].join('\n');
  const linhas = historico.length
    ? historico.slice(-20).map((h) => `[${h.autor}] ${h.texto}`).join('\n')
    : '(sem histórico textual)';
  const user = [
    `Contato: ${contato.name || 'sem nome'}`,
    contato.empresa ? `Empresa: ${contato.empresa}` : null,
    contato.atributos?.CNAE || contato.atributos?.cnae ? `CNAE: ${contato.atributos.CNAE || contato.atributos.cnae}` : null,
    '', 'Conversa:', linhas, '', 'Qual o segmento?',
  ].filter((x) => x !== null).join('\n');
  return { system, user };
};

const avaliarSegmento = ({ segmento, confianca, config }) => {
  const s = String(segmento || '').trim();
  if (!s || s === 'nenhum') return { acao: 'skipped', motivo: 'sem indício de segmento' };
  if (!Object.hasOwn(SEGMENTOS, s)) return { acao: 'skipped', motivo: `segmento inexistente: ${s}` };
  const c = Number(confianca);
  if (!Number.isFinite(c) || c < config.minConfianca) {
    return { acao: 'skipped', motivo: `confiança ${confianca} abaixo de ${config.minConfianca}` };
  }
  return { acao: 'applied' };
};

// Etiquetas atuais (SQL) para mesclar: a API do Chatwoot SUBSTITUI a lista inteira.
const etiquetasAtuais = async (pool, tipo, id) => {
  const { rows } = await pool.query(
    `SELECT t.name FROM taggings g JOIN tags t ON t.id = g.tag_id
      WHERE g.taggable_type = $1 AND g.taggable_id = $2 AND g.context = 'labels'`,
    [tipo, id]
  );
  return rows.map((r) => r.name);
};

const conversasDoContato = async (pool, { accountId, contactId, limite }) => {
  const { rows } = await pool.query(
    `SELECT id FROM conversations WHERE account_id = $1 AND contact_id = $2
      ORDER BY last_activity_at DESC NULLS LAST LIMIT $3`,
    [accountId, contactId, limite]
  );
  return rows.map((r) => r.id);
};

const runSegmentClassificationTick = async (pool, {
  accountId,
  chatCompletionJson,
  carregarContextoConversa,
  aplicarEtiquetas,        // async ({ tipo: 'contacts'|'conversations', id, labels }) => void  (labels = lista FINAL)
  config = carregarConfigSegmento(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };
  const hoje = await contarHoje(pool, accountId);
  const saldo = config.maxPorDia - hoje;
  if (saldo <= 0) return { skipped: 'teto diário atingido', hoje };

  const limite = Math.max(1, Math.min(config.maxPorTick, saldo));
  const candidatos = await buscarCandidatosSegmento(pool, { accountId, config, limite });
  const r = { avaliados: candidatos.length, etiquetados: 0, pulados: 0, falhas: 0 };

  for (const cand of candidatos) {
    const base = { accountId, contactId: cand.contact_id };
    try {
      const historico = await carregarContextoConversa(pool, { accountId, contactId: cand.contact_id });
      const { system, user } = montarPromptSegmento({ contato: cand, historico });
      const ia = await chatCompletionJson({ system, user, maxTokens: 200, temperature: 0.1 });
      if (!ia.ok) {
        await registrarSegmento(pool, { ...base, status: 'failed', error: ia.error });
        r.falhas += 1;
        continue;
      }
      const segmento = String(ia.data?.segmento || '').trim();
      const comum = {
        ...base, segmento, confidence: ia.data?.confianca,
        motivo: String(ia.data?.motivo || '').slice(0, 300), provider: ia.provider, model: ia.model,
      };
      const v = avaliarSegmento({ segmento, confianca: ia.data?.confianca, config });
      if (v.acao === 'skipped') {
        await registrarSegmento(pool, { ...comum, status: 'skipped', skipReason: v.motivo });
        r.pulados += 1;
        continue;
      }
      if (config.dryRun) {
        await registrarSegmento(pool, { ...comum, status: 'dry_run' });
        r.etiquetados += 1;
        continue;
      }
      // Contato e conversas recebem a etiqueta MESCLADA com o que já têm.
      const alvos = [{ tipo: 'contacts', id: cand.contact_id, modelo: 'Contact' }];
      for (const id of await conversasDoContato(pool, { accountId, contactId: cand.contact_id, limite: config.conversasPorContato })) {
        alvos.push({ tipo: 'conversations', id, modelo: 'Conversation' });
      }
      for (const a of alvos) {
        const atuais = await etiquetasAtuais(pool, a.modelo, a.id);
        if (atuais.some((n) => Object.hasOwn(SEGMENTOS, n))) continue; // já tem segmento: não toca
        await aplicarEtiquetas({ tipo: a.tipo, id: a.id, labels: [...new Set([...atuais, segmento])] });
      }
      await registrarSegmento(pool, { ...comum, status: 'applied' });
      r.etiquetados += 1;
    } catch (error) {
      await registrarSegmento(pool, { ...base, status: 'failed', error: String(error.message || error) }).catch(() => {});
      r.falhas += 1;
    }
  }
  return r;
};

module.exports = {
  SEGMENT_LOG_TABLE,
  SEGMENTOS,
  carregarConfigSegmento,
  createSegmentLogTable,
  buscarCandidatosSegmento,
  montarPromptSegmento,
  avaliarSegmento,
  runSegmentClassificationTick,
};
