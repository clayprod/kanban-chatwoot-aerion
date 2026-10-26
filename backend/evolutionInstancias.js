// Qual número da Aerion manda a mensagem.
//
// Em 23/10/2026 mandei duas mensagens de prospecção pelo número PESSOAL do Clayton.
// A causa foi uma só: `EVOLUTION_INSTANCE` no serviço estava com `claytoncosta`, e
// todo envio pela via Evolution usava essa variável sem perguntar de quem era o
// número. Pior: aquela instância não tem a integração Chatwoot ligada, então as
// mensagens saíram de verdade e não apareceram no CRM — ninguém no comercial soube.
//
// A correção não é trocar o valor da env. É parar de confiar numa env para isso:
//
// 1. A fonte de verdade de quais números são da Aerion é o próprio Chatwoot. Cada
//    inbox `Channel::Api` tem um `webhook_url` apontando para a instância do Evolution
//    (`.../chatwoot/webhook/ian_aerion`), e é desse par inbox↔instância que saem os
//    nomes válidos. Instância que não tem inbox não é da operação comercial.
// 2. Contato que já tem conversa recebe pelo número da conversa dele — a regra do
//    `fixarNumero`: lead que recebe de número diferente a cada contato reporta.
// 3. Contato novo recebe pelo número menos carregado do dia, entre os da Aerion.
// 4. Enviar por instância fora dessa lista é ERRO, não fallback silencioso.

