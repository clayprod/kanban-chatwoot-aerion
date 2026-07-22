/**
 * Embeddings OpenAI (text-embedding-3-small) com cache em dois níveis
 * (L1 em memória + L2 em banco), circuit breaker e orçamento diário
 * de tokens. Usado para reranqueamento semântico de resultados PNCP
 * e busca KNN sobre itens do PCA (pgvector).
 *
 * Uso:
 *   await initEmbeddings({ pool });
 *   const reranked = await rerankPncpItems(items, queryText);
 */

const crypto = require('crypto');

const EMBEDDING_CACHE_TABLE = 'embedding_cache';

const L1_CACHE_CAP = 5000;
const QUERY_CACHE_CAP = 200;
const API_CHUNK_SIZE = 500;
const MAX_TEXT_LENGTH = 6000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutos
const COST_PER_MILLION_TOKENS = 0.02;

let pool = null;
let apiKey = null;

// Configuração lida de env vars no initEmbeddings (com defaults sensatos
// para permitir uso mesmo sem init explícito, em modo degradado).
let config = {
  enabled: false,
  model: 'text-embedding-3-small',
  dims: 1536,
  dailyBudget: 20000000,
  pivot: 0.40,
  weight: 50,
  maxBoost: 10,
  maxPen: 15,
  dropWeak: false,
  dropWeakBelow: 0.30,
};

// Cache L1: Map simples com ordem de inserção preservada (LRU aproximado).
const l1Cache = new Map();
// Cache dedicado a embedQuery (consultas de busca, reaproveitadas com frequência).
const queryCache = new Map();

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

let budgetDate = null; // 'YYYY-MM-DD'
let tokensUsedToday = 0;

