/* quick smoke test for Google Trends RSS (no secrets) */
const TRENDS_RSS_URL = process.env.TRENDS_RSS_URL || 'https://trends.google.com/trending/rss?geo=BR';

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
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
};

(async () => {
  const res = await fetch(TRENDS_RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  const xml = await res.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  console.log('HTTP', res.status, 'items', itemBlocks.length);
  for (const block of itemBlocks.slice(0, 5)) {
    console.log('-', extractXmlTag(block, 'title'), extractXmlTag(block, 'ht:approx_traffic'));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
