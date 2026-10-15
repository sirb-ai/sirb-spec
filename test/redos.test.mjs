import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load, DEFAULT_LIMITS, compilePolicyPattern, isSafePolicyPattern } from '../src/index.mjs';
import { MAX_PROGRAM_SIZE } from '../src/policy-regex.mjs';
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
  'hex: long hex run': fill('', '0123456789abcdef'),
  'percent: escapes only': fill('', '%41'),
  'percent: near-encoded names': fill('https://a.example/?', 'a%5F'),
  'fragment: many # and ;': fill('https://a.example/#', ';a_'),
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
DOCS.push(['many comments', fill('apiVersion: sirb/v1alpha1\n', '# sk-FAKE 0123456789abcdef0123456789abcdef\n')]);
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

// Policy patterns run against model output (ADR-0010). The schema subset
// rejects exponential constructs; the reference matcher (RE2 semantics) keeps
// every accepted pattern linear. JavaScript's own backtracking RegExp is NOT
// safe even for the subset ([^ ]{0,500}[^ ]{0,500}! is polynomial), so it is
// deliberately not used here.
const EVIL = [String.raw`(a+)+$`, String.raw`(a|a)*$`, String.raw`(a|aa)+$`, String.raw`(.*a){12}`, String.raw`a*a*a*a*b`, String.raw`\d+\d+\d+x`, String.raw`(\w+\s?)+$`, String.raw`([a-z]{1,9}){1,9}$`, String.raw`(?=a)a`, String.raw`(a)\1`];
test('known ReDoS patterns are rejected by the safeRegex subset', () => {
  for (const p of EVIL) {
    assert.ok(!isSafePolicyPattern(p), `accepted ${p}`);
    assert.equal(compilePolicyPattern(p).ok, false);
  }
});

const ACCEPTED = [
  String.raw`EMP-[0-9]{6}`,
  String.raw`[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}`,
  String.raw`[a-z]{0,20}[a-z]{0,20}[a-z]{0,20}x`,
  String.raw`[^ ]{0,30}[^ ]{0,30}!`,
  String.raw`[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}`,
  String.raw`(?:\+[0-9]{1,3})?[0-9 -]{6,20}[0-9]`,
  String.raw`a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?aaaaaaaaaaaaaaaa`,
];
const HOSTILE = ['a'.repeat(SIZE), 'x'.repeat(SIZE), '1'.repeat(SIZE), ' '.repeat(SIZE), 'a@'.repeat(SIZE / 2), 'aB3 '.repeat(SIZE / 4)];

for (const p of ACCEPTED) {
  test(`accepted policy pattern matches 1 MB hostile input in < ${BUDGET_MS} ms: ${p}`, () => {
    for (const caseInsensitive of [false, true]) {
      const compiled = compilePolicyPattern(p, { caseInsensitive });
      assert.ok(compiled.ok, compiled.reason);
      for (const input of HOSTILE) {
        const start = performance.now();
        compiled.test(input);
        const ms = performance.now() - start;
        assert.ok(ms < BUDGET_MS, `${p} took ${ms.toFixed(0)} ms`);
      }
    }
  });
}

test('patterns over the complexity cap are rejected', () => {
  const big = compilePolicyPattern(String.raw`[^ ]{0,500}[^ ]{0,500}!`);
  assert.equal(big.ok, false);
  assert.match(big.reason, /too complex/);
});

// Worst case for RE2: a pattern whose DFA needs ~2^31 states, on input that
// defeats the literal prefilter. RE2 falls back to its NFA, which is still
// linear but with a constant proportional to program size.
test(`DFA-explosion fallback stays linear: 1 MB in < ${3 * BUDGET_MS} ms at the complexity cap`, () => {
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ab = Array.from({ length: SIZE }, (_, i) => (i % 997 === 0 ? 'c' : rnd() < 0.5 ? 'a' : 'b')).join('') + '!';
  const compiled = compilePolicyPattern(String.raw`[ab]{0,32}a[ab]{31}!`);
  assert.ok(compiled.ok, compiled.reason);
  assert.ok(compiled.size <= MAX_PROGRAM_SIZE);
  const start = performance.now();
  compiled.test(ab);
  const ms = performance.now() - start;
  assert.ok(ms < 3 * BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});

test('the reference matcher reports patterns it cannot compile instead of throwing', () => {
  assert.deepEqual(Object.keys(compilePolicyPattern('[a-')), ['ok', 'reason']);
  assert.equal(compilePolicyPattern(42).ok, false);
});
