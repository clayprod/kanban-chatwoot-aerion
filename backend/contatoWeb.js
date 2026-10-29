// Achar o WhatsApp real da empresa na web, sem trazer o número de outra empresa.
//
// Roda por baixo: nada disto aparece na tela. O que a operação vê é o contato já
// importado com um número que presta, e o log de prospecção com a origem.
//
// Por que existe: o telefone que a empresa declara na Receita é a linha da recepção.
// Medido em 24/10 sobre ~360 empresas de 9 recortes de CNAE × porte, **2 tinham
// WhatsApp**. Sem buscar fora, a prospecção avalia dezenas e aborda zero.
//
// Por que é perigoso: em 22/10 a busca respondeu com confiança e errado — afirmou
// que a SERTEC de Vinhedo/SP atende no (94) 3322-1241, DDD do Pará, de uma homônima
// numa lista do governo. Número errado com cara de certeza é pior que número nenhum.
//
// Como funciona, e por que assim: não dá para exigir prova perfeita. Nem todo site
// publica CNPJ, e muita empresa só é achável pelo nome curto — "Sertec", "Veracruz" —
// e não pela razão social inteira. Então o módulo faz o que uma pessoa faria: junta
// indícios (é a mesma cidade? é o mesmo ramo? o nome bate no domínio? o DDD fecha com
// a UF?), soma pontos, e quando o caso é claro decide sozinho. Quando é duvidoso,
// entrega tudo o que apurou para a IA julgar — e ela pode recusar.
//
// Duas regras são absolutas, porque já custaram caro:
//   - DDD incompatível com a UF da empresa: descarta, sem pontuação.
//   - Agregador de CNPJ (cnpja, casadosdados, gov.br…): descarta. Ele republica o
//     cadastro da Receita, então devolve o mesmo telefone inútil parecendo um achado
//     ótimo — medido em 24/10, 10 dos 13 números encontrados vieram daí.

const DDD_UF = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR',
  47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS',
  68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 87: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 88: 'CE',
  86: 'PI', 89: 'PI', 91: 'PA', 93: 'PA', 94: 'PA', 92: 'AM', 97: 'AM',
  95: 'RR', 96: 'AP', 98: 'MA', 99: 'MA',
};

// Empresa de Brasília com número de Goiás é comum; o inverso também. Sem isto a
// trava descartaria contato legítimo.
const UF_VIZINHAS = {
  DF: ['GO', 'MG'], GO: ['DF', 'MG', 'MT', 'MS', 'BA', 'TO'],
  SP: ['MG', 'RJ', 'PR', 'MS'], RJ: ['SP', 'MG', 'ES'], ES: ['RJ', 'MG', 'BA'],
  MG: ['SP', 'RJ', 'ES', 'BA', 'GO', 'DF', 'MS'],
  PR: ['SP', 'SC', 'MS'], SC: ['PR', 'RS'], RS: ['SC'],
  MT: ['MS', 'GO', 'RO', 'TO', 'PA'], MS: ['SP', 'PR', 'MT', 'GO', 'MG'],
  BA: ['MG', 'GO', 'TO', 'PI', 'PE', 'AL', 'SE', 'ES'],
  PE: ['BA', 'AL', 'PB', 'CE', 'PI'], CE: ['PI', 'PE', 'PB', 'RN'],
  PA: ['AM', 'MT', 'TO', 'MA', 'AP', 'RR'], AM: ['PA', 'RO', 'AC', 'RR'],
  TO: ['GO', 'BA', 'PI', 'MA', 'PA', 'MT'], MA: ['PI', 'TO', 'PA'],
  PI: ['MA', 'CE', 'PE', 'BA', 'TO'], RN: ['CE', 'PB'], PB: ['RN', 'PE', 'CE'],
  AL: ['PE', 'SE', 'BA'], SE: ['AL', 'BA'], RO: ['AM', 'MT', 'AC'],
  AC: ['AM', 'RO'], RR: ['AM', 'PA'], AP: ['PA'],
};

