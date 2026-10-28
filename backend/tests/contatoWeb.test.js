const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extrairTelefones, ufCompativel, termosSignificativos, termosDoRamo, nomeCurto,
  ehAgregador, pontuarPagina, montarPromptContato, buscarContatoWeb, LIMIAR_ACEITA,
} = require('../contatoWeb');

// Empresa real do caso que deu errado em 22/10.
const SERTEC = {
  cnpj: '07172169000184',
  razao_social: 'SERTEC ENGENHARIA LTDA',
  nome_fantasia: '',
  municipio_nome: 'VINHEDO',
  uf: 'SP',
  cnae_descricao: 'Serviços de engenharia',
  ddd1: '19',
  telefone1: '38765432',
};

const buscaFake = (resultados) => async () => resultados;

test('extrai telefone brasileiro em varios formatos', () => {
  const t = extrairTelefones('Fale conosco: (19) 3876-5432 ou WhatsApp (19) 99876-5432. Matriz +55 11 98765-4321');
  const numeros = t.map((x) => x.numero);
  assert.ok(numeros.includes('551938765432'));
  assert.ok(numeros.includes('5519998765432'));
  assert.ok(numeros.includes('5511987654321'));
  assert.equal(t.find((x) => x.numero === '5519998765432').celular, true);
  assert.equal(t.find((x) => x.numero === '551938765432').celular, false);
});

test('nao confunde CNPJ, CEP e data com telefone', () => {
  for (const x of extrairTelefones('CNPJ 07.172.169/0001-84 · CEP 13280-000 · desde 01/01/2010')) {
    assert.match(x.numero, /^55\d{2}(9\d{8}|[2-5]\d{7})$/, `aceitou lixo: ${x.numero}`);
  }
});

test('o DDD tem que bater com a UF — foi assim que veio o Para para Vinhedo', () => {
  assert.equal(ufCompativel('19', 'SP'), true);
  assert.equal(ufCompativel('94', 'SP'), false, 'DDD do Pará para empresa de SP');
  assert.equal(ufCompativel('62', 'DF'), true, 'vizinhas passam');
  assert.equal(ufCompativel('85', 'RS'), false);
  assert.equal(ufCompativel('00', 'SP'), false);
});

test('acha o nome curto mesmo sem nome fantasia cadastrado', () => {
  // Regra do Clayton: toda empresa tem um nome curto, e e por ele que ela aparece.
  assert.equal(nomeCurto('SERTEC ENGENHARIA LTDA', ''), 'sertec');
  assert.equal(nomeCurto('VERACRUZ SOLUCOES GEOFISICAS E GEOLOGICAS LTDA.', ''), 'veracruz');
  assert.equal(nomeCurto('CONSTRUTORA LTDA', 'BRUNORE'), 'brunore', 'fantasia na frente');
  // Nome inteiro generico: NAO existe nome curto, e dizer que existe e pior que
  // admitir que nao — "construtora" casaria com qualquer construtora do Brasil.
  assert.equal(nomeCurto('COMERCIO E SERVICOS LTDA', ''), '');
});

test('termos genericos nao identificam empresa nenhuma', () => {
  assert.deepEqual(termosSignificativos('SERTEC ENGENHARIA LTDA'), ['sertec']);
  assert.deepEqual(termosSignificativos('COMERCIO E SERVICOS LTDA ME'), []);
});

test('o ramo sai da descricao do CNAE', () => {
  const r = termosDoRamo('Serviços de cartografia, topografia e geodésia');
  assert.ok(r.includes('cartografia'));
  assert.ok(r.includes('geodesia'));
});

test('agregador de CNPJ e rejeitado de saida', () => {
  assert.equal(ehAgregador('https://cnpja.com/office/07172169000184'), true);
  assert.equal(ehAgregador('https://www.gov.br/compras/fornecedores'), true);
  assert.equal(ehAgregador('https://casadosdados.com.br/x'), true);
  assert.equal(ehAgregador('https://www.sertec.com.br/contato'), false);
  assert.equal(ehAgregador('https://www.instagram.com/sertec/'), false);
});

