import test from 'node:test';
import assert from 'node:assert/strict';
import presence from '../api/presence.js';

function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},writeHead(s,h={}){this.status=s;Object.assign(this.headers,h)},end(body){this.body=body}};}
test('counts sessions without exposing database credentials',async()=>{
  const previous=globalThis.fetch;
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='private-token';
  let command;
  globalThis.fetch=async (url,options)=>{command=JSON.parse(options.body);return Response.json({result:3});};
  try {
    const a=response();await presence({method:'POST',headers:{}},a);
    assert.equal(a.status,200);assert.deepEqual(JSON.parse(a.body),{online:3});
    assert.match(a.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
    assert.equal(command[0],'EVAL');assert.equal(command[5],'120000');
    const cookie=a.headers['Set-Cookie'].split(';')[0];const id=command[6];
    const b=response();await presence({method:'POST',headers:{cookie}},b);
    assert.equal(command[6],id);assert.equal(b.headers['Set-Cookie'],undefined);
    assert.ok(!JSON.stringify(b).includes('private-token'));
    const get=response();await presence({method:'GET',headers:{}},get);assert.equal(get.status,405);
  } finally {globalThis.fetch=previous;delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;}
});
