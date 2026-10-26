import { iptvCloud } from '../scripts/iptv-cloud.mjs';

export default async function handler(req, res) {
  try {
    const routed = new URL(req.url, 'http://localhost');
    const iptvPath = routed.searchParams.get('iptvPath');
    if (iptvPath) {
      if (iptvPath.length > 8192 || !iptvPath.startsWith('/')) {
        res.writeHead(400); res.end(); return;
      }
      req.url = iptvPath;
    }
    if (await iptvCloud(req, res)) return;
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end('Not found');
  } catch (error) {
    console.error('API Handler Error:', error.name || 'erro');
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erro ao processar a solicitação no servidor.');
  }
}
