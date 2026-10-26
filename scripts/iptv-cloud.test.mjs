import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { iptvCloud } from './iptv-cloud.mjs';

test('IPTV: public catalog, token rotation, cold instance, streaming, tamper rejection', async () => {
  process.env.IPTV_PLAYLIST_URL='https://provider.invalid/get.php?username=fixture-user&password=fixture-password';
  process.env.IPTV_SIGNING_SECRET='test-secret-with-at-least-32-characters';
  const realFetch=globalThis.fetch;
  let rotation=0;
  let catalogCalls=0;
  globalThis.fetch=async (input, options)=>{
    const url=new URL(input);
    if(url.hostname!=='provider.invalid')return realFetch(input,options);
    if(url.pathname==='/player_api.php'){catalogCalls++;return Response.json([{stream_id:1,name:'Canal Teste',stream_type:'live'}]);}
    if(url.pathname.endsWith('.m3u8'))return Object.defineProperty(new Response('#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:8,\nhttps://provider.invalid/hls/1_10.ts?token='+ ++rotation+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}}),'url',{value:url.href});
    assert.equal(url.pathname,'/hls/1_10.ts');
    assert.ok(url.searchParams.get('token'));
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('first'));setTimeout(()=>{controller.enqueue(new TextEncoder().encode('last'));controller.close();},150);}}),{headers:{'Content-Type':'video/mp2t'}});
  };
  let handler=iptvCloud;
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await realFetch(base+'/multicanais-embed-catalog.json')).status,404);
    const headers={};
    const catalog=await(await realFetch(base+'/iptv/catalog',{headers})).json();
    assert.equal(catalog.channels.length,1);
    assert.ok(!JSON.stringify(catalog).includes('fixture-password'));
    assert.match((await realFetch(base+'/iptv/catalog')).headers.get('cache-control'),/s-maxage=300/);
    assert.equal((await realFetch(base+'/refresh',{method:'POST'})).status,204);
    assert.equal(catalogCalls,1,'refresh must not force another provider catalog request');
    const url=base+catalog.channels[0].stream;
    const m1=await(await realFetch(url,{headers})).text();
    const m2=await(await realFetch(url,{headers})).text();
    const segment=m1.split('\n').find(x=>x.startsWith('/iptv/media/'));
    const segment2=m2.split('\n').find(x=>x.startsWith('/iptv/media/'));
    assert.ok(segment?.startsWith('/iptv/media/enc.'));
    assert.ok(segment2?.startsWith('/iptv/media/enc.'));
    assert.ok(!Buffer.from(segment.slice('/iptv/media/enc.'.length),'base64url').toString().includes('provider.invalid'));
    assert.ok(!Buffer.from(segment.slice('/iptv/media/enc.'.length),'base64url').toString().includes('fixture-password'));
    handler=(await import('./iptv-cloud.mjs?cold-instance')).iptvCloud;
    const video=await realFetch(base+segment,{headers});
    assert.equal(video.status,200);
    const reader=video.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'first','must deliver first bytes before full segment completes');
    let tail='';for(;;){const next=await reader.read();if(next.done)break;tail+=new TextDecoder().decode(next.value);}
    assert.equal(tail,'last');
    assert.equal((await realFetch(base+segment+'x',{headers})).status,502);
    const oldPayload=Buffer.from(JSON.stringify({id:'1',kind:'segment',url:'https://provider.invalid/hls/1_10.ts'})).toString('base64url');
    const oldSignature=createHmac('sha256',process.env.IPTV_SIGNING_SECRET).update(oldPayload).digest('base64url');
    assert.equal((await realFetch(base+'/iptv/media/'+oldPayload+'.'+oldSignature)).status,502,'old readable links must be revoked');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;}
});
