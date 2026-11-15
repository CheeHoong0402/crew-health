import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const serviceWorker = await readFile(path.join(root, 'sw.js'), 'utf8');
const assetList = serviceWorker.match(/^const FILES = (\[.*\]);$/m);
assert.ok(assetList, 'The service worker must declare its offline assets.');
const assets = JSON.parse(assetList[1].replaceAll("'", '"'));
for (const asset of new Set([...assets, './sw.js'])) {
  if (asset === './') continue;
  assert.ok(asset.startsWith('./') && !asset.includes('..'), 'Invalid web asset path.');
  const destination = path.join(root, 'dist', asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, asset), destination);
}
console.log('Built the offline web app in dist.');