const stats = {
  requests: 0,
  tokens_used: 0,
  cache_hits: 0,
  cache_misses: 0,
  failures: 0,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const truncateText = (text) => (typeof text === 'string' ? text.slice(0, MAX_TEXT_LENGTH) : '');

const hashText = (text) => crypto.createHash('sha256').update(`${config.model}\n${text}`).digest('hex');

// Reseta o contador de tokens quando o dia muda (comparação por data local YYYY-MM-DD).
const checkDayRollover = () => {
  const today = new Date().toISOString().slice(0, 10);
  if (budgetDate !== today) {
    budgetDate = today;
    tokensUsedToday = 0;
  }
};

const recordTokenUsage = (tokens) => {
  const amount = Number(tokens) || 0;
  checkDayRollover();
  tokensUsedToday += amount;
  stats.tokens_used += amount;
};

// L1: insere e, se estourar a capacidade, remove o mais antigo (ordem de inserção do Map).
const l1CacheSet = (hash, vec) => {
  if (l1Cache.has(hash)) l1Cache.delete(hash);
  l1Cache.set(hash, vec);
  if (l1Cache.size > L1_CACHE_CAP) {
    const oldestKey = l1Cache.keys().next().value;
    l1Cache.delete(oldestKey);
  }
};

const l1CacheTouch = (hash) => {
  const vec = l1Cache.get(hash);
  if (vec === undefined) return;
  l1Cache.delete(hash);
  l1Cache.set(hash, vec);
};

const queryCacheSet = (key, vec) => {
  if (queryCache.has(key)) queryCache.delete(key);
  queryCache.set(key, vec);
  if (queryCache.size > QUERY_CACHE_CAP) {
    const oldestKey = queryCache.keys().next().value;
    queryCache.delete(oldestKey);
  }
};

// Float32Array -> BYTEA (Buffer), sem cópia.
const float32ToBuffer = (vec) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

// BYTEA (Buffer) -> Float32Array. Copia se o offset não estiver alinhado a 4 bytes.
const bufferToFloat32 = (buf) => {
  if (!buf) return null;
  let aligned = buf;
  if (buf.byteOffset % 4 !== 0) {
    aligned = Buffer.from(buf);
  }
  return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
};

// Cria a tabela de cache L2 (idempotente). Nunca lança.
const initEmbeddings = async ({ pool: injectedPool } = {}) => {
  pool = injectedPool || null;
  apiKey = process.env.OPENAI_API_KEY || null;
  config = {
    enabled: process.env.EMBEDDINGS_ENABLED === '1',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dims: parseInt(process.env.EMBEDDING_DIMS || '1536', 10),
    dailyBudget: parseInt(process.env.EMBEDDINGS_DAILY_TOKEN_BUDGET || '20000000', 10),
    pivot: parseFloat(process.env.EMBED_RERANK_PIVOT || '0.40'),
    weight: parseFloat(process.env.EMBED_RERANK_WEIGHT || '50'),
    maxBoost: parseFloat(process.env.EMBED_RERANK_MAX_BOOST || '10'),
    maxPen: parseFloat(process.env.EMBED_RERANK_MAX_PEN || '15'),
    dropWeak: process.env.EMBED_RERANK_DROP_WEAK === '1',
    dropWeakBelow: parseFloat(process.env.EMBED_RERANK_DROP_WEAK_BELOW || '0.30'),
  };

  if (!pool) {
    console.warn('[embeddings] initEmbeddings chamado sem pool; cache L2 e KNN ficarão indisponíveis.');
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${EMBEDDING_CACHE_TABLE} (
        text_hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        embedding BYTEA NOT NULL,
        token_count INT,
        created_at TIMESTAMPTZ DEFAULT now(),
        last_used_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log(
      `[embeddings] schema pronto (embedding_cache). enabled=${config.enabled} model=${config.model} apiKey=${apiKey ? 'set' : 'missing'}`
    );
  } catch (error) {
    console.warn('[embeddings] falha ao inicializar schema:', error.message);
  }
};

// bool: habilitado por env, chave presente, circuito fechado e orçamento diário não estourado.
const isEmbeddingsEnabled = () => {
  try {
    if (!config.enabled) return false;
    if (!apiKey) return false;
    if (Date.now() < circuitOpenUntil) return false;
    checkDayRollover();
    if (tokensUsedToday >= config.dailyBudget) return false;
    return true;
  } catch (error) {
    return false;
  }
};

// Chamada crua à API de embeddings da OpenAI, com timeout via AbortController.
const callOpenAiEmbeddings = async (inputTexts, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: inputTexts }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

// Grava um lote de vetores no cache L2 (fire-and-forget do lado do chamador).
const persistL2Batch = async (rows, tokenCountPerRow) => {
  if (!pool || !rows.length) return;
  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const { hash, vec } of rows) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    values.push(hash, config.model, float32ToBuffer(vec), tokenCountPerRow);
    idx += 4;
  }
  await pool.query(
    `INSERT INTO ${EMBEDDING_CACHE_TABLE} (text_hash, model, embedding, token_count)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (text_hash) DO NOTHING`,
    values
  );
};

