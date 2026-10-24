// Catálogo da loja: o que a IA pode afirmar sobre produto, preço e link.
//
// A loja é WordPress/WooCommerce em loja.aerion.com.br, no mesmo servidor, com o
// plugin `aerion-commerce`. Três fontes, com papéis diferentes:
//
// - `aerion/v1/products/search` — PÚBLICO e sem preço: nome, SKU, link e imagem.
//   É daqui que sai link de produto, e por não ter preço não tem risco de vazamento.
// - `wc/v3/products` (consumer key/secret já guardados em `ecommerce_connections`) —
//   preço público (`price` no PIX, `regular_price` no cartão), tabela de revenda em
//   `_aerion_trade_price`, estoque, e as metas técnicas `_aerion_filter_*`.
// - `aerion/v1/registration/cnpj/{cnpj}` — diz se o CNPJ já é PJ aprovado na loja.
//   É a única prova forte de que o lead é revenda (ver `podeFalarTabelaRevenda`).
//
// Tiers, como o plugin implementa (`class-aerion-tiers.php`): sem nível, Silver (-5%
// sobre o PV) e Gold (-8%), com meta de sell-in trimestral de R$ 60k e R$ 120k. O
// preço do parceiro é o melhor entre a tabela de revenda e o PV menos o desconto do
// nível — a conta aqui espelha isso, mas o número que vale é sempre o que o site
// mostra para ele logado, e é por isso que a mensagem manda o LINK.
//
// Nada aqui inventa: campo vazio volta como null e a IA é instruída a não afirmar.

const CACHE_TTL_MS = 10 * 60 * 1000;

// Cache por instancia, nao do modulo: resposta de uma loja nunca pode aparecer na
// consulta de outra, e cada teste comeca limpo sem depender de ordem.
const criarCache = () => {
  const mapa = new Map();
  return {
    async com(chave, fn, ttl = CACHE_TTL_MS) {
      const agora = Date.now();
      const atual = mapa.get(chave);
      if (atual && agora - atual.em < ttl) return atual.valor;
      const valor = await fn();
      mapa.set(chave, { em: agora, valor });
      return valor;
    },
    limpar: () => mapa.clear(),
  };
};

const DESCONTO_TIER = { silver: 0.05, gold: 0.08 };
const META_TIER = { silver: 60000, gold: 120000 };

const numero = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const baseDaLoja = (url) => String(url || '').replace(/\/+$/, '');

// Preço do parceiro: o melhor entre a tabela de revenda e o PV menos o desconto do
// nível. Mesma ordem do `Aerion_Pricing::quote` no plugin.
const precoDoParceiro = ({ publico, tabelaRevenda, tier = 'none' }) => {
  const desconto = DESCONTO_TIER[tier] || 0;
  // Sem nivel nao existe desconto, e "PV menos zero" nao e preco de parceiro: seria
  // devolver o preco publico como se fosse tabela de revenda.
  const porNivel = desconto > 0 && publico ? publico * (1 - desconto) : null;
  const candidatos = [tabelaRevenda, porNivel].filter((v) => typeof v === 'number' && v > 0);
  if (!candidatos.length) return null;
  return Math.min(...candidatos);
};

