import { randomUUID } from 'node:crypto';

// Session identifiers expire after two minutes; no IP or account data is stored.
const script = `local now=tonumber(ARGV[1]); local ttl=tonumber(ARGV[2]);
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-ttl);
redis.call('ZADD',KEYS[1],now,ARGV[3]);
redis.call('EXPIRE',KEYS[1],180);
return redis.call('ZCARD',KEYS[1])`;

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  const store=process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!store || !token){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({available:false}));return;}
  const raw=req.headers.cookie?.match(/(?:^|;\s*)minitv_presence=([a-f0-9-]{36})(?:;|$)/i)?.[1];
  const id=raw || randomUUID();
  if(!raw)res.setHeader('Set-Cookie',`minitv_presence=${id}; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Lax`);
  try {
    const response=await fetch(store,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',script,'1','minitv:presence',String(Date.now()),'120000',id]),signal:AbortSignal.timeout(5000)});
    const result=await response.json();
    if(!response.ok || !Number.isSafeInteger(result.result) || result.result<0)throw new Error('Presence unavailable');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({online:result.result}));
  } catch {res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({available:false}));}
}
