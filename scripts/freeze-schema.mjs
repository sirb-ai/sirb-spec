// Records the sha256 of every schema file in schema/<dir> in schema/frozen.json.
// Run when an apiVersion reaches beta: npm run freeze -- v1beta1
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_ROOT = fileURLToPath(new URL('../schema/', import.meta.url));
const dir = process.argv[2];
if (!/^v[0-9]+(beta[0-9]+)?$/.test(dir ?? '')) {
  console.error('usage: npm run freeze -- <v1beta1|v1|...>  (alpha versions are never frozen)');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(SCHEMA_ROOT, 'frozen.json'), 'utf8'));
const files = {};
for (const file of readdirSync(join(SCHEMA_ROOT, dir)).filter((f) => f.endsWith('.json')).sort()) {
  files[file] = createHash('sha256').update(readFileSync(join(SCHEMA_ROOT, dir, file))).digest('hex');
}
manifest.frozen[dir] = files;
writeFileSync(join(SCHEMA_ROOT, 'frozen.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`froze ${Object.keys(files).length} files in schema/${dir}`);
