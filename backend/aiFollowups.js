// Follow-up automático com IA.
//
// Um lead que parou de responder há dias morre em silêncio: ninguém lembra de
// cutucar, e o CRM só acusa o problema quando a etapa já esfriou. Este módulo
// escreve o follow-up com o contexto real da conversa e posta na própria thread
// do Chatwoot, no mesmo número por onde o lead já falava.
//
// Ele envia SOZINHO, sem fila de aprovação — foi a decisão do produto. O que
// segura o risco são as regras abaixo, avaliadas antes de gastar token, e o
// AI_FOLLOWUP_DRY_RUN, que grava a mensagem sem mandar nada.
//
// As regras rodam da mais barata para a mais cara:
//   1. worker ligado + dentro da janela comercial
//   2. teto global por dia e por tick
//   3. etapa do funil elegível, opt-out
//   4. silêncio mínimo e "a última palavra foi nossa"
//   5. teto por contato e cooldown de campanha
//   6. (só aqui chama a IA) confiança e validação do texto

const { isBrazilBusinessDay } = require('./brazilBusinessDays');

const AI_FOLLOWUP_LOG_TABLE = 'ai_followup_log';
const TZ = 'America/Sao_Paulo';

const MENSAGEM_MAX_CHARS = 600;

// A IA não negocia: preço, prazo e desconto são do vendedor.
const TERMOS_PROIBIDOS = [
  /R\$\s*\d/i,
  /\bdescontos?\b/i,
  /\bpre[çc]o\s+especial\b/i,
  /\bcondi[çc][ãa]o\s+especial\b/i,
  /\bgarant(?:o|imos)\b/i,
  /\bprometo\b/i,
  /\bcontrato\s+assinad/i,
];

// Placeholder de template que escapou da personalização ({nome}, {empresa}, …).
const PLACEHOLDER = /\{[a-z_]+\}/i;

const flag = (nome, padrao = false) => {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(valor).trim().toLowerCase());
};

const inteiro = (nome, padrao) => {
  const valor = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(valor) ? valor : padrao;
};

const decimal = (nome, padrao) => {
  const valor = Number.parseFloat(process.env[nome] ?? '');
  return Number.isFinite(valor) ? valor : padrao;
};

const lista = (nome, padrao) => {
  const bruto = String(process.env[nome] || '').trim();
  if (!bruto) return padrao;
  return bruto.split(',').map((s) => s.trim()).filter(Boolean);
};

// Etapas onde um empurrão automático é seguro. Negociação, proposta enviada,
// descartado e fechado-perdido ficam de fora de propósito: ali quem fala é o vendedor.
const ETAPAS_PADRAO = [
  '3. Follow-up 1',
  '4. Follow-up 2',
  '5. Follow-up 3',
  '17. Nurturing',
];

const carregarConfig = () => {
  const [horaInicio, horaFim] = String(process.env.AI_FOLLOWUP_HOURS || '9-18')
    .split('-')
    .map((v) => Number.parseInt(v, 10));
  return {
    enabled: flag('AI_FOLLOWUP_ENABLED', false),
    dryRun: flag('AI_FOLLOWUP_DRY_RUN', true),
    etapas: lista('AI_FOLLOWUP_STAGES', ETAPAS_PADRAO),
    silencioDias: inteiro('AI_FOLLOWUP_SILENCE_DAYS', 3),
    maxPorContato: inteiro('AI_FOLLOWUP_MAX_PER_CONTACT', 2),
    maxPorDia: inteiro('AI_FOLLOWUP_MAX_PER_DAY', 20),
    maxPorTick: inteiro('AI_FOLLOWUP_MAX_PER_TICK', 3),
    cooldownDias: inteiro('AI_FOLLOWUP_COOLDOWN_DAYS', 5),
    minConfianca: decimal('AI_FOLLOWUP_MIN_CONFIDENCE', 0.6),
    horaInicio: Number.isFinite(horaInicio) ? horaInicio : 9,
    horaFim: Number.isFinite(horaFim) ? horaFim : 18,
    chatwootBaseUrl: String(process.env.CHATWOOT_BASE_URL || '').replace(/\/+$/, ''),
    chatwootToken: process.env.CHATWOOT_API_TOKEN || '',
  };
};

const createAiFollowupTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AI_FOLLOWUP_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT NOT NULL,
      conversation_id BIGINT,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'dry_run')),
      skip_reason TEXT,
      provider TEXT,
      model TEXT,
      confidence NUMERIC,
      message TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_followup_contact
      ON ${AI_FOLLOWUP_LOG_TABLE} (account_id, contact_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_followup_recent
      ON ${AI_FOLLOWUP_LOG_TABLE} (account_id, created_at DESC)
  `);
};

// Hora local de São Paulo sem depender do TZ do container (que varia no Swarm).
const horaEmSaoPaulo = (now = new Date()) => Number.parseInt(
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now),
  10
);

const dentroDaJanela = (config, now = new Date()) => {
  if (!isBrazilBusinessDay(now)) return false;
  const hora = horaEmSaoPaulo(now);
  return hora >= config.horaInicio && hora < config.horaFim;
};

// Candidatos: quem está numa etapa elegível, calado há N dias, com a última
// palavra nossa, sem opt-out, sem follow-up demais e sem campanha recente.
const buscarCandidatos = async (pool, { accountId, config, limite }) => {
  const { rows } = await pool.query(
    `
    WITH ultima_mensagem AS (
      SELECT DISTINCT ON (conv.contact_id)
             conv.contact_id,
             conv.id AS conversation_id,
             m.message_type,
             m.created_at
        FROM conversations conv
        JOIN messages m ON m.conversation_id = conv.id
       WHERE m.account_id = $1
         AND COALESCE(m."private", false) = false
         AND m.message_type IN (0, 1)
       ORDER BY conv.contact_id, m.created_at DESC, m.id DESC
    )
    SELECT c.id AS contact_id,
           c.name,
           c.phone_number,
           c.custom_attributes->>'Funil_Vendas' AS funil,
           c.additional_attributes->>'company_name' AS empresa,
           um.conversation_id,
           um.created_at AS ultima_em,
           COALESCE(ja.total, 0) AS followups_anteriores,
           conv.assignee_id
      FROM contacts c
      JOIN ultima_mensagem um ON um.contact_id = c.id
      JOIN conversations conv ON conv.id = um.conversation_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total
          FROM ${AI_FOLLOWUP_LOG_TABLE} l
         WHERE l.account_id = c.account_id
           AND l.contact_id = c.id
           AND l.status IN ('sent', 'dry_run')
      ) ja ON true
     WHERE c.account_id = $1
       AND COALESCE(c.phone_number, '') <> ''
       AND c.custom_attributes->>'Funil_Vendas' = ANY($2)
       -- a última palavra tem que ser nossa: se o contato falou por último, é
       -- atendimento vivo e quem responde é o vendedor, não a IA
       AND um.message_type = 1
       AND um.created_at <= NOW() - make_interval(days => $3)
       AND COALESCE(ja.total, 0) < $4
       -- não repete em cima de um follow-up recente
       AND NOT EXISTS (
         SELECT 1 FROM ${AI_FOLLOWUP_LOG_TABLE} r
          WHERE r.account_id = c.account_id AND r.contact_id = c.id
            AND r.created_at >= NOW() - make_interval(days => $5)
       )
       -- não colide com campanha de disparo: se saiu mensagem nossa depois da
       -- última registrada, alguém (ou o disparo) já falou com o lead
       AND NOT EXISTS (
         SELECT 1
           FROM messages m2
           JOIN conversations cv2 ON cv2.id = m2.conversation_id
          WHERE m2.account_id = c.account_id
            AND cv2.contact_id = c.id
            AND m2.message_type = 1
            AND m2.created_at >= NOW() - make_interval(days => $5)
            AND m2.created_at > um.created_at
       )
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'whatsapp_opt_out')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'opt_out')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'nao_contatar')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
     ORDER BY um.created_at ASC
     LIMIT $6
    `,
    [
      accountId,
      config.etapas,
      config.silencioDias,
      config.maxPorContato,
      config.cooldownDias,
      limite,
    ]
  );
  return rows;
};

const contarEnviadosHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM ${AI_FOLLOWUP_LOG_TABLE}
      WHERE account_id = $1
        AND status IN ('sent', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2`,
    [accountId, TZ]
  );
  return rows[0]?.total || 0;
};

// Histórico textual da conversa. É a primeira vez que o backend lê messages.content:
// todo o resto do app trabalha só com metadados (timestamps, message_type, sender).
const carregarContextoConversa = async (pool, { accountId, contactId, limite = 40 }) => {
  const { rows } = await pool.query(
    `SELECT m.content, m.message_type, m.created_at
       FROM messages m
       JOIN conversations conv ON conv.id = m.conversation_id
      WHERE conv.contact_id = $1
        AND m.account_id = $2
        AND COALESCE(m."private", false) = false
        AND m.message_type IN (0, 1)
        AND COALESCE(TRIM(m.content), '') <> ''
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3`,
    [contactId, accountId, limite]
  );
  return rows
    .reverse()
    .map((r) => ({
      autor: r.message_type === 0 ? 'cliente' : 'nós',
      texto: String(r.content).slice(0, 800),
      em: r.created_at,
    }));
};

