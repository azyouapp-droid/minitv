import fs from 'node:fs';

fs.mkdirSync('public', { recursive: true });
fs.mkdirSync('dist/server', { recursive: true });
fs.mkdirSync('dist/.openai', { recursive: true });

// Copy index.html to public
if (fs.existsSync('index.html')) {
  fs.copyFileSync('index.html', 'public/index.html');
}

// Extract static assets from worker/index.js for ultra-fast CDN delivery
const workerContent = fs.readFileSync('worker/index.js', 'utf8');

const artMatch = workerContent.match(/const categoryArt="([^"]+)";/);
if (artMatch) {
  fs.writeFileSync('public/category-art.png', Buffer.from(artMatch[1], 'base64'));
}

const catalogMatch = workerContent.match(/let currentCatalog=(\{[\s\S]+?\});\r?\nasync function refreshCatalog/);
if (catalogMatch) {
  fs.writeFileSync('public/multicanais-embed-catalog.json', catalogMatch[1]);
}

fs.copyFileSync('worker/index.js', 'dist/server/index.js');
if (fs.existsSync('.openai/hosting.json')) {
  fs.copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
}

console.log('Build complete: static assets generated in public/');