import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleGuidance } from './aether-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Set(['data/testing/astronaut-health-data.csv', 'data/testing/astronaut-health-stable.csv', 'data/testing/astronaut-health-worsening.csv', 'device-csv.js', 'device-config.js', 'mission-demo.js', 'demo-editor.js', 'motion.js', 'assets/lenis.js', 'assets/lenis-LICENSE.txt', 'hazard-csv.js', 'data/fixtures/five-hazards-synthetic.csv', 'assets/astra-icon.png', 'assets/mars-viking.jpg', 'assets/anatomy.glb', 'assets/meshopt_decoder.js', 'assets/anatomy-LICENSE.md', 'assets/anatomy-ATTRIBUTION.md', 'assets/meshopt-LICENSE.md', 'assets/skeleton.glb', 'assets/model-viewer.min.js', 'assets/model-viewer-LICENSE.txt', 'index.html', 'app.js', 'model.js', 'csv.js', 'style.css', 'sw.js', 'manifest.webmanifest']);
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json' };
http.createServer(async (request, response) => {
  const filename = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (filename === 'api/guidance') return handleGuidance(request, response);
  if (!allowed.has(filename)) { response.writeHead(404).end('Not found'); return; }
  try {
    const content = await readFile(path.join(root, filename));
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', async () => {
  console.log('Astra Health is running at http://localhost:4173');
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) return;
  try {
    const health = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(2000) });
    if (health.ok && 'rag_text_clf' in await health.json()) return;
  } catch { /* Start the local service when the health check cannot reach it. */ }
  const service = spawn(python, ['scripts/demo_server.py', '.', '8000', '127.0.0.1'], {
    cwd: root, stdio: 'inherit', windowsHide: true
  });
  service.on('error', error => console.error('AETHER startup failed:', error.message));
  process.on('exit', () => service.kill());
  process.once('SIGINT', () => process.exit());
  process.once('SIGTERM', () => process.exit());
});
