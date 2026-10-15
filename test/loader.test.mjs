import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, loadOrThrow, parse, SirbLoadError, secretReason } from '../src/index.mjs';
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

test('literal-secret messages never echo the value', () => {
  const key = 'ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE';
  const { issues } = load(AGENT.replace('instructions: hi', `instructions: "use ${key}"`));
  const secret = issues.find((i) => i.code === 'literal-secret');
  assert.ok(secret);
  assert.ok(!JSON.stringify(issues).includes(key));
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
