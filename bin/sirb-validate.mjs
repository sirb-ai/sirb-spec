#!/usr/bin/env node
// Validates Sirb documents (YAML or JSON). Exit code 0 when every file is
// valid (warnings allowed), 1 when any file has errors, 2 on usage errors.
import { loadFile } from '../src/index.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: sirb-validate <file.yaml|file.json>...');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const { valid, issues, documents } = await loadFile(file);
  if (valid) console.log(`ok   ${file} (${documents.length} document(s))`);
  else failed = true;
  for (const i of issues) {
    const doc = i.document !== undefined ? `#${i.document}` : '';
    const label = i.severity === 'warning' ? 'warn' : 'fail';
    console.log(`${label} ${file}${doc} ${i.instancePath ?? ''} [${i.code}${i.keyword ? `/${i.keyword}` : ''}] ${i.message}`);
  }
}
process.exit(failed ? 1 : 0);
