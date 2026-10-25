import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const configPath = new URL('../.iptv-local.json', import.meta.url);
let catalog;
const resources = new Map();
function resource(url) {
  // The provider renews the token on every playlist refresh. HLS requires
  // an overlapping segment to retain its URI for the same media sequence.
  const identity = new URL(url);
  if (/\/hls\/[^/]+\.ts$/.test(identity.pathname)) identity.searchParams.delete('token');
  const id = createHash('sha256').update(identity.href).digest('hex');
  resources.set(id, url);
  return '/iptv/media/' + id;
}
async function load() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const cached = await fs.readFile(new URL('../.iptv-cache.m3u', import.meta.url), 'utf8').catch(() => null);
  const response = cached ? new Response(cached) : await fetch(config.playlist, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Lista indisponível: ' + response.status);
  const text = await response.text();
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Resposta não é M3U');
  const channels = [];
  let info;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) {
      info = { name: line.slice(line.lastIndexOf(',') + 1).trim(), group: line.match(/group-title="([^"]*)"/)?.[1] || '' };
    } else if (info && /^https?:\/\//.test(line)) {
      if (/[\/.]m3u8(?:\?|$)/i.test(line.trim()) && !/\/(movie|series)\//i.test(line) && !/adult|xxx|sexy|playboy/i.test(info.name + ' ' + info.group)) {
        channels.push({ id: 'iptv-' + channels.length, name: info.name, stream: resource(line.trim()), embeds: [], provider: 'IPTV mensal' });
      }
      info = null;
    }
  }
  if (!channels.length) throw new Error('Lista sem canais ao vivo');
  catalog = { retrievedAt: new Date().toISOString(), channels };
  console.log('IPTV local: ' + channels.length + ' canais carregados');
  return catalog;
}
export async function iptvLocal(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!['/iptv/catalog', '/refresh', '/events'].includes(path) && !path.startsWith('/iptv/media/')) return false;
  try { await fs.access(configPath); } catch { return false; }
  try {
    if (path === '/events') { res.writeHead(200, {'Content-Type':'application/json'}); res.end('[]'); return true; }
    if (path === '/refresh' || path === '/iptv/catalog') {
      if (!catalog || path === '/refresh') await load();
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify(catalog)); return true;
    }
    const target = resources.get(path.split('/').pop());
    if (!target) { res.writeHead(404); res.end(); return true; }
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableFinished) abort.abort(); };
    res.once('close', disconnected);
    const upstream = await fetch(target, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]), headers: req.headers.range ? {Range:req.headers.range} : {} });
    if (!upstream.ok) throw new Error('Transmissão indisponível: ' + upstream.status);
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    const reader = upstream.body.getReader();
    const first = await reader.read();
    const chunks = async function* () {
      try {
        if (first.value) yield first.value;
        for (;;) { const next = await reader.read(); if (next.done) break; yield next.value; }
      } finally { await reader.cancel().catch(() => {}); }
    };
    if (/mpegurl/i.test(type) || Buffer.from(first.value || []).toString().trimStart().startsWith('#EXTM3U')) {
      const parts = []; for await (const chunk of chunks()) parts.push(Buffer.from(chunk));
      const bytes = Buffer.concat(parts);
      const manifest = bytes.toString().split(/\r?\n/).map(line => {
        if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => 'URI="' + resource(new URL(uri, upstream.url).href) + '"');
        return line.trim() ? resource(new URL(line.trim(), upstream.url).href) : line;
      }).join('\n');
      res.writeHead(200, {'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store'}); res.end(manifest);
    } else {
      const headers = {'Content-Type':type,'Cache-Control':'no-store'};
      if (upstream.headers.has('content-range')) headers['Content-Range'] = upstream.headers.get('content-range');
      if (upstream.headers.has('content-length')) headers['Content-Length'] = upstream.headers.get('content-length');
      res.writeHead(upstream.status, headers);
      await pipeline(Readable.from(chunks()), res);
    }
    res.removeListener('close', disconnected);
  } catch (error) { if (res.destroyed) return true; console.error('IPTV:', error.message.replace(/https?:\/\/\S+/g, '[servidor]')); if (!res.headersSent) res.writeHead(502, {'Content-Type':'text/plain'}); res.end('Não foi possível carregar o teste IPTV.'); }
  return true;
}
