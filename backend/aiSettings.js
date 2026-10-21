// Liga/desliga da automação, guardado no banco.
//
// As variáveis de ambiente vivem em `docker service update --env-add` e já foram
// apagadas por deploy SEIS vezes — o follow-up ficou dias parado sem ninguém notar,
// e a classificação voltou sozinha para modo sombra depois de ter sido ligada.
// O default no código não resolve: ele precisa ser "desligado" por segurança, senão
// perder env viraria envio acidental.
//
// Então o estado operacional (ligado? modo sombra?) passa a morar numa tabela. Deploy
// não alcança. A env continua valendo como piso: se o banco não disser nada, vale o
// que estiver no ambiente, e o comportamento antigo é preservado.

const AI_SETTINGS_TABLE = 'ai_settings';

const createAiSettingsTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AI_SETTINGS_TABLE} (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
};

// Cache curto: os workers consultam a cada tick e não faz sentido ir ao banco
// toda vez, mas mudar a chave tem que valer rápido.
const TTL_MS = 30000;
let cache = { em: 0, valores: new Map() };

const carregarSettings = async (pool, { agora = Date.now() } = {}) => {
  if (agora - cache.em < TTL_MS) return cache.valores;
  try {
    const { rows } = await pool.query(`SELECT chave, valor FROM ${AI_SETTINGS_TABLE}`);
    cache = { em: agora, valores: new Map(rows.map((r) => [r.chave, r.valor])) };
  } catch (error) {
    // Tabela ausente ou banco fora: não derruba o worker, só mantém o que tinha.
    console.warn('[ai-settings] leitura falhou, usando env:', error.message);
    cache = { em: agora, valores: cache.valores };
  }
  return cache.valores;
};

const invalidarCacheSettings = () => { cache = { em: 0, valores: cache.valores }; };

const BOOL_TRUE = ['1', 'true', 'yes', 'sim', 'on'];
const BOOL_FALSE = ['0', 'false', 'no', 'nao', 'não', 'off'];

// O banco manda; sem registro, vale a env; sem env, vale o default do código.
const resolverFlag = (valores, chave, doEnv) => {
  const bruto = valores?.get(chave);
  if (bruto === undefined || bruto === null || bruto === '') return doEnv;
  const v = String(bruto).trim().toLowerCase();
  if (BOOL_TRUE.includes(v)) return true;
  if (BOOL_FALSE.includes(v)) return false;
  return doEnv;
};

const gravarSetting = async (pool, chave, valor, porQuem = null) => {
  await pool.query(
    `INSERT INTO ${AI_SETTINGS_TABLE} (chave, valor, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (chave) DO UPDATE
       SET valor = EXCLUDED.valor, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [chave, valor === null || valor === undefined ? null : String(valor), porQuem]
  );
  invalidarCacheSettings();
};

module.exports = {
  AI_SETTINGS_TABLE,
  createAiSettingsTable,
  carregarSettings,
  invalidarCacheSettings,
  resolverFlag,
  gravarSetting,
};
