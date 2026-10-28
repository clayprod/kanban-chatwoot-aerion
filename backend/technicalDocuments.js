'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fetch, Agent } = require('undici');
const { hash } = require('./technicalRules');
const MAX_BYTES = 20 * 1024 * 1024;
function publicIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  // Reject mapped IPv4, local, reserved and multicast IPv6; only global unicast.
  return net.isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
async function download(url, { gate, pncpRequest, maxBytes = MAX_BYTES } = {}) {
  let next = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const u = new URL(next);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw new Error('URL pública HTTP/HTTPS inválida.');
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new Error('Endereço local ou reservado bloqueado.');
    const address = addresses[0];
    const pncp = /(^|\.)pncp\.gov\.br$/i.test(hostname);
    if (pncp && (!gate || !pncpRequest)) throw new Error('Download PNCP exige gate e pncpFetch.');
    // Pin DNS for the actual socket as well as checking every redirect.
    const dispatcher = new Agent({ connect: { lookup: (_host, options, cb) => options.all ? cb(null, [address]) : cb(null, address.address, address.family) } });
    try {
      const work = async () => {
        const response = await (pncp ? pncpRequest : fetch)(u.href, { dispatcher, redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'Aerion-Technical-Analysis/1.0' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('Redirecionamento sem destino.');
          return { redirect: new URL(location, u).href };
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Documento indisponível: HTTP ${response.status}`); }
        if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Documento acima de 20 MB.'); }
        let size = 0; const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('Documento acima de 20 MB.'); }
          chunks.push(chunk);
        }
        return { bytes: Buffer.concat(chunks), content_type: response.headers.get('content-type') || '', url: u.href };
      };
      // Large PDFs/ZIPs never consume the proxy plan, even if JSON proxy lanes
      // have explicitly been enabled. The central gate still owns all pacing.
      const result = pncp ? await gate(work,{transport:'direct'}) : await work();
      if (!result.redirect) return result;
      next = result.redirect;
    } finally { await dispatcher.close(); }
  }
  throw new Error('Redirecionamentos demais.');
}
function run(command, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, errors = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Tempo de leitura do documento excedido.')); }, timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 20 * 1024 * 1024) { child.kill('SIGKILL'); } else chunks.push(chunk); });
    child.stderr.on('data', b => { errors = (errors + b).slice(-2000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 && size <= 20 * 1024 * 1024 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(errors || `Falha de extração (${code}).`)); });
  });
}
async function extract(bytes, filename, contentType = '') {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Arquivo vazio ou acima de 20 MB.');
  let ext = path.extname(filename || '').toLowerCase();
  if (bytes.subarray(0, 5).toString() === '%PDF-') ext = '.pdf';
  else if (bytes.subarray(0, 2).toString() === 'PK') ext = '.zip';
  else if (bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') ext = '.doc';
  else if (/html|text\//i.test(contentType) || ['.txt', '.html', '.htm', ''].includes(ext)) {
    const html = bytes.toString('utf8');
    const value = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(?:p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const incomplete = /aria-expanded=["']false["']|id=["']root["']|id=["']__next["']/i.test(html);
    return { pages: [{ location: 'Página web / texto', text: value.trim() }], complete: !incomplete && value.trim().length > 10, notes: incomplete ? ['Conteúdo dinâmico pode estar incompleto. Anexe a ficha completa.'] : [] };
  }
  if (!['.pdf', '.doc', '.docx', '.zip'].includes(ext)) throw new Error('Formato não suportado. Use PDF, DOC, DOCX, ZIP ou texto.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'technical-'));
  try {
    const target = path.join(dir, `document${ext}`);
    await fs.writeFile(target, bytes);
    const result = await run(process.env.TECHNICAL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(__dirname, 'scripts', 'technical_extract.py'), target], 600000);
    return JSON.parse(result);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function chunksForSource(source, size = 6500) {
  const chunks = [];
  for (const [index, page] of (source.pages || []).entries()) {
    for (let start = 0; start < page.text.length; start += size - 300) {
      chunks.push({ source_id: source.id, location: page.location, text: page.text.slice(start, start + size),
        // Context helps associate continuation tables; quotations must still be
        // found in this chunk's text, never in context supplied only as a hint.
        context_before: start ? page.text.slice(Math.max(0, start - 1200), start) : (source.pages[index - 1]?.text || '').slice(-1200), chunk: chunks.length });
      if (start + size >= page.text.length) break;
    }
  }
  return chunks;
}
module.exports = { MAX_BYTES, publicIp, download, extract, run, chunksForSource, hash };
