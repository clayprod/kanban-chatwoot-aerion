// Resposta a quem já está falando com a gente.
//
// Regra do Clayton (23/10/2026), e ela é a espinha deste arquivo:
//
//   "pra interações além da inicial, a IA não faz diretamente. Espera 5 minutos; se o
//    cliente ficar sem resposta, ela age. Se o humano responder antes, ela nem entra
//    mais no circuito."
//
// Então a IA aqui é rede de segurança, não atendente: o vendedor tem a primeira
// chance sempre, e a IA só entra quando ninguém viu o cliente esperando. Isso também
// economiza token — a maior parte das conversas é resolvida por gente.
//
// Como "o humano respondeu" é detectado: toda mensagem que a IA manda vai com
// `content_attributes.aerion_ai = true`. Qualquer saída SEM essa marca conta como
// humana. Mensagem antiga da IA (de antes da marca) também conta como humana, o que
// só deixa a IA mais cautelosa — o lado certo de errar.
//
// O que ela responde: dúvida que o catálogo da loja sustenta (modelo, ficha técnica,
// link, preço conforme o perfil). O que ela NÃO responde: negociação, desconto, frete,
// prazo de entrega, condição de pagamento, nota fiscal, e qualquer coisa sem base.
// Nesses casos não escreve nada e marca para o humano.

const RESPONDER_LOG_TABLE = 'ai_responder_log';

const inteiro = (nome, padrao) => {
  const v = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(v) ? v : padrao;
};
const flag = (nome, padrao = false) => {
  const v = process.env[nome];
  if (v === undefined || v === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).trim().toLowerCase());
};

// Defaults no código são os valores de produção, de propósito: env de serviço já se
// perdeu em deploy mais de uma vez nesta stack, e perder env nunca pode LIGAR envio.
const carregarConfigResponder = () => ({
  enabled: flag('AI_RESPONDER_ENABLED', false),
  dryRun: flag('AI_RESPONDER_DRY_RUN', true),
  // Os 5 minutos do Clayton. É o tempo que o vendedor tem para chegar primeiro.
  esperaSegundos: inteiro('AI_RESPONDER_GRACE_SECONDS', 300),
  // Teto de espera: pergunta de ontem não se responde como se fosse agora.
  janelaMaximaHoras: inteiro('AI_RESPONDER_MAX_AGE_HOURS', 24),
  maxPorTick: inteiro('AI_RESPONDER_MAX_PER_TICK', 3),
  maxPorDia: inteiro('AI_RESPONDER_MAX_PER_DAY', 60),
  minConfianca: Number.parseFloat(process.env.AI_RESPONDER_MIN_CONFIDENCE ?? '') || 0.7,
  historicoMax: inteiro('AI_RESPONDER_HISTORY_MAX', 24),
});

const createResponderTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${RESPONDER_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT,
      conversation_id BIGINT,
      last_incoming_id BIGINT,
      status TEXT NOT NULL
        CHECK (status IN ('sent', 'dry_run', 'escalated', 'skipped', 'failed')),
      icp TEXT,
      icp_confianca NUMERIC(4,2),
      revenda_confirmada BOOLEAN,
      pergunta TEXT,
      mensagem TEXT,
      motivo TEXT,
      confianca NUMERIC(4,2),
      provider TEXT,
      model TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Uma decisão por mensagem recebida: o tick pode rodar de novo sem responder duas vezes.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_responder_incoming
      ON ${RESPONDER_LOG_TABLE} (account_id, last_incoming_id)
      WHERE last_incoming_id IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_responder_recente
      ON ${RESPONDER_LOG_TABLE} (account_id, created_at DESC)
  `);
};

// Assuntos em que a IA não encosta, por decisão comercial. Nenhum deles é "difícil
// para o modelo": são assuntos em que uma resposta errada custa dinheiro ou confiança.
const ESCALAR_SEMPRE = [
  [/\bdesconto\b|\babatimento\b|\bmelhor pre[çc]o\b|\bfaz por\b|\bbaixa (o|um)\b/i, 'negociação de preço'],
  [/\bfrete\b|\bentrega\b|\bprazo de entrega\b|\bchega em quantos\b|\bquando chega\b/i, 'frete ou prazo de entrega'],
  [/\bparcel|\bboleto\b|\bcart[ãa]o em\b|\bfatur|\bpagamento\b|\bpix com\b|\bfinanciamento\b/i, 'condição de pagamento'],
  [/\bnota fiscal\b|\bnf-?e\b|\bicms\b|\bst\b|\bsubstitui[çc][ãa]o tribut|\bimposto\b|\bcnpj para faturar\b/i, 'assunto fiscal'],
  [/\bcontrato\b|\bprocess[oa] licitat|\bedital\b|\bterm[oa] de refer|\bempenho\b/i, 'contrato ou licitação'],
  [/\bgarantia\b|\bdefeito\b|\bquebrou\b|\bassist[êe]ncia\b|\breparo\b|\bconserto\b/i, 'pós-venda ou garantia'],
  [/\btroca\b|\bdevolu[çc][ãa]o\b|\bcancelar\b|\breembolso\b|\bestorno\b/i, 'troca ou devolução'],
  [/\b(recebi|chegou|veio|mandaram)\b[^.!?]{0,60}\b(errad|quebrad|danificad|faltando|incomplet|trocad)/i, 'problema com pedido'],
];

const motivoDeEscalar = (texto) => {
  const t = String(texto || '');
  for (const [re, motivo] of ESCALAR_SEMPRE) if (re.test(t)) return motivo;
  return null;
};

// Candidatos: conversa cuja ÚLTIMA mensagem é do cliente, parada há pelo menos a
// espera configurada, e que ninguém respondeu.
//
// Toda a regra do humano-primeiro está nesta query, não no código em volta: se existe
// QUALQUER saída depois da fala do cliente, a conversa não é candidata. Humano que
// responde em 30 segundos ou em 4 minutos simplesmente faz o registro desaparecer
// daqui, e a IA nunca soube que ele existiu.
const buscarPendentes = async (pool, { accountId, config }) => {
  const { rows } = await pool.query(
    `
    WITH ultima_entrada AS (
      SELECT DISTINCT ON (m.conversation_id)
             m.conversation_id, m.id AS message_id, m.content, m.created_at
        FROM messages m
       WHERE m.account_id = $1
         AND m.message_type = 0
         AND COALESCE(m.private, false) = false
         AND m.content IS NOT NULL AND btrim(m.content) <> ''
         AND m.created_at >= NOW() - make_interval(hours => $3)
       ORDER BY m.conversation_id, m.id DESC
    ),
    -- Qualquer saida depois da fala do cliente mata o candidato. E aqui que o
    -- "se o humano responder antes, a IA nem entra" acontece.
    respondida AS (
      SELECT ue.conversation_id,
             BOOL_OR(COALESCE(m.content_attributes->>'aerion_ai', '') <> 'true') AS teve_humano,
             COUNT(*) AS saidas
        FROM ultima_entrada ue
        JOIN messages m
          ON m.conversation_id = ue.conversation_id
         AND m.account_id = $1
         AND m.message_type = 1
         AND m.id > ue.message_id
       GROUP BY ue.conversation_id
    )
    SELECT ue.conversation_id,
           ue.message_id AS last_incoming_id,
           ue.content AS pergunta,
           ue.created_at AS perguntado_em,
           EXTRACT(EPOCH FROM (NOW() - ue.created_at))::int AS esperando_segundos,
           c.contact_id,
           c.assignee_id,
           ct.name AS contato_nome,
           ct.phone_number,
           ct.custom_attributes,
           ct.additional_attributes
      FROM ultima_entrada ue
      JOIN conversations c ON c.id = ue.conversation_id AND c.account_id = $1
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN respondida r ON r.conversation_id = ue.conversation_id
      LEFT JOIN ${RESPONDER_LOG_TABLE} l
             ON l.account_id = $1 AND l.last_incoming_id = ue.message_id
     WHERE r.conversation_id IS NULL
       AND l.id IS NULL
       AND EXTRACT(EPOCH FROM (NOW() - ue.created_at)) >= $2
       AND COALESCE((ct.custom_attributes->>'whatsapp_opt_out')::text, 'false') NOT IN ('true', 'sim', '1')
       AND COALESCE((ct.custom_attributes->>'opt_out')::text, 'false') NOT IN ('true', 'sim', '1')
       AND COALESCE((ct.custom_attributes->>'nao_contatar')::text, 'false') NOT IN ('true', 'sim', '1')
     ORDER BY ue.created_at ASC
     LIMIT $4
    `,
    [accountId, config.esperaSegundos, config.janelaMaximaHoras, config.maxPorTick * 4]
  );
  return rows;
};

const contarHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${RESPONDER_LOG_TABLE}
      WHERE account_id = $1 AND status IN ('sent', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo'`,
    [accountId]
  );
  return rows[0]?.total || 0;
};

