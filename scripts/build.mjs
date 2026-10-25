import fs from 'node:fs';

fs.mkdirSync('public', { recursive: true });
fs.mkdirSync('dist/server', { recursive: true });
fs.mkdirSync('dist/.openai', { recursive: true });

// Copy index.html to public
if (fs.existsSync('index.html')) {
  fs.copyFileSync('index.html', 'public/index.html');
}

// Extract static assets from worker/index.js for ultra-fast CDN delivery
let workerContent = fs.readFileSync('worker/index.js', 'utf8');

// Keep worker/index.js pageHtml in sync with index.html
if (fs.existsSync('index.html')) {
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const pIdx = workerContent.indexOf('const pageHtml=');
  const cIdx = workerContent.indexOf('\nlet currentCatalog=');
  if (pIdx !== -1 && cIdx !== -1 && cIdx > pIdx) {
    workerContent = workerContent.slice(0, pIdx) + 'const pageHtml=' + JSON.stringify(indexHtml) + ';' + workerContent.slice(cIdx);
    fs.writeFileSync('worker/index.js', workerContent);
  }
}

const artMatch = workerContent.match(/const categoryArt="([^"]+)";/);
if (artMatch) {
  fs.writeFileSync('public/category-art.png', Buffer.from(artMatch[1], 'base64'));
}

// The old EmbedTV catalog is no longer published.
fs.rmSync('public/multicanais-embed-catalog.json', { force: true });

fs.copyFileSync('worker/index.js', 'dist/server/index.js');
if (fs.existsSync('.openai/hosting.json')) {
  fs.copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
}

console.log('Build complete: static assets generated in public/');