// Prospecção ativa: a IA busca empresas novas e faz o primeiro contato.
//
// A origem são os perfis que o Radar Trends já sugere; a base é a RFB local. O que
// esta camada acrescenta é o cuidado com quem está do outro lado.
//
// O risco central é o telefone. O número da Receita é o que a empresa declarou na
// abertura: muitas vezes é do contador, de um sócio que saiu ou de uma linha morta.
// Medido na base em 2026-10: 23% é fixo e 40% está em formato antigo de 8 dígitos.
//
// Tentei resolver buscando na web (Tavily, 2026-10-22) e o resultado condena a ideia:
// busca por CNPJ devolveu outra empresa e um "telefone" que era lixo; busca por nome
// afirmou com confiança que a SERTEC de Vinhedo/SP atende no (94) 3322-1241 — DDD do
// Pará, de uma empresa homônima numa lista do governo. Colher número da web produz
// contato de empresa errada com cara de certeza.
//
// Então a validação é honesta: a Evolution diz se o número existe e devolve o nome do
// perfil. Se o nome confirma a empresa, aborda normal. Se não confirma, a primeira
// mensagem PERGUNTA com quem está falando. Se o número nem existe, o lead é descartado.

const { nomeCurtoEmpresa } = require('./aiFollowups');

const PROSPECCAO_LOG_TABLE = 'prospeccao_log';
const APRESENTACAO_AERION = 'Olá! Somos da Aerion, distribuidora de drones profissionais e representante da Autel no Brasil.';
const PORTFOLIO_AERION = 'https://aerion.com.br/produtos';
const comporAbordagem = corpo => `${APRESENTACAO_AERION}\n\n${String(corpo || '').trim()}\n\nPortfólio: ${PORTFOLIO_AERION}`;

const inteiro = (nome, padrao) => {
  const v = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(v) ? v : padrao;
};
const flag = (nome, padrao = false) => {
  const v = process.env[nome];
  if (v === undefined || v === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).trim().toLowerCase());
};

const carregarConfigProspeccao = () => ({
  enabled: flag('PROSPECCAO_ENABLED', false),
  dryRun: flag('PROSPECCAO_DRY_RUN', true),
  maxPorDia: inteiro('PROSPECCAO_MAX_PER_DAY', 10),
  maxPorTick: inteiro('PROSPECCAO_MAX_PER_TICK', 3),
  candidatosPorPerfil: inteiro('PROSPECCAO_CANDIDATES_PER_PROFILE', 40),
  minConfianca: Number.parseFloat(process.env.PROSPECCAO_MIN_CONFIDENCE ?? '') || 0.6,
});

const createProspeccaoTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PROSPECCAO_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      cnpj TEXT,
      razao_social TEXT,
      telefone TEXT,
      perfil TEXT,
      status TEXT NOT NULL
        CHECK (status IN ('abordado', 'enfileirado', 'dry_run', 'descartado', 'falhou')),
      motivo TEXT,
      perfil_whatsapp TEXT,
      confirmou_empresa BOOLEAN,
      icp TEXT,
      contact_id BIGINT,
      mensagem TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Tabela ja existia em producao antes do ICP entrar.
  await pool.query(`ALTER TABLE ${PROSPECCAO_LOG_TABLE} ADD COLUMN IF NOT EXISTS icp TEXT`);
  // 'enfileirado' nasceu depois da tabela: abordagem gerada e na fila, ainda nao
  // entregue. Quem entrega e o despachante, e e ele que alimenta o teto diario.
  await pool.query(`
    ALTER TABLE ${PROSPECCAO_LOG_TABLE} DROP CONSTRAINT IF EXISTS ${PROSPECCAO_LOG_TABLE}_status_check
  `);
  await pool.query(`
    ALTER TABLE ${PROSPECCAO_LOG_TABLE} ADD CONSTRAINT ${PROSPECCAO_LOG_TABLE}_status_check
      CHECK (status IN ('abordado', 'enfileirado', 'dry_run', 'descartado', 'falhou'))
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prospeccao_cnpj
      ON ${PROSPECCAO_LOG_TABLE} (account_id, cnpj)
      WHERE cnpj IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospeccao_recente
      ON ${PROSPECCAO_LOG_TABLE} (account_id, created_at DESC)
  `);
};

