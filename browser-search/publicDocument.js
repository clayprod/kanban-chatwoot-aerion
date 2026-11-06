'use strict';
const dns = require('node:dns/promises');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
function publicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a > 0 && a !== 10 && a !== 127 && a < 224 && !(a===169 && b===254)
      && !(a===172 && b>=16 && b<=31) && !(a===192 && b===168) && !(a===100 && b>=64 && b<=127)
      && !(a===198 && [18,19].includes(b));
  }
  // Permit only native global unicast, avoiding mapped IPv4 and transition nets.
  return net.isIPv6(ip) && /^[23]/i.test(ip) && !/^200[12]:/i.test(ip);
}
async function validatePublicUrl(address, lookup = dns.lookup) {
  const u = new URL(address);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !['', '80', '443'].includes(u.port) || /(^|\.)(localhost|local|internal|ts\.net)$/i.test(u.hostname)) throw new Error('Destino não público');
  const records = await lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!records.length || records.some(r => !publicIp(r.address))) throw new Error('Destino não público');
  return { url: u, record: records[0] };
}
function readOnce(url, record, proxy, timeoutMs) {
  return new Promise((resolve, reject) => {
    let tunnel;
    const options = { method: 'GET', headers: { 'User-Agent': 'AerionResearch/1.0', Accept: 'text/html,application/xhtml+xml' },
      timeout: timeoutMs, lookup: (_host, opts, cb) => cb(null, opts?.all ? [record] : record.address, record.family) };
    const start = socket => {
      const client = url.protocol === 'https:' ? https : http;
      const agent = socket ? new client.Agent({keepAlive:false}) : null;
      if(agent)agent.createConnection=()=>socket;
      const request = client.request(url, { ...options, ...(agent ? { agent } : {}) }, response => {
        const status = response.statusCode;
        if (status>=300 && status<400) { response.resume(); resolve({ status, location: response.headers.location }); return; }
        if ([401,403,429].includes(status)) { response.resume(); resolve({ status, html: '' }); return; }
        if (!String(response.headers['content-type'] || '').includes('html')) { response.resume(); reject(new Error('Fonte não é HTML')); return; }
        let size = 0; const chunks = [];
        response.on('data', chunk => { size+=chunk.length; if(size>2*1024*1024) { request.destroy(new Error('Página excede 2 MB')); } else chunks.push(chunk); });
        response.on('end', () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.once('timeout', () => request.destroy(new Error('Tempo de pesquisa esgotado')));
      request.once('error', reject); request.end();
    };
    if (!proxy) { start(); return; }
    const p = new URL(proxy);
    // CONNECT to the validated address (not a second DNS lookup at the proxy).
    tunnel = http.request({ hostname: p.hostname, port: p.port, method: 'CONNECT', path: `${net.isIPv6(record.address) ? `[${record.address}]` : record.address}:${url.port || (url.protocol==='https:'?443:80)}`,
      headers: { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64')}` }, timeout: Math.min(3000,timeoutMs) });
    tunnel.once('connect', (response, socket, head) => {
      if(response.statusCode!==200) { socket.destroy(); reject(new Error('Proxy indisponível')); return; }
      if(head.length)socket.unshift(head);
      if(url.protocol==='https:') { const secure=tls.connect({socket,servername:url.hostname}); secure.once('secureConnect',()=>start(secure)); secure.once('error',reject); }
      else start(socket);
    });
    tunnel.once('timeout',()=>tunnel.destroy(new Error('Proxy indisponível'))); tunnel.once('error',reject); tunnel.end();
  });
}
async function readPublicDocument(address, { proxy = null, timeoutMs = 20000, lookup = dns.lookup, read = readOnce } = {}) {
  const start = Date.now();
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { url, record } = await validatePublicUrl(address, lookup);
    const result = await read(url, record, proxy, Math.max(1, timeoutMs-(Date.now()-start)));
    if (result.location) { address=new URL(result.location,url).href; continue; }
    return { ...result, url: url.href };
  }
  throw new Error('Redirecionamentos excessivos');
}
module.exports = { publicIp, validatePublicUrl, readPublicDocument };
