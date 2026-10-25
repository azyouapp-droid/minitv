import { iptvCloud } from '../scripts/iptv-cloud.mjs';
import app from '../worker/index.js';

export default async function handler(req, res) {
  try {
    const originalUrl = req.url;
    const routed = new URL(req.url, 'http://localhost');
    if (routed.searchParams.has('iptvPath')) req.url = routed.searchParams.get('iptvPath');
    if (await iptvCloud(req, res)) return;
    req.url = originalUrl;
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const reqUrlObj = new URL(req.url, 'http://localhost');
    const actualPath = req.headers['x-matched-path'] || reqUrlObj.pathname;
    const fullUrl = `${proto}://${host}${actualPath}${reqUrlObj.search}`;

    const safeHeaders = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (!key.startsWith(':') && typeof val === 'string') {
        safeHeaders[key] = val;
      }
    }

    const requestObj = new Request(fullUrl, {
      method: req.method,
      headers: safeHeaders
    });

    const response = await app.fetch(requestObj);

    res.statusCode = response.status;
    for (const [k, v] of response.headers.entries()) {
      res.setHeader(k, v);
    }

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('API Handler Error:', err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Erro ao processar a solicitação no servidor.');
  }
}