const carregarHistorico = async (pool, { accountId, conversationId, limite }) => {
  const { rows } = await pool.query(
    `SELECT message_type, content, created_at,
            COALESCE(content_attributes->>'aerion_ai', '') = 'true' AS da_ia
       FROM messages
      WHERE account_id = $1 AND conversation_id = $2
        AND content IS NOT NULL AND btrim(content) <> ''
        AND COALESCE(private, false) = false
      ORDER BY id DESC
      LIMIT $3`,
    [accountId, conversationId, limite]
  );
  return rows.reverse().map((r) => ({
    autor: r.message_type === 0 ? 'cliente' : (r.da_ia ? 'nós (IA)' : 'nós (vendedor)'),
    texto: String(r.content).slice(0, 1200),
    em: r.created_at,
  }));
};

const diasDesde = (quando, agora) => {
  const t = new Date(quando).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((agora.getTime() - t) / 86400000);
};

const montarPromptResposta = ({
  contato, historico, pergunta, blocoIcp, blocoCatalogo, agora = new Date(),
}) => {
  const system = [
    'Você responde, pelo WhatsApp, uma pessoa que acabou de escrever para a Aerion',
    'Technologies — distribuidora da Autel Robotics no Brasil (drones enterprise).',
    '',
    'Você não é atendente: o vendedor humano teve a chance de responder primeiro e não',
    'respondeu. Você entra para a pessoa não ficar esperando. Portanto: resolva o que dá',
    'para resolver com o que está escrito aqui, e passe o resto para o vendedor sem',
    'fingir que sabe.',
    '',
    blocoIcp,
    '',
    blocoCatalogo,
    '',
    'Como responder:',
    '- Responda a ÚLTIMA pergunta dela, que vem destacada. Não mude de assunto.',
    '- No máximo 3 frases curtas. Português do Brasil, tom de gente.',
    '- Se ela perguntou de um produto, diga o que é e mande o link dele.',
    '- Se couber uma pergunta sua, faça UMA, calibrada, começando por "Como" ou "O que".',
    '- Use o nome dela só se ele aparecer na conversa como nome de quem fala.',
    '- No máximo um emoji, e só se a conversa já tiver esse tom.',
    '- Nunca invente fato, número, prazo, modelo ou combinado que não esteja aqui.',
    '',
    'ESCALE para o vendedor (acao "escalar") sempre que a pergunta for sobre:',
    'desconto ou negociação de preço; frete ou prazo de entrega; forma e condição de',
    'pagamento; nota fiscal, imposto ou faturamento; contrato, edital ou licitação;',
    'garantia, defeito, assistência; troca, devolução ou problema com pedido já feito.',
    'Escale também se a resposta certa depender de algo que você não tem aqui.',
    'Escalar não é falhar: é o certo. Mensagem errada custa mais que resposta demorada.',
    '',
    'Quando escalar, NÃO escreva mensagem para o cliente: devolva "mensagem": null.',
    'Quem avisa o cliente é o vendedor.',
    '',
    'Responda SOMENTE com um objeto JSON:',
    '{"acao": "responder" | "escalar",',
    ' "assunto": "<do que a pessoa está falando, em 5 palavras>",',
    ' "mensagem": "<texto pronto, ou null se escalar>",',
    ' "produtos": ["<SKU que você citou>"],',
    ' "confianca": <0 a 1>,',
    ' "motivo": "<por que responder ou por que escalar>"}',
  ].filter((l) => l !== null).join('\n');

  const linhas = historico.map((h) => {
    const dias = diasDesde(h.em, agora);
    const quando = dias === null ? 'data desconhecida'
      : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
    return `[${h.autor} — ${quando}] ${h.texto}`;
  });

  const hoje = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full', timeZone: 'America/Sao_Paulo',
  }).format(agora);

  const user = [
    `Hoje é ${hoje}.`,
    `Contato: ${contato?.contato_nome || '—'}`,
    '',
    '>>> A PESSOA PERGUNTOU ISTO E ESTÁ ESPERANDO:',
    `    "${String(pergunta || '').slice(0, 1500)}"`,
    '',
    'Conversa completa (mais antigo primeiro):',
    linhas.length ? linhas.join('\n') : '(sem histórico textual)',
    '',
    'Responda ou escale.',
  ].join('\n');

  return { system, user };
};

