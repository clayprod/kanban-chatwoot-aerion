// Fila única de saída de WhatsApp.
//
// Antes disto havia três remetentes que não se conheciam: a campanha no n8n, o
// follow-up da IA e o vendedor humano. Cada um com seu ritmo, todos pelo mesmo número.
// Medido em 24/09: o inbox `comercial_aerion` fez 71 envios num dia, com 24 numa única
// hora. Somar a prospecção ativa a esse arranjo seria garantir bloqueio.
//
// Agora nenhuma feature fala com o canal direto: todas enfileiram, e o despachante é
// o único que decide QUANDO. Ele manda uma mensagem por vez e aplica, por número, as
// travas que até aqui só o follow-up respeitava.
//
// A campanha do n8n ainda fica de fora (migrá-la é passo seguinte e tem risco próprio).
// O despachante a enxerga pela carga do inbox, mas não a governa.

const OUTBOUND_QUEUE_TABLE = 'outbound_queue';

// Quem ganha a vez quando dois itens disputam o mesmo número. Resposta de cliente
// nunca espera atrás de contato frio.
const PRIORIDADES = {
  resposta: 10,
  followup: 20,
  campanha: 30,
  prospeccao: 40,
};
const ORIGENS = Object.keys(PRIORIDADES);

const prioridadeDe = (origem) => PRIORIDADES[origem] ?? 50;

const createOutboundQueueTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${OUTBOUND_QUEUE_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT,
      conversation_id BIGINT,
      inbox_id BIGINT,
      origem TEXT NOT NULL,
      prioridade SMALLINT NOT NULL DEFAULT 50,
      texto TEXT NOT NULL,
      telefone TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      agendado_para TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      enviado_em TIMESTAMPTZ,
      last_error TEXT,
      dedupe_key TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Dedupe: a mesma intenção não entra duas vezes enquanto não resolver.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_dedupe
      ON ${OUTBOUND_QUEUE_TABLE} (account_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status = 'pending'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbound_fila
      ON ${OUTBOUND_QUEUE_TABLE} (account_id, status, prioridade, agendado_para)
      WHERE status = 'pending'
  `);
};

// Enfileirar é a única porta de entrada. Devolve o id, ou null se já havia item
// pendente com a mesma dedupe_key.
const enfileirar = async (pool, {
  accountId, contactId = null, conversationId = null, inboxId = null,
  origem, texto, telefone = null, agendadoPara = null, dedupeKey = null, meta = null,
}) => {
  if (!ORIGENS.includes(origem)) throw new Error(`origem inválida: ${origem}`);
  const limpo = String(texto || '').trim();
  if (!limpo) throw new Error('texto vazio');
  const { rows } = await pool.query(
    `INSERT INTO ${OUTBOUND_QUEUE_TABLE}
       (account_id, contact_id, conversation_id, inbox_id, origem, prioridade,
        texto, telefone, agendado_para, dedupe_key, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, NOW()),$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      accountId, contactId, conversationId, inboxId, origem, prioridadeDe(origem),
      limpo, telefone, agendadoPara, dedupeKey, meta ? JSON.stringify(meta) : null,
    ]
  );
  return rows[0]?.id ?? null;
};

