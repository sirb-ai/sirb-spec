import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers/paths.mjs';

const FIXTURE_DIR = join(ROOT, 'conformance', 'fixtures');

// Requirement IDs as recorded in ADR-0001. SR-SPEC-05 (versioning) is
// verified by versioning.test.mjs rather than by fixtures.
const FIXTURE_REQUIREMENTS = {
  'SR-SPEC-01': 'schemas for the eight kinds',
  'SR-SPEC-02': 'ModelBinding modes, fallbacks and budget',
  'SR-SPEC-03': 'YAML and JSON accepted',
  'SR-SPEC-04': 'secrets only as secretRef; loader rejects literal keys',
};
const KNOWN = new Set([...Object.keys(FIXTURE_REQUIREMENTS), 'SR-SPEC-05']);

const fixtures = readdirSync(FIXTURE_DIR, { recursive: true })
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) }));

test('fixtures only cite known requirement IDs', () => {
  for (const f of fixtures) {
    for (const id of f.requirements) assert.ok(KNOWN.has(id), `${f.file} cites unknown ${id}`);
  }
});

for (const [id, title] of Object.entries(FIXTURE_REQUIREMENTS)) {
  test(`${id} (${title}) has valid and invalid fixtures`, () => {
    const tagged = fixtures.filter((f) => f.requirements.includes(id));
    assert.ok(tagged.some((f) => f.expect.valid), `${id} has no valid fixture`);
    assert.ok(tagged.some((f) => !f.expect.valid), `${id} has no invalid fixture`);
  });
}

test('SR-SPEC-03 is exercised through YAML and JSON loader fixtures', () => {
  const loader = fixtures.filter((f) => f.level === 'loader' && f.requirements.includes('SR-SPEC-03'));
  for (const format of ['yaml', 'json']) {
    assert.ok(loader.some((f) => f.format === format && f.expect.valid), `no valid ${format} loader fixture`);
  }
});

test('SR-SPEC-04 includes loader-level literal-secret rejections', () => {
  const hits = fixtures.filter(
    (f) => f.level === 'loader' && f.requirements.includes('SR-SPEC-04') && f.expect.errors?.some((e) => e.code === 'literal-secret'),
  );
  assert.ok(hits.length > 0);
});

test('every kind has at least two valid and one invalid fixture', () => {
  const kinds = ['Agent', 'Workflow', 'Tool', 'Memory', 'KnowledgeBase', 'ModelBinding', 'UIBinding', 'Policy'];
  for (const kind of kinds) {
    const ofKind = fixtures.filter((f) => f.document?.kind === kind);
    assert.ok(ofKind.filter((f) => f.expect.valid).length >= 2, `${kind} has fewer than two valid fixtures`);
    assert.ok(ofKind.some((f) => !f.expect.valid), `${kind} has no invalid fixture`);
  }
});
