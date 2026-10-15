import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, loadFile, loadOrThrow, parse, SirbLoadError, secretReason, isSecretName } from '../src/index.mjs';
import { ROOT } from './helpers/paths.mjs';

const AGENT = 'apiVersion: sirb/v1alpha1\nkind: Agent\nmetadata: {name: support}\nspec: {modelBinding: m, instructions: hi}\n';

test('stream size limit is enforced before parsing work is done', () => {
  const text = Array.from({ length: 101 }, () => AGENT).join('---\n');
  assert.deepEqual(parse(text).issues.map((i) => i.code), ['too-many-documents']);
});

test('byte limit is enforced', () => {
  assert.deepEqual(parse(AGENT, { maxBytes: 10 }).issues.map((i) => i.code), ['too-large']);
});

test('empty input is rejected', () => {
  assert.deepEqual(load('').issues.map((i) => i.code), ['empty']);
});

test('format is inferred from the file name', () => {
  assert.equal(load('{"a":1,}', { filename: 'x.json' }).issues[0].code, 'syntax');
  // A trailing comma is legal in a YAML 1.2 flow mapping, so only JSON rejects it.
  assert.equal(load('{"a":1,}', { filename: 'x.yaml' }).issues[0].code, 'schema');
});

test('loadOrThrow returns documents or throws with every issue', () => {
  assert.equal(loadOrThrow(AGENT)[0].metadata.name, 'support');
  assert.throws(() => loadOrThrow('a: &x 1\n'), (e) => e instanceof SirbLoadError && e.issues[0].code === 'yaml-alias');
});

test('secret findings never echo the value', () => {
  const key = 'ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE';
  const { valid, issues } = load(AGENT.replace('instructions: hi', `instructions: "use ${key}"`));
  assert.equal(valid, true, 'free text gets a warning, not an error');
  assert.equal(issues.find((i) => i.code === 'possible-secret')?.severity, 'warning');
  assert.ok(!JSON.stringify(issues).includes(key));
});

test('every issue carries a severity; only errors make a document invalid', () => {
  const warnOnly = load(AGENT.replace('instructions: hi', 'instructions: "Bearer FAKEFAKE"'));
  assert.equal(warnOnly.valid, true);
  assert.equal(warnOnly.documents.length, 1);
  for (const r of [warnOnly, load('a: &x 1\n'), load(AGENT.replace('m,', 'Bad_Ref,'))]) {
    for (const i of r.issues) assert.ok(['error', 'warning'].includes(i.severity), JSON.stringify(i));
  }
});

test('isSecretName classifies by the last whole word', () => {
  for (const n of ['apiKey', 'api_key', 'accessToken', 'clientSecret', 'dbPassword', 'privateKey', 'x-auth', 'GH_OAUTH', 'set-cookie']) assert.ok(isSecretName(n), n);
  for (const n of ['tokenCount', 'maxTokens', 'authorName', 'partitionKey', 'secretName', 'tokenUrl', 'KEYBOARD_LAYOUT', 'x-session-id', 'keyword']) assert.ok(!isSecretName(n), n);
  assert.ok(isSecretName('OPENAI_KEY', { anyKey: true }));
});

test('secret heuristics: true positives and known-good negatives', () => {
  for (const s of ['sk-ant-api03-FAKE', 'xoxb-FAKE', 'https://u:FAKE@h.example', 'bearer FAKEFAKE', 'https://h.example/?access_token=FAKE', 'Zx9Qm2Lp8Rt4FAKE6Ky1Nb3Hc5Jd7Fg0Ts']) {
    assert.ok(secretReason(s), `missed ${s}`);
  }
  for (const s of ['You answer billing questions politely.', 'task-runner', 'Token bucket size', 'claude-sonnet-5-5', '0f8e7c2a-1b3d-4e5f-9a8b-7c6d5e4f3a2b', 'ThisIsALongIdentifierName2024', 'https://help.example.com/Articles/GettingStarted2024', 'Acme.Tools::Acme.Tools.Refunds.Issue']) {
    assert.equal(secretReason(s), undefined, `false positive on ${s}`);
  }
});

test('sirb-validate CLI exits 0 for valid files and 1 for invalid ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sirb-'));
  writeFileSync(join(dir, 'ok.yaml'), AGENT);
  writeFileSync(join(dir, 'bad.json'), '{"apiVersion":"sirb/v1alpha1","kind":"Agent","metadata":{"name":"x"}}');
  const bin = join(ROOT, 'bin', 'sirb-validate.mjs');
  assert.match(execFileSync(process.execPath, [bin, join(dir, 'ok.yaml')], { encoding: 'utf8' }), /^ok /);
  assert.throws(() => execFileSync(process.execPath, [bin, join(dir, 'bad.json')], { encoding: 'utf8' }), (e) => e.status === 1 && /required/.test(e.stdout));
});

test('load() never throws, whatever the input', async () => {
  const doc = (kind) => `apiVersion: sirb/v1alpha1\nkind: ${kind}\nmetadata: {name: a}\nspec: {}\n`;
  const inputs = [
    undefined, null, 42, {}, [], () => {}, Symbol('x'), new Uint8Array([0xff, 0xfe]), Buffer.from(AGENT),
    '', '---', '~', '[]', '"just a string"', '!!binary aGk=', '&a [*a]', 'a: *missing',
    ...['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '"Agent "'].map(doc),
    'apiVersion: sirb/v1alpha1\nkind: Agent\nmetadata: {__proto__: {polluted: 1}, name: a}\nspec: {}\n',
    '{"__proto__": {"polluted": 1}}',
    'a: ' + '['.repeat(200_000) + ']'.repeat(200_000),
    '[' .repeat(200_000),
    '{"a":'.repeat(50_000) + '1' + '}'.repeat(50_000),
    Array.from({ length: 200 }, (_, i) => '  '.repeat(i) + 'a:').join('\n') + ' 1\n',
    '\uFEFF' + AGENT, AGENT.replace('hi', '"\\uD800"'),
  ];
  for (const input of inputs) {
    for (const format of ['yaml', 'json', 'toml', undefined]) {
      let result;
      assert.doesNotThrow(() => { result = load(input, { format }); }, `threw for ${String(input).slice(0, 40)}`);
      assert.equal(typeof result.valid, 'boolean');
      assert.ok(Array.isArray(result.issues));
    }
  }
  assert.equal(load(AGENT, null).valid, true, 'null options are tolerated');
  assert.equal(({}).polluted, undefined, 'Object.prototype was not polluted');
  const missing = await loadFile('/nonexistent/sirb.yaml');
  assert.deepEqual(missing.issues.map((i) => i.code), ['io']);
});

test('nesting depth is limited (default 64 collections, counting the root)', () => {
  const nested = (n) => 'a: ' + '['.repeat(n) + ']'.repeat(n) + '\n'; // n + 1 collections
  assert.deepEqual(parse(nested(63)).issues, []);
  assert.deepEqual(parse(nested(64)).issues.map((i) => i.code), ['too-deep']);
  assert.deepEqual(parse(nested(10), { maxDepth: 5 }).issues.map((i) => i.code), ['too-deep']);
  // Brackets inside quoted scalars and comments do not count.
  assert.deepEqual(parse(`a: "${'['.repeat(100)}" # ${'{'.repeat(100)}\n`).issues, []);
});
