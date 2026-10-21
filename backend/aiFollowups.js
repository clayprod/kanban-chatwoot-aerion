// Follow-up automático com IA.
//
// Um lead que parou de responder há dias morre em silêncio: ninguém lembra de
// cutucar, e o CRM só acusa o problema quando a etapa já esfriou. Este módulo
// escreve o follow-up com o contexto real da conversa e posta na própria thread
// do Chatwoot, no mesmo número por onde o lead já falava.
//
// Ele envia SOZINHO, sem fila de aprovação — foi a decisão do produto. O que
// segura o risco são as regras abaixo, avaliadas antes de gastar token, e o
// AI_FOLLOWUP_DRY_RUN, que grava a mensagem sem mandar nada.
//
// As regras rodam da mais barata para a mais cara:
//   1. worker ligado + dentro da janela comercial
//   2. teto global por dia e por tick
//   3. etapa do funil elegível, opt-out
//   4. silêncio mínimo e "a última palavra foi nossa"
//   5. teto por contato e cooldown de campanha
//   6. (só aqui chama a IA) confiança e validação do texto

const { isBrazilBusinessDay } = require('./brazilBusinessDays');

const AI_FOLLOWUP_LOG_TABLE = 'ai_followup_log';
const TZ = 'America/Sao_Paulo';

const MENSAGEM_MAX_CHARS = 600;

// A IA não negocia: preço, prazo e desconto são do vendedor.
const TERMOS_PROIBIDOS = [
  /R\$\s*\d/i,
  /\bdescontos?\b/i,
  /\bpre[çc]o\s+especial\b/i,
  /\bcondi[çc][ãa]o\s+especial\b/i,
  /\bgarant(?:o|imos)\b/i,
  /\bprometo\b/i,
  /\bcontrato\s+assinad/i,
];

// Nem toda conversa parada pede follow-up. Caso real (contato Mafra, out/2026): o
// cliente disse "nao estou a frente das ETPs, fale com o Cap Sa Fortes" e passou o
// telefone. A IA respondeu perguntando a ELE se NOS ja tinhamos falado com o Cap —
// tarefa nossa, nao dele — e depois ainda insistiu mais duas vezes. O certo era
// agradecer, reclassificar com data longa e abrir o lead novo com a indicacao.
//
// Por isso o modelo primeiro LE a situacao e so depois escreve. Estas quatro nunca
// geram mensagem, mesmo que ele ache que sim: a decisao nao fica com ele.
const SITUACOES_SEM_MENSAGEM = new Set([
  'handoff',            // "fale com fulano" — a conversa com esta pessoa acabou
  'recusa_definitiva',  // "nao usamos drone", "encerramos a atividade"
  'virou_cliente',      // ja comprou; follow-up de prospeccao aqui e vexame
  'aguardando_nos',     // a bola esta com a gente (proposta, orcamento, retorno tecnico)
]);

// Quanto esperar antes de voltar, por situacao. Handoff e recusa saem de cena por
// muito tempo; a pessoa ja disse o que tinha para dizer.
const ESPERA_POR_SITUACAO = {
  handoff: 180,
  recusa_definitiva: 365,
  virou_cliente: 0,
  aguardando_nos: 0,
};

// Placeholder de template que escapou da personalização ({nome}, {empresa}, …).
const PLACEHOLDER = /\{[a-z_]+\}/i;

// Despedida nao e tecnica de venda: avisa o cliente que desistimos e fecha a porta.
// O processo comercial manda terminar a cadencia em value-add e mandar para nurture,
// em silencio. Isto e validacao, nao instrucao: o modelo ja escorregou aqui.
const TERMOS_DESPEDIDA = [
  /\b[uú]ltima\s+mensagem\b/i,
  /n[aã]o\s+(vou|irei)\s+(mais\s+)?insistir/i,
  /n[aã]o\s+insisto\s+mais/i,
  /\bvou\s+encerrar\b/i,
  /\bencerrar\s+(por\s+aqui|o\s+contato|nosso\s+contato)/i,
  /\bme\s+despe(ço|co)\b/i,
  /desculpa?e?\s+(o\s+)?incom[oó]d/i,
  /obrigad[oa]\s+pel[oa]\s+(tempo|aten[cç][aã]o)\s+(dedicad|at[eé]\s+aqui)/i,
  /receber\s+(informa[cç][oõ]es|atualiza[cç][oõ]es)\s+futur/i,
  /prefere\s+que\s+eu\s+n[aã]o/i,
  /\bparo\s+de\s+(te\s+)?(mandar|enviar|incomodar)/i,
  // "Agradeco pela atencao ate aqui" e despedida com outras palavras.
  /agrade[c\u00e7]o\s+(pel[ao]|por)\s+(aten[c\u00e7][a\u00e3]o|tempo|interesse)/i,
  /deixo\s+a\s+porta\s+aberta/i,
  // Pergunta fechada de sim/nao: o processo manda usar calibrada ("Como", "O que").
  /ainda\s+h[a\u00e1]\s+interesse/i,
  /tem\s+interesse\s*\?/i,
];

const flag = (nome, padrao = false) => {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(valor).trim().toLowerCase());
};