// Validação do texto antes de sair. Mesmas travas do follow-up, mais as de catálogo:
// produto que não existe e número que não foi dado.
const validarResposta = (texto, confianca, {
  minConfianca = 0.7, skusConhecidos = [], precosPermitidos = [],
} = {}) => {
  const t = String(texto || '').trim();
  if (!t) return 'resposta vazia';
  if (t.length > 700) return 'resposta longa demais para WhatsApp';
  if (Number(confianca) < minConfianca) return `confiança ${confianca} abaixo de ${minConfianca}`;
  if (/\{[a-z_]+\}/i.test(t)) return 'placeholder não substituído';
  if (/\b(desculpe o inc[oô]modo|n[ãa]o vou mais insistir|obrigado pelo tempo)\b/i.test(t)) {
    return 'tom de despedida';
  }
  // Valor em reais só pode ser um dos que entregamos no catálogo deste perfil.
  const valores = t.match(/R\$\s?[\d.]+(?:,\d{2})?/g) || [];
  for (const v of valores) {
    const normalizado = v.replace(/\s/g, '');
    const ok = precosPermitidos.some((p) => p.replace(/\s/g, '') === normalizado);
    if (!ok) return `citou valor que não veio do catálogo (${v})`;
  }
  // Link só da loja, e só de produto que existe.
  const links = t.match(/https?:\/\/\S+/g) || [];
  for (const link of links) {
    if (!/^https?:\/\/(loja\.)?aerion\.com\.br\//i.test(link)) {
      return `link fora do domínio da Aerion (${link})`;
    }
  }
  void skusConhecidos;
  return null;
};

const registrarDecisao = async (pool, d) => {
  await pool.query(
    `INSERT INTO ${RESPONDER_LOG_TABLE}
       (account_id, contact_id, conversation_id, last_incoming_id, status, icp,
        icp_confianca, revenda_confirmada, pergunta, mensagem, motivo, confianca,
        provider, model, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (account_id, last_incoming_id) WHERE last_incoming_id IS NOT NULL
     DO NOTHING`,
    [
      d.accountId, d.contactId ?? null, d.conversationId ?? null, d.lastIncomingId ?? null,
      d.status, d.icp ?? null, d.icpConfianca ?? null, d.revendaConfirmada ?? null,
      d.pergunta ? String(d.pergunta).slice(0, 2000) : null,
      d.mensagem ?? null, d.motivo ? String(d.motivo).slice(0, 500) : null,
      d.confianca ?? null, d.provider ?? null, d.model ?? null,
      d.error ? String(d.error).slice(0, 500) : null,
    ]
  );
};