test('pontuacao: site proprio da empresa na cidade certa passa do limiar', () => {
  const { pontos, sinais } = pontuarPagina({
    url: 'https://www.sertec.com.br/contato',
    texto: 'SERTEC - engenharia em Vinhedo/SP. Fale conosco pelo WhatsApp.',
    empresa: SERTEC,
  });
  assert.ok(pontos >= LIMIAR_ACEITA, `esperava >= ${LIMIAR_ACEITA}, veio ${pontos}`);
  assert.ok(sinais.some((s) => s.includes('endereço')));
  assert.ok(sinais.some((s) => s.toUpperCase().includes('VINHEDO')));
});

test('pontuacao: homonima de outra cidade e outro ramo fica baixa', () => {
  const { pontos } = pontuarPagina({
    url: 'https://sertecrefrigeracao.com.br',
    texto: 'SERTEC Refrigeração — conserto de geladeiras em Belém',
    empresa: SERTEC,
  });
  assert.ok(pontos < LIMIAR_ACEITA, `homonima nao pode passar sozinha, veio ${pontos}`);
});

test('pontuacao: CNPJ na pagina decide sozinho', () => {
  const { pontos, sinais } = pontuarPagina({
    url: 'https://portalqualquer.com/x',
    texto: 'Empresa inscrita no CNPJ 07.172.169/0001-84',
    empresa: SERTEC,
  });
  assert.ok(pontos >= LIMIAR_ACEITA);
  assert.ok(sinais.includes('CNPJ na página'));
});

test('consulta as quatro fontes com a pergunta certa', async () => {
  const feitas = [];
  await buscarContatoWeb(SERTEC, {
    buscar: async (q, fonte) => { feitas.push({ q, fonte }); return []; },
  });
  assert.deepEqual(feitas.map((f) => f.fonte), ['site', 'instagram', 'places', 'razao']);
  assert.match(feitas[0].q, /whatsapp telefone contato/);
  assert.match(feitas[1].q, /site:instagram\.com/);
  assert.match(feitas[2].q, /google maps/);
  // As tres primeiras buscam pelo nome CURTO; a ultima pela razao social inteira.
  assert.match(feitas[0].q, /"SERTEC ENGENHARIA LTDA"/);
  assert.match(feitas[0].q, /07172169000184/);
  assert.match(feitas[3].q, /"SERTEC ENGENHARIA LTDA"/);
});

test('aceita o celular do site proprio sem precisar da IA', async () => {
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    decidirComIa: async () => { throw new Error('nao devia precisar da IA'); },
    buscar: buscaFake([{
      url: 'https://www.sertec.com.br/contato',
      title: 'SERTEC | Contato',
      content: 'SERTEC em Vinhedo/SP. Serviços de engenharia. WhatsApp (19) 99876-5432.',
    }]),
  });
  assert.equal(r.numero, '5519998765432');
  assert.equal(r.decidido, 'pontuação');
  assert.equal(r.celular, true);
});

test('o caso real de 22/10 e rejeitado: homonima com DDD do Para', async () => {
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{
      url: 'https://portaldaindustria.com.br/associadas',
      title: 'Empresas associadas',
      content: 'SERTEC ENGENHARIA — Vinhedo — telefone (94) 3322-1241',
    }]),
  });
  assert.equal(r.numero, null);
  assert.ok(r.rejeitados.some((x) => /DDD 94 n[ãa]o bate com SP/.test(x.motivo)));
});

test('numero igual ao da Receita nao conta como achado', async () => {
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{
      url: 'https://www.sertec.com.br/contato',
      title: 'SERTEC',
      content: 'SERTEC Vinhedo/SP, engenharia. Telefone (19) 3876-5432',
    }]),
  });
  assert.equal(r.numero, null);
  assert.ok(r.rejeitados.some((x) => /mesmo telefone da Receita/.test(x.motivo)));
});

test('agregador nao vira candidato mesmo tendo o CNPJ', async () => {
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{
      url: 'https://cnpja.com/office/07172169000184',
      title: 'SERTEC ENGENHARIA LTDA',
      content: 'CNPJ 07.172.169/0001-84 · Vinhedo/SP · (19) 99999-1111',
    }]),
  });
  assert.equal(r.numero, null);
  assert.match(r.rejeitados[0].motivo, /agregador de CNPJ/);
});