// Gera embeddings para uma lista de textos, passando por cache L1 -> L2 -> API.
// Retorna sempre um array de mesmo tamanho que `texts`, com null nas posições
// que falharam (texto vazio ou indisponibilidade total da API).
const embedTexts = async (texts, { timeoutMs = 10000 } = {}) => {
  if (!Array.isArray(texts) || !texts.length) return [];

  const truncated = texts.map((t) => truncateText(t).trim());
  const hashes = truncated.map((t) => (t ? hashText(t) : null));
  const results = new Array(texts.length).fill(null);

  const validIdx = [];
  for (let i = 0; i < texts.length; i += 1) {
    if (truncated[i]) validIdx.push(i);
  }
  if (!validIdx.length) return results;

  try {
    // 1) Cache L1 (memória)
    const afterL1Missing = [];
    for (const i of validIdx) {
      const hash = hashes[i];
      if (l1Cache.has(hash)) {
        results[i] = l1Cache.get(hash);
        l1CacheTouch(hash);
        stats.cache_hits += 1;
      } else {
        afterL1Missing.push(i);
      }
    }

    // 2) Cache L2 (banco)
    if (afterL1Missing.length && pool) {
      try {
        const missingHashes = [...new Set(afterL1Missing.map((i) => hashes[i]))];
        const { rows } = await pool.query(
          `SELECT text_hash, embedding FROM ${EMBEDDING_CACHE_TABLE} WHERE text_hash = ANY($1)`,
          [missingHashes]
        );
        if (rows.length) {
          const foundHashes = [];
          for (const row of rows) {
            const vec = bufferToFloat32(row.embedding);
            if (!vec) continue;
            l1CacheSet(row.text_hash, vec);
            foundHashes.push(row.text_hash);
          }
          if (foundHashes.length) {
            pool
              .query(`UPDATE ${EMBEDDING_CACHE_TABLE} SET last_used_at = now() WHERE text_hash = ANY($1)`, [
                foundHashes,
              ])
              .catch((error) => console.warn('[embeddings] falha ao atualizar last_used_at:', error.message));
          }
          for (const i of afterL1Missing) {
            const hash = hashes[i];
            if (results[i] === null && l1Cache.has(hash)) {
              results[i] = l1Cache.get(hash);
              stats.cache_hits += 1;
            }
          }
        }
      } catch (error) {
        console.warn('[embeddings] falha ao consultar cache L2:', error.message);
      }
    }

    // 3) Chamada à API para o que ainda faltar
    const apiMissing = afterL1Missing.filter((i) => results[i] === null);
    stats.cache_misses += apiMissing.length;
    if (!apiMissing.length) return results;

    if (!isEmbeddingsEnabled()) {
      return results;
    }

    for (let start = 0; start < apiMissing.length; start += API_CHUNK_SIZE) {
      const chunkIdx = apiMissing.slice(start, start + API_CHUNK_SIZE);
      const chunkTexts = chunkIdx.map((i) => truncated[i]);
      try {
        const data = await callOpenAiEmbeddings(chunkTexts, timeoutMs);
        const embeddingsByPos = new Array(chunkTexts.length).fill(null);
        for (const item of data.data || []) {
          embeddingsByPos[item.index] = new Float32Array(item.embedding);
        }

        consecutiveFailures = 0;
        stats.requests += 1;
        const tokensUsed = (data.usage && data.usage.total_tokens) || 0;
        recordTokenUsage(tokensUsed);

        const l2Rows = [];
        for (let k = 0; k < chunkIdx.length; k += 1) {
          const i = chunkIdx[k];
          const vec = embeddingsByPos[k];
          if (!vec) continue;
          results[i] = vec;
          l1CacheSet(hashes[i], vec);
          l2Rows.push({ hash: hashes[i], vec });
        }

        if (l2Rows.length) {
          const tokenCountPerRow = tokensUsed ? Math.round(tokensUsed / l2Rows.length) : null;
          persistL2Batch(l2Rows, tokenCountPerRow).catch((error) =>
            console.warn('[embeddings] falha ao gravar cache L2:', error.message)
          );
        }
      } catch (error) {
        consecutiveFailures += 1;
        stats.failures += 1;
        console.warn('[embeddings] falha ao chamar API de embeddings:', error.message);
        if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
          console.warn('[embeddings] circuito aberto por 5 minutos após falhas consecutivas.');
        }
        // deixa results[i] = null para os itens deste chunk
      }
    }

    return results;
  } catch (error) {
    console.warn('[embeddings] falha inesperada em embedTexts:', error.message);
    return results;
  }
};

// Embedding de uma única query de busca, com LRU dedicado de 200 entradas.
const embedQuery = async (text) => {
  try {
    if (!text || typeof text !== 'string' || !text.trim()) return null;
    const truncated = truncateText(text.trim());
    const key = hashText(truncated);

    if (queryCache.has(key)) {
      const vec = queryCache.get(key);
      queryCacheSet(key, vec);
      stats.cache_hits += 1;
      return vec;
    }

    const [vec] = await embedTexts([truncated]);
    if (vec) queryCacheSet(key, vec);
    return vec || null;
  } catch (error) {
    console.warn('[embeddings] falha em embedQuery:', error.message);
    return null;
  }
};

