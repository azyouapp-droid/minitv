import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const channelsCache = { expires: 0, value: null };
const mediaCache = new Map();
const canonical = value => { const u = new URL(value); u.searchParams.delete('token'); return u.href; };
function settings() {
  const playlist = process.env.IPTV_PLAYLIST_URL;
  if (!playlist) return null;
  if (!process.env.IPTV_SIGNING_SECRET || !process.env.IPTV_TEST_PASSWORD) throw new Error('IPTV incompleto');
  const url = new URL(playlist);
  return { url, username: url.searchParams.get('username'), password: url.searchParams.get('password'), secret: process.env.IPTV_SIGNING_SECRET, access: process.env.IPTV_TEST_PASSWORD };
}
function signature(value, cfg) { return createHmac('sha256', cfg.secret).update(value).digest('base64url'); }
function equal(a, b) { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x,y); }
function token(payload, cfg) { const data=Buffer.from(JSON.stringify(payload)).toString('base64url'); return data+'.'+signature(data,cfg); }
function untoken(value, cfg) {
  const [data, sig]=value.split('.');
  if (!equal(sig, signature(data || '',cfg))) throw new Error('Link inválido');
  return JSON.parse(Buffer.from(data,'base64url').toString());
}
function route(payload, cfg) { return '/iptv/media/'+token(payload,cfg); }
function authorized(req,cfg) {
  const cookie=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('minitv_access='))?.slice(14);
  if (!cookie) return false;
  try { const data=untoken(cookie,cfg); return data.kind==='access' && data.expires>Date.now(); } catch { return false; }
}
async function catalog(cfg) {
  if (channelsCache.value && Date.now()<channelsCache.expires) return channelsCache.value;
  const url=new URL('/player_api.php',cfg.url);
  url.searchParams.set('username',cfg.username); url.searchParams.set('password',cfg.password); url.searchParams.set('action','get_live_streams');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Catálogo indisponível');
  const data=await response.json();
  if (!Array.isArray(data)) throw new Error('Acesso IPTV indisponível');
  const channels=data.filter(c=>c.stream_type==='live' && !/adult|xxx|sexy|playboy/i.test(c.name)).map(c=>({id:'iptv-'+c.stream_id,name:c.name,stream:route({id:String(c.stream_id),kind:'manifest'},cfg),embeds:[],provider:'IPTV mensal'}));
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
    const absolute=new URL(value,response.url).href, stable=canonical(absolute);
    mediaCache.set(id+'|'+stable,{url:absolute,expires:Date.now()+120000});
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
  const relevant=path==='/multicanais-embed-catalog.json'||path==='/refresh'||path==='/events'||path.startsWith('/iptv/');
  if (!relevant || !process.env.IPTV_PLAYLIST_URL) return false;
  res.setHeader('Cache-Control','private, no-store');
  try {
    const cfg=settings();
    if(path==='/iptv/login' && req.method==='POST') {
      if (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) {res.writeHead(403);res.end();return true;}
      let input=req.body;
      if (!input) { let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw new Error('Entrada inválida');} input=JSON.parse(body); }
      if(typeof input==='string')input=JSON.parse(input);
      if(!equal(input.password,cfg.access)){res.writeHead(401);res.end('Senha inválida');return true;}
      const cookie=token({kind:'access',expires:Date.now()+86400000},cfg);
      res.setHeader('Set-Cookie','minitv_access='+cookie+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400');
      res.writeHead(204);res.end();return true;
    }
    if(!authorized(req,cfg)){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"loginRequired":true}');return true;}
    if(path==='/events'){res.writeHead(200,{'Content-Type':'application/json'});res.end('[]');return true;}
    if(path==='/refresh'||path==='/iptv/catalog'||path==='/multicanais-embed-catalog.json'){
      if(path==='/refresh')channelsCache.expires=0;
      const data=await catalog(cfg);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return true;
    }
    if(!path.startsWith('/iptv/media/')){res.writeHead(404);res.end();return true;}
    const data=untoken(path.slice('/iptv/media/'.length),cfg);
    if(data.kind==='manifest'){const text=await manifest(data.id,cfg);res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'});res.end(text);return true;}
    if(data.kind!=='segment')throw new Error('Link inválido');
    const key=data.id+'|'+data.url;
    if(!mediaCache.has(key)||mediaCache.get(key).expires<Date.now())await manifest(data.id,cfg);
    const target=mediaCache.get(key)?.url;
    if(!target){res.writeHead(410);res.end('Trecho expirado');return true;}
    const abort=new AbortController();res.once('close',()=>{if(!res.writableFinished)abort.abort();});
    const upstream=await fetch(target,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)]),headers:req.headers.range?{Range:req.headers.range}:{}});
    if(!upstream.ok)throw new Error('Trecho indisponível');
    res.statusCode=upstream.status;
    for(const name of ['content-type','content-length','content-range'])if(upstream.headers.has(name))res.setHeader(name,upstream.headers.get(name));
    await pipeline(Readable.fromWeb(upstream.body),res);
  }catch(error){if(!res.destroyed){if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Não foi possível carregar o IPTV.');}console.error('IPTV cloud: '+(error.name || 'erro'));}
  return true;
}
