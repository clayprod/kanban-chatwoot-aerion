// ICP da Aerion: quem é o lead, e por isso o que dizer para ele.
//
// Fonte: "02 - Comercial/Processos e Metodologia/Old/ICP-Perfis-Cliente-Ideal.md"
// e a seção 3 de "Processos-Comerciais-Vendas.md". O conteúdo aqui é resumo fiel
// daqueles documentos — dor, motivação, objeção e produto —, não invenção nossa.
//
// O que mais importa entender: a Aerion é DISTRIBUIDORA (B2B2B). O ICP principal,
// 70% do volume, é REVENDA/INTEGRADOR. Os quatro perfis de cliente final descrevem
// quem as revendas atendem, e valem 30%. Isso muda a mensagem por completo: para uma
// revenda a dor é margem de 10-15% em commodity e fornecedor sem suporte; falar de
// "ganhar produtividade na obra" com ela é conversa de outro interlocutor.
//
// Por que classificar: até aqui os prompts tratavam todo lead igual, então a abordagem
// saía genérica e o lead não via valor de cara.

const REVENDA = 'revenda';
const CONSTRUCAO = 'construcao';
const ENERGIA = 'energia';
const SEGURANCA = 'seguranca';
const RESGATE = 'resgate';
const DESCONHECIDO = 'desconhecido';

