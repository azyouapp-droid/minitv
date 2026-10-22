import fs from 'node:fs';

async function syncEmbedTV() {
  console.log('Fetching official EmbedTV channels API...');
  const resp = await fetch('https://embedtv.cc/api/channels');
  if (!resp.ok) throw new Error('Failed to fetch channels API: ' + resp.status);
  const data = await resp.json();
  const apiChannels = data.channels || [];
  console.log(`Found ${apiChannels.length} official channels from EmbedTV.`);

  const catalogPath = 'public/multicanais-embed-catalog.json';
  const existingData = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const existingMap = new Map();
  for (const c of existingData.channels) {
    existingMap.set(c.id, c);
    existingMap.set(c.name.toLowerCase(), c);
  }

  const updatedChannels = [];
  const queue = [...apiChannels];
  const concurrency = 8;
  let successCount = 0;
  let failCount = 0;

  async function worker() {
    while (queue.length > 0) {
      const apiCh = queue.shift();
      const existing = existingMap.get(apiCh.id) || existingMap.get(apiCh.name.toLowerCase());
      
      let streamUrl = existing?.stream || '';
      try {
        const pageResp = await fetch(apiCh.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (pageResp.ok) {
          const html = await pageResp.text();
          const match = html.match(/const src\s*=\s*["']([^"'\s]+)["']/)?.[1];
          if (match && !match.includes('akamaized.net')) {
            streamUrl = match;
            successCount++;
            process.stdout.write('.');
          } else {
            failCount++;
            process.stdout.write('~');
          }
        }
      } catch (err) {
        failCount++;
        process.stdout.write('x');
      }

      const merged = {
        name: apiCh.name,
        page: existing?.page || apiCh.url,
        embeds: [{ label: 'Opção 1', url: apiCh.url }],
        stream: streamUrl,
        id: apiCh.id,
        image: apiCh.image || existing?.image || '',
        preview: apiCh.preview || existing?.preview || ''
      };

      updatedChannels.push(merged);
    }
  }

  console.log('Extracting live stream URLs...');
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`\nStream extraction completed: ${successCount} fresh streams, ${failCount} fallbacks.`);

  // Preserve the two extra Nickelodeon channels if present
  for (const extraId of ['nickelodeon', 'nickjr']) {
    const extra = existingData.channels.find(c => c.id === extraId);
    if (extra && !updatedChannels.some(c => c.id === extraId)) {
      updatedChannels.push(extra);
    }
  }

  // Sort channels alphabetically by name
  updatedChannels.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));

  const finalCatalog = {
    source: ['https://embedtv.cc/api/channels'],
    retrievedAt: new Date().toISOString(),
    channels: updatedChannels
  };

  fs.writeFileSync(catalogPath, JSON.stringify(finalCatalog, null, 2));
  console.log(`Saved ${updatedChannels.length} channels to ${catalogPath}.`);

  // Update worker/index.js embedded catalog
  const workerFile = 'worker/index.js';
  if (fs.existsSync(workerFile)) {
    let workerContent = fs.readFileSync(workerFile, 'utf8');
    workerContent = workerContent.replace(
      /let currentCatalog=(\{[\s\S]+?\});\r?\nasync function refreshCatalog/,
      `let currentCatalog=${JSON.stringify(finalCatalog)};\r\nasync function refreshCatalog`
    );
    fs.writeFileSync(workerFile, workerContent);
    console.log('Updated worker/index.js embedded catalog.');
  }
}

syncEmbedTV().catch(console.error);