const soDigitos = (v) => String(v || '').replace(/[^0-9]/g, '');

// SPE e SCP sao CNPJ de UMA obra: "BATEL SPOT EMPREENDIMENTO SPE LTDA",
// "NEO LIFE PENHA II LTDA SCP". Nao tem operacao, nao compra equipamento e nao tem
// ninguem atendendo — quem decide e a incorporadora-mae. Em 26/10 a prospeccao
// automatica enfileirou 9 abordagens e 7 eram SPE/SCP, duas delas com o MESMO
// telefone (a mae), o que faria dois "falo com alguem da X?" caírem no mesmo numero.
const VEICULO_DE_OBRA = /(^|[\s.-])(spe|scp)([\s.-]|$)|spe\s*\d|empreendimento[s]?\s+spe/i;

const ehVeiculoDeObra = (empresa) => VEICULO_DE_OBRA.test(
  `${empresa?.razao_social || ''} ${empresa?.nome_fantasia || ''}`
);

// A busca RFB devolve ddd e numero em colunas separadas (ddd1/telefone1). Ler
// `ddd_telefone_1` — que so existe no formato de importacao — dava undefined em
// todo candidato, e cada empresa era registrada como "sem telefone no cadastro".
const telefoneDaEmpresa = (e) => {
  const juntar = (ddd, num) => (ddd && num ? soDigitos(`${ddd}${num}`) : '');
  const candidatos = [
    juntar(e?.ddd1, e?.telefone1),
    juntar(e?.ddd2, e?.telefone2),
    soDigitos(e?.ddd_telefone_1),
    soDigitos(e?.ddd_telefone_2),
    soDigitos(e?.telefone),
  ];
  // 10 digitos = fixo com DDD, 11 = celular. Menos que isso nao da para discar.
  const numero = candidatos.find((t) => t.length === 10 || t.length === 11 || (/^55/.test(t) && [12,13].includes(t.length))) || '';
  // A Receita separa DDD/telefone e omite o país. A Evolution exige 55+DDD:
  // consultar o formato nacional devolve exists:false mesmo para WhatsApp ativo.
  return numero && numero.length <= 11 ? `55${numero}` : numero;
};

// Normaliza para comparar nome de perfil com razão social: sem acento, sem caixa,
// sem pontuação. "SERTEC Engenharia LTDA" e "sertec engenharia" batem.
const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// O nome do perfil do WhatsApp confirma que é a empresa? Exige palavra significativa
// em comum — não basta "LTDA" ou "comercio" baterem.
const GENERICAS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'comercio', 'servicos',
  'industria', 'brasil', 'empresa', 'grupo', 'do', 'da', 'de', 'e']);

const perfilConfirmaEmpresa = (nomePerfil, razaoSocial, nomeFantasia) => {
  const perfil = normalizar(nomePerfil);
  if (!perfil) return false;
  const alvos = [razaoSocial, nomeFantasia, nomeCurtoEmpresa(razaoSocial)]
    .filter(Boolean).map(normalizar);
  const tokensPerfil = new Set(perfil.split(' ').filter((t) => t.length >= 4 && !GENERICAS.has(t)));
  if (!tokensPerfil.size) return false;
  for (const alvo of alvos) {
    for (const t of alvo.split(' ')) {
      if (t.length >= 4 && !GENERICAS.has(t) && tokensPerfil.has(t)) return true;
    }
  }
  return false;
};