const ICPS = {
  [REVENDA]: {
    id: REVENDA,
    nome: 'Revenda / Integrador',
    principal: true,
    quemE: 'revenda de tecnologia, integrador de soluções, distribuidor regional ou '
      + 'consultoria técnica que vende equipamento',
    comoCompra: 'compra para revender (sell-in), com tabela de revenda e nível de parceria',
    dores: [
      'margem baixa em produto comoditizado (10-15%)',
      'fornecedor sem suporte técnico de verdade',
      'cliente pedindo drone profissional que ela não tem no portfólio',
      'dificuldade de se diferenciar — todos vendem as mesmas marcas',
      'risco de estoque parado',
    ],
    motivacoes: [
      'margem de 25-35% em vez de 10-15%',
      'suporte técnico N2 para repassar ao cliente dela',
      'marca premium como diferencial contra o monopolista do mercado',
      'parceria de crescimento, não transação',
    ],
    objecoes: [
      ['já tenho fornecedor de drones', 'margem de 25-35% + suporte N2 — o atual oferece isso?'],
      ['marca desconhecida no Brasil', 'Autel é 2ª maior do mundo: alternativa real ao monopolista'],
      ['meus clientes não conhecem Autel', 'educação de mercado, cases e material co-brandado'],
      ['sell-in mínimo é alto', 'R$ 80k trimestral é 1-2 drones, com programa de ramp-up'],
    ],
    produtos: 'linha completa (EVO Lite Enterprise, EVO Max 4T, Alpha)',
    ticket: 'R$ 60-120k por trimestre de sell-in',
    redFlags: [
      'vende só para consumidor final (B2C), sem operação B2B',
      'uma pessoa só, sem estrutura comercial',
      'só olha preço e não valoriza suporte técnico',
      'quer ser distribuidor e concorrer com a Aerion',
    ],
    proximoPasso: 'apresentar o programa de parceria e, no site, o cadastro PJ que libera a tabela de revenda',
  },
  [CONSTRUCAO]: {
    id: CONSTRUCAO,
    nome: 'Construção e Topografia',
    quemE: 'construtora média/grande, empresa de topografia e georreferenciamento, '
      + 'engenharia consultiva, órgão de obras ou planejamento urbano',
    comoCompra: 'cliente final: compra para usar na própria operação',
    dores: [
      'cronograma atrasando por medição demorada',
      'retrabalho por erro de medição',
      'custo alto de topografia terceirizada',
      'dificuldade de medir volumetria e movimentação de terra',
    ],
    motivacoes: [
      'reduzir custo de topografia em 40-60%',
      'levantamento 10x mais rápido',
      'precisão centimétrica com RTK',
      'oferecer BIM + drone como diferencial',
    ],
    objecoes: [
      ['já temos topógrafo interno', 'libera a equipe para o trabalho crítico e é 10x mais rápido'],
      ['muito caro', 'ROI em 6-12 meses contra topografia terceirizada'],
      ['precisa de piloto certificado', 'treinamento e certificação ANAC inclusos'],
    ],
    produtos: 'EVO Lite Enterprise, EVO Max 4T com RTK',
    ticket: 'R$ 80-120k',
    redFlags: ['construtora pequena, menos de 5 obras por ano', 'processo 100% manual e resistente a tecnologia'],
    proximoPasso: 'demonstração técnica focada em levantamento e volumetria',
  },
  [ENERGIA]: {
    id: ENERGIA,
    nome: 'Inspeção Industrial e Energia',
    quemE: 'concessionária de energia, parque solar ou eólico, indústria com ativo '
      + 'crítico, empresa de inspeção, mineração, óleo e gás',
    comoCompra: 'cliente final: compra para usar na própria operação',
    dores: [
      'custo altíssimo de inspeção com helicóptero ou alpinismo',
      'risco de acidente em inspeção manual (altura, ATEX)',
      'parada não planejada por falha não detectada',
      'hotspot não identificado virando incêndio',
      'monitorar milhares de km de linha ou duto',
    ],
    motivacoes: [
      'zero acidente em inspeção',
      'inspeção 70-80% mais barata que helicóptero',
      'reduzir parada não planejada',
      'histórico térmico digital para análise preditiva',
      'compliance regulatório (ANEEL)',
    ],
    objecoes: [
      ['e interferência eletromagnética?', 'Alpha é projetado para BVLOS e resistência a EMI'],
      ['helicóptero inspeciona mais rápido', 'custo menor e inspeção mais detalhada com zoom 10x'],
      ['regulamentação ANEEL/ANAC', 'operação conforme, com apoio em licença'],
    ],
    produtos: 'Autel Alpha (BVLOS), EVO Max 4T (zoom 10x + térmica)',
    ticket: 'R$ 150-300k',
    redFlags: ['sem ativo crítico para inspecionar'],
    proximoPasso: 'demonstração térmica em ativo real da operação dele',
  },
  [SEGURANCA]: {
    id: SEGURANCA,
    nome: 'Segurança Pública e Defesa Civil',
    quemE: 'polícia militar ou civil, PRF, guarda municipal, Defesa Civil, '
      + 'secretaria de segurança',
    comoCompra: 'órgão público: compra por licitação, com termo de referência',
    dores: [
      'área de cobertura grande com efetivo limitado',
      'custo de helicóptero (R$ 5-10k por hora)',
      'falta de visão tática na operação',
      'resposta lenta a incidente e falta de evidência visual',
    ],
    motivacoes: [
      'reduzir risco para agente e civil',
      'cobrir mais área com menos recurso',
      'mobilização mais rápida que helicóptero',
      'registro visual para processo',
    ],
    objecoes: [
      ['licitação é longa', 'apoio no termo de referência e no enquadramento legal'],
      ['budget limitado', 'ROI contra helicóptero e emenda parlamentar'],
      ['treinamento de operador', 'certificação ANAC inclusa'],
      ['sigilo operacional', 'criptografia e armazenamento local'],
    ],
    produtos: 'Autel Alpha (visão noturna, alcance 20km)',
    ticket: 'R$ 200-400k',
    redFlags: [],
    proximoPasso: 'apoio no termo de referência e demonstração operacional',
  },
  [RESGATE]: {
    id: RESGATE,
    nome: 'Resgate, Emergência e Meio Ambiente',
    quemE: 'corpo de bombeiros, Defesa Civil, brigada de incêndio, órgão ambiental ou ONG',
    comoCompra: 'órgão público ou ONG: convênio, emenda ou doação',
    dores: [
      'acesso difícil a área remota ou sinistrada',
      'tempo crítico em busca de desaparecido',
      'risco para a equipe de resgate',
      'detecção tardia de foco de incêndio',
      'monitorar desmatamento e queimada em área extensa',
    ],
    motivacoes: [
      'resgatar mais rápido e proteger a equipe',
      'monitorar área extensa (floresta, rio)',
      'detectar foco de incêndio antes de alastrar',
      'mobilização imediata na emergência',
    ],
    objecoes: [
      ['budget extremamente limitado', 'convênio federal, doação e ROI contra helicóptero'],
      ['operação em área remota', 'Alpha: 20km de alcance, BVLOS e térmica'],
      ['e se falhar em operação crítica?', 'redundância de sistemas e suporte'],
    ],
    produtos: 'Autel Alpha (térmica, autonomia), EVO Max 4T',
    ticket: 'R$ 180-350k',
    redFlags: [],
    proximoPasso: 'demonstração térmica em cenário de busca',
  },
  [DESCONHECIDO]: {
    id: DESCONHECIDO,
    nome: 'Perfil não identificado',
    quemE: 'não deu para identificar o perfil pelo cadastro nem pela conversa',
    comoCompra: 'desconhecido',
    dores: [],
    motivacoes: [],
    objecoes: [],
    produtos: 'linha Autel enterprise',
    ticket: null,
    redFlags: [],
    proximoPasso: 'descobrir o que a empresa faz e como usaria drone antes de propor qualquer coisa',
  },
};

