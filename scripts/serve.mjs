import http from 'node:http';
import app from '../worker/index.js';
import { iptvLocal } from './iptv-local.mjs';
import { iptvCloud } from './iptv-cloud.mjs';
import presence from '../api/presence.js';
const port = Number(process.env.PORT || 8790);
http.createServer(async (req, res) => {
  try {
    if (new URL(req.url,'http://localhost').pathname === '/api/presence') { await presence(req,res); return; }
    if (await iptvCloud(req, res)) return;
    if (await iptvLocal(req, res)) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request('http://localhost:' + port + req.url, {
      method: req.method, headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {})
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end('Erro ao carregar.');
  }
}).listen(port, '127.0.0.1', () => console.log('Mini TV: http://localhost:' + port));