const inteiro = (nome, padrao) => {
  const valor = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(valor) ? valor : padrao;
};

const decimal = (nome, padrao) => {
  const valor = Number.parseFloat(process.env[nome] ?? '');
  return Number.isFinite(valor) ? valor : padrao;
};

const lista = (nome, padrao) => {
  const bruto = String(process.env[nome] || '').trim();
  if (!bruto) return padrao;
  return bruto.split(',').map((s) => s.trim()).filter(Boolean);
};

// Follow-up nao e a mesma mensagem repetida: e uma sequencia que muda de angulo a
// cada tentativa. Repetir "ainda tem interesse?" tres vezes cansa e queima o lead.
const ESTRATEGIA_SEQUENCIA = [
  'Primeira tentativa: retome o assunto de onde parou, curto e sem pressao. '
    + 'Feche com uma pergunta calibrada ("Como esta...", "O que mudou em...") '
    + 'que faca a pessoa pensar e responder com mais que um sim.',
  'Segunda tentativa: mude o angulo e TRAGA VALOR. Um ponto concreto do produto que '
    + 'casa com o que a pessoa falou, um caso parecido, uma duvida tecnica que costuma '
    + 'aparecer no segmento dela. Use labeling antes da pergunta ("Imagino que a '
    + 'prioridade de voces agora seja X..."). A pergunta vem do valor, nao do pedido.',
  'Terceira tentativa: ultimo toque da cadencia, e ele e VALUE-ADD, nunca despedida. '
    + 'Traga algo util de novo e descubra o TIMING com pergunta calibrada: '
    + '"Quando voces costumam revisar esse tipo de investimento?". '
    + 'O objetivo e qualificar o momento para nurture, nao encerrar relacionamento. '
    + 'Depois desta o lead so entra em nurture — ele nao precisa saber disso.',
];

const estrategiaDaTentativa = (tentativa, maximo) => {
  const indice = Math.min(Math.max(1, tentativa), ESTRATEGIA_SEQUENCIA.length) - 1;
  const ultima = tentativa >= maximo;
  if (ultima && tentativa > 1) return ESTRATEGIA_SEQUENCIA[ESTRATEGIA_SEQUENCIA.length - 1];
  return ESTRATEGIA_SEQUENCIA[indice];
};

// Etapas onde um empurrão automático é seguro. Negociação, proposta enviada,
// descartado e fechado-perdido ficam de fora de propósito: ali quem fala é o vendedor.
const ETAPAS_PADRAO = [
  '3. Follow-up 1',
  '4. Follow-up 2',
  '5. Follow-up 3',
  '17. Nurturing',
];

const carregarConfig = () => {
  const [horaInicio, horaFim] = String(process.env.AI_FOLLOWUP_HOURS || '9-18')
    .split('-')
    .map((v) => Number.parseInt(v, 10));
  return {
    enabled: flag('AI_FOLLOWUP_ENABLED', false),
    dryRun: flag('AI_FOLLOWUP_DRY_RUN', true),
    etapas: lista('AI_FOLLOWUP_STAGES', ETAPAS_PADRAO),
    silencioDias: inteiro('AI_FOLLOWUP_SILENCE_DAYS', 3),
    maxPorContato: inteiro('AI_FOLLOWUP_MAX_PER_CONTACT', 3),
    maxPorDia: inteiro('AI_FOLLOWUP_MAX_PER_DAY', 30),
    // 1 por tick e regra de seguranca, nao preferencia: o loop do tick envia sem
    // pausa entre contatos, entao qualquer valor > 1 vira rajada de mensagens em
    // segundos pelo mesmo numero. Quem controla o ritmo e o intervalo do cron.
    maxPorTick: inteiro('AI_FOLLOWUP_MAX_PER_TICK', 1),
    cooldownDias: inteiro('AI_FOLLOWUP_COOLDOWN_DAYS', 5),
    // Coordenacao com o disparo em massa: os dois saem pela MESMA instancia
    // Evolution, entao o orcamento tem que ser do numero, nao de cada sistema.
    instanciaCapDiario: inteiro('AI_FOLLOWUP_INSTANCE_DAILY_CAP', 40),
    instanciaCapHorario: inteiro('AI_FOLLOWUP_INSTANCE_HOURLY_CAP', 12),
    gapSegundos: inteiro('AI_FOLLOWUP_MIN_GAP_SECONDS', 300),
    minConfianca: decimal('AI_FOLLOWUP_MIN_CONFIDENCE', 0.6),
    horaInicio: Number.isFinite(horaInicio) ? horaInicio : 9,
    horaFim: Number.isFinite(horaFim) ? horaFim : 18,
    almoco: (() => {
      // "0" ou "off" desliga a pausa; formato "12-13".
      const bruto = String(process.env.AI_FOLLOWUP_LUNCH ?? '12-13').trim().toLowerCase();
      if (!bruto || bruto === '0' || bruto === 'off') return null;
      const [de, ate] = bruto.split('-').map((v) => Number.parseInt(v, 10));
      if (!Number.isFinite(de) || !Number.isFinite(ate) || ate <= de) return null;
      return { de, ate };
    })(),
    chatwootBaseUrl: String(process.env.CHATWOOT_BASE_URL || '').replace(/\/+$/, ''),
    chatwootToken: process.env.CHATWOOT_API_TOKEN || '',
  };
};

const createAiFollowupTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AI_FOLLOWUP_LOG_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT NOT NULL,
      conversation_id BIGINT,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'dry_run')),
      skip_reason TEXT,
      provider TEXT,
      model TEXT,
      confidence NUMERIC,
      message TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_followup_contact
      ON ${AI_FOLLOWUP_LOG_TABLE} (account_id, contact_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_followup_recent
      ON ${AI_FOLLOWUP_LOG_TABLE} (account_id, created_at DESC)
  `);
};

// Hora local de São Paulo sem depender do TZ do container (que varia no Swarm).
const horaEmSaoPaulo = (now = new Date()) => Number.parseInt(
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now),
  10
);

const dentroDaJanela = (config, now = new Date()) => {
  if (!isBrazilBusinessDay(now)) return false;
  const hora = horaEmSaoPaulo(now);
  if (hora < config.horaInicio || hora >= config.horaFim) return false;
  // Ninguem responde proposta no meio do almoco, e mensagem comercial nesse horario
  // irrita. A pausa vale para a IA; vendedor humano decide por conta.
  const almoco = config.almoco;
  if (almoco && hora >= almoco.de && hora < almoco.ate) return false;
  return true;
};

// Candidatos: quem está numa etapa elegível, calado há N dias, com a última
// palavra nossa, sem opt-out, sem follow-up demais e sem campanha recente.
const buscarCandidatos = async (pool, { accountId, config, limite }) => {
  const { rows } = await pool.query(
    `
    WITH carga_inbox AS (
      -- Tudo que saiu de cada numero nas ultimas 24h: campanha de disparo, vendedor
      -- humano e follow-up da IA entram na MESMA conta. O que derruba o numero e o
      -- volume total dele, nao o de cada sistema isolado.
      SELECT cv.inbox_id,
             COUNT(*) FILTER (
               WHERE m.created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
                     AT TIME ZONE 'America/Sao_Paulo'
             )::int AS hoje,
             COUNT(*) FILTER (WHERE m.created_at >= NOW() - INTERVAL '1 hour')::int AS ultima_hora,
             MAX(m.created_at) AS ultimo_envio
        FROM messages m
        JOIN conversations cv ON cv.id = m.conversation_id
       WHERE m.account_id = $1
         AND m.message_type = 1
         AND m.created_at >= NOW() - INTERVAL '1 day'
       GROUP BY cv.inbox_id
    ),
    ultima_mensagem AS (
      SELECT DISTINCT ON (conv.contact_id)
             conv.contact_id,
             conv.id AS conversation_id,
             m.message_type,
             m.created_at
        FROM conversations conv
        JOIN messages m ON m.conversation_id = conv.id
       WHERE m.account_id = $1
         AND COALESCE(m."private", false) = false
         AND m.message_type IN (0, 1)
       ORDER BY conv.contact_id, m.created_at DESC, m.id DESC
    )
    SELECT c.id AS contact_id,
           c.name,
           c.phone_number,
           c.custom_attributes->>'Funil_Vendas' AS funil,
           c.additional_attributes->>'company_name' AS empresa,
           um.conversation_id,
           um.created_at AS ultima_em,
           COALESCE(ja.total, 0) AS followups_anteriores,
           conv.assignee_id,
           conv.inbox_id,
           COALESCE(carga.hoje, 0) AS instancia_hoje,
           COALESCE(carga.ultima_hora, 0) AS instancia_ultima_hora,
           (retorno.id IS NOT NULL) AS por_agendamento,
           retorno.due_at AS agendado_para
      FROM contacts c
      JOIN ultima_mensagem um ON um.contact_id = c.id
      JOIN conversations conv ON conv.id = um.conversation_id
      LEFT JOIN carga_inbox carga ON carga.inbox_id = conv.inbox_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total
          FROM ${AI_FOLLOWUP_LOG_TABLE} l
         WHERE l.account_id = c.account_id
           AND l.contact_id = c.id
           AND l.status IN ('sent', 'dry_run')
      ) ja ON true
      -- Retorno que a classificacao de etapa agendou ("me chama em marco").
      LEFT JOIN LATERAL (
        SELECT r.id, r.due_at
          FROM contact_followup_reminders r
         WHERE r.account_id = c.account_id
           AND r.contact_id = c.id
           AND r.status = 'pending'
           AND r.due_at <= NOW()
         ORDER BY r.due_at
         LIMIT 1
      ) retorno ON true
     WHERE c.account_id = $1
       AND COALESCE(c.phone_number, '') <> ''
       AND (c.custom_attributes->>'Funil_Vendas' = ANY($2) OR retorno.id IS NOT NULL)
       -- a última palavra tem que ser nossa: se o contato falou por último, é
       -- atendimento vivo e quem responde é o vendedor, não a IA
       AND (retorno.id IS NOT NULL OR um.message_type = 1)
       AND (retorno.id IS NOT NULL OR um.created_at <= NOW() - make_interval(days => $3))
       AND COALESCE(ja.total, 0) < $4
       -- Espacamento CRESCENTE entre tentativas: a Nesima tentativa so acontece
       -- depois de cooldownDias * N. Cutucar sempre no mesmo ritmo soa automatico.
       AND NOT EXISTS (
         SELECT 1 FROM ${AI_FOLLOWUP_LOG_TABLE} r
          WHERE r.account_id = c.account_id AND r.contact_id = c.id
            AND r.created_at >= NOW() - make_interval(days => $5 * (COALESCE(ja.total, 0) + 1))
       )
       -- não colide com campanha de disparo: se saiu mensagem nossa depois da
       -- última registrada, alguém (ou o disparo) já falou com o lead
       AND NOT EXISTS (
         SELECT 1
           FROM messages m2
           JOIN conversations cv2 ON cv2.id = m2.conversation_id
          WHERE m2.account_id = c.account_id
            AND cv2.contact_id = c.id
            AND m2.message_type = 1
            AND m2.created_at >= NOW() - make_interval(days => $5)
            AND m2.created_at > um.created_at
       )
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'whatsapp_opt_out')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'opt_out')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'nao_contatar')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       -- Opt-out so da AUTOMACAO: vendedor e campanha continuam valendo. Serve para
       -- quem ja disse o que tinha que dizer e nao deve ser cutucado por robo.
       AND COALESCE(NULLIF(TRIM(LOWER(c.custom_attributes->>'ia_followup_opt_out')), ''), 'false')
           NOT IN ('true', '1', 'yes', 'sim')
       -- Nao entrar num lote em andamento: se o numero acabou de mandar algo (campanha
       -- disparando de 2 em 2 minutos, por exemplo), a IA espera o proximo tick.
       AND (carga.ultimo_envio IS NULL OR carga.ultimo_envio <= NOW() - make_interval(secs => $7))
       AND COALESCE(carga.hoje, 0) < $8
       AND COALESCE(carga.ultima_hora, 0) < $9
     -- Agendado vencido primeiro; depois o parado ha mais tempo.
     ORDER BY (retorno.id IS NOT NULL) DESC, retorno.due_at ASC NULLS LAST, um.created_at ASC
     LIMIT $6
    `,
    [
      accountId,
      config.etapas,
      config.silencioDias,
      config.maxPorContato,
      config.cooldownDias,
      limite,
      config.gapSegundos,
      config.instanciaCapDiario,
      config.instanciaCapHorario,
    ]
  );
  return rows;
};

const contarEnviadosHoje = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM ${AI_FOLLOWUP_LOG_TABLE}
      WHERE account_id = $1
        AND status IN ('sent', 'dry_run')
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2`,
    [accountId, TZ]
  );
  return rows[0]?.total || 0;
};