const AGREGADORES = [
  'cnpja.com', 'cnpj.info', 'cnpjcheck', 'casadosdados', 'econodata', 'empresascnpj',
  'consultacnpj', 'cnpj.biz', 'cnpj.rocks', 'solutudo', 'hiperguia', 'guiamais',
  'telelistas', 'apontador', 'kekanto', 'encontraempresas', 'situacaocadastral',
  'informecadastral', 'gov.br', 'jusbrasil', 'escavador', 'receitaws', 'cnpjs.rocks',
  'buscacnpj', 'listamais', 'cadastroempresa', 'empresaqui', 'cnpj.center',
  'consultasocio', 'portaldatransparencia', 'linkedin.com/jobs', 'indeed.com',
  'catho.com', 'vagas.com', 'glassdoor',
  // Vistos na medicao de 24/10 devolvendo telefone que nao era da empresa:
  'serasaexperian', 'fornecedoresdoagro', 'sitenacidade', 'civil.com.br',
  'mp.br', 'tjmg', 'tjsp', 'diariooficial', 'imprensaoficial', 'prefeitura',
  'camara.leg.br', 'licitacoes', 'comprasnet', 'kitdopreso', 'guiafacil',
  'ondefica', 'empresite', 'cylex', 'infoempresas', 'buscasim', 'empresasamapa',
  'empresasdobrasil', 'cnpjbrasil', 'guiaempresas', 'achecnpj',
];

const REDES = ['instagram.com', 'facebook.com', 'linkedin.com', 'youtube.com', 'tiktok.com'];

const ehAgregador = (url) => {
  const u = String(url || '').toLowerCase();
  return AGREGADORES.some((d) => u.includes(d));
};

const semAcento = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const soDigitos = (v) => String(v || '').replace(/[^0-9]/g, '');

// Palavras que não dizem QUAL empresa é.
const GENERICAS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'do', 'da', 'de', 'dos', 'das', 'e',
  'comercio', 'servicos', 'servico', 'industria', 'empresa', 'grupo', 'brasil',
  'tecnologia', 'engenharia', 'solucoes', 'consultoria', 'participacoes', 'holding',
  'construtora', 'construcoes', 'projetos', 'assessoria', 'representacoes', 'spe',
  'ambiental', 'mineracao', 'topografia', 'incorporadora', 'eng', 'com', 'ind',
]);

const termosSignificativos = (nome) => semAcento(nome)
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter((t) => t.length >= 4 && !GENERICAS.has(t));

// O nome curto pelo qual a empresa é conhecida. "SERTEC ENGENHARIA LTDA" → "sertec";
// "VERACRUZ SOLUCOES GEOFISICAS" → "veracruz". Quase toda empresa tem um, mesmo sem
// nome fantasia cadastrado, e é por ele que ela aparece na web.
const nomeCurto = (razaoSocial, nomeFantasia) => {
  for (const fonte of [nomeFantasia, razaoSocial]) {
    const termos = termosSignificativos(fonte);
    if (termos.length) return termos[0];
  }
  // Nome inteiro generico ("D.A.G. CONSTRUTORA", "COMERCIO E SERVICOS"): nao existe
  // nome curto. Devolver "construtora" como se fosse o nome fez a D.A.G. casar com
  // construtorabrf.com.br e receber o telefone de outra construtora (medido 24/10).
  return '';
};

const TELEFONE_RE = /(?:\+?55[\s.-]?)?\(?([1-9][0-9])\)?[\s.-]?(9?[0-9]{4})[\s.-]?([0-9]{4})\b/g;

// Janela de proximidade: o telefone tem que estar a esta distancia, em caracteres,
// de alguma mencao do nome da empresa.
const JANELA_PROXIMIDADE = 500;

