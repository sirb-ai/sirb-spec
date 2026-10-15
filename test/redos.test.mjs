import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load, DEFAULT_LIMITS } from '../src/index.mjs';
import { SHAPES } from '../src/secrets.mjs';
import { ROOT } from './helpers/paths.mjs';

// ReDoS budget: a document at the 1 MB input limit, built to make naive
// regexes backtrack, must load in well under a second (ADR-0004).
const BUDGET_MS = 1000;
const SIZE = 1_000_000;
const fill = (prefix, unit, suffix = '') => prefix + unit.repeat(Math.floor((SIZE - prefix.length - suffix.length - 400) / unit.length)) + suffix;

const AGENT = (field, value) =>
  JSON.stringify({ apiVersion: 'sirb/v1alpha1', kind: 'Agent', metadata: { name: 'a' }, spec: { modelBinding: 'm', instructions: 'hi', [field]: value } });
const TOOL = (http) =>
  JSON.stringify({ apiVersion: 'sirb/v1alpha1', kind: 'Tool', metadata: { name: 't' }, spec: { type: 'http', description: 'x', http: { method: 'GET', url: 'https://a.example', ...http } } });
const MCP = (mcp) =>
  JSON.stringify({ apiVersion: 'sirb/v1alpha1', kind: 'Tool', metadata: { name: 't' }, spec: { type: 'mcp', description: 'x', mcp: { transport: 'stdio', command: 'x', ...mcp } } });

// Each payload targets one pattern's worst case: long runs that almost match.
const PAYLOADS = {
  'userinfo: scheme chars without ://': fill('', 'a'),
  'userinfo: :// then user chars, no @': fill('a://', 'a:'),
  'auth scheme: bearer + whitespace': fill('bearer', ' ', 'x y'),
  'auth scheme: bearer + token + spaces': fill('Bearer ', 'x', ' '.repeat(300) + 'y'),
  'known token: eyJ run without .eyJ': fill('eyJ', 'a'),
  'known token: many near-prefixes': fill('', ' sk_ npm_ hf_ AKIA'),
  'query: ? then param chars, no =': fill('https://a.example/?', 'a_'),
  'query: many & separators': fill('https://a.example/?', '&a_'),
  'entropy: one huge mixed token': fill('', 'aB3dE5fG7hJ9kL1m'),
  'split: separators only': fill('', '?&=:@#'),
};

const DOCS = [];
for (const [name, value] of Object.entries(PAYLOADS)) {
  DOCS.push([`instructions / ${name}`, AGENT('instructions', value)]);
  DOCS.push([`description / ${name}`, AGENT('description', value)]);
}
DOCS.push(['http url', TOOL({ url: fill('https://a.example/', 'a?b_') })]);
DOCS.push(['header value', TOOL({ headers: { 'x-trace': fill('bearer', ' ', 'x') } })]);
DOCS.push(['header name', TOOL({ headers: { [fill('x-', 'a-').slice(0, SIZE / 2)]: 'v' } })]);
DOCS.push(['mcp args', MCP({ args: [fill('--', 'a-', '=1')] })]);
DOCS.push(['mcp command', MCP({ command: fill('A', '_') })]);
DOCS.push(['env value', MCP({ env: { X: fill('a://', 'a:') } })]);
DOCS.push(['many keys', JSON.stringify({ spec: Object.fromEntries(Array.from({ length: 30_000 }, (_, i) => [`aB3dE5fG7hJ9kL1mN${i}`, 'x'])) })]);

test('payloads are within the input limit and close to 1 MB', () => {
  for (const [name, text] of DOCS) {
    const bytes = Buffer.byteLength(text);
    assert.ok(bytes <= DEFAULT_LIMITS.maxBytes, `${name} is ${bytes} bytes`);
    assert.ok(bytes >= 0.5 * SIZE, `${name} is only ${bytes} bytes`);
  }
});

load('{}'); // warm up: compile the schemas outside the timed region
for (const [name, text] of DOCS) {
  for (const format of ['json', 'yaml']) {
    test(`1 MB adversarial ${format}: ${name} loads in < ${BUDGET_MS} ms`, () => {
      const start = performance.now();
      const result = load(text, { format });
      const ms = performance.now() - start;
      assert.ok(Array.isArray(result.issues));
      assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
    });
  }
}

// Every repeat in a secret pattern has an upper bound, so matching is linear.
// Escapes and character classes are stripped first; what remains must not
// contain *, + or {n,}.
function unboundedRepeat(pattern) {
  const stripped = pattern.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x');
  return /[*+]|\{\d+,\}/.test(stripped);
}

test('secret patterns in the schema have no unbounded repeats', () => {
  const dir = join(ROOT, 'schema', 'v1alpha1');
  for (const file of readdirSync(dir)) {
    const visit = (node, ptr) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.pattern === 'string') assert.ok(!unboundedRepeat(node.pattern), `${file}${ptr}/pattern is unbounded: ${node.pattern}`);
      if (node.patternProperties) for (const k of Object.keys(node.patternProperties)) assert.ok(!unboundedRepeat(k), `${file}${ptr} patternProperties key is unbounded`);
      for (const [k, v] of Object.entries(node)) visit(v, `${ptr}/${k}`);
    };
    visit(JSON.parse(readFileSync(join(dir, file), 'utf8')), '#');
  }
});

test('the loader shape regexes have no unbounded repeats', () => {
  for (const [name, re] of SHAPES) if (re instanceof RegExp) assert.ok(!unboundedRepeat(re.source), name);
});