const diasDesde = (data, now = new Date()) => {
  const t = new Date(data).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
};

const montarPrompt = ({ contato, historico, followupsAnteriores, diasSilencio }) => {
  const system = [
    'Você escreve mensagens curtas de follow-up comercial no WhatsApp, em nome da Aerion, empresa brasileira de tecnologia.',
    'Escreva em português do Brasil, tom profissional e direto, como um vendedor experiente — nunca como robô ou telemarketing.',
    'Regras que não se quebram:',
    '- No máximo 3 frases curtas.',
    '- Faça no máximo UMA pergunta, sempre fácil de responder.',
    '- Nunca cite preço, desconto, prazo de entrega ou condição comercial.',
    '- Nunca invente fato, número, reunião ou combinado que não esteja no histórico.',
    '- Nunca use placeholder entre chaves: escreva o nome real da pessoa.',
    '- No máximo um emoji, e só se o histórico já tiver tom informal.',
    '- Se o histórico não der contexto para uma mensagem útil, devolva confianca baixa.',
    '',
    'Responda SOMENTE com um objeto JSON:',
    '{"mensagem": "<texto pronto para enviar>", "confianca": <numero de 0 a 1>, "motivo": "<por que este follow-up faz sentido agora>"}',
  ].join('\n');

  const linhas = historico.length
    ? historico.map((h) => `[${h.autor}] ${h.texto}`).join('\n')
    : '(sem histórico textual)';

  const user = [
    `Contato: ${contato.name || 'sem nome'}`,
    contato.empresa ? `Empresa: ${contato.empresa}` : null,
    `Etapa do funil: ${contato.funil || 'não informada'}`,
    `Dias sem resposta: ${diasSilencio ?? 'desconhecido'}`,
    `Follow-ups automáticos já enviados a este contato: ${followupsAnteriores}`,
    '',
    'Histórico da conversa (mais antigo primeiro):',
    linhas,
    '',
    'Escreva o próximo follow-up.',
  ].filter(Boolean).join('\n');

  return { system, user };
};

// Última barreira antes de falar com o cliente.
const validarMensagem = (texto, confianca, config) => {
  const limpo = String(texto || '').trim();
  if (!limpo) return 'mensagem vazia';
  if (limpo.length > MENSAGEM_MAX_CHARS) return `mensagem longa demais (${limpo.length} chars)`;
  if (PLACEHOLDER.test(limpo)) return 'placeholder não resolvido na mensagem';
  if (TERMOS_PROIBIDOS.some((re) => re.test(limpo))) return 'mensagem toca em tema comercial proibido';
  // Number(null) é 0 — sem este teste, confiança ausente virava "abaixo do mínimo".
  if (confianca === null || confianca === undefined || confianca === '') return 'confiança ausente';
  if (!Number.isFinite(Number(confianca))) return 'confiança ausente';
  if (Number(confianca) < config.minConfianca) {
    return `confiança ${Number(confianca).toFixed(2)} abaixo do mínimo ${config.minConfianca}`;
  }
  return null;
};

// Postar direto em `messages` via SQL NÃO envia nada: quem despacha para o
// WhatsApp é o Rails do Chatwoot. Por isso o envio é pela API HTTP dele.
const enviarPeloChatwoot = async ({ config, accountId, conversationId, texto, fetchImpl = fetch }) => {
  if (!config.chatwootBaseUrl || !config.chatwootToken) {
    throw new Error('Chatwoot não configurado (CHATWOOT_BASE_URL / CHATWOOT_API_TOKEN).');
  }
  const url = `${config.chatwootBaseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: config.chatwootToken,
      },
      body: JSON.stringify({ content: texto, message_type: 'outgoing' }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      throw new Error(`Chatwoot HTTP ${resp.status}: ${String(corpo).slice(0, 200)}`);
    }
    return await resp.json().catch(() => null);
  } finally {
    clearTimeout(timer);
  }
};

const registrarDecisao = async (pool, dados) => {
  const { rows } = await pool.query(
    `INSERT INTO ${AI_FOLLOWUP_LOG_TABLE}
       (account_id, contact_id, conversation_id, attempt, status, skip_reason,
        provider, model, confidence, message, error, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      dados.accountId,
      dados.contactId,
      dados.conversationId ?? null,
      dados.attempt ?? 1,
      dados.status,
      dados.skipReason ?? null,
      dados.provider ?? null,
      dados.model ?? null,
      Number.isFinite(Number(dados.confidence)) ? Number(dados.confidence) : null,
      dados.message ?? null,
      dados.error ?? null,
      dados.status === 'sent' ? new Date() : null,
    ]
  );
  return rows[0]?.id ?? null;
};