// Distancia, em caracteres, entre o telefone e a mencao mais proxima do nome da
// empresa. Sem isto, qualquer telefone de uma pagina grande vira "contato dela":
// medido em 24/10, a ERVALIA CONSTRUTORA recebeu o celular de uma pagina sobre
// unidades prisionais que falava da CIDADE de Ervalia, e o Serasa deu o MESMO numero
// para duas empresas diferentes.
const extrairTelefones = (texto, { ancoras = [] } = {}) => {
  const corpo = String(texto || '');
  const plano = semAcento(corpo);
  const posicoesAncora = [];
  for (const a of ancoras.filter(Boolean)) {
    const alvo = semAcento(a);
    if (!alvo) continue;
    let i = plano.indexOf(alvo);
    while (i !== -1) { posicoesAncora.push(i); i = plano.indexOf(alvo, i + 1); }
  }
  const achados = new Map();
  for (const m of corpo.matchAll(TELEFONE_RE)) {
    const ddd = m[1];
    const numero = `${m[2]}${m[3]}`;
    if (numero.length !== 8 && numero.length !== 9) continue;
    const celular = numero.length === 9 && numero.startsWith('9');
    const fixo = numero.length === 8 && /^[2-5]/.test(numero);
    if (!celular && !fixo) continue;
    const completo = `55${ddd}${numero}`;
    const distancia = posicoesAncora.length
      ? Math.min(...posicoesAncora.map((pos) => Math.abs(pos - (m.index ?? 0))))
      : null;
    const atual = achados.get(completo);
    if (!atual || (distancia !== null && (atual.distancia === null || distancia < atual.distancia))) {
      achados.set(completo, { numero: completo, ddd, celular, distancia });
    }
  }
  return [...achados.values()];
};

const ufCompativel = (ddd, uf) => {
  const doDdd = DDD_UF[Number(ddd)];
  if (!doDdd || !uf) return false;
  const alvo = String(uf).toUpperCase();
  if (doDdd === alvo) return true;
  return (UF_VIZINHAS[alvo] || []).includes(doDdd);
};

// Termos do ramo, tirados da descrição do CNAE. Servem para responder "é o mesmo
// ramo?" — uma SERTEC de engenharia não é a SERTEC de refrigeração.
const termosDoRamo = (cnaeDescricao) => semAcento(cnaeDescricao)
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter((t) => t.length >= 5 && !['outras', 'outros', 'demais', 'exceto', 'propria', 'quando'].includes(t))
  .slice(0, 6);

// Pontuação de uma página candidata. Cada sinal vale o que vale porque responde uma
// pergunta que uma pessoa faria ao olhar o resultado da busca.
const PESOS = {
  cnpj: 50,            // é a empresa, sem discussão
  nomeNoDominio: 25,   // site próprio dela
  nomeNoTexto: 12,     // ela é citada na página
  nomeCompleto: 15,    // todos os termos da razão social, não só o nome curto
  cidade: 20,          // mesma cidade
  uf: 5,
  ramo: 15,            // mesmo ramo de atuação
  siteProprio: 10,     // domínio não é agregador nem rede social
  redeDaEmpresa: 18,   // perfil cujo @ contém o nome curto
  pareceEmpresa: 6,    // tem cara de página institucional
  celular: 12,         // é onde mora o WhatsApp
  pertoDoNome: 15,     // o telefone está colado na menção da empresa
  longeDoNome: -30,    // está na página, mas podia ser de qualquer um
};

const LIMIAR_ACEITA = 60;   // claro o bastante para decidir sozinho
const LIMIAR_DUVIDA = 30;   // abaixo disso nem vale perguntar para a IA

