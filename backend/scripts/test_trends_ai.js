require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const rss = await fetch('https://trends.google.com/trending/rss?geo=BR', {
    headers: { 'User-Agent': 'Aerion/1.0', Accept: '*/*' },
  });
  const xml = await rss.text();
  const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/gi)].map((m) => m[1]).slice(0, 8);
  console.log('trends', titles);

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.log('GROQ_API_KEY missing');
    return;
  }
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_AI_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Responda só JSON: {"ok":true,"n":number}' },
        { role: 'user', content: `Quantos trends? ${titles.join(', ')}` },
      ],
      temperature: 0,
      max_tokens: 50,
    }),
  });
  console.log('groq status', res.status);
  console.log((await res.text()).slice(0, 400));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