test('a IA não pode aprovar um telefone de terceiro sem vínculo com a empresa', async () => {
  const pagina = [{
    url: 'https://blogdaconstrucao.com.br/post',
    title: 'Obras em Vinhedo',
    content: 'A SERTEC participou da obra em Vinhedo. Fone da redação: (19) 98888-7777',
  }];
  let viuPrompt = null;

  const recusou = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake(pagina),
    decidirComIa: async (p) => {
      viuPrompt = p;
      return { ok: true, data: { escolha: null, motivo: 'telefone é da redação' } };
    },
  });
  assert.equal(recusou.numero, null);
  assert.equal(viuPrompt,null,'não gasta IA para contornar ausência de titularidade');
  assert.ok(recusou.rejeitados.some(r=>r.motivo.includes('Titularidade')));

  const aceitou = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake(pagina),
    decidirComIa: async () => ({ ok: true, data: { escolha: 0, confianca: 0.8, motivo: 'é o contato da empresa' } }),
  });
  assert.equal(aceitou.numero,null);
});

test('sem IA na zona cinzenta, nao inventa: devolve null com o motivo', async () => {
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{
      url: 'https://blogdaconstrucao.com.br/post',
      title: 'Obras',
      content: 'A SERTEC participou da obra em Vinhedo. Fone (19) 98888-7777',
    }]),
  });
  assert.equal(r.numero, null);
  assert.ok(r.rejeitados.some(r=>r.motivo.includes('Titularidade')));
});

test('busca que falha vira motivo, nao excecao', async () => {
  const r = await buscarContatoWeb(SERTEC, { buscar: async () => { throw new Error('ETIMEDOUT'); } });
  assert.equal(r.numero, null);
  assert.match(r.motivo, /busca falhou:/);
  assert.match(r.motivo, /site: ETIMEDOUT/);
});

test('sem chave e sem busca nao inventa nada', async () => {
  const r = await buscarContatoWeb(SERTEC, { apiKey: '', buscar: null });
  assert.equal(r.numero, null);
  assert.match(r.motivo, /TAVILY_API_KEY/);
});

test('o prompt lista os candidatos com os indicios de cada um', () => {
  const { user } = montarPromptContato({
    empresa: SERTEC,
    candidatos: [
      { numero: '5519998765432', celular: true, pontos: 55, url: 'https://a.com', sinais: ['cidade VINHEDO'], trecho: 'x' },
      { numero: '551938765432', celular: false, pontos: 40, url: 'https://b.com', sinais: ['ramo bate'], trecho: 'y' },
    ],
  });
  assert.match(user, /\[0\] 5519998765432 \(celular\) — 55 pontos/);
  assert.match(user, /\[1\] 551938765432 \(fixo\) — 40 pontos/);
  assert.match(user, /Ramo \(CNAE\): Serviços de engenharia/);
});

test('pagina de terceiro nao decide sozinha, por melhor que pontue', async () => {
  // Medido em 24/10: paginas do Serasa, do Ministério Público e de um site sobre
  // presídios marcaram 76 a 97 pontos com telefone que não era da empresa.
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{
      url: 'https://portaldeobras.com.br/vinhedo',
      title: 'Obras em Vinhedo',
      content: 'SERTEC ENGENHARIA — Vinhedo/SP — serviços de engenharia. Contato (19) 99876-5432',
    }]),
    decidirComIa: async () => ({ ok: true, data: { escolha: null, motivo: 'é um portal, não a empresa' } }),
  });
  assert.equal(r.numero, null);
  assert.ok(r.rejeitados.some(r=>r.motivo.includes('Titularidade')));
});

