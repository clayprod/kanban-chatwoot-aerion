// A IA do Radar sugere CNAE com formato válido que NÃO existe ("8421-1/00", "7520-0/00",
// "3511-2/00") e a busca devolve zero calada: em 29/10 o perfil "Segurança pública e defesa
// civil" ficou parado por isso. Só descartar o código (como era antes) mata o perfil; aqui o
// código inexistente é trocado pelo CNAE real mais próximo, achado pela DESCRIÇÃO.
//
// Regras para nunca errar para o lado de prospectar o setor errado:
// - código que existe na tabela da Receita passa intacto;
// - o substituto precisa estar na MESMA divisão (2 primeiros dígitos) e ter ao menos uma
//   palavra significativa em comum com a descrição/título que a IA deu;
// - sem descrição para comparar, ou sem candidato que cumpra as duas coisas, o código é
//   descartado e fica registrado — nunca é um palpite por vizinhança numérica.

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soDigitos = (s) => String(s || '').replace(/[^0-9]/g, '');

const SEM_VALOR = new Set([
  'atividades', 'atividade', 'servicos', 'servico', 'outras', 'outros', 'demais', 'empresa', 'empresas',
  'especificadas', 'especificada', 'especificado', 'anteriormente', 'exceto', 'para', 'sobre',
]);
const palavras = (texto) => new Set(
  semAcento(texto).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !SEM_VALOR.has(t))
);

const MAX_SUBSTITUTOS = 2;

// CNAEs que EXISTEM mas não identificam comprador de drone e, por serem enormes, derrubam a
// busca: administração pública em geral (toda prefeitura do país, 504 em 29/10 no perfil de
// resgate), holdings e associações. Tratados como inválidos: são trocados ou descartados.
const GENERICOS = ['8411', '8412', '8413', '6461', '6462', '6463', '9411', '9412', '9420', '9430', '9491', '9492', '9493', '9499'];
const ehGenerico = (cod) => GENERICOS.some((p) => cod.startsWith(p));

// Quando o título fala o jargão do setor e a Receita usa o nome oficial.
const SINONIMOS = {
  resgate: ['defesa', 'civil', 'bombeiros', 'socorro'],
  emergencia: ['defesa', 'civil', 'bombeiros', 'socorro'],
  emergencias: ['defesa', 'civil', 'bombeiros', 'socorro'],
  salvamento: ['defesa', 'civil', 'bombeiros', 'socorro'],
};
const comSinonimos = (conjunto) => {
  const extra = [...conjunto].flatMap((p) => SINONIMOS[p] || []);
  return new Set([...conjunto, ...extra]);
};

const corrigirCnaes = ({ lista, labels = [], titulo = '', tabela }) => {
  const porCodigo = new Map(tabela.map((r) => [soDigitos(r.codigo), r.descricao || '']));
  const codigos = [...new Set((Array.isArray(lista) ? lista : []).map(soDigitos).filter((c) => c.length === 7))];
  const validos = [];
  const corrigidos = [];
  const descartados = [];

  for (const cod of codigos) {
    if (porCodigo.has(cod) && !ehGenerico(cod)) {
      validos.push(cod);
      continue;
    }
    const rotulo = (Array.isArray(labels) ? labels : []).find((l) => soDigitos(l?.codigo) === cod);
    // Rótulo que é só o próprio código ("8411-7/00") não descreve nada.
    const descricaoDoRotulo = soDigitos(rotulo?.descricao) === cod ? '' : rotulo?.descricao || '';
    const contexto = comSinonimos(palavras(`${ehGenerico(cod) ? '' : descricaoDoRotulo} ${titulo || ''}`));
    if (!contexto.size) {
      descartados.push({ de: cod, motivo: 'sem descrição para achar o código certo' });
      continue;
    }
    const candidatos = [];
    for (const [alvo, descricao] of porCodigo) {
      if (alvo.slice(0, 2) !== cod.slice(0, 2)) continue; // mesma divisão
      if (ehGenerico(alvo)) continue;
      const emComum = [...palavras(descricao)].filter((p) => contexto.has(p)).length;
      if (!emComum) continue;
      let prefixo = 0;
      while (prefixo < 7 && alvo[prefixo] === cod[prefixo]) prefixo += 1;
      candidatos.push({ cod: alvo, emComum, nota: emComum * 10 + prefixo });
    }
    candidatos.sort((a, b) => b.nota - a.nota || a.cod.localeCompare(b.cod));
    // Só quem empata com o melhor em palavras em comum: "Defesa" (forças armadas) tem 1
    // palavra de "defesa civil" e não pode acompanhar o código que tem 2.
    const melhor = candidatos[0]?.emComum || 0;
    const escolhidos = candidatos.filter((c) => c.emComum === melhor).slice(0, MAX_SUBSTITUTOS).map((c) => c.cod);
    if (!escolhidos.length) {
      descartados.push({ de: cod, motivo: 'nenhum CNAE real da mesma divisão bate com a descrição' });
      continue;
    }
    corrigidos.push({ de: cod, para: escolhidos });
    validos.push(...escolhidos);
  }
  return { validos: [...new Set(validos)], corrigidos, descartados };
};

module.exports = { corrigirCnaes };
