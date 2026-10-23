// Classificação automática da etapa do funil pela IA.
//
// O lead responde, o vendedor não move o card, e o funil vira ficção. Medido em
// 2026-10-21: 101 contatos responderam nos últimos 30 dias sem ninguém mexer na etapa
// depois — 39 deles ainda sentados em "1. Inbox (Novos)".
//
// Este worker é SEPARADO do follow-up de propósito: o follow-up só olha quem está
// calado, então quem respondeu "não tenho interesse" nunca viraria candidato lá — e é
// justamente esse o caso que mais precisa de reclassificação.
//
// Mover card é escrita no CRM, não mensagem para cliente: erro aqui não queima número,
// mas estraga pipeline e relatório. Por isso a IA só aplica sozinha em etapas de
// trabalho; marco comercial (demo marcada, proposta, negociação, cliente novo) ela
// apenas SUGERE, e quem decide é o vendedor.

const STAGE_LOG_TABLE = 'ai_stage_log';

// Etapas que a IA pode aplicar sozinha. Movimento entre elas é organização de fila,
// não compromisso comercial. "16. Descartado" entra porque recusa explícita do cliente
// é o sinal mais claro que existe e deixar o lead vivo no funil é pior.
// De onde a IA NAO tira ninguem sozinha. Sair de um marco comercial e decisao
// de gente: ou o negocio avancou, ou morreu, e os dois casos tem dono.
// "No momento nao tenho interesse" e adiamento, nao recusa. O prompt manda tratar
// assim, mas o modelo insistia em Descartado — entao a regra virou codigo.
const ADIAMENTO = [
  /n[a\u00e3]o\s+(tenho|temos|h[a\u00e1])?\s*(interesse|necessidade|demanda|previs[a\u00e3]o)?\s*(no|neste)\s+momento/i,
  /(no|neste)\s+momento\s+n[a\u00e3]o/i,
  /\bagora\s+n[a\u00e3]o\b/i,
  /por\s+enquanto/i,
  /sem\s+previs[a\u00e3]o/i,
  /(esse|este)\s+ano\s+n[a\u00e3]o/i,
  /ano\s+que\s+vem/i,
  /mais\s+(para\s+|pra\s+)?frente/i,
  /quando\s+(surgir|precisar|houver|tiver)/i,
];
const ehAdiamento = (texto) => ADIAMENTO.some((re) => re.test(String(texto || '')));

const ORIGENS_PROTEGIDAS_PADRAO = [
  '7. Agendamento Demo',
  '8. Demo Realizada',
  '9. Elaborando Proposta',
  '10. Proposta Enviada',
  '11. Em Negociação',
  '12. Aprovação Interna',
  '13. Fechado-Ganho',
  '14. Fechado-Perdido',
  '18. Novos Clientes',
  '23. Oportunidade Recompra',
];

const ALVOS_AUTOMATICOS_PADRAO = [
  '1. Inbox (Novos)',
  '2. Em Contato',
  '3. Follow-up 1',
  '4. Follow-up 2',
  '5. Follow-up 3',
  '6. Qualificado (SQL)',
  '16. Descartado',
  '17. Nurturing',
];

// Mandar para Nurturing/Descartado sem marcar quando voltar e so empurrar o lead
// para debaixo do tapete. Nestas etapas a IA agenda o retorno.
const ETAPAS_FRIAS_PADRAO = ['16. Descartado', '17. Nurturing', '15. Pausado'];

const flag = (nome, padrao = false) => {
  const v = process.env[nome];
  if (v === undefined || v === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).trim().toLowerCase());
};
const inteiro = (nome, padrao) => {
  const v = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(v) ? v : padrao;
};
const decimal = (nome, padrao) => {
  const v = Number.parseFloat(process.env[nome] ?? '');
  return Number.isFinite(v) ? v : padrao;
};
const lista = (nome, padrao) => {
  const bruto = String(process.env[nome] || '').trim();
  if (!bruto) return padrao;
  return bruto.split(',').map((s) => s.trim()).filter(Boolean);
};

