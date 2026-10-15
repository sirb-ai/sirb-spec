import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJson } from './helpers/ajv.mjs';

const FIXTURE_DIR = join(ROOT, 'conformance', 'fixtures');

// SR-SPEC-04 (the suite itself) is covered by conformance.test.mjs and
// SR-SPEC-05 (CI) by workflows.test.mjs, so fixtures trace to 01-03 only.
const FIXTURE_REQUIREMENTS = ['SR-SPEC-01', 'SR-SPEC-02', 'SR-SPEC-03'];

const fixtures = readdirSync(FIXTURE_DIR, { recursive: true })
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(join(FIXTURE_DIR, f)));

for (const req of FIXTURE_REQUIREMENTS) {
  test(`${req} has valid and invalid fixtures`, () => {
    const tagged = fixtures.filter((f) => f.requirements.includes(req));
    assert.ok(tagged.some((f) => f.expect.valid), `${req} has no valid fixture`);
    assert.ok(tagged.some((f) => !f.expect.valid), `${req} has no invalid fixture`);
  });
}

test('every kind has at least one valid and one invalid fixture', () => {
  const kinds = ['Agent', 'Workflow', 'Tool', 'Memory', 'KnowledgeBase', 'ModelBinding', 'UIBinding', 'Policy'];
  for (const kind of kinds) {
    const ofKind = fixtures.filter((f) => f.document?.kind === kind);
    assert.ok(ofKind.some((f) => f.expect.valid), `${kind} has no valid fixture`);
    assert.ok(ofKind.some((f) => !f.expect.valid), `${kind} has no invalid fixture`);
  }
});