// Histórico textual da conversa. É a primeira vez que o backend lê messages.content:
// todo o resto do app trabalha só com metadados (timestamps, message_type, sender).
const carregarContextoConversa = async (pool, { accountId, contactId, limite = 40 }) => {
  const { rows } = await pool.query(
    `SELECT m.content, m.message_type, m.created_at
       FROM messages m
       JOIN conversations conv ON conv.id = m.conversation_id
      WHERE conv.contact_id = $1
        AND m.account_id = $2
        AND COALESCE(m."private", false) = false
        AND m.message_type IN (0, 1)
        AND COALESCE(TRIM(m.content), '') <> ''
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3`,
    [contactId, accountId, limite]
  );
  return rows
    .reverse()
    .map((r) => ({
      autor: r.message_type === 0 ? 'cliente' : 'nós',
      texto: String(r.content).slice(0, 800),
      em: r.created_at,
    }));
};

// Sufixos juridicos e ruido de cadastro. "Leandro Martins Imagens Aéreas LTDA ME"
// citado inteiro numa mensagem de WhatsApp soa a cobrança de cartório.
const SUFIXOS_EMPRESA = /\s*[-–,]?\s*\b(ltda|me|epp|eireli|s\/?a|s\.a\.?|mei|cia|c\/o)\b\.?\s*$/gi;

// Forma curta e pronunciavel do nome da empresa: sem sufixo juridico e com no maximo
// duas palavras, que e como uma pessoa se refere a um cliente em conversa.
const nomeCurtoEmpresa = (nome) => {
  let limpo = String(nome || '').trim();
  if (!limpo) return null;
  let anterior;
  do { anterior = limpo; limpo = limpo.replace(SUFIXOS_EMPRESA, '').trim(); } while (limpo !== anterior);
  limpo = limpo.replace(/[.,;]+$/, '').trim();
  if (!limpo) return null;
  // Cortar em 2 palavras cruas produz "WEPRO DO" e "SERTEC –": nunca terminar em
  // conectivo ou pontuação solta.
  const CONECTIVOS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', '-', '–', '&']);
  const palavras = limpo.split(/\s+/).filter(Boolean);
  const escolhidas = palavras.slice(0, 2);
  while (escolhidas.length > 1 && CONECTIVOS.has(escolhidas[escolhidas.length - 1].toLowerCase())) {
    escolhidas.pop();
  }
  return escolhidas.join(' ').replace(/[\s\-–&.,;]+$/, '').trim() || null;
};

