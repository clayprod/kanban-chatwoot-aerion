// Descoberta de contato na web com vários provedores, para distribuir risco e custo.
//
// Ordem padrão: Google Places API (cota gratuita) → Tavily → Chromium headless.
// Medido em 2026-10-29: a cota do Tavily acabou (HTTP 432) e TODOS os leads do dia morreram
// com "busca falhou", porque cada lead refazia 4 chamadas inúteis e o CNPJ ficava queimado.
// Aqui um provedor que esgota vira circuit-breaker (os outros assumem), e o resultado é
// cacheado por CNPJ para nunca pagar duas vezes pela mesma empresa.
//
// Places: telefone e site são campos do SKU "Text Search Enterprise", com 1.000 chamadas
// grátis por mês (developers.google.com/maps/billing-and-pricing/pricing). O teto padrão
// fica abaixo disso (PLACES_MONTHLY_LIMIT=900) e o contador é persistido no banco: reiniciar
// o container não zera a conta. Perder env nunca pode estourar a cota gratuita.

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
// Máscara mínima: pedir mais campos muda o SKU e o preço.
const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.businessStatus',
].join(',');

const num = (v, padrao) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : padrao;
};

// Piso RÍGIDO no código: a cota grátis do Text Search Enterprise é 1.000/mês. Nenhuma env,
// bug ou valor errado no banco consegue autorizar mais que isto — o Clayton exigiu que o
// Places NUNCA gere cobrança. A folga cobre diferença de fuso e chamadas feitas fora daqui.
const PLACES_TETO_MENSAL_ABSOLUTO = 950;
const PLACES_TETO_DIARIO_PADRAO = 25;

const carregarConfigBusca = (env = process.env) => ({
  ordem: String(env.BUSCA_WEB_ORDER || 'places,tavily,headless')
    .split(',').map((s) => s.trim()).filter(Boolean),
  placesLimiteMensal: Math.min(num(env.PLACES_MONTHLY_LIMIT, 900), PLACES_TETO_MENSAL_ABSOLUTO),
  placesLimiteDiario: Math.min(num(env.PLACES_DAILY_LIMIT, PLACES_TETO_DIARIO_PADRAO), PLACES_TETO_MENSAL_ABSOLUTO),
  cacheDias: num(env.BUSCA_WEB_CACHE_DIAS, 30),
  cacheVazioDias: num(env.BUSCA_WEB_CACHE_VAZIO_DIAS, 14),
  // Default no código: env não sobrevive a deploy nesta stack (ver segredos.js).
  headlessUrl: String(env.HEADLESS_SEARCH_URL || 'http://browser-search:3100').replace(/\/+$/, ''),
  timeoutMs: num(env.BUSCA_WEB_TIMEOUT_MS, 20000),
});

const criarTabelasBuscaWeb = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS busca_web_uso (
      provedor TEXT NOT NULL,
      mes TEXT NOT NULL,
      usado INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provedor, mes)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS busca_web_cache (
      cnpj TEXT PRIMARY KEY,
      provedor TEXT,
      paginas JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
};

// O Google conta a cota grátis por mês-calendário no fuso do Pacífico; contar no mesmo
// fuso evita "mês novo" aqui enquanto ainda é o mês velho lá.
const fusoGoogle = (agora, opcoes) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', ...opcoes }).format(agora);
const mesAtual = (agora = new Date()) => fusoGoogle(agora, { year: 'numeric', month: '2-digit' });
const diaAtual = (agora = new Date()) => fusoGoogle(agora, { year: 'numeric', month: '2-digit', day: '2-digit' });