// Carga real de cada número nas últimas 24h: campanha, humano e IA na mesma régua.
// É a mesma conta que o follow-up já fazia — só que agora governa todo mundo.
const cargaPorInbox = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT cv.inbox_id,
            COUNT(*) FILTER (
              WHERE m.created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
                    AT TIME ZONE 'America/Sao_Paulo'
            )::int AS hoje,
            COUNT(*) FILTER (WHERE m.created_at >= NOW() - INTERVAL '1 hour')::int AS ultima_hora,
            MAX(m.created_at) AS ultimo_envio
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
      WHERE m.account_id = $1 AND m.message_type = 1
        AND m.created_at >= NOW() - INTERVAL '1 day'
      GROUP BY cv.inbox_id`,
    [accountId]
  );
  return new Map(rows.map((r) => [Number(r.inbox_id), r]));
};

// Por que este número não pode receber agora. null = liberado.
const bloqueioDoNumero = (carga, limites, agora = Date.now()) => {
  if (!carga) return null;
  const ultimo = carga.ultimo_envio ? new Date(carga.ultimo_envio).getTime() : null;
  if (ultimo && (agora - ultimo) < limites.gapSegundos * 1000) {
    const faltam = Math.ceil((limites.gapSegundos * 1000 - (agora - ultimo)) / 1000);
    return `mandou há pouco, faltam ${faltam}s`;
  }
  if (carga.ultima_hora >= limites.capHorario) return `teto por hora (${carga.ultima_hora}/${limites.capHorario})`;
  if (carga.hoje >= limites.capDiario) return `teto diário (${carga.hoje}/${limites.capDiario})`;
  return null;
};

// Um tick despacha NO MÁXIMO uma mensagem por número, mesmo que a fila esteja cheia.
// É o que impede a rajada: o espaçamento emerge do intervalo entre ticks + o gap.
const despacharTick = async (pool, {
  accountId,
  enviar,
  dentroDaJanela,
  limites = { gapSegundos: 300, capHorario: 12, capDiario: 40 },
  maxPorTick = 3,
  agora = new Date(),
} = {}) => {
  if (dentroDaJanela && !dentroDaJanela(agora)) {
    return { despachados: 0, skipped: 'fora da janela comercial' };
  }

  const { rows: fila } = await pool.query(
    `SELECT * FROM ${OUTBOUND_QUEUE_TABLE}
      WHERE account_id = $1 AND status = 'pending'
        AND agendado_para <= NOW() AND attempts < 3
      ORDER BY prioridade ASC, agendado_para ASC, id ASC
      LIMIT 200`,
    [accountId]
  );
  if (!fila.length) return { despachados: 0, falhas: 0, bloqueados: 0 };

  const carga = await cargaPorInbox(pool, accountId);
  const usadosNesteTick = new Set();
  const r = { despachados: 0, falhas: 0, bloqueados: 0, motivos: {} };

  for (const item of fila) {
    if (r.despachados >= maxPorTick) break;
    const inbox = Number(item.inbox_id);

    // Um por número por tick: dois itens do mesmo número nunca saem juntos.
    if (usadosNesteTick.has(inbox)) { r.bloqueados += 1; continue; }

    const bloqueio = bloqueioDoNumero(carga.get(inbox), limites, agora.getTime());
    if (bloqueio) {
      r.bloqueados += 1;
      r.motivos[bloqueio] = (r.motivos[bloqueio] || 0) + 1;
      continue;
    }

    try {
      await enviar(item);
      await pool.query(
        `UPDATE ${OUTBOUND_QUEUE_TABLE}
            SET status = 'sent', enviado_em = NOW(), attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [item.id]
      );
      r.despachados += 1;
      usadosNesteTick.add(inbox);
      // O envio conta na carga imediatamente: o próximo tick já enxerga.
      const c = carga.get(inbox) || { hoje: 0, ultima_hora: 0 };
      carga.set(inbox, {
        hoje: c.hoje + 1,
        ultima_hora: c.ultima_hora + 1,
        ultimo_envio: agora.toISOString(),
      });
    } catch (error) {
      const msg = String(error.message || error).slice(0, 400);
      await pool.query(
        `UPDATE ${OUTBOUND_QUEUE_TABLE}
            SET attempts = attempts + 1, last_error = $2,
                status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END
          WHERE id = $1`,
        [item.id, msg]
      );
      r.falhas += 1;
    }
  }
  return r;
};

module.exports = {
  OUTBOUND_QUEUE_TABLE,
  PRIORIDADES,
  ORIGENS,
  prioridadeDe,
  createOutboundQueueTable,
  enfileirar,
  cargaPorInbox,
  bloqueioDoNumero,
  despacharTick,
};
