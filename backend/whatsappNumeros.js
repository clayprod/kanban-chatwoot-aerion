// Verificação de existência de número no WhatsApp, antes de enfileirar campanha.
//
// Por que isto existe: mandar mensagem para número que não tem WhatsApp é um dos
// sinais mais fortes de spam para o anti-abuso do WhatsApp — é exatamente o padrão
// de quem comprou lista. Medido em 2026-09-24, as três instâncias da Aerion estavam
// com ~60% de taxa de sucesso (287, 352 e 319 erros), e o erro real observado era
// `{"exists": false}` vindo da Evolution.
//
// Heurística de "fixo x celular" NÃO serve: 551136466600 é fixo e tem WhatsApp
// Business ativo. Quem sabe é a Evolution, então é ela que responde.
//
// Falha da verificação não bloqueia a campanha (fail-open): derrubar um disparo
// inteiro porque a Evolution piscou é pior que o risco que se evita. Mas o resumo
// devolve `verificacao_indisponivel` para a UI avisar em vez de mentir que está tudo
// certo.

const LOTE = 100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h: existir no WhatsApp muda devagar

const soDigitos = (valor) => String(valor || '').replace(/[^0-9]/g, '');

// Cache em memória: o preview é chamado várias vezes enquanto o usuário mexe nos
// filtros, e não faz sentido reconsultar os mesmos números a cada clique.
const cache = new Map(); // numero -> { existe, em }

const limparCacheExpirado = (agora) => {
  for (const [numero, entrada] of cache) {
    if (agora - entrada.em > CACHE_TTL_MS) cache.delete(numero);
  }
};

const lotes = (itens, tamanho) => {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
};

// A Evolution devolve [{ jid, exists, number, name }]. O `number` volta como foi
// enviado; o `jid` pode vir normalizado (ela mesma ajusta o 9º dígito), então o
// casamento é feito pelo `number` e, como reforço, pelos dígitos do jid.
const indexarResposta = (linhas, enviados) => {
  const existentes = new Set();
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    if (!linha || linha.exists !== true) continue;
    const doNumber = soDigitos(linha.number);
    if (doNumber) existentes.add(doNumber);
    const doJid = soDigitos(String(linha.jid || '').split('@')[0]);
    if (doJid) existentes.add(doJid);
  }
  // Um número enviado cujo jid voltou normalizado (perdeu/ganhou o 9) ainda conta:
  // se o jid existe, a Evolution vai entregar.
  return new Set(enviados.filter(n => existentes.has(n)
    || existentes.has(n.replace(/^55(\d{2})9(\d{8})$/, '55$1$2'))
    || existentes.has(n.replace(/^55(\d{2})(\d{8})$/, '55$19$2'))));
};

// Devolve { existentes:Set, indisponivel:boolean }. `indisponivel` = não deu para
// verificar (sem config ou erro) — quem chama decide o que fazer.
const verificarNumerosWhatsapp = async (telefones, {
  baseUrl = process.env.EVOLUTION_API_URL,
  instancia = process.env.EVOLUTION_INSTANCE,
  apiKey = process.env.EVOLUTION_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 20000,
  agora = Date.now(),
} = {}) => {
  const numeros = [...new Set(telefones.map(soDigitos).filter(Boolean))];
  if (!numeros.length) return { existentes: new Set(), indisponivel: false };

  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base || !instancia || !apiKey) {
    return { existentes: new Set(numeros), indisponivel: true };
  }

  limparCacheExpirado(agora);
  const existentes = new Set();
  const aConsultar = [];
  for (const numero of numeros) {
    const emCache = cache.get(numero);
    if (emCache) {
      if (emCache.existe) existentes.add(numero);
    } else {
      aConsultar.push(numero);
    }
  }
  if (!aConsultar.length) return { existentes, indisponivel: false };

  let indisponivel = false;
  for (const lote of lotes(aConsultar, LOTE)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(`${base}/chat/whatsappNumbers/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ numbers: lote }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const linhas = await resp.json();
      const doLote = indexarResposta(linhas, lote);
      for (const numero of lote) {
        const existe = doLote.has(numero);
        cache.set(numero, { existe, em: agora });
        if (existe) existentes.add(numero);
      }
    } catch (error) {
      // Fail-open: sem veredito, o número segue no público.
      console.warn('[whatsapp-check] lote não verificado:', error.message);
      indisponivel = true;
      for (const numero of lote) existentes.add(numero);
    } finally {
      clearTimeout(timer);
    }
  }
  return { existentes, indisponivel };
};

const limparCacheWhatsapp = () => cache.clear();

module.exports = {
  LOTE,
  CACHE_TTL_MS,
  soDigitos,
  indexarResposta,
  verificarNumerosWhatsapp,
  limparCacheWhatsapp,
};