// Perfis que o Radar já sugere. Mesma forma que a tela usa em
// searchCompaniesFromTrendProfile — nada de formato novo.
//
// O cache do Radar entrega { day, geo, trends, news, intel: { suggestions } }. Ler
// `payload.suggestions` devolvia sempre [] e o worker parava em "nenhum perfil
// sugerido" — foi por isso que a prospeccao ficou ligada horas sem abordar ninguem.
const extrairPerfis = (trendsPayload) => {
  const sugestoes = trendsPayload?.intel?.suggestions
    || trendsPayload?.suggestions
    || trendsPayload?.perfis
    || [];
  return sugestoes
    .filter((s) => s && s.filters && (s.filters.cnae?.length || s.filters.uf))
    .map((s) => ({ titulo: s.titulo || s.title || s.label || 'perfil', filtros: s.filters }));
};

// CNAE na base e 7 digitos sem pontuacao (4120400). Perfil sugerido as vezes trazia
// o codigo formatado ("7520-0/00"), que nao casa com nada: medido em producao em
// 2026-10-23, "7520-0/00" devolvia total 0 em 0.0s enquanto "4120400" devolvia
// resultados. Normaliza aqui e descarta o que nao tiver 7 digitos.
// Tambem deduplica: em 24/10 um perfil do Radar veio com "0111301,0111301", o mesmo
// codigo repetido. Nao quebra a busca, mas polui a query e o log.
const cnaesValidos = (lista) => [...new Set(
  (Array.isArray(lista) ? lista : [])
    .map((c) => String(c || '').replace(/[^0-9]/g, ''))
    .filter((c) => c.length === 7)
)];

// Monta a query da busca RFB a partir do perfil sugerido.
const paramsDaBusca = (filtros, { pageSize }) => {
  const p = new URLSearchParams();
  if (filtros.nome) p.set('nome', filtros.nome);
  if (filtros.uf) p.set('uf', filtros.uf);
  const cnaes = cnaesValidos(filtros.cnae);
  if (cnaes.length) p.set('cnae', cnaes.join(','));
  if (filtros.porte) p.set('porte', filtros.porte);
  if (filtros.capital_min) p.set('capital_min', String(filtros.capital_min));
  if (filtros.capital_max) p.set('capital_max', String(filtros.capital_max));
  // abertura_min_anos/abertura_max_anos ficam de fora DE PROPOSITO. Medido em
  // producao em 2026-10-23: "cnae + idade 3-25 anos" estourou o statement timeout
  // de 120s (504 em 140s), enquanto o mesmo CNAE com porte e capital respondeu em
  // ~20s. Idade da empresa e refino desejavel; 504 a cada tick nao e.
  p.set('situacao', (filtros.situacao || ['2']).join ? (filtros.situacao || ['2']).join(',') : '2');
  p.set('only_matriz', filtros.only_matriz === false ? 'false' : 'true');
  p.set('page', '1');
  p.set('page_size', String(pageSize));
  return p;
};

// Quem já está na base (por CNPJ) ou já foi prospectado antes não volta.
const filtrarNovos = async (pool, accountId, empresas) => {
  const cnpjs = empresas.map((e) => soDigitos(e.cnpj)).filter(Boolean);
  if (!cnpjs.length) return [];
  const { rows: jaNaBase } = await pool.query(
    `SELECT UPPER(regexp_replace(COALESCE(
              custom_attributes->>'CNPJ_CPF', custom_attributes->>'CNPJ',
              custom_attributes->>'cnpj', ''), '[^0-9]', '', 'g')) AS cnpj
       FROM contacts WHERE account_id = $1`,
    [accountId]
  );
  const { rows: jaTentados } = await pool.query(
    `SELECT cnpj FROM ${PROSPECCAO_LOG_TABLE} WHERE account_id = $1`,
    [accountId]
  );
  const conhecidos = new Set([
    ...jaNaBase.map((r) => r.cnpj).filter(Boolean),
    ...jaTentados.map((r) => soDigitos(r.cnpj)).filter(Boolean),
  ]);
  return empresas.filter((e) => !conhecidos.has(soDigitos(e.cnpj)));
};

