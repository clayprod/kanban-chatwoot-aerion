// Contatos que NÃO são clientes: a Evolution cria no Chatwoot um contato "EvolutionAPI"
// (telefone +123456) e posta ali avisos de conexão/QR como mensagem de entrada. Sem este
// filtro o respondedor escala o aviso ao atendimento e o reclassificador move o card.
//
// Os defaults vivem no código de propósito (env vars já se perderam em deploy): perder
// AI_IGNORE_CONTACTS nunca pode reabrir o buraco.
const NOMES_PADRAO = ['evolutionapi'];
const TELEFONES_PADRAO = ['+123456', '123456'];

const lista = (valor, padrao) => {
  const extra = String(valor || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...padrao, ...extra])];
};

const contatosSistema = (env = process.env) => ({
  nomes: lista(env.AI_IGNORE_CONTACT_NAMES, NOMES_PADRAO),
  telefones: lista(env.AI_IGNORE_CONTACT_PHONES, TELEFONES_PADRAO),
});

// Fragmento SQL "AND ..." para o alias de contacts. Valores vão como literais já
// escapados (a lista vem de env/código, nunca de entrada do usuário).
const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlExcluiSistema = (alias = 'ct', env = process.env) => {
  const { nomes, telefones } = contatosSistema(env);
  return `AND LOWER(TRIM(COALESCE(${alias}.name, ''))) NOT IN (${nomes.map(esc).join(',')})
       AND COALESCE(${alias}.phone_number, '') NOT IN (${telefones.map(esc).join(',')})
       AND COALESCE(${alias}.identifier, '') NOT IN (${telefones.map(esc).join(',')})`;
};

const ehContatoSistema = (contato, env = process.env) => {
  const { nomes, telefones } = contatosSistema(env);
  const nome = String(contato?.name || '').trim().toLowerCase();
  return (
    nomes.includes(nome) ||
    telefones.includes(String(contato?.phone_number || '')) ||
    telefones.includes(String(contato?.identifier || ''))
  );
};

module.exports = { contatosSistema, sqlExcluiSistema, ehContatoSistema };