// CNAE → ICP. Prefixo de 2 a 5 dígitos; o mais específico ganha.
//
// Revenda é prefixo de comércio/atacado/varejo e também instalação e manutenção de
// equipamento — integrador entra por ali. Vem com peso menor de propósito: comércio
// é prefixo largo e não prova que a empresa revende tecnologia B2B. Quem decide
// tabela de preço é evidência, não este palpite (ver `podeFalarTabelaRevenda`).
const CNAE_ICP = [
  // Construção e topografia
  ['4120', CONSTRUCAO, 0.75], ['4211', CONSTRUCAO, 0.75], ['4213', CONSTRUCAO, 0.7],
  ['4299', CONSTRUCAO, 0.6], ['4319', CONSTRUCAO, 0.6], ['4321', CONSTRUCAO, 0.5],
  ['7111', CONSTRUCAO, 0.8], ['7112', CONSTRUCAO, 0.85], ['7119701', CONSTRUCAO, 0.9],
  ['7119702', CONSTRUCAO, 0.9], ['7119', CONSTRUCAO, 0.7], ['7490104', CONSTRUCAO, 0.6],
  ['4110', CONSTRUCAO, 0.7], ['8413', CONSTRUCAO, 0.4],
  // Energia, indústria e inspeção
  ['3511', ENERGIA, 0.85], ['3512', ENERGIA, 0.85], ['3513', ENERGIA, 0.85],
  ['3514', ENERGIA, 0.8], ['3520', ENERGIA, 0.7], ['3530', ENERGIA, 0.7],
  ['0600', ENERGIA, 0.75], ['0710', ENERGIA, 0.7], ['0729', ENERGIA, 0.7],
  ['0892', ENERGIA, 0.6], ['1921', ENERGIA, 0.7], ['1922', ENERGIA, 0.7],
  ['4921', ENERGIA, 0.4], ['4940', ENERGIA, 0.8], ['7120', ENERGIA, 0.7],
  ['7490103', ENERGIA, 0.6], ['3314', ENERGIA, 0.55], ['2411', ENERGIA, 0.5],
  // Segurança pública e defesa
  ['8421', SEGURANCA, 0.8], ['8424', SEGURANCA, 0.9], ['8425', RESGATE, 0.9],
  ['8422', SEGURANCA, 0.8], ['8423', SEGURANCA, 0.8], ['8011', SEGURANCA, 0.6],
  ['8012', SEGURANCA, 0.6], ['8020', SEGURANCA, 0.5],
  // Resgate, emergência e meio ambiente
  ['8412', RESGATE, 0.35], ['9430', RESGATE, 0.45], ['3900', RESGATE, 0.5],
  ['0210', RESGATE, 0.5], ['0220', RESGATE, 0.5], ['8640', RESGATE, 0.4],
  // Revenda e integração
  ['4651', REVENDA, 0.7], ['4652', REVENDA, 0.7], ['4649', REVENDA, 0.55],
  ['4669', REVENDA, 0.6], ['4673', REVENDA, 0.55], ['4674', REVENDA, 0.5],
  ['4681', REVENDA, 0.4], ['4689', REVENDA, 0.5], ['4691', REVENDA, 0.4],
  ['4713', REVENDA, 0.35], ['4751', REVENDA, 0.7], ['4752', REVENDA, 0.6],
  ['4753', REVENDA, 0.5], ['4759', REVENDA, 0.5], ['4789', REVENDA, 0.4],
  ['9511', REVENDA, 0.6], ['9512', REVENDA, 0.55], ['3312', REVENDA, 0.5],
  ['4321', REVENDA, 0.35], ['6209', REVENDA, 0.5], ['6202', REVENDA, 0.45],
  ['6204', REVENDA, 0.5], ['4649408', REVENDA, 0.65],
];

const semAcento = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase();

