// Seleção de público do Disparo WhatsApp — parte pura (sem banco), para poder
// ser testada isoladamente.
//
// Contexto: até set/2026 o backend combinava TODOS os grupos de seletores em E,
// ignorando o `combinar` que a UI enviava. Marcar "etapa X" + "3 contatos" virava
// uma interseção quase sempre vazia, e campanhas grandes saíam para 1 pessoa sem
// nenhum aviso na tela.

const OPT_OUT_KEYS = ['whatsapp_opt_out', 'opt_out', 'nao_contatar', 'não_contatar', 'bloqueado'];
const OPT_IN_KEYS = ['whatsapp_opt_in', 'opt_in', 'consentimento_whatsapp', 'consentimento'];
const VERDADEIRO = ['true', '1', 'yes', 'sim'];

// DDD a partir do telefone salvo no Chatwoot (com ou sem +55).
const dddDoTelefone = (telefone) => {
  const digitos = String(telefone || '').replace(/[^0-9]/g, '');
  const nacional = digitos.startsWith('55') ? digitos.slice(2) : digitos;
  return nacional.slice(0, 2);
};

const temAtributoVerdadeiro = (atributos, chaves) => chaves.some((chave) =>
  VERDADEIRO.includes(String((atributos || {})[chave]).trim().toLowerCase()));

// Monta um teste por grupo preenchido. `combinar: true` une (OU), `false` cruza (E).
const montarTestes = (destinatarios, idsFixos) => {
  const testes = [];
  if (destinatarios.funil_vendas?.length) {
    testes.push((row) => destinatarios.funil_vendas.includes(row.funil));
  }
  if (destinatarios.tags?.length) {
    testes.push((row) => destinatarios.tags.some((tag) => (row.labels || []).includes(tag)));
  }
  if (destinatarios.canais?.length) {
    testes.push((row) => destinatarios.canais.includes(row.canal));
  }
  if (destinatarios.ddds?.length) {
    testes.push((row) => destinatarios.ddds.includes(dddDoTelefone(row.phone_number)));
  }
  if (idsFixos.size) {
    testes.push((row) => idsFixos.has(Number(row.id)));
  }
  return testes;
};

// `rows` vem da consulta em contacts (id, name, phone_number, funil, canal, empresa,
// atributos, labels). Devolve o público já deduplicado por telefone e a contagem de
// descartes por motivo — é isso que a UI mostra para o disparo deixar de ser cego.
const selecionarPublico = (rows, destinatarios, { requireOptIn = false } = {}) => {
  const idsFixos = new Set((destinatarios.contatos || [])
    .map((c) => Number(typeof c === 'object' && c !== null ? c.id : c))
    .filter(Number.isFinite));
  const testes = montarTestes(destinatarios, idsFixos);
  const unir = Boolean(destinatarios.combinar);
  const descartados = { seletor: 0, opt_out: 0, sem_opt_in: 0, duplicados: 0 };
  const telefonesVistos = new Set();
  const publico = [];

  for (const row of rows) {
    const passa = testes.length > 0
      && (unir ? testes.some((t) => t(row)) : testes.every((t) => t(row)));
    if (!passa) { descartados.seletor += 1; continue; }

    const atributos = row.atributos && typeof row.atributos === 'object' ? row.atributos : {};
    if (temAtributoVerdadeiro(atributos, OPT_OUT_KEYS)) { descartados.opt_out += 1; continue; }
    if (requireOptIn && !temAtributoVerdadeiro(atributos, OPT_IN_KEYS)) {
      descartados.sem_opt_in += 1;
      continue;
    }

    const telefone = String(row.phone_number || '').trim();
    const chave = telefone.replace(/[^0-9]/g, '');
    if (!chave || telefonesVistos.has(chave)) { descartados.duplicados += 1; continue; }
    telefonesVistos.add(chave);

    // `nome` = contacts.name do Chatwoot (pessoa ou razão social do contato)
    publico.push({ id: Number(row.id), nome: row.name, telefone, empresa: row.empresa || null });
  }

  return { publico, descartados, totalBase: rows.length };
};

module.exports = {
  OPT_OUT_KEYS,
  OPT_IN_KEYS,
  dddDoTelefone,
  selecionarPublico,
};