// Similaridade de cosseno, normalizada para 0..1 (vetores de embedding são majoritariamente positivos).
const cosineSim = (a, b) => {
  try {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return clamp(sim, 0, 1);
  } catch (error) {
    return 0;
  }
};

// Estatísticas para endpoint de saúde/monitoramento.
const getEmbeddingsStats = () => {
  checkDayRollover();
  return {
    enabled: isEmbeddingsEnabled(),
    requests: stats.requests,
    tokens_used: stats.tokens_used,
    est_cost_usd: Number(((stats.tokens_used / 1e6) * COST_PER_MILLION_TOKENS).toFixed(4)),
    cache_hits: stats.cache_hits,
    cache_misses: stats.cache_misses,
    failures: stats.failures,
    circuit_open_until: circuitOpenUntil > Date.now() ? new Date(circuitOpenUntil).toISOString() : null,
    budget_remaining: Math.max(0, config.dailyBudget - tokensUsedToday),
  };
};

// Reranqueia os `topN` itens de PNCP por similaridade semântica com a query,
// ajustando o score dentro dos limites configurados. Falha total = retorna
// os itens originais, inalterados.
const rerankPncpItems = async (items, queryText, { timeoutMs = 2500, topN = 60 } = {}) => {
  if (!isEmbeddingsEnabled() || !queryText || !Array.isArray(items) || !items.length) {
    return items;
  }

  const doRerank = async () => {
    const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
    // Itens sem NENHUMA evidência textual estão travados em 37 independente do
    // embedding (ver decoratePncpSearchItem) — embedá-los é gasto sem efeito.
    // Fora do orçamento de topN, mantém score/posição intactos.
    const eligible = sorted.filter((it) => it.evidencia_textual && it.evidencia_textual !== 'nenhuma');
    const ineligible = sorted.filter((it) => !it.evidencia_textual || it.evidencia_textual === 'nenhuma');
    const top = eligible.slice(0, topN);
    const rest = [...eligible.slice(topN), ...ineligible];

    const texts = top.map((item) => {
      const titulo = item.titulo || '';
      const descricao = item.descricao || '';
      const itensResumo = item.itens_resumo_texto || '';
      return `${titulo}\n${descricao}\n${itensResumo}`;
    });

    const [queryVec, itemVecs] = await Promise.all([embedQuery(queryText), embedTexts(texts, { timeoutMs })]);

    if (!queryVec) return items;

    let reranked = top.map((item, idx) => {
      const vec = itemVecs[idx];
      if (!vec) return item;

      const sim = cosineSim(queryVec, vec);
      const adj = clamp(config.weight * (sim - config.pivot), -config.maxPen, config.maxBoost);
      const evidencia = item.evidencia_textual;
      const cap = evidencia === 'forte' ? 100 : evidencia === 'fraca' ? 55 : 37;
      const novoScore = clamp(Math.round((item.score || 0) + adj), 0, cap);

      const clone = { ...item };
      clone.score = novoScore;
      clone.vector_similarity = Number(sim.toFixed(4));
      if (adj !== 0) {
        clone.score_breakdown = [
          ...(item.score_breakdown || []),
          { label: 'Similaridade semântica', value: Math.round(adj) },
        ];
      }
      if (evidencia === 'fraca' && sim < config.dropWeakBelow) {
        clone.vector_flag = 'low';
      }
      return clone;
    });

    if (config.dropWeak) {
      reranked = reranked.filter((item) => item.vector_flag !== 'low');
    }

    const combined = [...reranked, ...rest];
    combined.sort((a, b) => (b.score || 0) - (a.score || 0));
    return combined;
  };

  try {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(items), timeoutMs);
    });
    return await Promise.race([doRerank(), timeoutPromise]);
  } catch (error) {
    console.warn('[embeddings] falha no rerank semântico, retornando itens originais:', error.message);
    return items;
  }
};