// O que a IA ja mandou para este contato, para a proxima tentativa nao repetir
// abordagem nem pergunta.
const carregarFollowupsAnteriores = async (pool, { accountId, contactId }) => {
  const { rows } = await pool.query(
    `SELECT message, created_at
       FROM ${AI_FOLLOWUP_LOG_TABLE}
      WHERE account_id = $1 AND contact_id = $2 AND status = 'sent'
        AND COALESCE(TRIM(message), '') <> ''
      ORDER BY created_at`,
    [accountId, contactId]
  );
  return rows;
};

const diasDesde = (data, now = new Date()) => {
  const t = new Date(data).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
};

const montarPrompt = ({
  contato, historico, followupsAnteriores, diasSilencio,
  anteriores = [], maxPorContato = 3, agora = new Date(),
}) => {
  const tentativa = Math.min(Number(followupsAnteriores || 0) + 1, Math.max(1, maxPorContato));
  const system = [
    'Você escreve mensagens curtas de follow-up comercial no WhatsApp, em nome da Aerion, empresa brasileira de tecnologia.',
'Escreva em português do Brasil, tom profissional e direto, como um vendedor experiente — nunca como robô ou telemarketing.',
    'Soe como alguém que já conversou com essa pessoa e está retomando o assunto, não como',
    'e-mail corporativo nem atendimento. Claro e respeitoso, mas solto.',
    'Regras que não se quebram:',
    '- Evite fórmulas de circunstância. Nada de "Espero que esteja tudo bem", "Gostaria de',
    '  saber se", "Estou à disposição", "Fico no aguardo", "Venho por meio desta". Vá direto',
    '  ao ponto com naturalidade.',
    '- O nome da empresa é CONTEXTO para você entender o negócio, não coisa para recitar.',
    '  Na maioria das vezes nem mencione: "por aí", "aí no seu time", "nos seus projetos"',
    '  soam melhor. Se precisar citar, use a forma curta que te passei e jamais a razão',
    '  social completa com LTDA/ME/EIRELI.',
    '- No máximo 3 frases curtas.',
    '- Faça no máximo UMA pergunta, sempre fácil de responder.',
    '- Nunca cite preço, desconto, prazo de entrega ou condição comercial.',
    '- Nunca invente fato, número, reunião ou combinado que não esteja no histórico.',
    '- A SITUAÇÃO SE JULGA PELA ÚLTIMA COISA QUE O CLIENTE DISSE, que vem destacada.',
    '  Mensagens NOSSAS enviadas depois dela, sem resposta, NÃO mudam a situação: são',
    '  insistência nossa, não fato novo. Se ele disse "fale com fulano" e depois mandamos',
    '  três mensagens no vazio, a situação continua handoff — nunca vira silêncio.',
    '  Handoff, recusa definitiva e "já comprei" valem para sempre.',
    '- CADA linha do histórico vem com quanto tempo faz. Respeite isso: evento, feira,',
    '  promoção ou prazo citado numa mensagem antiga JÁ PASSOU. Nunca convide alguém para',
    '  algo que já aconteceu nem fale no futuro de data que ficou para trás. Na dúvida sobre',
    '  se algo ainda está de pé, não mencione.',
    '- Use o nome da pessoa APENAS se ele aparecer no histórico como nome de quem fala.',
    '  O cadastro do contato costuma ser razão social ou apelido do comercial ("DRONE',
    '  FLORIANO", "Felipe GRS80"): nunca extraia um primeiro nome dali. Sem nome confiável,',
    '  comece sem vocativo ("Oi, tudo bem?").',
    '- Nunca use placeholder entre chaves.',
    '- No máximo um emoji, e só se o histórico já tiver tom informal.',
    '- Esta é uma SEQUÊNCIA. Nunca repita a abordagem nem a pergunta de uma tentativa',
    '  anterior: se já perguntou se há interesse, mude o ângulo.',
    '',
    'Técnicas do processo comercial da Aerion (base Chris Voss) — use, não cite:',
    '- PERGUNTA CALIBRADA: comece por "Como" ou "O que". Nunca "por que" (soa cobrança),',
    '  nunca pergunta fechada de sim/não que o cliente responde com uma palavra e some.',
    '- LABELING: nomeie a situação dele antes de perguntar ("Imagino que a frota de vocês',
    '  esteja rodando no limite...", "Parece que o momento aí está corrido..."). Mostra que',
    '  você entende a realidade dele e desarma.',
    '- BUSCAR O "NÃO": pergunta onde o "não" é confortável devolve controle para o cliente',
    '  e costuma destravar resposta. "Seria absurdo olharmos isso de novo agora?" funciona',
    '  melhor que "você tem interesse?".',
    '- CUSTO DA INÇÃO: quando couber, ancore no que fica caro ficando como está — sem drama',
    '  e sem inventar número.',
    '',
    'O que NUNCA fazer, porque mata a venda:',
    '- Nunca se despedir, encerrar o contato ou avisar que "não vai mais insistir".',
    '  A cadencia acaba em silencio e o lead vai para nurture; o cliente nunca recebe',
    '  mensagem de encerramento. A porta fica aberta SEMPRE.',
    '- Nunca pedir desculpa por incomodar nem agradecer "pelo tempo até aqui". Isso',
    '  comunica que você desistiu e convida o cliente a sumir de vez.',
    '- Nunca perguntar se ele "quer receber informações futuras" — é pergunta de',
    '  descadastro, não de vendas.',
    '- Se o histórico não der contexto para uma mensagem útil, devolva confianca baixa.',
    '',
    'ANTES DE ESCREVER, LEIA A CONVERSA E CLASSIFIQUE A SITUAÇÃO:',
    '- "handoff": a pessoa disse que não é ela quem cuida disso e indicou outra. A conversa',
    '  COM ELA acabou. Não se pergunta a ela sobre o andamento com a outra pessoa — isso',
    '  é tarefa nossa. Se ela passou nome ou telefone, devolva em "indicacao".',
    '- "recusa_definitiva": não usa drone, já tem fornecedor fechado, encerrou a atividade.',
    '- "virou_cliente": já comprou ou fechou com a gente.',
    '- "aguardando_nos": a bola está do NOSSO lado (ele pediu proposta, orçamento, resposta',
    '  técnica e não entregamos). Cobrar quem espera por nós é o pior erro possível.',
    '- "adiar_com_data": pediu para voltar em um momento específico.',
    '- "duvida_aberta": ficou uma pergunta dele sem resposta.',
    '- "silencio": conversou normalmente e parou de responder, sem nada pendente.',
    '',
    'Nas quatro primeiras, NÃO escreva mensagem: devolva "acao": "nao_escrever".',
    'Nas três últimas, escreva seguindo a estratégia da tentativa.',
    '',
    'Responda SOMENTE com um objeto JSON:',
    '{"situacao": "<uma das sete>", "acao": "escrever" | "nao_escrever",',
    ' "motivo": "<a frase do cliente que te levou a isso>",',
    ' "mensagem": "<texto pronto, ou null se nao_escrever>",',
    ' "confianca": <numero de 0 a 1>,',
    ' "retomar_em_dias": <inteiro, 0 se nao cabe>,',
    ' "indicacao": {"nome": "<quem ele indicou>", "telefone": "<se deu>"} ou null}',
  ].join('\n');

  // Sem a idade de cada mensagem o modelo trata o assunto mais recente como atual e
  // convida gente para feira que aconteceu meses atrás. A data crua também confunde;
  // "há N dias" é o que ele usa bem.
  const linhas = historico.length
    ? historico.map((h) => {
        const dias = diasDesde(h.em, agora);
        const quando = dias === null
          ? 'data desconhecida'
          : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
        return `[${h.autor} — ${quando}] ${h.texto}`;
      }).join('\n')
    : '(sem histórico textual)';

  const hoje = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric',
  }).format(agora);
  const empresaCurta = nomeCurtoEmpresa(contato.empresa);

  // A ultima fala do cliente e o unico sinal que define a situacao. Entregue separada,
  // para nao depender de o modelo acha-la no meio das nossas mensagens sem resposta.
  const idxUltimaCliente = historico.map((h) => h.autor).lastIndexOf('cliente');
  const ultimaDoCliente = idxUltimaCliente >= 0 ? historico[idxUltimaCliente] : null;
  const nossasDepois = idxUltimaCliente >= 0
    ? historico.length - idxUltimaCliente - 1
    : historico.length;
  // Pega a ultima RAJADA do cliente (falas seguidas dele), nao so a ultima linha.
  const falasDoCliente = [];
  for (let i = idxUltimaCliente; i >= 0 && falasDoCliente.length < 4; i -= 1) {
    if (historico[i].autor !== 'cliente') break;
    falasDoCliente.unshift(historico[i]);
  }

  const user = [
    `Hoje é ${hoje}.`,
    `Contato (cadastro, pode ser razão social — não use como primeiro nome): ${contato.name || 'sem nome'}`,
    empresaCurta ? `Empresa (contexto — não recite, prefira não citar): ${empresaCurta}` : null,
    `Etapa do funil: ${contato.funil || 'não informada'}`,
    `Dias sem resposta: ${diasSilencio ?? 'desconhecido'}`,
    `Tentativa ${tentativa} de ${maxPorContato} desta sequência.`,
    `Estratégia desta tentativa: ${estrategiaDaTentativa(tentativa, maxPorContato)}`,
    '',
    ultimaDoCliente
      ? [
        `>>> O QUE O CLIENTE FALOU POR ÚLTIMO (há ${diasDesde(ultimaDoCliente.em, agora) ?? '?'} dias) — julgue a situação por aqui:`,
        ...falasDoCliente.map((f) => `    "${f.texto}"`),
      ].join(String.fromCharCode(10))
      : '>>> O CLIENTE NUNCA RESPONDEU nesta conversa.',
    nossasDepois > 0
      ? `>>> Depois disso nós mandamos ${nossasDepois} mensagem(ns) e ele não respondeu. Isso é insistência nossa, não fato novo.`
      : null,
    '',
    'Histórico completo (mais antigo primeiro):',
    linhas,
    anteriores.length ? '' : null,
    anteriores.length
      ? 'Follow-ups que VOCÊ já mandou nesta sequência (não repita nenhum deles):'
      : null,
    anteriores.length
      ? anteriores.map((a, i) => {
          const dias = diasDesde(a.created_at, agora);
          const quando = dias === null ? '' : dias === 0 ? ' (hoje)' : ` (há ${dias} dias)`;
          return `  ${i + 1}ª${quando}: ${a.message}`;
        }).join('\n')
      : null,
    '',
    'Escreva o próximo follow-up.',
  ].filter(Boolean).join('\n');

  return { system, user };
};

