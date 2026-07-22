const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractRssImage,
  extractHtmlPreviewImage,
  enrichNewsPictures,
  combineTrendsFeeds,
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

test('mantém correlatos para inteligência e notícias em coleção separada', () => {
  const related = {
    source: 'pytrends_related',
    fetchedAt: '2026-07-22T12:00:00.000Z',
    seeds: ['drone'],
    trends: [{ title: 'mapeamento com drone', kind: 'rising' }],
  };
  const sectorNews = {
    source: 'google_news_sector',
    fetchedAt: '2026-07-22T12:00:01.000Z',
    trends: [{ title: 'Notícia do setor', picture: 'https://img.example/news.jpg' }],
  };

  const payload = combineTrendsFeeds({ related, sectorNews });

  assert.equal(payload.source, 'pytrends_related');
  assert.deepEqual(payload.trends, related.trends);
  assert.deepEqual(payload.news, sectorNews.trends);
  assert.equal(payload.news_source, 'google_news_sector');
});

test('usa RSS de notícias também como inteligência quando correlatos falham', () => {
  const sectorNews = {
    source: 'google_news_sector',
    trends: [{ title: 'Notícia do setor' }],
  };

  const payload = combineTrendsFeeds({
    sectorNews,
    pytrendsError: 'Google Trends HTTP 429',
  });

  assert.deepEqual(payload.trends, sectorNews.trends);
  assert.deepEqual(payload.news, sectorNews.trends);
  assert.equal(payload.pytrends_error, 'Google Trends HTTP 429');
});

test('usa RSS geral como último fallback visual e de inteligência', () => {
  const rss = {
    source: 'google_trends_rss',
    trends: [{ title: 'Assunto em alta', picture: 'https://img.example/trend.jpg' }],
  };

  const payload = combineTrendsFeeds({
    rss,
    fallbackSeeds: ['drone'],
    pytrendsError: 'pytrends offline',
    newsError: 'Google News offline',
  });

  assert.equal(payload.source, 'google_trends_rss_fallback');
  assert.deepEqual(payload.trends, rss.trends);
  assert.deepEqual(payload.news, rss.trends);
  assert.deepEqual(payload.seeds, ['drone']);
  assert.equal(payload.news_source, 'google_trends_rss');
});