const pontuarPagina = ({ texto, url, empresa }) => {
  const razaoSocial = empresa?.razao_social || '';
  const nomeFantasia = empresa?.nome_fantasia || '';
  const cnpj = soDigitos(empresa?.cnpj);
  const municipio = empresa?.municipio_nome || '';
  const uf = empresa?.uf || '';
  const corpo = semAcento(texto);
  const endereco = semAcento(url);
  let parsed;
  try { parsed = new URL(url); } catch { return {pontos:0,sinais:['URL inválida'],dominioDaEmpresa:false,identidadeComprovada:false}; }
  const rede = REDES.find(r=>parsed.hostname===r||parsed.hostname.endsWith('.'+r));
  // A search query or article slug mentioning the company does not own the host.
  const identificador = rede ? parsed.pathname.split('/').filter(Boolean)[0] || '' : parsed.hostname;
  const dominio = semAcento(identificador).replace(/[^a-z0-9]/g, '');
  const curto = nomeCurto(razaoSocial, nomeFantasia);

  const sinais = [];
  let pontos = 0;
  const somar = (peso, descricao) => { pontos += peso; sinais.push(descricao); };

  if (cnpj.length === 14 && soDigitos(texto).includes(cnpj)) somar(PESOS.cnpj, 'CNPJ na página');
  // Nome curto igual ao nome da cidade nao diz nada: a ERVALIA CONSTRUTORA pegou o
  // telefone de uma pagina sobre a CIDADE de Ervalia porque "ervalia" aparecia nela
  // o tempo todo. Nesse caso o nome nao pontua no texto, so no dominio.
  // Vale para o endereco tambem: facebook.com/pmervalia e a PREFEITURA de Ervalia,
  // nao a ERVALIA CONSTRUTORA. O nome da cidade aparece no dominio de meia internet.
  const nomeEhCidade = Boolean(curto) && semAcento(municipio).includes(curto);
  if (nomeEhCidade) sinais.push(`"${curto}" é o nome da cidade: não identifica a empresa`);
  else if (curto && dominio.includes(curto)) somar(PESOS.nomeNoDominio, `"${curto}" no endereço`);
  else if (curto && corpo.includes(curto)) somar(PESOS.nomeNoTexto, `"${curto}" no texto`);

  const termosNome = termosSignificativos(nomeFantasia || razaoSocial);
  if (termosNome.length > 1 && termosNome.every((t) => corpo.includes(t))) {
    somar(PESOS.nomeCompleto, 'nome completo da empresa na página');
  }
  if (municipio && corpo.includes(semAcento(municipio))) somar(PESOS.cidade, `cidade ${municipio}`);
  if (uf && new RegExp(`\\b${semAcento(uf)}\\b`).test(corpo)) somar(PESOS.uf, `UF ${uf}`);

  const ramo = termosDoRamo(empresa?.cnae_descricao);
  const ramoAchado = ramo.filter((t) => corpo.includes(t));
  if (ramoAchado.length >= 2) somar(PESOS.ramo, `ramo bate (${ramoAchado.slice(0, 3).join(', ')})`);
  else if (ramoAchado.length === 1) somar(Math.round(PESOS.ramo / 2), `ramo parcial (${ramoAchado[0]})`);

  if (rede) {
    if (curto && dominio.includes(curto)) somar(PESOS.redeDaEmpresa, `perfil da empresa no ${rede.split('.')[0]}`);
  } else {
    somar(PESOS.siteProprio, 'domínio próprio');
  }
  if (/\b(contato|fale conosco|quem somos|sobre nos|nossa empresa|orcamento)\b/.test(corpo)) {
    somar(PESOS.pareceEmpresa, 'página institucional');
  }

  // O dominio e da propria empresa? E a diferenca entre "achei o contato dela" e
  // "achei um telefone numa pagina que a cita". So isto autoriza decidir sem a IA.
  // Sem nome curto proprio, ou quando ele e o nome da cidade, nenhum dominio prova
  // ser da empresa — e sem isso nada e aceito sem a IA olhar.
  const tokens = termosSignificativos(nomeFantasia || razaoSocial);
  const nomeNoHost = tokens.length>0 && tokens.every(t=>dominio.includes(t));
  const cidadeConfere = Boolean(municipio) && corpo.includes(semAcento(municipio));
  const cnpjConfere = cnpj.length===14 && soDigitos(texto).includes(cnpj);
  const dominioDaEmpresa = Boolean(curto) && !nomeEhCidade && nomeNoHost;
  const identidadeComprovada = cnpjConfere || (dominioDaEmpresa && cidadeConfere && ramoAchado.length>0);
  return { pontos, sinais, dominioDaEmpresa, identidadeComprovada };
};

