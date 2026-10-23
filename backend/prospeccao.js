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
        CHECK (status IN ('abordado', 'dry_run', 'descartado', 'falhou')),
      motivo TEXT,
      perfil_whatsapp TEXT,
      confirmou_empresa BOOLEAN,
      contact_id BIGINT,
      mensagem TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
  return candidatos.find((t) => t.length >= 10) || '';
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
const cnaesValidos = (lista) => (Array.isArray(lista) ? lista : [])
  .map((c) => String(c || '').replace(/[^0-9]/g, ''))
  .filter((c) => c.length === 7);

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

const montarPromptAbordagem = ({ empresa, perfil, confirmouEmpresa, contexto }) => {
  const curto = nomeCurtoEmpresa(empresa.razao_social || empresa.nome_fantasia) || 'a empresa';
  const system = [
    'Você escreve a PRIMEIRA mensagem de WhatsApp para uma empresa que ainda não conhece a Aerion,',
    'distribuidora da Autel Robotics no Brasil (drones enterprise).',
    '',
    'O que funciona na prática, medido em 870 aberturas reais desta base:',
    '- prova social ("tenho conversado com empresas de topografia sobre como otimizar tempo',
    '  e ganhar produtividade") responde 35%',
    '- pedir indicação ("poderia me indicar quem cuida disso?") responde 19%',
    'Comece pela prova social, ancorada no setor real da empresa.',
    '',
    'Regras que não se quebram:',
    '- No máximo 3 frases curtas. Português do Brasil, tom de gente, não de folheto.',
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
    `Atividade (CNAE): ${empresa.cnae_principal_desc || empresa.cnae_principal || '—'}`,
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
        perfil_whatsapp, confirmou_empresa, contact_id, mensagem, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (account_id, cnpj) WHERE cnpj IS NOT NULL DO NOTHING`,
    [
      d.accountId, soDigitos(d.cnpj) || null, d.razaoSocial ?? null, d.telefone ?? null,
      d.perfil ?? null, d.status, d.motivo ?? null, d.perfilWhatsapp ?? null,
      d.confirmouEmpresa ?? null, d.contactId ?? null, d.mensagem ?? null, d.error ?? null,
    ]
  );
};

const contarHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${PROSPECCAO_LOG_TABLE}
      WHERE account_id = $1 AND status IN ('abordado', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo'`,
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
  importarLead,
  enfileirarEnvio,
  validarMensagem,
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
    const { existentes, perfis: perfisWpp } = await verificarNumerosWhatsapp(telefones);

    for (const empresa of novas) {
      if (r.abordados >= limite) break;
      r.avaliados += 1;
      const tel = telefoneDaEmpresa(empresa);
      const base = {
        accountId, cnpj: empresa.cnpj, razaoSocial: empresa.razao_social,
        telefone: tel, perfil: perfil.titulo,
      };

      try {
        if (!tel || !existentes.has(tel)) {
          await registrarProspeccao(pool, {
            ...base, status: 'descartado',
            motivo: tel ? 'número não existe no WhatsApp' : 'sem telefone no cadastro',
          });
          r.descartados += 1;
          continue;
        }

        const nomePerfil = perfisWpp?.get?.(tel) || null;
        const confirmou = perfilConfirmaEmpresa(
          nomePerfil, empresa.razao_social, empresa.nome_fantasia
        );

        const prompt = montarPromptAbordagem({
          empresa, perfil: perfil.titulo, confirmouEmpresa: confirmou,
        });
        const ia = await chatCompletionJson({ ...prompt, maxTokens: 450, temperature: 0.4 });
        if (!ia.ok) {
          await registrarProspeccao(pool, { ...base, status: 'falhou', error: ia.error });
          r.falhas += 1;
          continue;
        }

        const texto = String(ia.data?.mensagem || '').trim();
        const confianca = ia.data?.confianca;
        const problema = validarMensagem
          ? validarMensagem(texto, confianca, { minConfianca: config.minConfianca })
          : null;
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
            perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou,
            motivo: confirmou ? 'perfil confirma a empresa' : 'abordagem pergunta com quem fala',
          });
          r.abordados += 1;
          continue;
        }

        const contactId = await importarLead(empresa);
        // Contato novo não tem conversa: o envio vai por telefone, e a conversa
        // nasce no Chatwoot quando a Evolution entrega.
        await enfileirarEnvio({
          contactId, telefone: tel, texto,
          dedupeKey: `prospeccao:${soDigitos(empresa.cnpj)}`,
        });
        await registrarProspeccao(pool, {
          ...base, status: 'abordado', mensagem: texto, contactId,
          perfilWhatsapp: nomePerfil, confirmouEmpresa: confirmou,
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
  registrarProspeccao,
  contarHoje,
  runProspeccaoTick,
};
