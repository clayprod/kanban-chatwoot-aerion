// Exigência de variação no pool de mensagens de uma campanha.
//
// Conteúdo idêntico repetido é o sinal de automação mais forte que existe — pesa
// mais que volume. Uma campanha de 60 pessoas com um texto só é reconhecível de
// longe; o mesmo vale para mídia, já que o WhatsApp compara o hash do arquivo e
// vê o mesmo anexo saindo dezenas de vezes do mesmo número.
//
// A regra escala com o público: a cada `contatosPorVariacao` contatos, exige-se
// mais uma variação, até um teto (pedir 40 textos para uma campanha de 1000 seria
// inviável na prática). Campanha pequena — teste, reenvio pontual — não é afetada.

const crypto = require('crypto');

const CONTATOS_POR_VARIACAO_PADRAO = 25;
const MAX_VARIACOES_PADRAO = 6;

const carregarConfigVariacao = () => ({
  contatosPorVariacao: Math.max(
    1,
    Number.parseInt(process.env.DISPARO_CONTATOS_POR_VARIACAO || '', 10) || CONTATOS_POR_VARIACAO_PADRAO
  ),
  maxVariacoes: Math.max(
    1,
    Number.parseInt(process.env.DISPARO_MAX_VARIACOES || '', 10) || MAX_VARIACOES_PADRAO
  ),
});

// Quantas variações distintas o público exige.
const variacoesExigidas = (totalContatos, {
  contatosPorVariacao = CONTATOS_POR_VARIACAO_PADRAO,
  maxVariacoes = MAX_VARIACOES_PADRAO,
} = {}) => {
  const total = Math.max(0, Number(totalContatos) || 0);
  if (total <= contatosPorVariacao) return 1;
  return Math.min(maxVariacoes, Math.ceil(total / contatosPorVariacao));
};

// Normaliza para comparar: espaços e caixa não fazem duas mensagens serem
// diferentes de verdade — "Oi!  Tudo bem?" e "oi! tudo bem?" são a mesma coisa
// para quem recebe e para quem detecta padrão.
const normalizarTexto = (texto) => String(texto || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const impressaoDigitalMidia = (mensagem) => {
  if (!mensagem?.arquivo_base64) return null;
  return crypto.createHash('sha1').update(String(mensagem.arquivo_base64)).digest('hex');
};

// Conta variações reais de texto e de mídia no pool.
const contarVariacoes = (mensagens) => {
  const textos = new Set();
  const midias = new Set();
  let comMidia = 0;
  for (const mensagem of Array.isArray(mensagens) ? mensagens : []) {
    const texto = normalizarTexto(mensagem?.texto || mensagem?.legenda);
    if (texto) textos.add(texto);
    const midia = impressaoDigitalMidia(mensagem);
    if (midia) {
      midias.add(midia);
      comMidia += 1;
    }
  }
  return { textos: textos.size, midias: midias.size, comMidia };
};

// Devolve null quando o pool está adequado, ou { erro, detalhe, exigidas, ... }.
const validarVariacaoMensagens = (mensagens, totalContatos, opcoes = {}) => {
  const config = { ...carregarConfigVariacao(), ...opcoes };
  const exigidas = variacoesExigidas(totalContatos, config);
  const { textos, midias, comMidia } = contarVariacoes(mensagens);

  const base = {
    exigidas,
    textos_distintos: textos,
    midias_distintas: midias,
    contatos: Number(totalContatos) || 0,
    contatos_por_variacao: config.contatosPorVariacao,
  };

  if (exigidas <= 1) return null;

  if (textos < exigidas) {
    return {
      ...base,
      erro: `Campanha para ${base.contatos} contatos exige ao menos ${exigidas} mensagens diferentes — há ${textos}.`,
      detalhe: `Texto repetido para muita gente é o que mais denuncia automação. A cada ${config.contatosPorVariacao} contatos, escreva mais uma variação (mude a abertura e a pergunta, não só sinônimos).`,
      campo: 'texto',
    };
  }

  // Mídia só é cobrada quando a campanha usa mídia.
  if (comMidia > 0 && midias < exigidas) {
    return {
      ...base,
      erro: `Campanha com mídia para ${base.contatos} contatos exige ao menos ${exigidas} arquivos diferentes — há ${midias}.`,
      detalhe: 'O WhatsApp compara o hash do arquivo: o mesmo anexo saindo dezenas de vezes do mesmo número é padrão de disparo em massa. Varie também a imagem/vídeo.',
      campo: 'midia',
    };
  }

  return null;
};

module.exports = {
  CONTATOS_POR_VARIACAO_PADRAO,
  MAX_VARIACOES_PADRAO,
  carregarConfigVariacao,
  variacoesExigidas,
  normalizarTexto,
  impressaoDigitalMidia,
  contarVariacoes,
  validarVariacaoMensagens,
};