const CONSULTAS = [
  { fonte: 'site', monta: ({ nome, cnpj, municipio, uf }) => `("${nome}" OR "${cnpj}") ${municipio} ${uf} whatsapp telefone contato` },
  { fonte: 'instagram', monta: ({ curto, nome, municipio }) => `"${curto || nome}" ${municipio} site:instagram.com` },
  { fonte: 'places', monta: ({ curto, nome, municipio, uf }) => `"${curto || nome}" ${municipio} ${uf} endereço telefone google maps` },
  { fonte: 'razao', monta: ({ nome, municipio }) => `"${nome}" ${municipio} contato` },
];

const buscarNoTavily = async ({ query, apiKey, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 6,
        include_answer: false,
        include_raw_content: true,
        country: 'brazil',
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      // O corpo diz se é cota (432), limite de taxa (429) ou chave inválida (401).
      const corpo = await resp.text().catch(() => '');
      const e = new Error(`Tavily HTTP ${resp.status}${corpo ? ` ${corpo.slice(0, 100)}` : ''}`);
      e.status = resp.status;
      throw e;
    }
    const d = await resp.json();
    return Array.isArray(d.results) ? d.results : [];
  } finally {
    clearTimeout(timer);
  }
};

const montarPromptContato = ({ empresa, candidatos }) => {
  const system = [
    'Você decide se um telefone achado na internet é mesmo o contato de uma empresa',
    'específica. Errar manda uma mensagem comercial para um estranho, então recusar é',
    'uma resposta boa e esperada.',
    '',
    'Já foi conferido automaticamente, e você não precisa reconferir:',
    '- o DDD é compatível com o estado da empresa;',
    '- a página não é agregador de CNPJ nem lista de governo;',
    '- o número é diferente do que a empresa declarou na Receita.',
    '',
    'O que VOCÊ julga, olhando os indícios de cada página:',
    '- é a MESMA empresa, ou é uma homônima de outra cidade ou de outro ramo?',
    '- a página é da empresa (site próprio, perfil dela) ou só cita o nome de passagem?',
    '- o telefone é o contato dela, ou é de um parceiro, cliente ou anunciante na página?',
    '',
    'Nome curto conta: muita empresa só é achável por ele ("Sertec", "Veracruz"), e a',
    'razão social completa não aparece em lugar nenhum. Isso é normal, não é suspeito.',
    'Mas nome curto sozinho, em cidade diferente e ramo diferente, é homônima.',
    '',
    'Responda SOMENTE com JSON:',
    '{"escolha": <índice do candidato, ou null se nenhum convence>,',
    ' "confianca": <0 a 1>,',
    ' "motivo": "<por que este, ou por que nenhum>"}',
  ].join('\n');

  const user = [
    'EMPRESA QUE PROCURAMOS',
    `Razão social: ${empresa?.razao_social || '—'}`,
    empresa?.nome_fantasia ? `Nome fantasia: ${empresa.nome_fantasia}` : null,
    `Cidade/UF: ${[empresa?.municipio_nome, empresa?.uf].filter(Boolean).join('/') || '—'}`,
    `Ramo (CNAE): ${empresa?.cnae_descricao || '—'}`,
    '',
    'CANDIDATOS',
    ...candidatos.map((c, i) => [
      `[${i}] ${c.numero} (${c.celular ? 'celular' : 'fixo'}) — ${c.pontos} pontos`,
      `    página: ${c.url}`,
      `    indícios: ${c.sinais.join('; ') || 'nenhum'}`,
      `    trecho: ${String(c.trecho || '').slice(0, 300).replace(/\s+/g, ' ')}`,
    ].join('\n')),
    '',
    'Escolha um ou recuse.',
  ].filter(Boolean).join('\n');

  return { system, user };
};