const INSTANCIA_DO_WEBHOOK = /\/chatwoot\/webhook\/([^/?#]+)/i;

// "https://evolution.../chatwoot/webhook/Comercial%20-%20Aerion%20Technologies"
//   → "Comercial - Aerion Technologies"
const instanciaDoWebhook = (url) => {
  const m = INSTANCIA_DO_WEBHOOK.exec(String(url || ''));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim() || null;
  } catch {
    return m[1].trim() || null;
  }
};

// Pares inbox↔instância vindos do Chatwoot. Cacheado porque muda quando alguém
// conecta um número novo, não a cada mensagem.
const criarMapaDeInstancias = ({ pool, ttlMs = 5 * 60 * 1000 } = {}) => {
  let cache = null;

  const carregar = async (accountId) => {
    if (cache && Date.now() - cache.em < ttlMs) return cache.valor;
    const { rows } = await pool.query(
      `SELECT i.id AS inbox_id, i.name AS inbox, ca.webhook_url
         FROM inboxes i
         JOIN channel_api ca ON ca.id = i.channel_id
        WHERE i.account_id = $1 AND i.channel_type = 'Channel::Api'`,
      [accountId]
    );
    const porInbox = new Map();
    const porInstancia = new Map();
    for (const r of rows) {
      const instancia = instanciaDoWebhook(r.webhook_url);
      if (!instancia) continue;
      const item = { inboxId: Number(r.inbox_id), inbox: r.inbox, instancia };
      porInbox.set(item.inboxId, item);
      porInstancia.set(instancia.toLowerCase(), item);
    }
    const valor = { porInbox, porInstancia };
    cache = { em: Date.now(), valor };
    return valor;
  };

  return {
    carregar,
    limpar: () => { cache = null; },
  };
};

// A instância é da operação comercial? Usado como trava antes de qualquer envio.
const instanciaPermitida = (mapa, instancia) => {
  if (!instancia) return false;
  return mapa.porInstancia.has(String(instancia).toLowerCase());
};

// Escolhe o número que vai mandar.
//
// `inboxId` vem da conversa do contato: se ele já falou com a gente por um número,
// é por aquele que ele recebe. Sem conversa, vai o menos carregado hoje — e se dois
// empatam, o de nome menor, só para a escolha ser determinística e testável.
const escolherInstancia = (mapa, { inboxId = null, carga = new Map(), permitidas = null } = {}) => {
  const elegiveis = [...mapa.porInbox.values()].filter((i) => (
    !permitidas || permitidas.includes(i.instancia) || permitidas.includes(String(i.inbox))
  ));
  if (!elegiveis.length) {
    return { erro: 'nenhuma instância da Aerion configurada (inbox Channel::Api sem webhook do Evolution)' };
  }

  if (inboxId != null) {
    const fixa = mapa.porInbox.get(Number(inboxId));
    if (fixa && elegiveis.some((e) => e.inboxId === fixa.inboxId)) {
      return { ...fixa, motivo: 'número da conversa do contato' };
    }
  }

  const ordenado = [...elegiveis].sort((a, b) => {
    const ca = Number(carga.get(a.inboxId)?.hoje || 0);
    const cb = Number(carga.get(b.inboxId)?.hoje || 0);
    if (ca !== cb) return ca - cb;
    return a.instancia.localeCompare(b.instancia);
  });
  return { ...ordenado[0], motivo: 'número menos carregado hoje' };
};

// O token de cada instância, por env própria.
//
// A chave GLOBAL do Evolution abre todas as instâncias do servidor — inclusive a
// pessoal do Clayton e a do c2finance, que é outro projeto e não pertence à Aerion.
// Dar essa chave ao kanban seria deixá-lo falar por números que não são da operação
// comercial. Com um token por instância, o alcance é o que está configurado aqui:
// sem o token, não envia, e não tem como alcançar o que não foi dado.
const SLUG_DA_INSTANCIA = (nome) => String(nome || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const tokenDaInstancia = (instancia, env = process.env) => {
  const slug = SLUG_DA_INSTANCIA(instancia);
  // "Comercial - Aerion Technologies" → EVOLUTION_TOKEN_COMERCIAL_AERION_TECHNOLOGIES,
  // e também um apelido curto pelo primeiro termo: EVOLUTION_TOKEN_COMERCIAL.
  const curto = slug.split('_')[0];
  return env[`EVOLUTION_TOKEN_${slug}`] || env[`EVOLUTION_TOKEN_${curto}`] || null;
};

// Envia pela instância escolhida. Sem default implícito: quem chama diz a instância,
// e ela tem que estar na lista — é isso que impede repetir o erro de hoje.
const criarEnvioEvolution = ({
  baseUrl = process.env.EVOLUTION_API_URL,
  apiKey = null,
  env = process.env,
  // Resolve o token fora do env (ver segredos.js): o EasyPanel apaga env posta por
  // CLI a cada deploy, e em 26/10 isso deixou 6 prospeccoes presas na fila.
  resolverToken = null,
  fetchImpl = fetch,
  timeoutMs = 20000,
} = {}) => async ({ numero, texto, instancia }) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Evolution API não configurada (EVOLUTION_API_URL).');
  if (!instancia) throw new Error('instância não informada: envio sem número de origem definido');
  const chave = apiKey
    || (resolverToken ? await resolverToken(instancia) : null)
    || tokenDaInstancia(instancia, env);
  if (!chave) {
    throw new Error(
      `sem token para a instância "${instancia}": defina EVOLUTION_TOKEN_${SLUG_DA_INSTANCIA(instancia)}`
    );
  }
  const digitos = String(numero || '').replace(/\D/g, '');
  if (digitos.length < 10) throw new Error(`número inválido para envio: "${numero}"`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`${base}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      // Evolution v2 aceita só `apikey` minúsculo; mandar as duas grafias faz o undici
      // colapsar o header e devolver 401.
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify({ number: digitos, text: String(texto || '') }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      throw new Error(`Evolution API ${resp.status}: ${String(corpo).slice(0, 300)}`);
    }
    return resp.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
};

module.exports = {
  SLUG_DA_INSTANCIA,
  tokenDaInstancia,
  instanciaDoWebhook,
  criarMapaDeInstancias,
  instanciaPermitida,
  escolherInstancia,
  criarEnvioEvolution,
};