// Palavras do nome ou da descrição do CNAE que puxam para um perfil. Sinal mais fraco
// que o código do CNAE, usado para desempate e para quem o CNAE não cobre.
const TERMOS_ICP = [
  [REVENDA, ['revenda', 'revendedor', 'distribuidor', 'distribuidora', 'importadora',
    'comercio de equipamentos', 'integrador', 'solucoes em tecnologia', 'suprimentos',
    'representacao comercial', 'representacoes']],
  [CONSTRUCAO, ['topografia', 'topografica', 'georreferenciamento', 'geotecnologia',
    'agrimensura', 'cartografia', 'aerofotogrametria', 'construtora', 'construcoes',
    'engenharia civil', 'empreiteira', 'terraplenagem', 'pavimentacao', 'incorporadora',
    'geoprocessamento', 'levantamento']],
  [ENERGIA, ['energia', 'eletrica', 'eletrico', 'transmissao', 'subestacao', 'solar',
    'fotovoltaic', 'eolic', 'concessionaria', 'inspecao', 'manutencao industrial',
    'termografia', 'mineracao', 'minerio', 'petroleo', 'oleoduto', 'gasoduto',
    'usina', 'linha de transmissao']],
  [SEGURANCA, ['policia', 'militar', 'seguranca publica', 'vigilancia', 'guarda municipal',
    'penitenciari', 'secretaria de seguranca', 'inteligencia', 'monitoramento']],
  [RESGATE, ['bombeiro', 'resgate', 'defesa civil', 'samu', 'emergencia', 'socorro',
    'ambiental', 'florestal', 'reflorestamento', 'brigada', 'incendio', 'conservacao']],
];

const normalizarCnae = (cnae) => String(cnae || '').replace(/[^0-9]/g, '');

// Classifica a empresa num ICP a partir do que a busca de leads já traz: CNAE, razão
// social, nome fantasia e o que a pessoa disse na conversa. Devolve também as
// evidências, porque mensagem baseada em palpite invisível é como nascem as asneiras.
const classificarIcp = ({
  razaoSocial = '', nomeFantasia = '', cnae = '', cnaeDescricao = '',
  declarado = '', cadastroB2b = false, historico = '',
} = {}) => {
  const pontos = new Map();
  const evidencias = [];
  const somar = (icp, peso, porque) => {
    if (!icp || !ICPS[icp]) return;
    pontos.set(icp, Math.max(pontos.get(icp) || 0, peso));
    evidencias.push({ icp, peso, porque });
  };

  // 1) Cadastro B2B aprovado no site é prova, não pista: a empresa já é parceira.
  if (cadastroB2b) somar(REVENDA, 1, 'CNPJ já cadastrado como PJ aprovado na loja');

  // 2) O que a própria pessoa disse vale mais que qualquer inferência de cadastro.
  const falas = semAcento(`${declarado} ${historico}`);
  if (/\b(sou|somos|minha empresa e|trabalho com)\b[^.]{0,40}(revenda|revendedor|distribuidor|integrador)/.test(falas)
      || /\b(quer|quero|queria|queremos|gostaria|pretend\w+|penso|pensamos|vamos)\b[^.]{0,30}\b(revender|distribuir|ser revenda|representar)\b/.test(falas)
      || /\b(para|pra)\s+revender\b/.test(falas)
      || /\btabela\s+de\s+(revenda|distribuidor|parceiro)\b/.test(falas)
      || /\b(sell-?in|margem\s+de\s+revenda|programa\s+de\s+parceri)/.test(falas)) {
    somar(REVENDA, 0.95, 'a pessoa disse na conversa que revende ou quer revender');
  }

  // 3) CNAE: prefixo mais específico ganha.
  const digitos = normalizarCnae(cnae);
  if (digitos) {
    let melhor = null;
    for (const [prefixo, icp, peso] of CNAE_ICP) {
      if (!digitos.startsWith(prefixo)) continue;
      if (!melhor || prefixo.length > melhor[0].length) melhor = [prefixo, icp, peso];
    }
    if (melhor) somar(melhor[1], melhor[2], `CNAE ${digitos} (prefixo ${melhor[0]})`);
  }

  // 4) Termos do nome e da descrição do CNAE.
  const texto = semAcento(`${razaoSocial} ${nomeFantasia} ${cnaeDescricao}`);
  for (const [icp, termos] of TERMOS_ICP) {
    const achou = termos.find((t) => texto.includes(t));
    if (achou) somar(icp, 0.6, `"${achou}" no nome ou na atividade`);
  }

  if (!pontos.size) {
    return { icp: DESCONHECIDO, perfil: ICPS[DESCONHECIDO], confianca: 0, evidencias: [] };
  }
  const [icp, confianca] = [...pontos.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    icp,
    perfil: ICPS[icp],
    confianca: Number(confianca.toFixed(2)),
    evidencias: evidencias.filter((e) => e.icp === icp),
  };
};