const carregarConfigStage = () => ({
  enabled: flag('AI_STAGE_ENABLED', false),
  dryRun: flag('AI_STAGE_DRY_RUN', true),
  janelaDias: inteiro('AI_STAGE_LOOKBACK_DAYS', 30),
  maxPorTick: inteiro('AI_STAGE_MAX_PER_TICK', 5),
  maxPorDia: inteiro('AI_STAGE_MAX_PER_DAY', 60),
  minConfianca: decimal('AI_STAGE_MIN_CONFIDENCE', 0.7),
  // Descartar e o movimento mais caro de desfazer: exige mais certeza que os outros.
  minConfiancaDescarte: decimal('AI_STAGE_MIN_CONFIDENCE_DISCARD', 0.9),
  alvosAutomaticos: lista('AI_STAGE_AUTO_TARGETS', ALVOS_AUTOMATICOS_PADRAO),
  etapasFrias: lista('AI_STAGE_COLD_TARGETS', ETAPAS_FRIAS_PADRAO),
  origensProtegidas: lista('AI_STAGE_PROTECTED_SOURCES', ORIGENS_PROTEGIDAS_PADRAO),
  retomarMinDias: inteiro('AI_STAGE_RETRY_MIN_DAYS', 15),
  retomarMaxDias: inteiro('AI_STAGE_RETRY_MAX_DAYS', 180),
});

const createStageLogTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STAGE_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      confidence NUMERIC,
      motivo TEXT,
      status TEXT NOT NULL
        CHECK (status IN ('applied', 'suggested', 'skipped', 'failed', 'dry_run')),
      skip_reason TEXT,
      provider TEXT,
      model TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_stage_contact
      ON ${STAGE_LOG_TABLE} (account_id, contact_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_stage_recent
      ON ${STAGE_LOG_TABLE} (account_id, created_at DESC)
  `);
};

// Etapas reais da base, não lista fixa no código: o funil muda e um valor inventado
// pela IA que não existe aqui tem que ser rejeitado.
const carregarEtapasConhecidas = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT custom_attributes->>'Funil_Vendas' AS etapa
       FROM contacts
      WHERE account_id = $1
        AND COALESCE(TRIM(custom_attributes->>'Funil_Vendas'), '') <> ''
      ORDER BY 1`,
    [accountId]
  );
  return rows.map((r) => r.etapa);
};

// Candidatos: respondeu na janela e ninguém mexeu na etapa depois disso. Se um humano
// já moveu o card após a resposta, a decisão dele vale — a IA não opina de novo.
const buscarCandidatosStage = async (pool, { accountId, config, limite }) => {
  const { rows } = await pool.query(
    `
    WITH ult_in AS (
      SELECT cv.contact_id, MAX(m.created_at) AS em
        FROM messages m
        JOIN conversations cv ON cv.id = m.conversation_id
       WHERE m.account_id = $1
         AND m.message_type = 0
         AND COALESCE(m."private", false) = false
         AND m.created_at >= NOW() - make_interval(days => $2)
       GROUP BY cv.contact_id
    ), ult_mov AS (
      SELECT contact_id, MAX(changed_at) AS em FROM kanban_stage_history GROUP BY contact_id
    )
    SELECT c.id AS contact_id,
           c.name,
           c.custom_attributes->>'Funil_Vendas' AS etapa_atual,
           c.additional_attributes->>'company_name' AS empresa,
           i.em AS respondeu_em
      FROM ult_in i
      JOIN contacts c ON c.id = i.contact_id AND c.account_id = $1
      LEFT JOIN ult_mov mv ON mv.contact_id = i.contact_id
     WHERE COALESCE(TRIM(c.custom_attributes->>'Funil_Vendas'), '') <> ''
       AND (mv.em IS NULL OR mv.em < i.em)
       -- não reavalia o mesmo contato enquanto ele não falar de novo
       AND NOT EXISTS (
         SELECT 1 FROM ${STAGE_LOG_TABLE} l
          WHERE l.account_id = $1 AND l.contact_id = c.id AND l.created_at >= i.em
       )
     ORDER BY i.em DESC
     LIMIT $3
    `,
    [accountId, config.janelaDias, limite]
  );
  return rows;
};

const contarAplicadosHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM ${STAGE_LOG_TABLE}
      WHERE account_id = $1
        AND status IN ('applied', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo'`,
    [accountId]
  );
  return rows[0]?.total || 0;
};

const montarPromptStage = ({ contato, historico, etapas }) => {
  const system = [
    'Você classifica em que etapa do funil de vendas um lead está, lendo a conversa real dele com a Aerion (distribuidora de drones Autel no Brasil).',
    '',
    'Escolha UMA etapa, exatamente como escrita na lista. Não invente etapa nova.',
    'Etapas disponíveis:',
    ...etapas.map((e) => `- ${e}`),
    '',
    'Como julgar:',
    '- Olhe o que o CLIENTE disse, não o que nós dissemos. Nosso esforço não move etapa.',
    '- Vale a posição ATUAL dele, não a mais antiga. Uma fala recente SUBSTITUI uma',
    '  anterior: se ele disse "não estou procurando" em março e em agosto pediu a tabela,',
    '  ele voltou a ter interesse. Julgue pela ÚLTIMA fala dele, que vem destacada.',
    '',
    'Descartado é o movimento mais caro de desfazer, então a régua é alta:',
    '- Só use Descartado com recusa DEFINITIVA e ATUAL: "não trabalho com drones",',
    '  "não usamos isso", "encerramos a atividade", "já fechei com outro fornecedor".',
    '- "No momento não", "agora não", "esse ano não", "sem previsão" NÃO é Descartado:',
    '  é Nurturing com data. A pessoa não disse que nunca quer, disse que não é agora.',
    '- Tentativa de contato que não foi respondida NUNCA é Descartado. Silêncio não é',
    '  recusa: pode ser número errado, pessoa ocupada ou mensagem não vista.',
    '- Se a última coisa que o cliente disse demonstra qualquer abertura ("pode mandar",',
    '  "vou salvar seu contato", "me manda depois"), NÃO é Descartado.',
    '- Na dúvida entre Descartado e Nurturing, escolha Nurturing. Nurturing volta sozinho',
    '  na data; Descartado precisa de alguém perceber o erro.',
    '',
    '- Interesse vago ou "me chama depois" = Nurturing.',
    '- Conversa ativa sem qualificação clara = Em Contato.',
    '- Só diga que houve demo, proposta ou negociação se isso aparecer no histórico.',
    '- Se a etapa atual já descreve bem a situação, repita a etapa atual.',
    '- Na dúvida entre duas, fique na mais conservadora (a mais atrasada no funil).',
    '',
    'Se a etapa for fria (Descartado, Nurturing, Pausado), diga também em quantos dias',
    'faz sentido voltar a falar com essa pessoa, em "retomar_em_dias". Use o que o',
    'cliente disse: "me chama em março", "ano que vem", "quando renovar a frota".',
    'Sem pista nenhuma, use 90. Se a recusa foi definitiva (empresa não usa drone,',
    'encerrou atividade), use 0 para não reagendar.',
    '',
    'Responda SOMENTE com um objeto JSON:',
    '{"etapa": "<uma das etapas, texto exato>", "confianca": <0 a 1>, "motivo": "<a frase do cliente que te levou a isso>", "retomar_em_dias": <inteiro, 0 se não cabe>}',
  ].join('\n');

  const agora = new Date();
  const dias = (d) => {
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? Math.floor((agora.getTime() - t) / 86400000) : null;
  };
  const quando = (d) => {
    const n = dias(d);
    return n === null ? 'data desconhecida' : n === 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`;
  };
  const linhas = historico.length
    ? historico.map((h) => `[${h.autor} — ${quando(h.em)}] ${h.texto}`).join('\n')
    : '(sem histórico textual)';

  // A última fala do cliente define a posição atual dele. Sem destacar, o modelo
  // acha uma recusa velha no meio do histórico e descarta quem voltou a engajar:
  // o Flavio disse "não estou mais procurando" e depois "Pode mandar" — e foi
  // descartado pela primeira frase.
  const idxCliente = historico.map((h) => h.autor).lastIndexOf('cliente');
  const falasFinais = [];
  for (let i = idxCliente; i >= 0 && falasFinais.length < 4; i -= 1) {
    if (historico[i].autor !== 'cliente') break;
    falasFinais.unshift(historico[i]);
  }

  const user = [
    `Contato: ${contato.name || 'sem nome'}`,
    contato.empresa ? `Empresa: ${contato.empresa}` : null,
    `Etapa atual: ${contato.etapa_atual}`,
    '',
    idxCliente >= 0
      ? [
        `>>> POSIÇÃO ATUAL DO CLIENTE — o que ele falou por último (${quando(historico[idxCliente].em)}):`,
        ...falasFinais.map((f) => `    "${f.texto}"`),
      ].join(String.fromCharCode(10))
      : '>>> O CLIENTE NUNCA RESPONDEU. Silêncio não é recusa — nunca classifique como Descartado.',
    '',
    'Conversa completa (mais antigo primeiro):',
    linhas,
    '',
    'Em que etapa este lead está?',
  ].filter(Boolean).join('\n');

  return { system, user };
};

// Decide se a sugestão vira movimento automático, sugestão ao vendedor, ou nada.
const avaliarSugestao = ({ etapaAtual, sugerida, confianca, motivo = '', etapas, config }) => {
  const alvo = String(sugerida || '').trim();
  if (!alvo) return { acao: 'skipped', motivo: 'etapa vazia' };
  if (!etapas.includes(alvo)) return { acao: 'skipped', motivo: `etapa inexistente: ${alvo}` };
  if (alvo === etapaAtual) return { acao: 'skipped', motivo: 'etapa já está correta' };
  if (confianca === null || confianca === undefined || confianca === '') {
    return { acao: 'skipped', motivo: 'confiança ausente' };
  }
  if (!Number.isFinite(Number(confianca)) || Number(confianca) < config.minConfianca) {
    return { acao: 'skipped', motivo: `confiança ${confianca} abaixo de ${config.minConfianca}` };
  }
  // Descartado tem regua propria, acima da geral.
  if (alvo === '16. Descartado') {
    // A pessoa disse que nao e agora, nao que nunca mais. Descartar fecha a porta
    // de quem so pediu tempo — e Nurturing volta sozinho na data.
    if (ehAdiamento(motivo)) {
      return {
        acao: 'applied',
        alvoCorrigido: '17. Nurturing',
        motivo: 'adiamento, não recusa — vai para Nurturing com data em vez de Descartado',
      };
    }
    const minDescarte = config.minConfiancaDescarte ?? 0.9;
    if (Number(confianca) < minDescarte) {
      return {
        acao: 'suggested',
        motivo: `descarte com confiança ${confianca} (mínimo ${minDescarte}) — precisa de confirmação humana`,
      };
    }
  }
  // Sair de marco comercial tambem e decisao de gente, nao so entrar.
  if ((config.origensProtegidas || ORIGENS_PROTEGIDAS_PADRAO).includes(etapaAtual)) {
    return { acao: 'suggested', motivo: `sair de "${etapaAtual}" precisa de confirmação humana` };
  }
  // Marco comercial é decisão de gente: a IA só levanta a mão.
  if (!config.alvosAutomaticos.includes(alvo)) {
    return { acao: 'suggested', motivo: `"${alvo}" é marco comercial — precisa de confirmação humana` };
  }
  return { acao: 'applied' };
};

// A IA chuta dias; a gente decide se o chute e usavel. Fora da faixa, descarta.
const normalizarRetomada = (dias, config = {}) => {
  const min = Number.isFinite(config.retomarMinDias) ? config.retomarMinDias : 15;
  const max = Number.isFinite(config.retomarMaxDias) ? config.retomarMaxDias : 180;
  const n = Math.round(Number(dias));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < min || n > max) return null;
  const quando = new Date(Date.now() + n * 86400000);
  // 10h da manha de Sao Paulo, para o lembrete cair dentro do horario comercial.
  quando.setUTCHours(13, 0, 0, 0);
  return { dias: n, dueAt: quando.toISOString() };
};

const registrarStage = async (pool, d) => {
  const { rows } = await pool.query(
    `INSERT INTO ${STAGE_LOG_TABLE}
       (account_id, contact_id, from_stage, to_stage, confidence, motivo, status,
        skip_reason, provider, model, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      d.accountId, d.contactId, d.fromStage ?? null, d.toStage ?? null,
      Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : null,
      d.motivo ?? null, d.status, d.skipReason ?? null,
      d.provider ?? null, d.model ?? null, d.error ?? null,
    ]
  );
  return rows[0]?.id ?? null;
};

