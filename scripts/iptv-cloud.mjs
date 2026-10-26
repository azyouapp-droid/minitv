import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getTodayEvents } from './sports-events.mjs';

const channelsCache = { expires: 0, value: null };
const mediaCache = new Map();
const canonical = value => { const u = new URL(value); u.searchParams.delete('token'); return u.href; };
function settings() {
  const playlist = process.env.IPTV_PLAYLIST_URL;
  if (!playlist) return null;
  if (!process.env.IPTV_SIGNING_SECRET) throw new Error('IPTV incompleto');
  const url = new URL(playlist);
  return { url, username: url.searchParams.get('username'), password: url.searchParams.get('password'), secret: process.env.IPTV_SIGNING_SECRET };
}
function signature(value, cfg) { return createHmac('sha256', cfg.secret).update(value).digest('base64url'); }
function equal(a, b) { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x,y); }
function token(payload, cfg) { const data=Buffer.from(JSON.stringify(payload)).toString('base64url'); return data+'.'+signature(data,cfg); }
function mediaKey(cfg) { return createHash('sha256').update('minitv-media-v1:').update(cfg.secret).digest(); }
function sealMedia(payload, cfg) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',mediaKey(cfg),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify({...payload,expires:Date.now()+180000}),'utf8'),cipher.final()]);
  return 'enc.'+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function openMedia(value,cfg) {
  if(value.length>11000)throw new Error('Link inválido');
  const bytes=Buffer.from(value.slice(4),'base64url');
  if(bytes.length<29||bytes.length>8192)throw new Error('Link inválido');
  const decipher=createDecipheriv('aes-256-gcm',mediaKey(cfg),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
  const now=Date.now();
  if(data.kind!=='segment'||!Number.isSafeInteger(data.expires)||data.expires<now||data.expires>now+180000)throw new Error('Link expirado');
  return data;
}
function untoken(value, cfg) {
  if(value.startsWith('enc.'))return openMedia(value,cfg);
  if(value.length>8192)throw new Error('Link inválido');
  const [data, sig]=value.split('.');
  if (!equal(sig, signature(data || '',cfg))) throw new Error('Link inválido');
  const payload=JSON.parse(Buffer.from(data,'base64url').toString());
  // Signed segment links from the old format exposed their URL in base64.
  if(payload.kind!=='manifest')throw new Error('Link antigo inválido');
  return payload;
}
function route(payload, cfg) { return '/iptv/media/'+(payload.kind==='segment'?sealMedia(payload,cfg):token(payload,cfg)); }
async function catalog(cfg) {
  if (channelsCache.value && Date.now()<channelsCache.expires) return channelsCache.value;
  const url=new URL('/player_api.php',cfg.url);
  url.searchParams.set('username',cfg.username); url.searchParams.set('password',cfg.password); url.searchParams.set('action','get_live_streams');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Catálogo indisponível');
  const data=await response.json();
  if (!Array.isArray(data)) throw new Error('Acesso IPTV indisponível');
  const channels=data.filter(c=>c.stream_type==='live' && !/adult|xxx|sexy|playboy/i.test(c.name)).map(c=>({id:'iptv-'+c.stream_id,name:c.name,stream:route({id:String(c.stream_id),kind:'manifest'},cfg),embeds:[],provider:'IPTV anual'}));
  if (!channels.length) throw new Error('Nenhum canal disponível');
  channelsCache.value={retrievedAt:new Date().toISOString(),channels}; channelsCache.expires=Date.now()+300000;
  return channelsCache.value;
}
async function manifest(id,cfg) {
  if (!/^\d+$/.test(id)) throw new Error('Canal inválido');
  const url=new URL('/live/'+encodeURIComponent(cfg.username)+'/'+encodeURIComponent(cfg.password)+'/'+id+'.m3u8',cfg.url);
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('Canal indisponível');
  const text=await response.text();
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Playlist inválida');
  const remember=value=>{
    const absolute=new URL(value,response.url);
    if(!['http:','https:'].includes(absolute.protocol))throw new Error('Trecho inválido');
    const stable=canonical(absolute.href);
    mediaCache.set(id+'|'+stable,{url:absolute.href,expires:Date.now()+120000});
    return route({id,kind:'segment',url:stable},cfg);
  };
  // The provider returns media playlists for /live/...m3u8. Keep stable
  // signed segment URLs across token rotations and independent instances.
  if (text.includes('#EXT-X-STREAM-INF')) throw new Error('Playlist master não suportada por este adaptador');
  if (mediaCache.size>20000) for (const [key,value] of mediaCache) if(value.expires<Date.now()) mediaCache.delete(key);
  return text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,uri)=>'URI="'+remember(uri)+'"'):line.trim()?remember(line.trim()):line).join('\n');
}
export async function iptvCloud(req,res) {
  const path=new URL(req.url,'http://localhost').pathname;
  const relevant=path==='/refresh'||path==='/events'||path.startsWith('/iptv/');
  if(path==='/events'){
    if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
    try {
      const events=await getTodayEvents();
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400'});
      res.end(JSON.stringify(events));
    } catch {
      res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end('[]');
    }
    return true;
  }
  if (!relevant || !process.env.IPTV_PLAYLIST_URL) return false;
  res.setHeader('Cache-Control','private, no-store');
  try {
    const cfg=settings();
    if(path==='/refresh'){
      if(req.method!=='POST'){res.writeHead(405);res.end();return true;}
      res.writeHead(204);res.end();return true;
    }
    if(path==='/iptv/catalog'){
      if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
      const data=await catalog(cfg);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=0, s-maxage=300, stale-while-revalidate=900'});
      res.end(JSON.stringify(data));return true;
    }
    if(!path.startsWith('/iptv/media/')){res.writeHead(404);res.end();return true;}
    if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
    const data=untoken(path.slice('/iptv/media/'.length),cfg);
    if(data.kind==='manifest'){const text=await manifest(data.id,cfg);res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'});res.end(text);return true;}
    if(data.kind!=='segment')throw new Error('Link inválido');
    const key=data.id+'|'+data.url;
    if(!mediaCache.has(key)||mediaCache.get(key).expires<Date.now())await manifest(data.id,cfg);
    const target=mediaCache.get(key)?.url;
    if(!target){res.writeHead(410);res.end('Trecho expirado');return true;}
    const abort=new AbortController();res.once('close',()=>{if(!res.writableFinished)abort.abort();});
    const range=typeof req.headers.range==='string' && /^bytes=\d{1,15}-(?:\d{0,15})?$/.test(req.headers.range) ? req.headers.range : null;
    if(req.headers.range && !range){res.writeHead(416);res.end();return true;}
    const upstream=await fetch(target,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)]),headers:range?{Range:range}:{}});
    if(!upstream.ok)throw new Error('Trecho indisponível');
    res.statusCode=upstream.status;
    for(const name of ['content-type','content-length','content-range'])if(upstream.headers.has(name))res.setHeader(name,upstream.headers.get(name));
    await pipeline(Readable.fromWeb(upstream.body),res);
  }catch(error){if(!res.destroyed){if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Não foi possível carregar o IPTV.');}console.error('IPTV cloud: '+(error.name || 'erro'));}
  return true;
}
