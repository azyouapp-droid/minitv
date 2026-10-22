import app from '../worker/index.js';

export default async function handler(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {})
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    res.writeHead(502);
    res.end('Erro ao carregar.');
  }
}