// Última barreira antes de falar com o cliente.
const validarMensagem = (texto, confianca, config) => {
  const limpo = String(texto || '').trim();
  if (!limpo) return 'mensagem vazia';
  if (limpo.length > MENSAGEM_MAX_CHARS) return `mensagem longa demais (${limpo.length} chars)`;
  if (PLACEHOLDER.test(limpo)) return 'placeholder não resolvido na mensagem';
  if (TERMOS_PROIBIDOS.some((re) => re.test(limpo))) return 'mensagem toca em tema comercial proibido';
  if (TERMOS_DESPEDIDA.some((re) => re.test(limpo))) {
    return 'mensagem se despede do lead — a cadência termina em silêncio, não em adeus';
  }
  // Number(null) é 0 — sem este teste, confiança ausente virava "abaixo do mínimo".
  if (confianca === null || confianca === undefined || confianca === '') return 'confiança ausente';
  if (!Number.isFinite(Number(confianca))) return 'confiança ausente';
  if (Number(confianca) < config.minConfianca) {
    return `confiança ${Number(confianca).toFixed(2)} abaixo do mínimo ${config.minConfianca}`;
  }
  return null;
};

// Postar direto em `messages` via SQL NÃO envia nada: quem despacha para o
// WhatsApp é o Rails do Chatwoot. Por isso o envio é pela API HTTP dele.
const enviarPeloChatwoot = async ({ config, accountId, conversationId, texto, fetchImpl = fetch }) => {
  if (!config.chatwootBaseUrl || !config.chatwootToken) {
    throw new Error('Chatwoot não configurado (CHATWOOT_BASE_URL / CHATWOOT_API_TOKEN).');
  }
  const url = `${config.chatwootBaseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: config.chatwootToken,
      },
      body: JSON.stringify({ content: texto, message_type: 'outgoing' }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      throw new Error(`Chatwoot HTTP ${resp.status}: ${String(corpo).slice(0, 200)}`);
    }
    return await resp.json().catch(() => null);
  } finally {
    clearTimeout(timer);
  }
};

const registrarDecisao = async (pool, dados) => {
  const { rows } = await pool.query(
    `INSERT INTO ${AI_FOLLOWUP_LOG_TABLE}
       (account_id, contact_id, conversation_id, attempt, status, skip_reason,
        provider, model, confidence, message, error, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      dados.accountId,
      dados.contactId,
      dados.conversationId ?? null,
      dados.attempt ?? 1,
      dados.status,
      dados.skipReason ?? null,
      dados.provider ?? null,
      dados.model ?? null,
      Number.isFinite(Number(dados.confidence)) ? Number(dados.confidence) : null,
      dados.message ?? null,
      dados.error ?? null,
      dados.status === 'sent' ? new Date() : null,
    ]
  );
  return rows[0]?.id ?? null;
};