const montarPromptAbordagem = ({
  empresa, perfil, confirmouEmpresa, contexto, blocoIcp = '', blocoCatalogo = '',
}) => {
  const curto = nomeCurtoEmpresa(empresa.razao_social || empresa.nome_fantasia) || 'a empresa';
  const system = [
    'Você escreve a PRIMEIRA mensagem de WhatsApp para uma empresa que ainda não conhece a Aerion,',
    'distribuidora da Autel Robotics no Brasil (drones enterprise).',
    '',
    ...(blocoIcp ? [blocoIcp, ''] : []),
    ...(blocoCatalogo ? [blocoCatalogo, ''] : []),
    'Escreva SOMENTE o corpo personalizado da abordagem. O sistema já acrescenta,',
    `antes dele: "${APRESENTACAO_AERION}" e, no final, o portfólio ${PORTFOLIO_AERION}.`,
    'Não repita apresentação, saudação nem link no corpo.',
    'Seja direto: cite UMA aplicação concreta de drones no setor REAL desta empresa',
    'e o benefício operacional correspondente, com base no ICP e catálogo fornecidos.',
    'Exemplos de aplicações (somente quando pertinentes): acompanhar obras por imagens,',
    'inspecionar ativos com câmera térmica, mapear áreas para levantamentos.',
    'Não invente prova social, clientes atendidos, resultados, economia percentual',
    'nem afirmar que conhece a operação interna da empresa.',
    '',
    'Cada abordagem é única: ela tem que mostrar, na primeira frase, que você entendeu',
    'o negócio DESTA empresa. Abertura que serviria para qualquer empresa está errada.',
    '',
    'Regras que não se quebram:',
    '- Corpo com até 360 caracteres e no máximo 2 frases curtas. Português do Brasil.',
    '- Evite "soluções inovadoras", "aumentar produtividade" e benefícios sem aplicação concreta.',
    '- Uma pergunta só, calibrada: comece por "Como" ou "O que". Nunca "tem interesse?".',
    '- Nunca cite preço, desconto ou condição comercial.',
    '- Nunca invente que já conversaram, que foi indicado por alguém, ou qualquer fato.',
    '- Nunca se despeça nem peça desculpa por incomodar.',
    '- No máximo um emoji.',
    confirmouEmpresa
      ? '- Já sabemos que este WhatsApp é da empresa: vá direto ao assunto.'
      : `- NÃO temos certeza de que este WhatsApp é de ${curto}. A mensagem precisa confirmar `
        + 'isso de forma natural, logo no começo ("falo com alguém da ...?"), antes de propor '
        + 'qualquer coisa. Melhor perguntar que falar com a pessoa errada.',
    '',
    'Responda SOMENTE com JSON:',
    '{"mensagem": "<texto pronto>", "confianca": <0 a 1>, "motivo": "<por que esta abordagem cabe>"}',
  ].join('\n');

  const user = [
    `Empresa: ${empresa.razao_social || empresa.nome_fantasia || '—'}`,
    empresa.nome_fantasia && empresa.nome_fantasia !== empresa.razao_social
      ? `Nome fantasia: ${empresa.nome_fantasia}` : null,
    `Como chamá-la na mensagem: ${curto}`,
    `Atividade (CNAE): ${empresa.cnae_descricao || empresa.cnae_principal_desc || empresa.cnae_fiscal_principal || empresa.cnae_principal || '—'}`,
    `Cidade/UF: ${[empresa.municipio_nome, empresa.uf].filter(Boolean).join('/') || '—'}`,
    perfil ? `Perfil de prospecção que trouxe esta empresa: ${perfil}` : null,
    contexto ? `Contexto encontrado sobre ela: ${contexto}` : null,
    '',
    confirmouEmpresa
      ? 'Escreva a abertura.'
      : 'Escreva a abertura CONFIRMANDO primeiro que é a empresa certa.',
  ].filter(Boolean).join('\n');

  return { system, user };
};

