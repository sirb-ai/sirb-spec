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

/**
 * level runtime (ADR-0012). This package has no agent runtime, so the reference
 * runner only checks that a fixture is well formed and self-consistent. The
 * behaviour is executed by the sirb-js and sirb-dotnet runners.
 */
function checkRuntimeFixture(fixture) {
  // Every embedded document loads with no errors and no warnings, as JSON and as YAML.
  for (const [i, doc] of fixture.documents.entries()) {
    for (const [format, text] of [['json', JSON.stringify(doc)], ['yaml', YAML.stringify(doc, { version: '1.2' })]]) {
      const { issues } = load(text, { format });
      assert.deepEqual(issues, [], `documents[${i}] (${format}) must load cleanly; issues:\n${JSON.stringify(issues, null, 2)}`);
    }
  }

  // References resolve within the fixture, and every agent tool has exactly one stub.
  const byKey = new Map();
  for (const d of fixture.documents) {
    const key = `${d.kind}/${d.metadata.name}`;
    assert.ok(!byKey.has(key), `duplicate document ${key}`);
    byKey.set(key, d);
  }
  const agent = byKey.get(`Agent/${fixture.agent}`);
  assert.ok(agent, `Agent ${fixture.agent} is not among the documents`);
  assert.ok(byKey.has(`ModelBinding/${agent.spec.modelBinding}`), `ModelBinding ${agent.spec.modelBinding} is not among the documents`);
  if (agent.spec.memory) assert.ok(byKey.has(`Memory/${agent.spec.memory}`), `Memory ${agent.spec.memory} is not among the documents`);
  const agentTools = agent.spec.tools ?? [];
  for (const t of agentTools) {
    const tool = byKey.get(`Tool/${t}`);
    assert.ok(tool, `Tool ${t} is not among the documents`);
    if (tool.spec.inputSchema) assert.ok(ajv.compile(tool.spec.inputSchema), `Tool ${t} inputSchema does not compile`);
  }
  assert.deepEqual(Object.keys(fixture.tools ?? {}).sort(), [...agentTools].sort(), 'tools needs exactly one stub per agent tool');
  for (const run of fixture.runs) {
    if (run.structuredOutput) assert.ok(ajv.compile(run.structuredOutput.schema), 'structuredOutput.schema does not compile');
  }

  // Expectations line up with the script.
  const { expect } = fixture;
  assert.equal(expect.runs.length, fixture.runs.length, 'expect.runs needs one entry per run');
  for (const e of expect.errors ?? []) assert.ok(e.run < fixture.runs.length, `error locator names missing run ${e.run}`);
  const steps = expect.runs.flatMap((r) => r.steps);
  const turns = steps.filter((s) => s.type === 'model').map((s) => s.turn);
  assert.deepEqual(turns, fixture.model.turns.map((_, i) => i), 'model steps must consume every scripted turn once, in order');
  for (const [tool, stub] of Object.entries(fixture.tools ?? {})) {
    const accepted = steps.filter((s) => s.type === 'tool' && s.name === tool && s.outcome === 'ok').length;
    assert.equal(stub.results.length, accepted, `stub ${tool} has ${stub.results.length} results for ${accepted} accepted calls`);
  }
  if (expect.usage) {
    const completed = turns.filter((t) => !fixture.model.turns[t].error).length;
    assert.equal(expect.usage.length, completed, 'expect.usage needs one record per completed model call');
    const ids = expect.usage.map((u) => u.request_id.$capture);
    assert.equal(new Set(ids).size, ids.length, 'every usage record needs its own request_id capture');
  }
  for (const [i, span] of (expect.spans ?? []).entries()) {
    if (span.parent !== undefined) assert.ok(span.parent < i, `spans[${i}].parent must name an earlier span`);
  }
}

const fixtures = listFixtures().map((path) => ({ path, name: relative(FIXTURE_DIR, path), fixture: JSON.parse(readFileSync(path, 'utf8')) }));

test('suite has at least 20 fixtures with both outcomes at every level', () => {
  assert.ok(fixtures.length >= 20, `only ${fixtures.length} fixtures`);
  for (const level of ['schema', 'loader', 'runtime']) {
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

    if (fixture.level === 'runtime') {
      checkRuntimeFixture(fixture);
      return;
    }

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

  if (fixture.level === 'runtime') {
    test(`${name} behaviour`, { skip: 'level runtime is executed by the sirb-js and sirb-dotnet runners, not by this reference runner (ADR-0012)' }, () => {});
  }
}