// Um tick do worker. `deps` injeta o que vive no index.js (chatCompletionJson,
// notificação) e o fetch, para dar para testar sem rede e sem provider.
const runAiFollowupTick = async (pool, {
  accountId,
  chatCompletionJson,
  notify = null,
  agendarRetorno = null,
  atribuirResponsavel = null,
  fetchImpl = fetch,
  now = new Date(),
  config = carregarConfig(),
} = {}) => {
  if (!config.enabled) return { skipped: 'desligado' };
  if (!dentroDaJanela(config, now)) return { skipped: 'fora da janela comercial' };

  const enviadosHoje = await contarEnviadosHoje(pool, accountId);
  const saldoDia = config.maxPorDia - enviadosHoje;
  if (saldoDia <= 0) return { skipped: 'teto diário atingido', enviadosHoje };

  const limite = Math.max(1, Math.min(config.maxPorTick, saldoDia));
  const candidatos = await buscarCandidatos(pool, { accountId, config, limite });
  const resultado = {
    avaliados: candidatos.length,
    enviados: 0,
    dry_run: 0,
    pulados: 0,
    falhas: 0,
  };

  for (const candidato of candidatos) {
    const base = {
      accountId,
      contactId: candidato.contact_id,
      conversationId: candidato.conversation_id,
      attempt: Number(candidato.followups_anteriores || 0) + 1,
    };
    try {
      const historico = await carregarContextoConversa(pool, {
        accountId,
        contactId: candidato.contact_id,
      });
      if (!historico.length) {
        await registrarDecisao(pool, { ...base, status: 'skipped', skipReason: 'sem histórico textual' });
        resultado.pulados += 1;
        continue;
      }

      const anteriores = await carregarFollowupsAnteriores(pool, {
        accountId,
        contactId: candidato.contact_id,
      });
      const { system, user } = montarPrompt({
        contato: candidato,
        historico,
        followupsAnteriores: Number(candidato.followups_anteriores || 0),
        diasSilencio: diasDesde(candidato.ultima_em, now),
        anteriores,
        maxPorContato: config.maxPorContato,
        agora: now,
      });
      const ia = await chatCompletionJson({ system, user, maxTokens: 500, temperature: 0.4 });
      if (!ia.ok) {
        await registrarDecisao(pool, { ...base, status: 'failed', error: ia.error });
        resultado.falhas += 1;
        continue;
      }

      const situacao = String(ia.data?.situacao || '').trim().toLowerCase();
      const texto = String(ia.data?.mensagem || '').trim();
      const confianca = ia.data?.confianca;

      // Guarda dura: nestas situacoes nao se escreve, mesmo que o modelo tenha
      // devolvido "escrever" e um texto bonito. A decisao nao e dele.
      const proibidoEscrever = SITUACOES_SEM_MENSAGEM.has(situacao)
        || String(ia.data?.acao || '').trim().toLowerCase() === 'nao_escrever';

      if (proibidoEscrever) {
        const motivoLeitura = String(ia.data?.motivo || '').slice(0, 300);
        await registrarDecisao(pool, {
          ...base,
          status: 'skipped',
          skipReason: `situacao "${situacao || 'nao_escrever'}": ${motivoLeitura}`,
          provider: ia.provider,
          model: ia.model,
          confidence: confianca,
        });
        resultado.pulados += 1;

        // Sai de cena pelo tempo que a situacao pede, em vez de voltar em 5 dias.
        const dias = ESPERA_POR_SITUACAO[situacao] ?? Number(ia.data?.retomar_em_dias) ?? 0;
        if (dias > 0 && agendarRetorno) {
          await Promise.resolve(agendarRetorno({
            contactId: candidato.contact_id,
            dueAt: new Date(Date.now() + dias * 86400000).toISOString(),
            note: `IA: ${situacao} — voltar em ${dias} dias`.slice(0, 160),
          })).catch((e) => console.warn('[follow-up] agendar retorno falhou:', e.message));
        }

        // Indicacao e o ativo mais valioso dessa resposta: nao pode morrer no log.
        const ind = ia.data?.indicacao;
        if (ind && (ind.nome || ind.telefone) && notify) {
          await Promise.resolve(notify({
            tipo: 'indicacao',
            contato: candidato,
            indicacao: ind,
            motivo: motivoLeitura,
          })).catch(() => {});
        }
        continue;
      }

      const problema = validarMensagem(texto, confianca, config);
      if (problema) {
        await registrarDecisao(pool, {
          ...base,
          status: 'skipped',
          skipReason: problema,
          provider: ia.provider,
          model: ia.model,
          confidence: confianca,
          message: texto || null,
        });
        resultado.pulados += 1;
        if (notify) {
          await Promise.resolve(
            notify({ tipo: 'skipped', contato: candidato, motivo: problema, mensagem: texto })
          ).catch(() => {});
        }
        continue;
      }

      if (config.dryRun) {
        await registrarDecisao(pool, {
          ...base,
          status: 'dry_run',
          provider: ia.provider,
          model: ia.model,
          confidence: confianca,
          message: texto,
        });
        resultado.dry_run += 1;
        continue;
      }

      await enviarPeloChatwoot({
        config,
        accountId,
        conversationId: candidato.conversation_id,
        texto,
        fetchImpl,
      });
      await registrarDecisao(pool, {
        ...base,
        status: 'sent',
        provider: ia.provider,
        model: ia.model,
        confidence: confianca,
        message: texto,
      });
      resultado.enviados += 1;

      // Se ninguem cuidava dessa conversa, ela passa a ter dono. A IA abriu a porta;
      // quem atende a resposta tem que estar definido antes dela chegar.
      if (!candidato.assignee_id && atribuirResponsavel) {
        await Promise.resolve(atribuirResponsavel({
          conversationId: candidato.conversation_id,
          contactId: candidato.contact_id,
        })).catch((e) => console.warn('[follow-up] atribuir responsavel falhou:', e.message));
      }

      if (notify) {
        await Promise.resolve(
          notify({ tipo: 'sent', contato: candidato, mensagem: texto })
        ).catch(() => {});
      }
    } catch (error) {
      await registrarDecisao(pool, {
        ...base,
        status: 'failed',
        error: String(error.message || error),
      }).catch(() => {});
      resultado.falhas += 1;
    }
  }

  return resultado;
};

module.exports = {
  AI_FOLLOWUP_LOG_TABLE,
  TERMOS_DESPEDIDA,
  SITUACOES_SEM_MENSAGEM,
  ESPERA_POR_SITUACAO,
  nomeCurtoEmpresa,
  MENSAGEM_MAX_CHARS,
  ETAPAS_PADRAO,
  carregarConfig,
  createAiFollowupTable,
  dentroDaJanela,
  horaEmSaoPaulo,
  buscarCandidatos,
  carregarContextoConversa,
  carregarFollowupsAnteriores,
  estrategiaDaTentativa,
  ESTRATEGIA_SEQUENCIA,
  contarEnviadosHoje,
  montarPrompt,
  validarMensagem,
  enviarPeloChatwoot,
  registrarDecisao,
  runAiFollowupTick,
};