// Pode citar a TABELA DE REVENDA numa mensagem?
//
// A regra do Clayton é "preço conforme o ICP, inclusive revenda". A trava é só sobre
// o que conta como revenda: a tabela de revenda é informação de parceiro, e mandar
// preço de distribuidor para quem compra no varejo não volta atrás. Então exige
// EVIDÊNCIA — cadastro PJ aprovado na loja ou a pessoa dizendo que revende —, nunca
// um palpite de CNAE de comércio, que é prefixo largo e pega qualquer loja.
const podeFalarTabelaRevenda = (classificacao) => {
  if (!classificacao || classificacao.icp !== REVENDA) return false;
  return classificacao.evidencias.some((e) => e.peso >= 0.95);
};

// Bloco pronto para injetar no prompt. Fala em segunda pessoa com a IA, lista dor,
// motivação e objeção do perfil e diz qual é o próximo passo comercial — que é o que
// a metodologia chama de saída do SDR.
const blocoPromptIcp = (classificacao, { incluirProximoPasso = true } = {}) => {
  const c = classificacao || { icp: DESCONHECIDO, perfil: ICPS[DESCONHECIDO], confianca: 0, evidencias: [] };
  const p = c.perfil || ICPS[DESCONHECIDO];
  if (p.id === DESCONHECIDO) {
    return [
      'PERFIL DO LEAD: não identificado.',
      'Não finja saber o que a empresa faz. A primeira coisa a descobrir é a operação',
      'dela e como um drone entraria nela. Pergunte, não presuma.',
    ].join('\n');
  }
  const linhas = [
    `PERFIL DO LEAD: ${p.nome}${p.principal ? ' — este é o ICP PRINCIPAL da Aerion' : ''}.`,
    `Pistas: ${c.evidencias.map((e) => e.porque).join('; ') || 'nenhuma'} (confiança ${c.confianca}).`,
    `Quem é: ${p.quemE}.`,
    `Como compra: ${p.comoCompra}.`,
  ];
  if (p.id === REVENDA) {
    linhas.push(
      'A Aerion é DISTRIBUIDORA: com revenda a conversa é de PARCERIA e MARGEM, nunca de',
      'produtividade na operação dele. Ele ganha dinheiro revendendo, não voando.'
    );
  } else {
    linhas.push(
      'Este é cliente final: a conversa é sobre a operação dele, o custo que ele tem hoje',
      'e o risco que ele corre — não sobre margem de revenda.'
    );
  }
  if (p.dores.length) {
    linhas.push('', 'Dores reais deste perfil (use UMA, a que o histórico sustentar):');
    linhas.push(...p.dores.map((d) => `- ${d}`));
  }
  if (p.motivacoes.length) {
    linhas.push('', 'O que move a decisão dele:');
    linhas.push(...p.motivacoes.map((m) => `- ${m}`));
  }
  if (p.objecoes.length) {
    linhas.push('', 'Se vier objeção, a resposta da casa é:');
    linhas.push(...p.objecoes.map(([o, r]) => `- "${o}" → ${r}`));
  }
  linhas.push('', `Produto que cabe neste perfil: ${p.produtos}.`);
  if (p.redFlags.length) {
    linhas.push(`Sinais de que NÃO é este perfil: ${p.redFlags.join('; ')}.`);
  }
  if (incluirProximoPasso) {
    linhas.push(`Próximo passo comercial deste perfil: ${p.proximoPasso}.`);
  }
  linhas.push(
    '',
    'Não recite nada disso. É contexto para você escolher O QUE dizer; o texto sai com',
    'suas palavras, curto, e já mostrando que você entendeu o negócio dele.'
  );
  return linhas.join('\n');
};

module.exports = {
  REVENDA, CONSTRUCAO, ENERGIA, SEGURANCA, RESGATE, DESCONHECIDO,
  ICPS,
  CNAE_ICP,
  classificarIcp,
  podeFalarTabelaRevenda,
  blocoPromptIcp,
};
