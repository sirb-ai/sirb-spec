import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_DIR } from './validator.mjs';
import { isSecretName, isIdentifierName } from './secret-names.mjs';

// The credential shapes are defined once, in common.schema.json, and reused
// here so the schema and the loader can never disagree about them. Every
// repeat in them is bounded, so each test is linear in the input length.
const defs = JSON.parse(readFileSync(join(SCHEMA_DIR, 'common.schema.json'), 'utf8')).$defs;
const CREDENTIAL_QUERY = new RegExp(defs.credentialQueryPattern.pattern, 'u');
const ENCODED_QUERY_NAME = new RegExp(defs.encodedQueryNamePattern.pattern, 'u');
export const SHAPES = [
  ['known credential prefix', new RegExp(defs.knownTokenPattern.pattern, 'u')],
  ['32-hex key', new RegExp(defs.hexKeyPattern.pattern, 'u')],
  ['URL with embedded credentials', new RegExp(defs.urlUserinfoPattern.pattern, 'u')],
  ['HTTP authorization value', new RegExp(defs.authSchemePattern.pattern, 'u')],
  ['credential in URL query or fragment', { test: (v) => v.includes('://') && CREDENTIAL_QUERY.test(v) }],
  ['percent-encoded URL parameter name', { test: (v) => v.includes('://') && ENCODED_QUERY_NAME.test(v) }],
];

/** Decodes each %XX escape on its own, so malformed input never throws. */
function percentDecode(value) {
  return value.replace(/%[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)));
}

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

function shapeReason(value, { allowHex = false } = {}) {
  for (const [reason, re] of SHAPES) if (re.test(value) && !(allowHex && reason === '32-hex key')) return reason;
  if (value.split(TOKEN_SPLIT).some(isHighEntropyToken)) return 'high-entropy token';
  return undefined;
}

/**
 * Returns the reason a string looks like a literal secret, or undefined.
 * Percent-encoded text is also checked after decoding, so `api%5Fkey=` and
 * `Bearer%20sk-...` are recognised.
 */
export function secretReason(value, options) {
  const reason = shapeReason(value, options);
  if (reason || !/%[0-9A-Fa-f]{2}/.test(value)) return reason;
  const decoded = shapeReason(percentDecode(value), options);
  return decoded && `${decoded}, percent-encoded`;
}

/** Warnings for credential-shaped YAML comments (comments never hold secrets legitimately). */
export function scanComments(comments) {
  const issues = [];
  for (const { text, instancePath, line, document } of comments) {
    const reason = secretReason(text);
    if (reason) issues.push({ code: 'possible-secret', severity: 'warning', instancePath, line, document, location: 'comment', message: `comment looks like it contains a credential (${reason})` });
  }
  return issues;
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
        // Identifier fields (x-request-id, IMAGE_SHA256) may hold hex strings.
        const reason = secretReason(node, { allowHex: field !== undefined && isIdentifierName(field) });
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
