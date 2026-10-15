import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { createAjv, load, normalizeKeyword, schemaIdForKind, RESOURCE_ID } from '../src/index.mjs';
import { ROOT } from './helpers/paths.mjs';

const FIXTURE_DIR = join(ROOT, 'conformance', 'fixtures');
const ajv = createAjv();
const validateFixtureFile = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'conformance', 'fixture.schema.json'), 'utf8')));
const validateResource = ajv.getSchema(RESOURCE_ID);

function listFixtures() {
  return readdirSync(FIXTURE_DIR, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(FIXTURE_DIR, f));
}

/** Matching rules from conformance/README.md: every given locator field must agree. */
function matches(expected, actual) {
  return Object.entries(expected).every(([k, v]) => actual[k] === v);
}

function assertLocators(expected = [], actual, dump) {
  for (const e of expected) {
    assert.ok(actual.some((a) => matches(e, a)), `expected ${JSON.stringify(e)} not reported; got:\n${dump}`);
  }
}

function schemaErrors(validate, document) {
  const valid = validate(document);
  const errors = (validate.errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    keyword: normalizeKeyword(e.keyword),
    property: e.params?.missingProperty ?? e.params?.additionalProperty ?? e.params?.propertyName ?? e.propertyName,
  }));
  return { valid, errors };
}

const fixtures = listFixtures().map((path) => ({ path, name: relative(FIXTURE_DIR, path), fixture: JSON.parse(readFileSync(path, 'utf8')) }));

test('suite has at least 20 fixtures with both outcomes at both levels', () => {
  assert.ok(fixtures.length >= 20, `only ${fixtures.length} fixtures`);
  for (const level of ['schema', 'loader']) {
    const outcomes = new Set(fixtures.filter((f) => f.fixture.level === level).map((f) => f.fixture.expect.valid));
    assert.deepEqual([...outcomes].sort(), [false, true], `level ${level} needs valid and invalid fixtures`);
  }
});

for (const { name, fixture } of fixtures) {
  test(name, () => {
    assert.ok(validateFixtureFile(fixture), `malformed fixture: ${ajv.errorsText(validateFixtureFile.errors)}`);
    const base = name.split('/').pop();
    assert.ok(base.startsWith(fixture.expect.valid ? 'valid-' : 'invalid-'), 'file name prefix must agree with expect.valid');
    const { expect } = fixture;

    if (fixture.level === 'loader') {
      const result = load(fixture.source, { format: fixture.format });
      const dump = JSON.stringify(result.issues, null, 2);
      assert.equal(result.valid, expect.valid, `loader verdict mismatch; issues:\n${dump}`);
      assertLocators(expect.errors, result.issues.filter((i) => i.severity === 'error'), dump);
      assertLocators(expect.warnings, result.issues.filter((i) => i.severity === 'warning'), dump);
      return;
    }

    const { document } = fixture;
    const validate = ajv.getSchema(schemaIdForKind(document?.kind));
    const { valid, errors } = schemaErrors(validate, document);
    const dump = JSON.stringify(errors, null, 2);
    assert.equal(valid, expect.valid, `verdict mismatch; errors:\n${dump}`);
    assertLocators(expect.errors, errors, dump);

    // The single entry-point envelope must reach the same verdict.
    assert.equal(validateResource(document), expect.valid, 'resource.schema.json disagrees with kind schema');

    // The loader must agree for both encodings of the same document. A
    // schema-valid fixture must also be free of literal secrets.
    for (const [format, text] of [['json', JSON.stringify(document)], ['yaml', YAML.stringify(document, { version: '1.2' })]]) {
      const loaded = load(text, { format });
      assert.equal(loaded.valid, expect.valid, `loader (${format}) disagrees; issues:\n${JSON.stringify(loaded.issues, null, 2)}`);
    }
  });
}
