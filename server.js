import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Set(['motion.js', 'assets/lenis.js', 'assets/lenis-LICENSE.txt', 'hazard-csv.js', 'data/testing/five-hazards-synthetic.csv', 'assets/anatomy.glb', 'assets/meshopt_decoder.js', 'assets/anatomy-LICENSE.md', 'assets/anatomy-ATTRIBUTION.md', 'assets/meshopt-LICENSE.md', 'assets/skeleton.glb', 'assets/model-viewer.min.js', 'assets/model-viewer-LICENSE.txt', 'index.html', 'app.js', 'model.js', 'csv.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'data/testing/healthy-data.csv', 'data/testing/unhealthy-data.csv']);
const types = { '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json' };
http.createServer(async (request, response) => {
  const filename = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(filename)) { response.writeHead(404).end('Not found'); return; }
  try {
    const content = await readFile(path.join(root, filename));
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Crew Health is running at http://localhost:4173'));