// Procura o contato da empresa. Devolve o número escolhido com a origem e o porquê,
// ou null com o motivo — e sempre a lista do que foi rejeitado. Auditoria importa
// mais aqui do que em qualquer outra parte deste sistema.
const buscarContatoWeb = async (empresa, {
  apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 20000,
  buscar = null,
  fontes = null,
  decidirComIa = null,
  limiarAceita = LIMIAR_ACEITA,
  limiarDuvida = LIMIAR_DUVIDA,
  confirmarCadastro = false,
  buscarPaginas = null,
} = {}) => {
  const razaoSocial = empresa?.razao_social || '';
  const nomeFantasia = empresa?.nome_fantasia || '';
  const nome = nomeFantasia || razaoSocial;
  if (!nome) return { numero: null, motivo: 'empresa sem nome', rejeitados: [] };
  // A chave pode vir como funcao: o cofre a busca no banco, porque env nao sobrevive
  // a deploy nesta stack (ver segredos.js).
  const chave = typeof apiKey === 'function' ? await apiKey() : apiKey;
  if (!chave && !buscar && !buscarPaginas) return { numero: null, motivo: 'TAVILY_API_KEY não configurada', rejeitados: [] };

  const curto = nomeCurto(razaoSocial, nomeFantasia);
  const alvo = { curto, nome, cnpj:soDigitos(empresa?.cnpj),municipio: empresa?.municipio_nome || '', uf: empresa?.uf || '' };
  const telefoneCadastro = (() => {
    const juntar = (ddd, num) => (ddd && num ? `55${soDigitos(`${ddd}${num}`)}` : '');
    return juntar(empresa?.ddd1, empresa?.telefone1) || juntar(empresa?.ddd2, empresa?.telefone2) || '';
  })();

  const consultas = (fontes || CONSULTAS.map((c) => c.fonte))
    .map((f) => CONSULTAS.find((c) => c.fonte === f))
    .filter(Boolean);

  const paginas = [];
  const falhas = [];
  let transitorio = false;
  // Cadeia de provedores (Places → Tavily → headless) com cota, cache e circuit-breaker.
  if (buscarPaginas) {
    const r = await buscarPaginas({ alvo, empresa });
    for (const p of r.paginas) paginas.push({ ...p, fonte: p.fonte || r.provedor || 'web' });
    falhas.push(...(r.falhas || []));
    transitorio = r.transitorio === true;
  }
  for (const c of buscarPaginas ? [] : consultas) {
    const consulta = c.monta(alvo);
    try {
      const achados = buscar
        ? await buscar(consulta, c.fonte)
        : await buscarNoTavily({ query: consulta, apiKey: chave, fetchImpl, timeoutMs });
      for (const r of achados) paginas.push({ ...r, fonte: c.fonte });
      // Stop paid discovery once a strong company source already supplies a
      // nearby, geographically compatible phone. Do not buy four searches then.
      const strong=achados.some(p=>{
        if(ehAgregador(p.url))return false;
        const texto=`${p.title || ''}\n${p.content || ''}\n${p.raw_content || ''}`,e=pontuarPagina({texto,url:p.url,empresa});
        return e.identidadeComprovada&&e.dominioDaEmpresa&&e.pontos>=limiarAceita&&extrairTelefones(texto,{ancoras:[nomeFantasia,razaoSocial,curto]}).some(t=>t.distancia!==null&&t.distancia<=JANELA_PROXIMIDADE&&ufCompativel(t.ddd,empresa.uf)&&(confirmarCadastro||t.numero!==telefoneCadastro));
      });
      if(strong)break;
    } catch (error) {
      falhas.push(`${c.fonte}: ${String(error.message || error)}`);
    }
  }
  if (!paginas.length) {
    return {
      numero: null,
      motivo: falhas.length ? `busca falhou: ${falhas.join('; ')}` : 'nenhuma página encontrada',
      rejeitados: [],
      // Provedor fora do ar não é "empresa sem telefone": quem chama não pode queimar o CNPJ.
      transitorio,
    };
  }

  const rejeitados = [];
  const candidatos = [];
  const vistos = new Set();
  for (const p of paginas) {
    const url = p.url || '';
    const texto = `${p.title || ''}\n${p.content || ''}\n${p.raw_content || ''}`;
    if (ehAgregador(url)) {
      rejeitados.push({ url, fonte: p.fonte, motivo: 'agregador de CNPJ: republica o telefone da Receita' });
      continue;
    }
    let { pontos, sinais, dominioDaEmpresa, identidadeComprovada } = pontuarPagina({ texto, url, empresa });
    // Perfil do Google (Places): o próprio Google já ligou nome+endereço ao telefone.
    // Aceita como identidade se TODOS os termos do nome curto estão no nome do negócio e a
    // cidade está no endereço. É mais forte que "um telefone numa página que cita o nome".
    if (p.googlePlace) {
      const nomeG = semAcento(p.googlePlace.nome || '');
      const endG = semAcento(p.googlePlace.endereco || '');
      const toks = termosSignificativos(nomeCurto(razaoSocial, nomeFantasia) || nome);
      const cidade = semAcento(empresa?.municipio_nome || '');
      if (toks.length && toks.every((t) => nomeG.includes(t)) && (!cidade || endG.includes(cidade))) {
        identidadeComprovada = true;
        dominioDaEmpresa = true;
        pontos = Math.max(pontos, limiarAceita);
        sinais = [...sinais, 'perfil do Google (nome e cidade conferem)'];
      }
    }
    // Ancoras para medir proximidade: o nome curto e a razao social.
    const telefones = extrairTelefones(texto, {
      ancoras: [nomeCurto(razaoSocial, nomeFantasia), nomeFantasia, razaoSocial],
    });
    if (!telefones.length) continue;
    if (pontos < limiarDuvida) {
      rejeitados.push({
        url, fonte: p.fonte, pontos,
        motivo: `indícios fracos demais (${pontos} pts): ${sinais.join('; ') || 'nenhum'}`,
      });
      continue;
    }
    for (const t of telefones) {
      if (!ufCompativel(t.ddd, empresa?.uf)) {
        rejeitados.push({ url, fonte: p.fonte, numero: t.numero, motivo: `DDD ${t.ddd} não bate com ${empresa?.uf}` });
        continue;
      }
      if (!confirmarCadastro && telefoneCadastro && t.numero === telefoneCadastro) {
        rejeitados.push({ url, fonte: p.fonte, numero: t.numero, motivo: 'é o mesmo telefone da Receita' });
        continue;
      }
      if(!identidadeComprovada || !dominioDaEmpresa || t.distancia===null || t.distancia>JANELA_PROXIMIDADE){
        rejeitados.push({url,fonte:p.fonte,numero:t.numero,motivo:'Titularidade não comprovada: nome parecido, DDD e WhatsApp ativo não identificam a empresa.'});
        continue;
      }
      const chave = `${t.numero}|${url}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      // Telefone longe de qualquer mencao do nome provavelmente nao e dela.
      let pontosDoNumero = pontos + (t.celular ? PESOS.celular : 0);
      const sinaisDoNumero = t.celular ? [...sinais, 'é celular'] : [...sinais];
      if (t.distancia === null) {
        pontosDoNumero += PESOS.longeDoNome;
        sinaisDoNumero.push('nome da empresa não aparece junto do telefone');
      } else if (t.distancia > JANELA_PROXIMIDADE) {
        pontosDoNumero += PESOS.longeDoNome;
        sinaisDoNumero.push(`telefone a ${t.distancia} caracteres do nome`);
      } else {
        pontosDoNumero += PESOS.pertoDoNome;
        sinaisDoNumero.push('telefone junto do nome da empresa');
      }
      candidatos.push({
        ...t, url, fonte: p.fonte, dominioDaEmpresa,
        pontos: pontosDoNumero,
        sinais: sinaisDoNumero,
        trecho: (()=>{const match=[...texto.matchAll(TELEFONE_RE)].find(m=>`55${m[1]}${m[2]}${m[3]}`===t.numero);const index=match?.index || 0;return texto.slice(Math.max(0,index-250),index+350);})(),
        identidadeComprovada,
      });
    }
  }

  if (!candidatos.length) {
    return { numero: null, motivo: 'nenhum candidato sobreviveu aos filtros', rejeitados };
  }
  candidatos.sort((a, b) => b.pontos - a.pontos);

  const melhor = candidatos[0];
  const devolver = (c, extra) => ({
    numero: c.numero,
    origem: c.url,
    fonte: c.fonte,
    celular: c.celular,
    pontos: c.pontos,
    sinais: c.sinais,
    identidadeComprovada:c.identidadeComprovada===true,
    candidatos: candidatos.length,
    rejeitados,
    ...extra,
  });

  // Aceitar sozinho exige as duas coisas: pontuacao alta E ser o dominio da propria
  // empresa. Em 24/10, paginas de terceiro (Serasa, Ministerio Publico, um site sobre
  // presidios) marcaram 76 a 97 pontos com telefone que nao era da empresa. Qualquer
  // outra origem passa pela IA, por melhor que pontue.
  if (melhor.pontos >= limiarAceita && melhor.dominioDaEmpresa) {
    return devolver(melhor, { decidido: 'pontuação' });
  }

  // Zona cinzenta: tem indício, não tem prova. Quem decide é a IA, com tudo à vista.
  if (!decidirComIa) {
    return {
      numero: null,
      motivo: `melhor candidato com ${melhor.pontos} pts`
        + `${melhor.dominioDaEmpresa ? '' : ' em página de terceiro'}`
        + `, e sem IA para julgar`,
      candidatosAvaliados: candidatos,
      rejeitados,
    };
  }
  const ia = await decidirComIa(montarPromptContato({ empresa, candidatos: candidatos.slice(0, 5) }));
  if (!ia?.ok) {
    return { numero: null, motivo: `IA não decidiu: ${ia?.error || 'sem resposta'}`, candidatosAvaliados: candidatos, rejeitados };
  }
  const escolha = ia.data?.escolha;
  if (!Number.isInteger(escolha) || escolha<0 || escolha>=Math.min(5,candidatos.length) || !Number.isFinite(ia.data?.confianca) || ia.data.confianca<0.9 || ia.data.confianca>1) {
    return { numero: null, motivo: `IA recusou: ${ia.data?.motivo || 'sem motivo'}`, candidatosAvaliados: candidatos, rejeitados };
  }
  return devolver(candidatos[escolha], {
    decidido: 'IA',
    confianca: ia.data?.confianca,
    motivo: ia.data?.motivo,
  });
};

module.exports = {
  DDD_UF,
  JANELA_PROXIMIDADE,
  AGREGADORES,
  CONSULTAS,
  PESOS,
  LIMIAR_ACEITA,
  LIMIAR_DUVIDA,
  ehAgregador,
  extrairTelefones,
  ufCompativel,
  termosSignificativos,
  termosDoRamo,
  nomeCurto,
  pontuarPagina,
  montarPromptContato,
  buscarContatoWeb,
  buscarNoTavily,
};