const registrarProspeccao = async (pool, d) => {
  await pool.query(
    `INSERT INTO ${PROSPECCAO_LOG_TABLE}
       (account_id, cnpj, razao_social, telefone, perfil, status, motivo,
        perfil_whatsapp, confirmou_empresa, contact_id, mensagem, error, icp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (account_id, cnpj) WHERE cnpj IS NOT NULL DO NOTHING`,
    [
      d.accountId, soDigitos(d.cnpj) || null, d.razaoSocial ?? null, d.telefone ?? null,
      d.perfil ?? null, d.status, d.motivo ?? null, d.perfilWhatsapp ?? null,
      d.confirmouEmpresa ?? null, d.contactId ?? null, d.mensagem ?? null, d.error ?? null,
      d.icp ?? null,
    ]
  );
};

// O teto diario conta MENSAGEM ENTREGUE, nao tentativa.
//
// Regra do Clayton (24/10): "o limite da prospeccao ativa so deve contar com mensagem
// realmente enviada, nao tentativa". Faz diferenca de verdade: o status 'abordado'
// significa que a abordagem entrou na fila, e em 23/10 o despachante estava quebrado
// e nada saiu — contar por ali queimaria os 10 contatos do dia sem um unico envio.
// Quem sabe se saiu e a fila (outbound_queue.status = 'sent').
//
// Dry run conta porque gasta token de IA: o teto existe tambem para isso.
const contarHoje = async (pool, accountId) => {
  const inicioDoDia = `date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
                       AT TIME ZONE 'America/Sao_Paulo'`;
  const { rows } = await pool.query(
    `SELECT (
       (SELECT COUNT(*) FROM outbound_queue
         WHERE account_id = $1 AND origem = 'prospeccao' AND status = 'sent'
           AND enviado_em >= ${inicioDoDia})
       +
       (SELECT COUNT(*) FROM ${PROSPECCAO_LOG_TABLE}
         WHERE account_id = $1 AND status = 'dry_run'
           AND created_at >= ${inicioDoDia})
     )::int AS total`,
    [accountId]
  );
  return rows[0]?.total || 0;
};

