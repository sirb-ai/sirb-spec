import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_DIR } from './validator.mjs';
import { isSecretName } from './secret-names.mjs';

// The credential shapes are defined once, in common.schema.json, and reused
// here so the schema and the loader can never disagree about them. Every
// repeat in them is bounded, so each test is linear in the input length.
const defs = JSON.parse(readFileSync(join(SCHEMA_DIR, 'common.schema.json'), 'utf8')).$defs;
const CREDENTIAL_QUERY = new RegExp(defs.credentialQueryPattern.pattern, 'u');
export const SHAPES = [
  ['known credential prefix', new RegExp(defs.knownTokenPattern.pattern, 'u')],
  ['URL with embedded credentials', new RegExp(defs.urlUserinfoPattern.pattern, 'u')],
  ['HTTP authorization value', new RegExp(defs.authSchemePattern.pattern, 'u')],
  ['credential in URL query', { test: (v) => v.includes('://') && CREDENTIAL_QUERY.test(v) }],
];

// '/' and '+' are base64 characters, so they do not split tokens. A single
// character class repeated is linear.
const TOKEN_SPLIT = /[\s?&=:@#,;"'()<>[\]{}|\\]+/u;
const MIN_TOKEN_LENGTH = 24;
const MIN_ENTROPY_BITS = 4.0;
// Seven lower-case letters in a row reads as a word, not a random key.
const WORD_RUN = /[a-z]{7}/;

function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * True when a token looks like a random credential: long, mixed upper case,
 * lower case and digits, close to uniformly distributed, and free of
 * word-like runs. Hex digests and UUIDs are single-case, and camelCase
 * identifiers contain words, so neither is flagged.
 */
export function isHighEntropyToken(token) {
  return (
    token.length >= MIN_TOKEN_LENGTH &&
    /[a-z]/.test(token) &&
    /[A-Z]/.test(token) &&
    /[0-9]/.test(token) &&
    !WORD_RUN.test(token) &&
    shannonEntropy(token) >= MIN_ENTROPY_BITS
  );
}

/** Returns the reason a string looks like a literal secret, or undefined. */
export function secretReason(value) {
  for (const [reason, re] of SHAPES) if (re.test(value)) return reason;
  if (value.split(TOKEN_SPLIT).some(isHighEntropyToken)) return 'high-entropy token';
  return undefined;
}

// JSON Schema value keywords: a string under `default` belongs to the
// property that encloses it (properties.token.default -> "token").
const VALUE_KEYWORDS = new Set(['default', 'const', 'enum', 'examples']);
const escapePointer = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Scans a parsed document for literal secrets (ADR-0004).
 *
 * - error `literal-secret`: a literal string or number in a field meant to
 *   hold a secret, i.e. whose enclosing key names a secret (password,
 *   apiKey, clientSecret, ...). Those fields must hold a secretRef.
 * - warning `possible-secret`: a credential-shaped value anywhere else, such
 *   as free text, labels or keys. It is reported, not rejected.
 *
 * secretRef objects and metadata are never treated as secret-holding fields.
 * Messages never echo the value. The walk is iterative.
 */
export function scanSecrets(document) {
  const issues = [];
  const stack = [{ node: document, path: '', field: undefined, inRef: false, inMeta: false }];
  while (stack.length) {
    const { node, path, field, inRef, inMeta } = stack.pop();
    if (typeof node === 'string' || typeof node === 'number') {
      if (inRef) continue;
      if (!inMeta && field !== undefined && isSecretName(field) && node !== '') {
        issues.push({ code: 'literal-secret', severity: 'error', instancePath: path, message: `"${field}" holds a secret; use a secretRef instead of a literal value` });
      } else if (typeof node === 'string') {
        const reason = secretReason(node);
        if (reason) issues.push({ code: 'possible-secret', severity: 'warning', instancePath: path, message: `value looks like a credential (${reason}); if it is one, use a secretRef` });
      }
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => stack.push({ node: item, path: `${path}/${i}`, field, inRef, inMeta }));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const childPath = `${path}/${escapePointer(key)}`;
        const reason = secretReason(key);
        if (reason) issues.push({ code: 'possible-secret', severity: 'warning', instancePath: childPath, message: `key looks like a credential (${reason})` });
        stack.push({
          node: value,
          path: childPath,
          field: VALUE_KEYWORDS.has(key) ? field : key,
          inRef: inRef || key === 'secretRef',
          inMeta: inMeta || (path === '' && key === 'metadata'),
        });
      }
    }
  }
  return issues.sort((a, b) => (a.instancePath < b.instancePath ? -1 : 1));
}
