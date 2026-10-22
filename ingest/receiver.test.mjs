import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function launch(command, args, env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr.on('data', () => {});
  return child;
}

async function until(callback, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await callback(); if (value) return value; } catch {}
    await pause(200);
  }
  throw new Error('Timed out waiting for video receiver');
}

test('one receiver starts on first viewer and stops after idle', { timeout: 45000 }, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-tv-ingest-'));
  const sourceDir = path.join(tmp, 'source');
  await fs.mkdir(sourceDir);
  const source = launch(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi',
    '-i', 'testsrc=size=160x90:rate=10', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-g', '20', '-f', 'hls', '-hls_time', '2',
    '-hls_list_size', '4', '-hls_flags', 'delete_segments+temp_file',
    path.join(sourceDir, 'index.m3u8')
  ]);
  const sourceServer = http.createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname);
    try {
      const data = await fs.readFile(path.join(sourceDir, name));
      res.writeHead(200, { 'Content-Type': name.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl' : 'video/mp2t' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => sourceServer.listen(0, '127.0.0.1', resolve));
  let receiver;
  try {
    await until(async () => (await fs.stat(path.join(sourceDir, 'index.m3u8'))).size > 0);
    const port = await new Promise(resolve => {
      const s = http.createServer().listen(0, '127.0.0.1', () => { const p=s.address().port; s.close(() => resolve(p)); });
    });
    const configPath = path.join(tmp, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({
      channels: [{ id: 'test', sourceUrl: `http://127.0.0.1:${sourceServer.address().port}/index.m3u8` }],
      maxActiveChannels: 1, idleSeconds: 3, startupSeconds: 12, staleSeconds: 20
    }));
    receiver = launch(process.execPath, [path.join(here, 'server.mjs')], {
      ...process.env, FFMPEG_BIN: ffmpeg, INGEST_CONFIG: configPath,
      INGEST_DATA: path.join(tmp, 'data'), INGEST_PORT: String(port), INGEST_DEBUG: '1'
    });
    let receiverErrors = '';
    receiver.stderr.on('data', chunk => { receiverErrors += chunk.toString(); });
    const base = `http://127.0.0.1:${port}`;
    await until(async () => (await (await fetch(base + '/health')).json()).active.length === 0);
    const playlistResponse = await fetch(base + '/channel/test/index.m3u8');
    assert.equal(playlistResponse.status, 200, receiverErrors);
    const playlist = await playlistResponse.text();
    assert.match(playlist, /#EXTM3U/);
    const segment = playlist.match(/seg-\d+\.ts/)?.[0];
    assert.ok(segment);
    assert.equal((await fetch(base + '/channel/test/' + segment)).status, 200);
    assert.equal((await fetch(base + '/channel/test/index.m3u8')).status, 200);
    assert.equal((await (await fetch(base + '/health')).json()).active.length, 1);
    await until(async () => (await (await fetch(base + '/health')).json()).active.length === 0, 8000);
  } finally {
    receiver?.kill();
    source.kill();
    await new Promise(resolve => sourceServer.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
