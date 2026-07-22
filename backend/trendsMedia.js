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
  return isHttpUrl(value) ? value : null;
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

const fetchArticlePreviewImage = async (articleUrl, {
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) => {
  if (!isHttpUrl(articleUrl)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(articleUrl, {
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
    return extractHtmlPreviewImage(html, response.url || articleUrl);
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

module.exports = {
  decodeXmlEntities,
  extractXmlTag,
  extractRssImage,
  extractHtmlPreviewImage,
  fetchArticlePreviewImage,
  enrichNewsPictures,
};
