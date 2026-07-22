const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractRssImage,
  extractHtmlPreviewImage,
  enrichNewsPictures,
} = require('../trendsMedia');

test('extrai imagens dos campos usados pelo RSS do Google Trends', () => {
  assert.equal(
    extractRssImage('<ht:news_item_picture>https://img.example/news.jpg</ht:news_item_picture>'),
    'https://img.example/news.jpg'
  );
  assert.equal(
    extractRssImage('<media:thumbnail url="https://img.example/thumb.jpg" />'),
    'https://img.example/thumb.jpg'
  );
});

test('extrai og:image independentemente da ordem dos atributos', () => {
  assert.equal(
    extractHtmlPreviewImage('<meta content="/cover.jpg" property="og:image">', 'https://publisher.example/story'),
    'https://publisher.example/cover.jpg'
  );
  assert.equal(
    extractHtmlPreviewImage('<meta name="twitter:image" content="https://img.example/social.jpg">'),
    'https://img.example/social.jpg'
  );
});

test('enriquece apenas os itens sem imagem usando o preview da matéria', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return new Response('<head><meta property="og:image" content="https://img.example/article.jpg"></head>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
  const trends = await enrichNewsPictures([
    { title: 'Com imagem', picture: 'https://img.example/existing.jpg', url: 'https://news.example/1' },
    { title: 'Sem imagem', picture: null, url: 'https://news.example/2' },
  ], { fetchImpl, concurrency: 1 });

  assert.equal(trends[0].picture, 'https://img.example/existing.jpg');
  assert.equal(trends[1].picture, 'https://img.example/article.jpg');
  assert.deepEqual(requested, ['https://news.example/2']);
});
