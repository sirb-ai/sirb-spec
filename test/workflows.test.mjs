import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers/ajv.mjs';

const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');
const USES = /^\s*-?\s*uses:\s*(\S+)/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

const files = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));

test('at least one workflow exists', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file} pins every action by full commit SHA (SR-SPEC-05)`, () => {
    const lines = readFileSync(join(WORKFLOW_DIR, file), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const m = line.match(USES);
      if (!m || m[1].startsWith('./')) continue;
      assert.match(m[1], PINNED, `${file}:${i + 1} uses an unpinned action: ${m[1]}`);
    }
  });

  test(`${file} declares least-privilege permissions`, () => {
    const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    assert.match(text, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  });
}