const runProspeccaoTick = async (pool, {
  accountId,
  chatCompletionJson,
  carregarPerfis,
  buscarEmpresas,
  verificarNumerosWhatsapp,
  buscarContatoWeb,
  importarLead,
  enfileirarEnvio,
  validarMensagem,
  contextoComercial,
  config = carregarConfigProspeccao(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };

  const hoje = await contarHoje(pool, accountId);
  const saldo = config.maxPorDia - hoje;
  if (saldo <= 0) return { skipped: 'teto diário atingido', hoje };

  const perfis = await carregarPerfis();
  if (!perfis.length) return { skipped: 'nenhum perfil sugerido pelo Radar' };

  const r = { abordados: 0, descartados: 0, falhas: 0, avaliados: 0, perfis: perfis.length };
  const limite = Math.max(1, Math.min(config.maxPorTick, saldo));

  for (const perfil of perfis) {
    if (r.abordados >= limite) break;

    // Busca fora do try matava o tick inteiro quando um perfil dava 504/401.
    let encontradas;
    try {
      encontradas = await buscarEmpresas(perfil.filtros, config.candidatosPorPerfil);
    } catch (error) {
      r.falhas += 1;
      r.errosBusca = [...(r.errosBusca || []), `${perfil.titulo}: ${String(error.message || error)}`];
      continue;
    }
    const novas = await filtrarNovos(pool, accountId, encontradas);
    if (!novas.length) continue;

    // Uma consulta à Evolution para o lote: existe? qual o nome do perfil?
    const telefones = novas.map(telefoneDaEmpresa).filter(Boolean);
    const { existentes, perfis: perfisWpp, indisponivel } = await verificarNumerosWhatsapp(telefones);

    // Fail-CLOSED aqui, ao contrário da campanha. A verificação devolve todos os
    // números como existentes quando não consegue consultar, o que é aceitável para
    // um disparo que não pode cair por um piscar da Evolution — mas não para contato
    // FRIO, onde mandar para número inexistente é o padrão de quem comprou lista e é
    // o sinal mais forte de spam. Em 26/10 o token sumiu num deploy, a verificação
    // ficou indisponível e a prospecção aceitou PABX sem conferir nada.
    if (indisponivel) {
      r.falhas += 1;
      r.errosBusca = [...(r.errosBusca || []),
        `${perfil.titulo}: verificação de WhatsApp indisponível — não abordo sem conferir`];
      continue;
    }

    const telefonesUsados = new Set();
    for (const empresa of novas) {
      if (r.abordados >= limite) break;
      r.avaliados += 1;

      if (ehVeiculoDeObra(empresa)) {
        await registrarProspeccao(pool, {
          accountId, cnpj: empresa.cnpj, razaoSocial: empresa.razao_social,
          telefone: telefoneDaEmpresa(empresa), perfil: perfil.titulo,
          status: 'descartado',
          motivo: 'SPE/SCP: CNPJ de uma obra, não é empresa com operação',
        });
        r.descartados += 1;
        continue;
      }
      const tel = telefoneDaEmpresa(empresa);
      const base = {
        accountId, cnpj: empresa.cnpj, razaoSocial: empresa.razao_social,
        telefone: tel, perfil: perfil.titulo,
      };

      try {
        // O telefone da Receita quase nunca tem WhatsApp: medido em 24/10, 2 em ~360.
        // Antes de descartar a empresa, procura o contato real na web — site proprio,
        // Instagram, ficha do Google. Roda por baixo; a tela so ve o resultado.
        let telefone = tel;
        let origemTelefone = tel ? 'receita' : null;
        let achadoWeb = null;
        if ((!telefone || !existentes.has(telefone)) && buscarContatoWeb) {
          achadoWeb = await buscarContatoWeb(empresa);
          if (achadoWeb?.numero) {
            const { existentes: temWpp } = await verificarNumerosWhatsapp([achadoWeb.numero]);
            if (temWpp.has(achadoWeb.numero)) {
              telefone = achadoWeb.numero;
              origemTelefone = achadoWeb.fonte || 'web';
              existentes.add(telefone);
              base.telefone = telefone;
            } else {
              achadoWeb = { ...achadoWeb, motivo: 'achado na web, mas sem WhatsApp' };
            }
          }
        }

        // Duas SPE da mesma incorporadora compartilham o telefone da mãe: duas
        // mensagens para o mesmo número, com nomes diferentes, é cara de robô.
        if (telefone && telefonesUsados.has(telefone)) {
          await registrarProspeccao(pool, {
            ...base, status: 'descartado',
            motivo: 'outra empresa deste mesmo lote já recebe neste número',
          });
          r.descartados += 1;
          continue;
        }

        if (!telefone || !existentes.has(telefone)) {
          await registrarProspeccao(pool, {
            ...base, status: 'descartado',
            motivo: tel
              ? `número da Receita sem WhatsApp; na web: ${achadoWeb?.motivo || 'não procurei'}`
              : `sem telefone no cadastro; na web: ${achadoWeb?.motivo || 'não procurei'}`,
          });
          r.descartados += 1;
          continue;
        }
        if (origemTelefone !== 'receita') r.achadosNaWeb = (r.achadosNaWeb || 0) + 1;
        telefonesUsados.add(telefone);

        const nomePerfil = perfisWpp?.get?.(telefone) || null;
        const confirmou = perfilConfirmaEmpresa(
          nomePerfil, empresa.razao_social, empresa.nome_fantasia
        );

        const contexto = contextoComercial
          ? await contextoComercial({ empresa, perfil: perfil.titulo })
          : { blocoIcp: '', blocoCatalogo: '' };

        // Sem ICP nao se aborda. Medido em 24/10, em dry run: o Radar sugeriu um
        // perfil de agronegocio (vertical DESCONTINUADA no ICP), a empresa sorteada
        // foi uma produtora de arroz, e a IA escreveu uma abordagem convincente sobre
        // monitorar lavoura e pasto — assunto que a Aerion nao vende. Quando nao se
        // sabe a dor do perfil, o modelo inventa uma. Melhor nao falar.
        if (contextoComercial && (!contexto.icp || contexto.icp === 'desconhecido')) {
          await registrarProspeccao(pool, {
            ...base, status: 'descartado',
            motivo: 'fora dos ICPs da Aerion — não dá para saber a dor dessa empresa',
            perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou,
          });
          r.descartados += 1;
          continue;
        }
        const prompt = montarPromptAbordagem({
          empresa, perfil: perfil.titulo, confirmouEmpresa: confirmou,
          blocoIcp: contexto.blocoIcp, blocoCatalogo: contexto.blocoCatalogo,
        });
        const ia = await chatCompletionJson({ ...prompt, maxTokens: 450, temperature: 0.4 });
        if (!ia.ok) {
          await registrarProspeccao(pool, { ...base, status: 'falhou', error: ia.error });
          r.falhas += 1;
          continue;
        }

        const corpo = String(ia.data?.mensagem || '').trim();
        const texto = comporAbordagem(corpo);
        const confianca = ia.data?.confianca;
        const problema = !corpo ? 'corpo da abordagem vazio' : corpo.length>360 ? 'corpo da abordagem longo demais' : /https?:\/\/|www\./i.test(corpo) ? 'link no corpo: o portfólio é acrescentado pelo sistema' : validarMensagem
          ? validarMensagem(texto, confianca, { minConfianca: config.minConfianca }) : null;
        if (problema) {
          await registrarProspeccao(pool, {
            ...base, status: 'descartado', motivo: problema,
            perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou, mensagem: texto || null,
          });
          r.descartados += 1;
          continue;
        }

        if (config.dryRun) {
          await registrarProspeccao(pool, {
            ...base, status: 'dry_run', mensagem: texto,
            perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou, icp: contexto.icp,
            motivo: confirmou ? 'perfil confirma a empresa' : 'abordagem pergunta com quem fala',
          });
          r.abordados += 1;
          continue;
        }

        const contactId = await importarLead(empresa);
        // Contato novo não tem conversa: o envio vai por telefone, e a conversa
        // nasce no Chatwoot quando a Evolution entrega.
        await enfileirarEnvio({
          contactId, telefone, texto,
          dedupeKey: `prospeccao:${soDigitos(empresa.cnpj)}`,
        });
        await registrarProspeccao(pool, {
          ...base, status: 'enfileirado', mensagem: texto, contactId,
          perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou, icp: contexto.icp,
          motivo: origemTelefone === 'receita'
            ? 'telefone do cadastro da Receita'
            : `telefone achado na web (${origemTelefone}): ${achadoWeb?.origem || ''}`.slice(0, 500),
        });
        r.abordados += 1;
      } catch (error) {
        await registrarProspeccao(pool, {
          ...base, status: 'falhou', error: String(error.message || error),
        }).catch(() => {});
        r.falhas += 1;
      }
    }
  }
  return r;
};

module.exports = {
  ehVeiculoDeObra,
  cnaesValidos,
  telefoneDaEmpresa,
  PROSPECCAO_LOG_TABLE,
  carregarConfigProspeccao,
  createProspeccaoTable,
  normalizar,
  perfilConfirmaEmpresa,
  extrairPerfis,
  paramsDaBusca,
  filtrarNovos,
  montarPromptAbordagem,
  comporAbordagem,
  registrarProspeccao,
  contarHoje,
  runProspeccaoTick,
};
