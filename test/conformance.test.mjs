import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { KIND_TO_ID, RESOURCE_ID, ROOT, createAjv, readJson } from './helpers/ajv.mjs';

const FIXTURE_DIR = join(ROOT, 'conformance', 'fixtures');
const ajv = createAjv();
const validateFixtureFile = ajv.compile(readJson(join(ROOT, 'conformance', 'fixture.schema.json')));
const validateResource = ajv.getSchema(RESOURCE_ID);

function listFixtures() {
  return readdirSync(FIXTURE_DIR, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(FIXTURE_DIR, f));
}

/** True when every key in `expected` deep-equals the same key in `actual`. */
function isSubset(expected, actual) {
  return Object.entries(expected).every(([k, v]) => {
    try {
      assert.deepEqual(actual?.[k], v);
      return true;
    } catch {
      return false;
    }
  });
}

function matches(expected, actual) {
  return (
    actual.instancePath === expected.instancePath &&
    actual.keyword === expected.keyword &&
    isSubset(expected.params ?? {}, actual.params)
  );
}

const fixtures = listFixtures();

test('suite has at least 20 fixtures with both outcomes', () => {
  assert.ok(fixtures.length >= 20, `only ${fixtures.length} fixtures`);
  const outcomes = new Set(fixtures.map((f) => readJson(f).expect.valid));
  assert.deepEqual([...outcomes].sort(), [false, true]);
});

for (const path of fixtures) {
  const name = relative(FIXTURE_DIR, path);

  test(name, () => {
    const fixture = readJson(path);
    assert.ok(validateFixtureFile(fixture), `malformed fixture: ${ajv.errorsText(validateFixtureFile.errors)}`);

    const base = name.split('/').pop();
    assert.ok(
      base.startsWith(fixture.expect.valid ? 'valid-' : 'invalid-'),
      'file name prefix must agree with expect.valid',
    );

    const { document, expect } = fixture;
    const validate = ajv.getSchema(KIND_TO_ID[document?.kind] ?? RESOURCE_ID);
    const valid = validate(document);
    const errors = validate.errors ?? [];
    const dump = JSON.stringify(errors, null, 2);

    assert.equal(valid, expect.valid, `verdict mismatch; ajv errors:\n${dump}`);
    for (const e of expect.errors ?? []) {
      assert.ok(errors.some((a) => matches(e, a)), `expected error ${JSON.stringify(e)} not reported; got:\n${dump}`);
    }

    // The single entry-point envelope must reach the same verdict.
    assert.equal(validateResource(document), expect.valid, 'resource.schema.json disagrees with kind schema');
  });
}