// Reserva 1 chamada de forma atômica nos DOIS tetos (mês e dia). A reserva acontece ANTES
// da chamada e conta mesmo se ela falhar: errar para o lado de gastar menos. Sem linha
// devolvida = teto cheio, e a chamada não sai.
const reservarUso = async (pool, provedor, limiteMensal, agora = new Date(), limiteDiario = null) => {
  const mes = mesAtual(agora);
  if (limiteDiario !== null) {
    const dia = await pool.query(
      `INSERT INTO busca_web_uso (provedor, mes, usado) VALUES ($1, $2, 1)
       ON CONFLICT (provedor, mes) DO UPDATE SET usado = busca_web_uso.usado + 1
         WHERE busca_web_uso.usado < $3
       RETURNING usado`,
      [`${provedor}:dia`, diaAtual(agora), limiteDiario]
    );
    if (!dia.rows.length) return false;
  }
  const { rows } = await pool.query(
    `INSERT INTO busca_web_uso (provedor, mes, usado) VALUES ($1, $2, 1)
     ON CONFLICT (provedor, mes) DO UPDATE SET usado = busca_web_uso.usado + 1
       WHERE busca_web_uso.usado < $3
     RETURNING usado`,
    [provedor, mes, limiteMensal]
  );
  return rows.length > 0;
};

const erroDeProvedor = (mensagem, codigo, status) => {
  const e = new Error(mensagem);
  e.codigo = codigo;
  e.status = status;
  return e;
};

const temTelefone = (paginas) =>
  paginas.some((p) => /\d{4}[\s.-]?\d{4}/.test(`${p.title || ''} ${p.content || ''} ${p.raw_content || ''}`));

const buscarNoPlaces = async ({ alvo, apiKey, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${alvo.nome} ${alvo.municipio} ${alvo.uf}`.trim(),
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: 3,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      const codigo = [401, 403].includes(resp.status) ? 'auth' : resp.status === 429 ? 'cota' : 'transitorio';
      throw erroDeProvedor(`Places HTTP ${resp.status} ${corpo.slice(0, 120)}`.trim(), codigo, resp.status);
    }
    const d = await resp.json();
    return (d.places || [])
      .filter((p) => p.nationalPhoneNumber && p.businessStatus !== 'CLOSED_PERMANENTLY')
      .map((p) => ({
        url: p.websiteUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
        title: p.displayName?.text || '',
        content: `${p.displayName?.text || ''}. Endereço: ${p.formattedAddress || ''}. Telefone: ${p.nationalPhoneNumber}`,
        // O contatoWeb confere nome e cidade; aqui só entregamos os fatos do Google.
        googlePlace: { nome: p.displayName?.text || '', endereco: p.formattedAddress || '' },
      }));
  } finally {
    clearTimeout(timer);
  }
};

const buscarNoHeadless = async ({ alvo, url, fetchImpl, timeoutMs }) => {
  if (!url) throw erroDeProvedor('HEADLESS_SEARCH_URL não configurada', 'indisponivel');
  const resp = await fetchImpl(`${url}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `"${alvo.nome}" ${alvo.municipio} ${alvo.uf} telefone whatsapp`.trim(),
    }),
    signal: AbortSignal.timeout(timeoutMs * 2),
  });
  if (!resp.ok) throw erroDeProvedor(`headless HTTP ${resp.status}`, 'transitorio', resp.status);
  const d = await resp.json();
  return Array.isArray(d.paginas) ? d.paginas : [];
};

