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
// DRAFT runtime IDs (docs/requirements.md, ADR-0012). The ID-to-item mapping
// is a guess awaiting owner confirmation. SR-RT-10 (the CLI) is verified by
// CLI smoke tests in the runtime repositories, so no fixture may cite it.
const RUNTIME_REQUIREMENTS = {
  'SR-RT-01': 'load and validate v1alpha1; defineAgent()',
  'SR-RT-02': 'single-agent run loop with typed tools',
  'SR-RT-03': 'structured output with retry',
  'SR-RT-05': 'in-memory and Postgres memory store',
  'SR-RT-06': 'OpenTelemetry span per step',
  'SR-RT-07': 'usage record per model call',
};
const KNOWN = new Set([...Object.keys(FIXTURE_REQUIREMENTS), 'SR-SPEC-05', ...Object.keys(RUNTIME_REQUIREMENTS)]);

const fixtures = readdirSync(FIXTURE_DIR, { recursive: true })
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) }));

for (const [id, title] of Object.entries(RUNTIME_REQUIREMENTS)) {
  test(`${id} (${title}) has a runtime fixture`, () => {
    assert.ok(fixtures.some((f) => f.level === 'runtime' && f.requirements.includes(id)), `${id} has no runtime fixture`);
  });
}

test('runtime fixtures cite only SR-RT IDs, and SR-RT IDs appear only on runtime fixtures', () => {
  for (const f of fixtures) {
    for (const id of f.requirements) {
      assert.equal(id.startsWith('SR-RT-'), f.level === 'runtime', `${f.file} (level ${f.level}) cites ${id}`);
    }
  }
});

test('SR-RT-03 has a runtime fixture where retries are exhausted', () => {
  assert.ok(fixtures.some((f) => f.level === 'runtime' && f.requirements.includes('SR-RT-03') && !f.expect.valid));
});

test('docs/requirements.md lists every runtime requirement ID, marked as a draft', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'requirements.md'), 'utf8');
  // Drop this check in the same change that records the owner's confirmed mapping.
  assert.ok(doc.includes('DRAFT — proposed by Claude, needs owner confirmation'), 'the SR-RT section must stay marked as a draft');
  for (const id of [...Object.keys(RUNTIME_REQUIREMENTS), 'SR-RT-10']) {
    assert.ok(doc.includes(`| ${id} |`), `docs/requirements.md has no row for ${id}`);
  }
});

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
