import fs from 'node:fs';

async function refreshAll() {
  console.log('Loading catalog...');
  const catalogPath = 'public/multicanais-embed-catalog.json';
  const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  let updated = 0;
  let failed = 0;

  console.log(`Processing ${data.channels.length} channels...`);

  const queue = [...data.channels];
  const concurrency = 6;

  async function worker() {
    while (queue.length > 0) {
      const ch = queue.shift();
      const embedUrl = ch.embeds?.[0]?.url;
      if (!embedUrl) continue;

      try {
        const resp = await fetch(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://multicanaishd.email/'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (resp.ok) {
          const html = await resp.text();
          const match = html.match(/const src\s*=\s*"(https:\/\/[^"\s]+)"/)?.[1];
          if (match && !match.includes('akamaized.net')) {
            ch.stream = match;
            updated++;
            process.stdout.write('.');
            continue;
          }
        }
      } catch (err) {}
      failed++;
      process.stdout.write('x');
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`\nFinished: ${updated} updated, ${failed} failed.`);

  data.retrievedAt = new Date().toISOString();
  fs.writeFileSync(catalogPath, JSON.stringify(data, null, 2));

  // Also update worker/index.js embedded catalog
  const workerFile = 'worker/index.js';
  if (fs.existsSync(workerFile)) {
    let workerContent = fs.readFileSync(workerFile, 'utf8');
    workerContent = workerContent.replace(
      /let currentCatalog=(\{[\s\S]+?\});\r?\nasync function refreshCatalog/,
      `let currentCatalog=${JSON.stringify(data)};\r\nasync function refreshCatalog`
    );
    fs.writeFileSync(workerFile, workerContent);
    console.log('Updated worker/index.js embedded catalog.');
  }
}

refreshAll().catch(console.error);