// Um tick do worker. `deps` injeta o que vive no index.js (chatCompletionJson,
// notificação) e o fetch, para dar para testar sem rede e sem provider.
const runAiFollowupTick = async (pool, {
  accountId,
  chatCompletionJson,
  notify = null,
  fetchImpl = fetch,
  now = new Date(),
  config = carregarConfig(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };
  if (!dentroDaJanela(config, now)) return { skipped: 'fora da janela comercial' };

  const enviadosHoje = await contarEnviadosHoje(pool, accountId);
  const saldoDia = config.maxPorDia - enviadosHoje;
  if (saldoDia <= 0) return { skipped: 'teto diário atingido', enviadosHoje };

  const limite = Math.max(1, Math.min(config.maxPorTick, saldoDia));
  const candidatos = await buscarCandidatos(pool, { accountId, config, limite });
  const resultado = {
    avaliados: candidatos.length,
    enviados: 0,
    dry_run: 0,
    pulados: 0,
    falhas: 0,
  };

  for (const candidato of candidatos) {
    const base = {
      accountId,
      contactId: candidato.contact_id,
      conversationId: candidato.conversation_id,
      attempt: Number(candidato.followups_anteriores || 0) + 1,
    };
    try {
      const historico = await carregarContextoConversa(pool, {
        accountId,
        contactId: candidato.contact_id,
      });
      if (!historico.length) {
        await registrarDecisao(pool, { ...base, status: 'skipped', skipReason: 'sem histórico textual' });
        resultado.pulados += 1;
        continue;
      }

      const { system, user } = montarPrompt({
        contato: candidato,
        historico,
        followupsAnteriores: Number(candidato.followups_anteriores || 0),
        diasSilencio: diasDesde(candidato.ultima_em, now),
      });
      const ia = await chatCompletionJson({ system, user, maxTokens: 500, temperature: 0.4 });
      if (!ia.ok) {
        await registrarDecisao(pool, { ...base, status: 'failed', error: ia.error });
        resultado.falhas += 1;
        continue;
      }

      const texto = String(ia.data?.mensagem || '').trim();
      const confianca = ia.data?.confianca;
      const problema = validarMensagem(texto, confianca, config);
      if (problema) {
        await registrarDecisao(pool, {
          ...base,
          status: 'skipped',
          skipReason: problema,
          provider: ia.provider,
          model: ia.model,
          confidence: confianca,
          message: texto || null,
        });
        resultado.pulados += 1;
        if (notify) {
          await Promise.resolve(
            notify({ tipo: 'skipped', contato: candidato, motivo: problema, mensagem: texto })
          ).catch(() => {});
        }
        continue;
      }

      if (config.dryRun) {
        await registrarDecisao(pool, {
          ...base,
          status: 'dry_run',
          provider: ia.provider,
          model: ia.model,
          confidence: confianca,
          message: texto,
        });
        resultado.dry_run += 1;
        continue;
      }

      await enviarPeloChatwoot({
        config,
        accountId,
        conversationId: candidato.conversation_id,
        texto,
        fetchImpl,
      });
      await registrarDecisao(pool, {
        ...base,
        status: 'sent',
        provider: ia.provider,
        model: ia.model,
        confidence: confianca,
        message: texto,
      });
      resultado.enviados += 1;
      if (notify) {
        await Promise.resolve(
          notify({ tipo: 'sent', contato: candidato, mensagem: texto })
        ).catch(() => {});
      }
    } catch (error) {
      await registrarDecisao(pool, {
        ...base,
        status: 'failed',
        error: String(error.message || error),
      }).catch(() => {});
      resultado.falhas += 1;
    }
  }

  return resultado;
};

module.exports = {
  AI_FOLLOWUP_LOG_TABLE,
  MENSAGEM_MAX_CHARS,
  ETAPAS_PADRAO,
  carregarConfig,
  createAiFollowupTable,
  dentroDaJanela,
  horaEmSaoPaulo,
  buscarCandidatos,
  carregarContextoConversa,
  contarEnviadosHoje,
  montarPrompt,
  validarMensagem,
  enviarPeloChatwoot,
  registrarDecisao,
  runAiFollowupTick,
};