// Busca KNN de itens do PCA por similaridade de embedding (pgvector).
const knnPcaItens = async ({ pool: knnPool, queryVec, whereSql = '', params = [], limit = 200 } = {}) => {
  try {
    const targetPool = knnPool || pool;
    if (!targetPool || !queryVec || !queryVec.length) return [];

    const vecLiteral = `[${Array.from(queryVec).join(',')}]`;
    const vecParamIdx = params.length + 1;
    const limitParamIdx = params.length + 2;

    const { rows } = await targetPool.query(
      `SELECT i.id AS item_id, 1 - (i.embedding <=> $${vecParamIdx}::vector) AS vector_sim
         FROM pca_itens i
         JOIN pca_planos p ON p.id = i.plano_id
        WHERE i.embedding IS NOT NULL
          ${whereSql}
        ORDER BY i.embedding <=> $${vecParamIdx}::vector
        LIMIT $${limitParamIdx}`,
      [...params, vecLiteral, limit]
    );
    return rows;
  } catch (error) {
    console.warn('[embeddings] falha em knnPcaItens:', error.message);
    return [];
  }
};

// Preenche embeddings faltantes de pca_itens em lote (para job de backfill).
const runPcaEmbedBackfillBatch = async ({ pool: bfPool, batchSize = 500 } = {}) => {
  const targetPool = bfPool || pool;
  try {
    if (!targetPool) return { embedded: 0, remaining: -1, unavailable: true };

    const pending = await targetPool.query(
      `SELECT i.id, i.descricao
         FROM pca_itens i
         JOIN pca_planos p ON p.id = i.plano_id
        WHERE i.embedding IS NULL AND i.descricao IS NOT NULL
        ORDER BY (p.ano_pca = EXTRACT(YEAR FROM NOW())::int) DESC, p.ano_pca DESC, i.id
        LIMIT $1`,
      [batchSize]
    );

    if (!pending.rows.length) {
      const remainingResult = await targetPool.query(
        `SELECT COUNT(*)::int AS total FROM pca_itens WHERE embedding IS NULL`
      );
      return { embedded: 0, remaining: remainingResult.rows[0] ? remainingResult.rows[0].total : 0 };
    }

    const descricoes = pending.rows.map((row) => row.descricao);
    const vectors = await embedTexts(descricoes);

    const toUpdate = [];
    for (let i = 0; i < pending.rows.length; i += 1) {
      const vec = vectors[i];
      if (!vec) continue;
      toUpdate.push({ id: pending.rows[i].id, literal: `[${Array.from(vec).join(',')}]` });
    }

    let embedded = 0;
    if (toUpdate.length) {
      const placeholders = [];
      const values = [];
      let idx = 1;
      for (const row of toUpdate) {
        placeholders.push(`($${idx}::bigint, $${idx + 1}::vector)`);
        values.push(row.id, row.literal);
        idx += 2;
      }
      const updateResult = await targetPool.query(
        `UPDATE pca_itens AS i
            SET embedding = v.emb, embedding_model = $${idx}
           FROM (VALUES ${placeholders.join(', ')}) AS v(id, emb)
          WHERE i.id = v.id`,
        [...values, config.model]
      );
      embedded = updateResult.rowCount || 0;
    }

    const remainingResult = await targetPool.query(
      `SELECT COUNT(*)::int AS total FROM pca_itens WHERE embedding IS NULL`
    );
    return { embedded, remaining: remainingResult.rows[0] ? remainingResult.rows[0].total : 0 };
  } catch (error) {
    if (error.code === '42703') {
      // Coluna embedding ainda não existe em pca_itens: backfill indisponível, sem alarde.
      return { embedded: 0, remaining: -1, unavailable: true };
    }
    console.warn('[embeddings] falha no backfill de embeddings do PCA:', error.message);
    return { embedded: 0, remaining: -1 };
  }
};

module.exports = {
  initEmbeddings,
  isEmbeddingsEnabled,
  embedTexts,
  embedQuery,
  cosineSim,
  getEmbeddingsStats,
  rerankPncpItems,
  knnPcaItens,
  runPcaEmbedBackfillBatch,
};