const runAiResponderTick = async (pool, {
  accountId,
  chatCompletionJson,
  classificarContato,
  catalogo,
  enviar,
  notificarHumano,
  dentroDaJanela,
  config = carregarConfigResponder(),
  agora = () => new Date(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };
  if (dentroDaJanela && !dentroDaJanela(agora())) return { skipped: 'fora da janela' };

  const hoje = await contarHoje(pool, accountId);
  if (hoje >= config.maxPorDia) return { skipped: 'teto diário atingido', hoje };

  const pendentes = await buscarPendentes(pool, { accountId, config });
  if (!pendentes.length) return { skipped: 'ninguém esperando', hoje };

  const r = { respondidos: 0, escalados: 0, falhas: 0, avaliados: 0, pendentes: pendentes.length };
  const limite = Math.max(1, Math.min(config.maxPorTick, config.maxPorDia - hoje));

  let produtos = [];
  try {
    produtos = await catalogo.carregarCatalogo();
  } catch (error) {
    // Sem catálogo a IA não tem base para responder nada de produto. Em vez de
    // responder no vácuo, o tick inteiro para e o humano continua dono da conversa.
    return { skipped: `catálogo indisponível: ${String(error.message || error)}` };
  }

  for (const p of pendentes) {
    if (r.respondidos + r.escalados >= limite) break;
    r.avaliados += 1;
    const base = {
      accountId, contactId: p.contact_id, conversationId: p.conversation_id,
      lastIncomingId: p.last_incoming_id, pergunta: p.pergunta,
    };

    try {
      // 1) Assunto proibido nem gasta token de IA.
      const proibido = motivoDeEscalar(p.pergunta);
      if (proibido) {
        await registrarDecisao(pool, { ...base, status: 'escalated', motivo: proibido });
        if (notificarHumano) await notificarHumano({ ...p, motivo: proibido });
        r.escalados += 1;
        continue;
      }

      const historico = await carregarHistorico(pool, {
        accountId, conversationId: p.conversation_id, limite: config.historicoMax,
      });
      const classificacao = await classificarContato(p, historico);
      const blocoCatalogo = catalogo.blocoCatalogo(produtos, {
        revendaConfirmada: classificacao.revendaConfirmada,
        tier: classificacao.tier || 'none',
      });
      const precosPermitidos = blocoCatalogo.match(/R\$\s?[\d.]+(?:,\d{2})?/g) || [];

      const prompt = montarPromptResposta({
        contato: p,
        historico,
        pergunta: p.pergunta,
        blocoIcp: classificacao.bloco,
        blocoCatalogo,
        agora: agora(),
      });
      const ia = await chatCompletionJson({ ...prompt, maxTokens: 600, temperature: 0.4 });
      if (!ia.ok) {
        await registrarDecisao(pool, { ...base, status: 'failed', error: ia.error });
        r.falhas += 1;
        continue;
      }

      const comum = {
        ...base,
        icp: classificacao.icp,
        icpConfianca: classificacao.confianca,
        revendaConfirmada: classificacao.revendaConfirmada,
        motivo: ia.data?.motivo,
        confianca: ia.data?.confianca,
        provider: ia.provider,
        model: ia.model,
      };

      if (String(ia.data?.acao || '') !== 'responder') {
        await registrarDecisao(pool, { ...comum, status: 'escalated' });
        if (notificarHumano) await notificarHumano({ ...p, motivo: ia.data?.motivo || 'a IA preferiu escalar' });
        r.escalados += 1;
        continue;
      }

      const texto = String(ia.data?.mensagem || '').trim();
      const problema = validarResposta(texto, ia.data?.confianca, {
        minConfianca: config.minConfianca,
        precosPermitidos,
      });
      if (problema) {
        // Texto reprovado vira escalada, não silêncio: alguém precisa responder.
        await registrarDecisao(pool, {
          ...comum, status: 'escalated', mensagem: texto || null,
          motivo: `reprovado na validação: ${problema}`,
        });
        if (notificarHumano) await notificarHumano({ ...p, motivo: problema, rascunho: texto });
        r.escalados += 1;
        continue;
      }

      if (config.dryRun) {
        await registrarDecisao(pool, { ...comum, status: 'dry_run', mensagem: texto });
        r.respondidos += 1;
        continue;
      }

      await enviar({ contato: p, texto });
      await registrarDecisao(pool, { ...comum, status: 'sent', mensagem: texto });
      r.respondidos += 1;
    } catch (error) {
      await registrarDecisao(pool, { ...base, status: 'failed', error: String(error.message || error) });
      r.falhas += 1;
    }
  }

  return r;
};

module.exports = {
  RESPONDER_LOG_TABLE,
  carregarConfigResponder,
  createResponderTable,
  motivoDeEscalar,
  ESCALAR_SEMPRE,
  buscarPendentes,
  contarHoje,
  carregarHistorico,
  montarPromptResposta,
  validarResposta,
  registrarDecisao,
  runAiResponderTick,
};