const criarCatalogoAerion = ({ carregarConfigLoja, fetchImpl = fetch } = {}) => {
  if (typeof carregarConfigLoja !== 'function') {
    throw new Error('carregarConfigLoja é obrigatório');
  }

  const cache = criarCache();
  const config = () => carregarConfigLoja();

  const wc = async (caminho, params = {}) => {
    const cfg = await config();
    if (!cfg?.url || !cfg?.consumer_key || !cfg?.consumer_secret) {
      throw new Error('loja sem credencial WooCommerce configurada');
    }
    const url = new URL(`${baseDaLoja(cfg.url)}/wp-json/wc/v3/${caminho}`);
    url.search = new URLSearchParams(params).toString();
    const auth = Buffer.from(`${cfg.consumer_key}:${cfg.consumer_secret}`).toString('base64');
    const resp = await fetchImpl(url.toString(), { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) throw new Error(`loja HTTP ${resp.status} em ${caminho}`);
    return resp.json();
  };

  const publico = async (caminho, params = {}) => {
    const cfg = await config();
    if (!cfg?.url) throw new Error('loja sem URL configurada');
    const url = new URL(`${baseDaLoja(cfg.url)}/wp-json/aerion/v1/${caminho}`);
    url.search = new URLSearchParams(params).toString();
    const resp = await fetchImpl(url.toString());
    if (!resp.ok) throw new Error(`loja HTTP ${resp.status} em ${caminho}`);
    return resp.json();
  };

  // Busca pública: nome, SKU, link, imagem, família. Sem preço, de propósito.
  const buscarProdutos = async (termo, { limite = 5 } = {}) => {
    const q = String(termo || '').trim();
    if (!q) return [];
    const dados = await cache.com(`busca:${q.toLowerCase()}`, () => publico('products/search', { q }));
    return (Array.isArray(dados) ? dados : []).slice(0, limite).map((p) => ({
      nome: p.name,
      sku: p.sku || null,
      link: p.url,
      imagem: p.image || null,
      familia: p.family || null,
    }));
  };

  const META_TECNICA = {
    _aerion_filter_camera: 'câmera',
    _aerion_filter_rtk: 'RTK',
    _aerion_filter_battery_count: 'baterias',
    _aerion_filter_license: 'licença',
    _aerion_filter_product_type: 'tipo',
  };

  const normalizarProduto = (p) => {
    const meta = Object.fromEntries((p.meta_data || []).map((m) => [m.key, m.value]));
    const ficha = {};
    for (const [chave, rotulo] of Object.entries(META_TECNICA)) {
      const v = String(meta[chave] ?? '').trim();
      if (v) ficha[rotulo] = v;
    }
    return {
      id: p.id,
      nome: p.name,
      sku: p.sku || null,
      link: p.permalink,
      estoque: p.stock_status || null,
      categorias: (p.categories || []).map((c) => c.name),
      resumo: String(p.short_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null,
      precoPublicoPix: numero(p.price),
      precoPublicoCartao: numero(p.regular_price),
      tabelaRevendaCartao: numero(meta._aerion_trade_price),
      ficha,
    };
  };

  // Detalhe com preço. Usa o SKU quando vem da busca pública, que é o que a IA tem.
  const detalheProduto = async ({ sku, id } = {}) => {
    const chave = `produto:${id || sku || ''}`;
    if (!id && !sku) return null;
    return cache.com(chave, async () => {
      const lista = id
        ? [await wc(`products/${id}`)]
        : await wc('products', { sku, per_page: 1 });
      const p = Array.isArray(lista) ? lista[0] : lista;
      return p && p.id ? normalizarProduto(p) : null;
    });
  };

  // O CNPJ já é PJ aprovado na loja? Fail-closed: erro devolve null, e sem "sim"
  // explícito nenhuma tabela de revenda é liberada.
  const cnpjAprovadoNaLoja = async (cnpj) => {
    const digitos = String(cnpj || '').replace(/[^0-9A-Za-z]/g, '');
    if (digitos.length !== 14) return null;
    try {
      const dados = await cache.com(`cnpj:${digitos}`, () => publico(`registration/cnpj/${digitos}`));
      if (!dados || typeof dados !== 'object') return null;
      const aprovado = dados.approved ?? dados.aprovado ?? dados.is_approved;
      if (typeof aprovado === 'boolean') return aprovado;
      const status = String(dados.status || dados.situacao || '').toLowerCase();
      if (!status) return null;
      return ['approved', 'aprovado', 'ativo', 'active'].includes(status);
    } catch {
      return null;
    }
  };

  // O que a IA pode dizer de preço, dado o perfil. Devolve texto pronto para o prompt
  // e os números — ou a razão de não ter preço, que a IA usa para não inventar.
  const precoParaPerfil = (produto, { revendaConfirmada = false, tier = 'none' } = {}) => {
    if (!produto) return null;
    const publicoPix = produto.precoPublicoPix;
    const publicoCartao = produto.precoPublicoCartao;
    if (!revendaConfirmada) {
      return {
        pode: Boolean(publicoPix),
        tabela: 'publico',
        pix: publicoPix,
        cartao: publicoCartao,
        motivo: publicoPix ? null : 'produto sem preço publicado',
      };
    }
    const parceiro = precoDoParceiro({
      publico: publicoCartao || publicoPix,
      tabelaRevenda: produto.tabelaRevendaCartao,
      tier,
    });
    if (!parceiro) {
      return {
        pode: false,
        tabela: 'revenda',
        motivo: 'este produto não tem tabela de revenda cadastrada',
      };
    }
    return { pode: true, tabela: 'revenda', cartao: parceiro, tier, publicoCartao };
  };

  // A loja tem 30 produtos publicados (medido em 2026-10-23), entao o catalogo inteiro
  // cabe no prompt. Isso evita duas chamadas de IA (uma para escolher produto, outra
  // para escrever) e, principalmente, evita a IA citar produto que nao existe.
  const carregarCatalogo = async () => cache.com('catalogo', async () => {
    const lista = await wc('products', { per_page: 100, status: 'publish' });
    return (Array.isArray(lista) ? lista : []).map(normalizarProduto);
  });

  const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

  // Catalogo pronto para o prompt, com SO o preco que este lead pode ver.
  //
  // A trava mais importante do sistema esta aqui: se o lead nao e revenda confirmada,
  // a tabela de revenda NAO ENTRA no texto. A IA nao pode vazar um numero que ela
  // nunca recebeu — e trava de contexto, nao de boa vontade do modelo.
  const blocoCatalogo = (produtos, { revendaConfirmada = false, tier = 'none' } = {}) => {
    const linhas = [];
    for (const p of produtos || []) {
      const preco = precoParaPerfil(p, { revendaConfirmada, tier });
      const partes = [p.nome];
      if (p.sku) partes.push(`SKU ${p.sku}`);
      if (preco?.pode) {
        partes.push(preco.tabela === 'revenda'
          ? `tabela de revenda ${reais(preco.cartao)} no cartao`
          : `${reais(preco.pix)} no PIX${preco.cartao ? ` / ${reais(preco.cartao)} no cartao` : ''}`);
      } else {
        partes.push('preco so com o vendedor');
      }
      if (p.estoque && p.estoque !== 'instock') {
        partes.push(p.estoque === 'onbackorder' ? 'sob encomenda' : 'sem estoque');
      }
      const ficha = Object.entries(p.ficha || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
      if (ficha) partes.push(ficha);
      partes.push(p.link);
      linhas.push(`- ${partes.join(' | ')}`);
    }
    if (!linhas.length) return 'CATALOGO: indisponivel agora. Nao afirme preco, prazo nem modelo.';
    return [
      revendaConfirmada
        ? `CATALOGO DA LOJA com a TABELA DE REVENDA deste parceiro${tier && tier !== 'none' ? ` (nivel ${tier})` : ''}:`
        : 'CATALOGO DA LOJA com o preco publico:',
      ...linhas,
      '',
      'Regras de uso do catalogo:',
      '- So fale de produto que esta nesta lista, com o nome exato dela.',
      '- Preco: use SOMENTE o numero que esta aqui. Nunca calcule desconto, parcela,',
      '  frete ou condicao de pagamento, e nunca prometa prazo de entrega.',
      '- Produto marcado "preco so com o vendedor": diga que vai confirmar, nao chute.',
      '- Mande o link do produto quando ele ajudar a pessoa a decidir. O site mostra',
      '  o preco certo para quem esta logado.',
      revendaConfirmada
        ? '- Este preco e de PARCEIRO. Nao mencione que existe outra tabela.'
        : '- NUNCA mencione tabela de revenda, desconto de distribuidor ou margem.',
    ].join(String.fromCharCode(10));
  };

  return {
    buscarProdutos,
    detalheProduto,
    carregarCatalogo,
    blocoCatalogo,
    cnpjAprovadoNaLoja,
    precoParaPerfil,
    limparCache: cache.limpar,
  };
};

module.exports = {
  criarCatalogoAerion,
  precoDoParceiro,
  DESCONTO_TIER,
  META_TIER,
};
