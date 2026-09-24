const test = require('node:test');
const assert = require('node:assert/strict');

const {
  indexarResposta,
  verificarNumerosWhatsapp,
  limparCacheWhatsapp,
} = require('../whatsappNumeros');

const CFG = {
  baseUrl: 'https://evo.example/',
  instancia: 'inst',
  apiKey: 'k',
};

test.beforeEach(() => limparCacheWhatsapp());

test('indexa só os números que existem', () => {
  const enviados = ['551138978000', '5511991316458'];
  const r = indexarResposta([
    { jid: '551138978000@s.whatsapp.net', exists: false, number: '551138978000' },
    { jid: '5511991316458@s.whatsapp.net', exists: true, number: '5511991316458' },
  ], enviados);
  assert.deepEqual([...r], ['5511991316458']);
});

test('aceita número cujo jid voltou sem o nono dígito', () => {
  // Caso real: enviamos 5537999659954 e a Evolution respondeu jid 553799659954.
  const r = indexarResposta([
    { jid: '553799659954@s.whatsapp.net', exists: true, number: '5537999659954' },
  ], ['5537999659954']);
  assert.deepEqual([...r], ['5537999659954']);
});

test('fixo com WhatsApp Business não é descartado', () => {
  // 551136466600 é fixo e existe no WhatsApp — heurística de celular erraria aqui.
  const r = indexarResposta([
    { jid: '551136466600@s.whatsapp.net', exists: true, number: '551136466600' },
  ], ['551136466600']);
  assert.deepEqual([...r], ['551136466600']);
});

test('filtra quem não tem WhatsApp e normaliza a entrada', async () => {
  const chamadas = [];
  const { existentes, indisponivel } = await verificarNumerosWhatsapp(
    ['+55 (11) 3897-8000', '5511991316458'],
    {
      ...CFG,
      fetchImpl: async (url, opts) => {
        chamadas.push({ url, body: JSON.parse(opts.body), apikey: opts.headers.apikey });
        return {
          ok: true,
          json: async () => [
            { jid: '551138978000@s.whatsapp.net', exists: false, number: '551138978000' },
            { jid: '5511991316458@s.whatsapp.net', exists: true, number: '5511991316458' },
          ],
        };
      },
    }
  );
  assert.equal(indisponivel, false);
  assert.deepEqual([...existentes], ['5511991316458']);
  assert.equal(chamadas[0].url, 'https://evo.example/chat/whatsappNumbers/inst');
  assert.equal(chamadas[0].apikey, 'k');
  assert.deepEqual(chamadas[0].body.numbers, ['551138978000', '5511991316458']);
});

test('erro da Evolution não derruba a campanha (fail-open) mas se declara', async () => {
  const { existentes, indisponivel } = await verificarNumerosWhatsapp(
    ['5511991316458', '551138978000'],
    { ...CFG, fetchImpl: async () => { throw new Error('ECONNRESET'); } }
  );
  assert.equal(indisponivel, true);
  assert.equal(existentes.size, 2, 'sem veredito, ninguém é descartado');
});

test('sem Evolution configurada, não filtra e marca indisponível', async () => {
  const { existentes, indisponivel } = await verificarNumerosWhatsapp(
    ['5511991316458'],
    { baseUrl: '', instancia: '', apiKey: '', fetchImpl: async () => { throw new Error('não deveria chamar'); } }
  );
  assert.equal(indisponivel, true);
  assert.deepEqual([...existentes], ['5511991316458']);
});

test('reconsulta não bate na Evolution de novo (cache)', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { ok: true, json: async () => [{ jid: '5511991316458@s.whatsapp.net', exists: true, number: '5511991316458' }] };
  };
  await verificarNumerosWhatsapp(['5511991316458'], { ...CFG, fetchImpl });
  const segunda = await verificarNumerosWhatsapp(['5511991316458'], { ...CFG, fetchImpl });
  assert.equal(n, 1, 'segunda chamada veio do cache');
  assert.deepEqual([...segunda.existentes], ['5511991316458']);
});

test('quebra em lotes de 100', async () => {
  const tamanhos = [];
  const numeros = Array.from({ length: 250 }, (_, i) => `55119${String(i).padStart(8, '0')}`);
  await verificarNumerosWhatsapp(numeros, {
    ...CFG,
    fetchImpl: async (url, opts) => {
      const enviados = JSON.parse(opts.body).numbers;
      tamanhos.push(enviados.length);
      return { ok: true, json: async () => enviados.map(n => ({ jid: `${n}@s.whatsapp.net`, exists: true, number: n })) };
    },
  });
  assert.deepEqual(tamanhos, [100, 100, 50]);
});