test('telefone longe do nome perde pontos', async () => {
  // Caso ERVALIA: pagina sobre unidades prisionais da CIDADE de Ervalia, com um
  // celular a milhares de caracteres de qualquer mencao da construtora.
  const longe = `SERTEC aparece aqui. ${'texto de enchimento. '.repeat(80)} Telefone (19) 99876-5432`;
  const r = await buscarContatoWeb(SERTEC, {
    fontes: ['site'],
    buscar: buscaFake([{ url: 'https://portalqualquer.com.br/x', title: 'Vinhedo', content: longe }]),
  });
  assert.equal(r.numero, null);
  const avaliado = (r.candidatosAvaliados || [])[0];
  if (avaliado) {
    assert.ok(avaliado.sinais.some((x) => /caracteres do nome|n[ãa]o aparece junto/.test(x)));
  }
});

test('nome curto que e o nome da cidade nao prova nada, nem no dominio', () => {
  // facebook.com/pmervalia e a PREFEITURA de Ervalia, nao a ERVALIA CONSTRUTORA.
  const ervalia = {
    razao_social: 'ERVALIA CONSTRUTORA & INCORPORADORA LTDA',
    nome_fantasia: '', municipio_nome: 'ERVALIA', uf: 'MG',
    cnae_descricao: 'Construção de edifícios',
  };
  const { pontos, sinais, dominioDaEmpresa } = pontuarPagina({
    url: 'https://www.facebook.com/pmervalia',
    texto: 'Prefeitura Municipal de Ervalia - MG. Telefone (32) 3554-1124',
    empresa: ervalia,
  });
  assert.equal(dominioDaEmpresa, false, 'não pode decidir sozinho');
  assert.ok(sinais.some((x) => /nome da cidade/.test(x)));
  assert.ok(pontos < LIMIAR_ACEITA, `veio ${pontos}`);
});

test('empresa so com nome generico nao tem nome curto', () => {
  // "D.A.G. CONSTRUTORA" virava "construtora" e casava com construtorabrf.com.br.
  assert.equal(nomeCurto('D.A.G. CONSTRUTORA', ''), '');
  const { dominioDaEmpresa } = pontuarPagina({
    url: 'http://construtorabrf.com.br/contatos',
    texto: 'Construtora BRF — Salvador/BA. Fone (71) 98157-9912',
    empresa: {
      razao_social: 'D.A.G. CONSTRUTORA', nome_fantasia: '',
      municipio_nome: 'SALVADOR', uf: 'BA', cnae_descricao: 'Construção de edifícios',
    },
  });
  assert.equal(dominioDaEmpresa, false, 'outra construtora não é a D.A.G.');
});

test('doctor and lawyer homonyms cannot become construction company contacts, even with enthusiastic AI',async()=>{
 for(const [name,url]of [['CONSTRUTORA MELLO DE AZEVEDO SA','https://drbrunomello.com.br/contato'],['CONSTRUTORA BARBOSA MELLO SA','https://barbosaecostaadvogados.com.br'],['PAULISTA OBRAS E PAVIMENTACAO LTDA','https://centralpaulista.com.br/noticia/paulista-obras-e-pavimentacao']]){
  const r=await buscarContatoWeb({...SERTEC,razao_social:name,nome_fantasia:'',municipio_nome:'São Paulo'}, {fontes:['site'],buscar:buscaFake([{url,title:'Contato',content:`${name} é citado como cliente. Contato do escritório em São Paulo/SP: (11) 99999-8888.`}]),decidirComIa:async()=>({ok:true,data:{escolha:0,confianca:1}})});
  assert.equal(r.numero,null,name);assert.ok(r.rejeitados.length>0);
 }
});
test('a matching brand in URL query parameters does not prove site ownership',()=>{
 const result=pontuarPagina({empresa:SERTEC,url:'https://doctor.example/?empresa=sertec',texto:'SERTEC Engenharia em Vinhedo SP, telefone.'});assert.equal(result.dominioDaEmpresa,false);
});
test('low confidence or out-of-range AI choice is rejected even for an otherwise valid source',async()=>{
 for(const data of [{escolha:0,confianca:0.2},{escolha:99,confianca:1},{escolha:'0',confianca:1}]){
  const r=await buscarContatoWeb(SERTEC,{limiarAceita:999,fontes:['site'],buscar:buscaFake([{url:'https://sertec.com.br',content:'Sertec Engenharia em Vinhedo SP: (19) 99999-8888.'}]),decidirComIa:async()=>({ok:true,data})});assert.equal(r.numero,null);
 }
});