const criarBuscaWeb = ({
  pool,
  lerSegredo,              // (nome) => Promise<string|null>: cofre
  buscarNoTavily,          // injetado de contatoWeb (evita import circular)
  consultas = [],          // CONSULTAS de contatoWeb: { fonte, monta }
  fetchImpl = fetch,
  config = carregarConfigBusca(),
  agora = () => new Date(),
  log = console,
} = {}) => {
  // Circuit-breaker em memória: provedor esgotado/quebrado sai da fila por um tempo.
  const bloqueadoAte = new Map();
  const bloquear = (provedor, ms) => bloqueadoAte.set(provedor, agora().getTime() + ms);
  const bloqueado = (provedor) => (bloqueadoAte.get(provedor) || 0) > agora().getTime();
  const HORA = 3600 * 1000;

  const lerCache = async (cnpj) => {
    if (!cnpj) return null;
    const { rows } = await pool.query(
      `SELECT provedor, paginas, created_at FROM busca_web_cache WHERE cnpj = $1`, [cnpj]
    );
    const r = rows[0];
    if (!r) return null;
    const dias = (agora().getTime() - new Date(r.created_at).getTime()) / 86400000;
    const vazio = !r.paginas?.length;
    if (dias > (vazio ? config.cacheVazioDias : config.cacheDias)) return null;
    return r;
  };
  const gravarCache = async (cnpj, provedor, paginas) => {
    if (!cnpj) return;
    await pool.query(
      `INSERT INTO busca_web_cache (cnpj, provedor, paginas, created_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (cnpj) DO UPDATE SET provedor=$2, paginas=$3, created_at=NOW()`,
      [cnpj, provedor, JSON.stringify(paginas)]
    );
  };

  const provedores = {
    places: async ({ alvo }) => {
      const chave = await lerSegredo('GOOGLE_PLACES_API_KEY');
      if (!chave) throw erroDeProvedor('GOOGLE_PLACES_API_KEY não configurada', 'indisponivel');
      const cabe = await reservarUso(pool, 'places', config.placesLimiteMensal, agora(), config.placesLimiteDiario);
      if (!cabe) throw erroDeProvedor('cota gratuita mensal do Places esgotada', 'cota');
      return buscarNoPlaces({ alvo, apiKey: chave, fetchImpl, timeoutMs: config.timeoutMs });
    },
    tavily: async ({ alvo }) => {
      const chave = await lerSegredo('TAVILY_API_KEY');
      if (!chave) throw erroDeProvedor('TAVILY_API_KEY não configurada', 'indisponivel');
      // No máximo 2 consultas por lead (antes eram 4) e só a 2ª se a 1ª não trouxe telefone.
      const paginas = [];
      for (const fonte of ['site', 'razao']) {
        const c = consultas.find((x) => x.fonte === fonte);
        if (!c) continue;
        const achados = await buscarNoTavily({
          query: c.monta(alvo), apiKey: chave, fetchImpl, timeoutMs: config.timeoutMs,
        });
        paginas.push(...achados.map((r) => ({ ...r, fonte })));
        if (temTelefone(achados)) break;
      }
      return paginas;
    },
    headless: async ({ alvo }) => buscarNoHeadless({
      alvo, url: config.headlessUrl, fetchImpl, timeoutMs: config.timeoutMs,
    }),
  };

  // Devolve { paginas, falhas, provedor, doCache }. Nunca lança: falha vira `falhas`.
  const buscarPaginas = async ({ alvo }) => {
    const cnpj = alvo.cnpj || '';
    try {
      const cache = await lerCache(cnpj);
      if (cache) return { paginas: cache.paginas, falhas: [], provedor: cache.provedor, doCache: true };
    } catch (error) {
      log.warn?.('[busca-web] cache indisponível:', error.message);
    }

    const falhas = [];
    let algumRespondeu = false;
    for (const nome of config.ordem) {
      const executar = provedores[nome];
      if (!executar) continue;
      if (bloqueado(nome)) {
        falhas.push(`${nome}: em pausa`);
        continue;
      }
      try {
        const paginas = await executar({ alvo });
        algumRespondeu = true;
        if (temTelefone(paginas)) {
          await gravarCache(cnpj, nome, paginas).catch(() => {});
          return { paginas, falhas, provedor: nome, doCache: false };
        }
        falhas.push(`${nome}: sem telefone`);
      } catch (error) {
        falhas.push(`${nome}: ${String(error.message || error)}`);
        // Cota/credencial: pausa longa, os outros provedores assumem. Instabilidade: curta.
        if (error.codigo === 'cota') bloquear(nome, 6 * HORA);
        else if (error.codigo === 'auth' || error.codigo === 'indisponivel') bloquear(nome, HORA);
        else if (error.status === 432 || error.status === 429) bloquear(nome, 6 * HORA);
        else bloquear(nome, 10 * 60 * 1000);
      }
    }
    // Só cacheia "nada" se alguém de fato respondeu; falha de provedor não vira negativa.
    if (algumRespondeu) await gravarCache(cnpj, 'nenhum', []).catch(() => {});
    return { paginas: [], falhas, provedor: null, doCache: false, transitorio: !algumRespondeu };
  };

  return { buscarPaginas, provedores, bloqueado, bloquear };
};

module.exports = {
  PLACES_TETO_MENSAL_ABSOLUTO,
  PLACES_FIELD_MASK,
  carregarConfigBusca,
  criarTabelasBuscaWeb,
  reservarUso,
  criarBuscaWeb,
  buscarNoPlaces,
  temTelefone,
};