// Move o card do mesmo jeito que o PUT /api/contacts/:id faz, para o histórico do
// kanban ficar consistente — só que com source 'ia' em vez de 'kanban'.
const aplicarEtapa = async (pool, { accountId, contactId, fromStage, toStage, historyTable }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT custom_attributes, account_id FROM contacts WHERE id = $1 FOR UPDATE',
      [contactId]
    );
    if (!rows[0]) throw new Error('contato não encontrado');
    const atuais = rows[0].custom_attributes || {};
    // Alguém pode ter movido o card entre a leitura e agora.
    if ((atuais.Funil_Vendas || null) !== (fromStage || null)) {
      await client.query('ROLLBACK');
      return { aplicado: false, motivo: 'etapa mudou durante a análise' };
    }
    await client.query(
      'UPDATE contacts SET custom_attributes = $1 WHERE id = $2',
      [{ ...atuais, Funil_Vendas: toStage }, contactId]
    );
    await client.query(
      `INSERT INTO ${historyTable}
         (contact_id, account_id, from_stage, to_stage, changed_at, source, actor_id, actor_name)
       VALUES ($1, $2, $3, $4, NOW(), 'ia', NULL, 'IA (classificação automática)')`,
      [contactId, rows[0].account_id || accountId, fromStage, toStage]
    );
    await client.query('COMMIT');
    return { aplicado: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const runStageClassificationTick = async (pool, {
  accountId,
  chatCompletionJson,
  carregarContextoConversa,
  historyTable = 'kanban_stage_history',
  notify = null,
  agendarRetorno = null,
  config = carregarConfigStage(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };

  const hoje = await contarAplicadosHoje(pool, accountId);
  const saldo = config.maxPorDia - hoje;
  if (saldo <= 0) return { skipped: 'teto diário atingido', hoje };

  const etapas = await carregarEtapasConhecidas(pool, accountId);
  if (!etapas.length) return { skipped: 'nenhuma etapa cadastrada' };

  const limite = Math.max(1, Math.min(config.maxPorTick, saldo));
  const candidatos = await buscarCandidatosStage(pool, { accountId, config, limite });
  const r = { avaliados: candidatos.length, movidos: 0, sugeridos: 0, agendados: 0, pulados: 0, falhas: 0 };

  for (const cand of candidatos) {
    const base = { accountId, contactId: cand.contact_id, fromStage: cand.etapa_atual };
    try {
      const historico = await carregarContextoConversa(pool, {
        accountId,
        contactId: cand.contact_id,
      });
      if (!historico.length) {
        await registrarStage(pool, { ...base, status: 'skipped', skipReason: 'sem histórico textual' });
        r.pulados += 1;
        continue;
      }

      const { system, user } = montarPromptStage({ contato: cand, historico, etapas });
      const ia = await chatCompletionJson({ system, user, maxTokens: 400, temperature: 0.1 });
      if (!ia.ok) {
        await registrarStage(pool, { ...base, status: 'failed', error: ia.error });
        r.falhas += 1;
        continue;
      }

      const sugerida = String(ia.data?.etapa || '').trim();
      const confianca = ia.data?.confianca;
      const motivo = String(ia.data?.motivo || '').slice(0, 500);
      const comum = {
        ...base, toStage: sugerida, confidence: confianca, motivo,
        provider: ia.provider, model: ia.model,
      };

      const veredito = avaliarSugestao({
        etapaAtual: cand.etapa_atual, sugerida, confianca, etapas, config,
      });

      if (veredito.acao === 'skipped') {
        await registrarStage(pool, { ...comum, status: 'skipped', skipReason: veredito.motivo });
        r.pulados += 1;
        continue;
      }

      if (veredito.acao === 'suggested') {
        await registrarStage(pool, { ...comum, status: 'suggested', skipReason: veredito.motivo });
        r.sugeridos += 1;
        if (notify) {
          await Promise.resolve(notify({ tipo: 'suggested', contato: cand, para: sugerida, motivo })).catch(() => {});
        }
        continue;
      }

      if (config.dryRun) {
        await registrarStage(pool, { ...comum, status: 'dry_run' });
        r.movidos += 1;
        continue;
      }

      const res = await aplicarEtapa(pool, {
        accountId, contactId: cand.contact_id,
        fromStage: cand.etapa_atual, toStage: sugerida, historyTable,
      });
      if (!res.aplicado) {
        await registrarStage(pool, { ...comum, status: 'skipped', skipReason: res.motivo });
        r.pulados += 1;
        continue;
      }
      await registrarStage(pool, { ...comum, status: 'applied' });
      r.movidos += 1;

      // Etapa fria com data de volta: agenda o retorno para a propria IA puxar depois.
      let retomada = null;
      if ((config.etapasFrias || ETAPAS_FRIAS_PADRAO).includes(sugerida)) {
        retomada = normalizarRetomada(ia.data?.retomar_em_dias, config);
        if (retomada && agendarRetorno) {
          try {
            await agendarRetorno({
              contactId: cand.contact_id,
              dueAt: retomada.dueAt,
              note: `IA: retomar em ${retomada.dias} dias — ${motivo}`.slice(0, 160),
            });
            r.agendados += 1;
          } catch (error) {
            console.warn('[ia-stage] agendar retorno falhou:', error.message);
          }
        }
      }

      if (notify) {
        await Promise.resolve(notify({
          tipo: 'applied', contato: cand, para: destino, motivo,
          retomarEm: retomada?.dueAt || null,
        })).catch(() => {});
      }
    } catch (error) {
      await registrarStage(pool, { ...base, status: 'failed', error: String(error.message || error) })
        .catch(() => {});
      r.falhas += 1;
    }
  }

  return r;
};

module.exports = {
  STAGE_LOG_TABLE,
  ehAdiamento,
  ALVOS_AUTOMATICOS_PADRAO,
  ORIGENS_PROTEGIDAS_PADRAO,
  ETAPAS_FRIAS_PADRAO,
  normalizarRetomada,
  carregarConfigStage,
  createStageLogTable,
  carregarEtapasConhecidas,
  buscarCandidatosStage,
  contarAplicadosHoje,
  montarPromptStage,
  avaliarSugestao,
  aplicarEtapa,
  registrarStage,
  runStageClassificationTick,
};
