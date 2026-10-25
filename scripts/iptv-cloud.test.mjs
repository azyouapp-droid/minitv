import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { iptvCloud } from './iptv-cloud.mjs';

test('IPTV: public catalog, token rotation, cold instance, streaming, tamper rejection', async () => {
  process.env.IPTV_PLAYLIST_URL='https://provider.invalid/get.php?username=fixture-user&password=fixture-password';
  process.env.IPTV_SIGNING_SECRET='test-secret-with-at-least-32-characters';
  const realFetch=globalThis.fetch;
  let rotation=0;
  globalThis.fetch=async (input, options)=>{
    const url=new URL(input);
    if(url.hostname!=='provider.invalid')return realFetch(input,options);
    if(url.pathname==='/player_api.php')return Response.json([{stream_id:1,name:'Canal Teste',stream_type:'live'}]);
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
    const url=base+catalog.channels[0].stream;
    const m1=await(await realFetch(url,{headers})).text();
    const m2=await(await realFetch(url,{headers})).text();
    assert.equal(m1,m2,'rotating provider token must not change segment URI');
    const segment=m1.split('\n').find(x=>x.startsWith('/iptv/media/'));
    handler=(await import('./iptv-cloud.mjs?cold-instance')).iptvCloud;
    const video=await realFetch(base+segment,{headers});
    assert.equal(video.status,200);
    const reader=video.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'first','must deliver first bytes before full segment completes');
    let tail='';for(;;){const next=await reader.read();if(next.done)break;tail+=new TextDecoder().decode(next.value);}
    assert.equal(tail,'last');
    assert.equal((await realFetch(base+segment+'x',{headers})).status,502);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;}
});
