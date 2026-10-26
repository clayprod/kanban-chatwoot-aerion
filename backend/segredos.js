// Credencial de integração que sobrevive a deploy.
//
// Env var nesta stack não sobrevive: o EasyPanel recria o serviço com as variáveis
// do painel dele e descarta o que foi posto por `docker service update`. Isso já
// apagou a configuração do follow-up seis vezes, e em 26/10 apagou os tokens das
// instâncias do WhatsApp e a chave do Tavily — seis prospecções foram enfileiradas
// e nenhuma saiu, com "sem token para a instância iago_aerion" na fila.
//
// O liga/desliga já tinha saído do env por esse motivo (ver aiSettings.js). Aqui vão
// os SEGREDOS, pelo mesmo caminho e na mesma tabela, mas cifrados com a chave que o
// módulo de ecommerce já usa — não quero credencial em texto puro no banco.
//
// A env continua valendo como piso: sem registro no banco, usa o ambiente. Assim
// nada quebra enquanto os segredos não forem migrados.

const { encrypt, decrypt, encryptionKey } = require('./ecommerce/domain');

const PREFIXO = 'secret:';
const TTL_MS = 60000;

const criarCofre = ({ pool, tabela = 'ai_settings', env = process.env } = {}) => {
  let cache = { em: 0, valores: new Map() };

  const carregar = async () => {
    if (Date.now() - cache.em < TTL_MS) return cache.valores;
    try {
      const { rows } = await pool.query(
        `SELECT chave, valor FROM ${tabela} WHERE chave LIKE $1`,
        [`${PREFIXO}%`]
      );
      const valores = new Map();
      for (const r of rows) {
        try {
          valores.set(r.chave.slice(PREFIXO.length), decrypt(r.valor, encryptionKey(env)));
        } catch {
          // Segredo gravado com outra chave de cifra: ignora em vez de derrubar o
          // processo, e o piso do env assume.
          console.warn(`[segredos] não consegui decifrar "${r.chave}"`);
        }
      }
      cache = { em: Date.now(), valores };
    } catch (error) {
      console.warn('[segredos] leitura falhou, usando env:', error.message);
      cache = { em: Date.now(), valores: cache.valores };
    }
    return cache.valores;
  };

  return {
    // Banco primeiro; sem registro, o env. Devolve null se não houver nenhum.
    async ler(chave, { doEnv = env[chave] } = {}) {
      const valores = await carregar();
      return valores.get(chave) || doEnv || null;
    },
    async gravar(chave, valor, porQuem = null) {
      await pool.query(
        `INSERT INTO ${tabela} (chave, valor, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (chave) DO UPDATE
           SET valor = EXCLUDED.valor, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [`${PREFIXO}${chave}`, encrypt(String(valor), encryptionKey(env)), porQuem]
      );
      cache = { em: 0, valores: cache.valores };
    },
    async listar() {
      const valores = await carregar();
      return [...valores.keys()];
    },
    invalidar() { cache = { em: 0, valores: cache.valores }; },
  };
};

module.exports = { criarCofre, PREFIXO };
