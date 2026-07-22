const decodeXmlEntities = (value = '') => String(value)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .trim();

const extractXmlTag = (block, tag) => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = String(block || '').match(re);
  return match ? decodeXmlEntities(match[1]) : '';
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const isGoogleNewsArticleUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'news.google.com' && /\/(?:rss\/)?articles?\//i.test(url.pathname);
  } catch (_) {
    return false;
  }
};

const isGenericGoogleNewsImage = (value) => (
  /lh3\.googleusercontent\.com\/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc/i
    .test(String(value || ''))
);

const extractRssImage = (block = '') => {
  const source = String(block);
  const direct = source.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl=["']([^"']+)["']/i);
  const tagged = extractXmlTag(source, 'ht:news_item_picture')
    || extractXmlTag(source, 'news_item_picture')
    || extractXmlTag(source, 'ht:picture')
    || extractXmlTag(source, 'picture');
  const description = extractXmlTag(source, 'description');
  const embedded = description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  const value = decodeXmlEntities(direct?.[1] || tagged || embedded?.[1] || '');
  return isHttpUrl(value) && !isGenericGoogleNewsImage(value) ? value : null;
};

const extractHtmlPreviewImage = (html = '', baseUrl = '') => {
  const metaTags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attributes = {};
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      attributes[match[1].toLowerCase()] = decodeXmlEntities(match[3]);
    }
    const key = String(attributes.property || attributes.name || '').toLowerCase();
    if (!['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) continue;
    const raw = attributes.content || '';
    try {
      const resolved = new URL(raw, baseUrl || undefined).toString();
      if (isHttpUrl(resolved)) return resolved;
    } catch (_) { /* ignore invalid/relative URL without a base */ }
  }
  return null;
};

const readResponsePrefix = async (response, maxBytes = 768 * 1024) => {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(text)) break;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
};

const resolveGoogleNewsArticleUrl = async (articleUrl, {
  fetchImpl = fetch,
  signal,
} = {}) => {
  if (!isGoogleNewsArticleUrl(articleUrl)) return null;
  try {
    const parsed = new URL(articleUrl);
    const articleId = parsed.pathname.split('/').filter(Boolean).at(-1);
    if (!articleId) return null;

    const pageResponse = await fetchImpl(`https://news.google.com/rss/articles/${articleId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0; +https://aerion.com.br)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
      signal,
    });
    if (!pageResponse.ok) return null;
    const pageHtml = await pageResponse.text();
    const signature = pageHtml.match(/data-n-a-sg=["']([^"']+)/i)?.[1];
    const timestamp = pageHtml.match(/data-n-a-ts=["']([^"']+)/i)?.[1];
    if (!signature || !timestamp) return null;

    const rpcArguments = [
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'BR:pt-419', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      articleId,
      Number(timestamp),
      signature,
    ];
    const body = new URLSearchParams({
      'f.req': JSON.stringify([[['Fbv4je', JSON.stringify(rpcArguments), null, 'generic']]]),
    });
    const rpcResponse = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Origin: 'https://news.google.com',
        Referer: 'https://news.google.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0; +https://aerion.com.br)',
      },
      body,
      signal,
    });
    if (!rpcResponse.ok) return null;
    const rpcText = await rpcResponse.text();
    for (const line of rpcText.split('\n')) {
      if (!line.trimStart().startsWith('[[')) continue;
      let rows;
      try {
        rows = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const result = rows.find((row) => row?.[1] === 'Fbv4je');
      if (!result?.[2]) continue;
      try {
        const resolved = JSON.parse(result[2])?.[1];
        if (isHttpUrl(resolved) && !isGoogleNewsArticleUrl(resolved)) return resolved;
      } catch (_) { /* ignore malformed RPC payload */ }
    }
    return null;
  } catch (_) {
    return null;
  }
};

const fetchArticlePreviewImage = async (articleUrl, {
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) => {
  if (!isHttpUrl(articleUrl)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const previewUrl = isGoogleNewsArticleUrl(articleUrl)
      ? await resolveGoogleNewsArticleUrl(articleUrl, { fetchImpl, signal: controller.signal })
      : articleUrl;
    if (!isHttpUrl(previewUrl)) return null;
    const response = await fetchImpl(previewUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0; +https://aerion.com.br)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (contentType && !/html|xhtml/i.test(contentType)) return null;
    const html = await readResponsePrefix(response);
    const picture = extractHtmlPreviewImage(html, response.url || previewUrl);
    return picture && !isGenericGoogleNewsImage(picture) ? picture : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const enrichNewsPictures = async (trends = [], {
  limit = 12,
  concurrency = 3,
  fetchImpl = fetch,
} = {}) => {
  const head = trends.slice(0, Math.max(0, limit));
  const enriched = await mapWithConcurrency(head, concurrency, async (item) => {
    if (extractRssImage(`<ht:picture>${item?.picture || ''}</ht:picture>`)) return item;
    const articleUrl = (item?.news || []).find((news) => isHttpUrl(news?.url))?.url
      || item?.url
      || item?.link;
    const picture = await fetchArticlePreviewImage(articleUrl, { fetchImpl });
    return picture ? { ...item, picture } : item;
  });
  return [...enriched, ...trends.slice(head.length)];
};

const combineTrendsFeeds = ({
  related = null,
  sectorNews = null,
  rss = null,
  fallbackSeeds = [],
  pytrendsError = null,
  newsError = null,
} = {}) => {
  const hasItems = (payload) => Array.isArray(payload?.trends) && payload.trends.length > 0;
  const relatedReady = hasItems(related);
  const sectorNewsReady = hasItems(sectorNews);
  const rssReady = hasItems(rss);
  const newsPayload = sectorNewsReady ? sectorNews : (rssReady ? rss : null);
  const intelPayload = relatedReady ? related : newsPayload;

  if (!intelPayload) return null;

  const onlyGeneralRss = !relatedReady && !sectorNewsReady && rssReady;
  return {
    ...intelPayload,
    source: onlyGeneralRss ? 'google_trends_rss_fallback' : intelPayload.source,
    seeds: onlyGeneralRss && fallbackSeeds.length ? fallbackSeeds : (intelPayload.seeds || []),
    news: newsPayload?.trends || [],
    news_source: newsPayload?.source || null,
    news_fetched_at: newsPayload?.fetchedAt || null,
    pytrends_error: pytrendsError || null,
    news_error: newsError || null,
  };
};

module.exports = {
  decodeXmlEntities,
  extractXmlTag,
  extractRssImage,
  extractHtmlPreviewImage,
  isGoogleNewsArticleUrl,
  isGenericGoogleNewsImage,
  resolveGoogleNewsArticleUrl,
  fetchArticlePreviewImage,
  enrichNewsPictures,
  combineTrendsFeeds,
};
