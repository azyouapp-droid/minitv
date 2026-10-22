import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.INGEST_CONFIG || path.join(here, 'config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const outputRoot = path.resolve(process.env.INGEST_DATA || path.join(here, 'data'));
const host = process.env.INGEST_HOST || '127.0.0.1';
const port = Number(process.env.INGEST_PORT || 8788);
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const idleMs = (config.idleSeconds ?? 120) * 1000;
const startupMs = (config.startupSeconds ?? 20) * 1000;
const staleMs = (config.staleSeconds ?? 35) * 1000;
const maxActive = config.maxActiveChannels ?? 8;
const allowed = new Map();
const active = new Map();

for (const channel of config.channels || []) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(channel.id) ||
      !/^https?:\/\//.test(channel.sourceUrl) || allowed.has(channel.id)) {
    throw new Error('Invalid or duplicate channel configuration');
  }
  allowed.set(channel.id, channel);
}
if (!allowed.size || !Number.isInteger(maxActive) || maxActive < 1 ||
    !Number.isFinite(idleMs) || idleMs < 1000 ||
    !Number.isFinite(startupMs) || startupMs < 1000 ||
    !Number.isFinite(staleMs) || staleMs < 1000) {
  throw new Error('Invalid ingest settings');
}
await fs.mkdir(outputRoot, { recursive: true });

function channelDir(id) {
  return path.join(outputRoot, id);
}

async function clearPreviousOutput(dir) {
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(dir)) {
    if (name === 'index.m3u8' || /^seg-\d+\.ts$/.test(name)) {
      await fs.unlink(path.join(dir, name));
    }
  }
}

async function start(id) {
  const previous = active.get(id);
  if (previous) return previous;
  if (active.size >= maxActive) return null;

  const channel = allowed.get(id);
  const dir = channelDir(id);
  await clearPreviousOutput(dir);
  const state = { id, dir, startedAt: Date.now(), lastViewerAt: Date.now(), process: null,
    restartAt: 0, failures: 0, stopping: false, starting: false, pending: 0 };
  active.set(id, state);
  launch(state, channel);
  return state;
}

function launch(state, channel) {
  if (state.stopping || state.process || state.starting) return;
  state.starting = true;
  state.startedAt = Date.now();
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', channel.sourceUrl,
    '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy',
    '-f', 'hls', '-hls_time', '6', '-hls_list_size', '12',
    '-hls_delete_threshold', '4',
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist+program_date_time+temp_file',
    '-hls_start_number_source', 'epoch',
    '-hls_segment_filename', path.join(state.dir, 'seg-%d.ts'),
    path.join(state.dir, 'index.m3u8')
  ];
  const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  state.process = child;
  state.starting = false;
  child.stderr.on('data', chunk => {
    if (process.env.INGEST_DEBUG === '1') process.stderr.write(chunk);
  }); // Diagnostics are opt-in because source errors may include credentials.
  child.on('error', () => {});
  child.on('close', () => {
    if (state.process !== child) return;
    state.process = null;
    if (!state.stopping) {
      state.failures += 1;
      state.restartAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(5, state.failures));
    }
  });
}

function stop(state) {
  state.stopping = true;
  active.delete(state.id);
  state.process?.kill();
}

async function waitForPlaylist(state) {
  const deadline = Date.now() + startupMs;
  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(path.join(state.dir, 'index.m3u8'));
      if (stat.mtimeMs >= state.startedAt - 1000 && stat.size > 0) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

const timer = setInterval(async () => {
  for (const state of active.values()) {
    if (!state.pending && Date.now() - state.lastViewerAt > idleMs) { stop(state); continue; }
    if (!state.process && Date.now() >= state.restartAt) {
      launch(state, allowed.get(state.id));
      continue;
    }
    try {
      const stat = await fs.stat(path.join(state.dir, 'index.m3u8'));
      if (state.process && Date.now() - stat.mtimeMs > staleMs) {
        state.process.kill();
      } else if (state.process) {
        state.failures = 0;
      }
    } catch {
      if (state.process && Date.now() - state.startedAt > staleMs) state.process.kill();
    }
  }
}, 1000);
timer.unref();

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ active: [...active.values()].map(s => ({
      id: s.id, running: !!s.process, ageSeconds: Math.round((Date.now() - s.startedAt) / 1000),
      idleSeconds: Math.round((Date.now() - s.lastViewerAt) / 1000)
    })) }));
    return;
  }
  const match = /^\/channel\/([a-z0-9][a-z0-9-]{0,63})\/(index\.m3u8|seg-\d+\.ts)$/.exec(pathname);
  if (!match || !allowed.has(match[1]) || request.method !== 'GET') {
    response.writeHead(404); response.end(); return;
  }
  const [, id, filename] = match;
  let state = active.get(id);
  if (!state && filename === 'index.m3u8') state = await start(id);
  if (!state) { response.writeHead(503); response.end('Channel capacity reached'); return; }
  state.lastViewerAt = Date.now();
  if (filename === 'index.m3u8') {
    state.pending += 1;
    let ready;
    try { ready = await waitForPlaylist(state); }
    finally { state.pending -= 1; state.lastViewerAt = Date.now(); }
    if (!ready) {
      response.writeHead(503, { 'Retry-After': '2', 'Cache-Control': 'no-store' });
      response.end('Channel is starting'); return;
    }
  }
  try {
    const filePath = path.join(state.dir, filename);
    await fs.access(filePath);
    response.writeHead(200, {
      'Content-Type': filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Cache-Control': filename.endsWith('.m3u8') ? 'no-store' : 'public, max-age=60',
      'Access-Control-Allow-Origin': '*'
    });
    createReadStream(filePath).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end();
  }
});
server.listen(port, host, () => console.log(`Mini TV ingest listening at http://${host}:${port}`));

function shutdown() {
  for (const state of active.values()) stop(state);
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
