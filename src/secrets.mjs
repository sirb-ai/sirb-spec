import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_DIR } from './validator.mjs';

// The credential shapes are defined once, in common.schema.json, and reused
// here so the schema and the loader can never disagree about them.
const defs = JSON.parse(readFileSync(join(SCHEMA_DIR, 'common.schema.json'), 'utf8')).$defs;
const SHAPES = [
  ['known credential prefix', new RegExp(defs.knownTokenPattern.pattern, 'u')],
  ['URL with embedded credentials', new RegExp(defs.urlUserinfoPattern.pattern, 'u')],
  ['HTTP authorization value', new RegExp(defs.authSchemePattern.pattern, 'u')],
  ['credential in URL query', new RegExp(`^[A-Za-z][A-Za-z0-9+.-]*://\\S*${defs.credentialQueryPattern.pattern}`, 'u')],
];

// '/' and '+' are base64 characters, so they do not split tokens.
const TOKEN_SPLIT = /[\s?&=:@#,;"'()<>[\]{}|\\]+/u;
const MIN_TOKEN_LENGTH = 24;
const MIN_ENTROPY_BITS = 4.0;
// Seven or more lower-case letters in a row reads as a word, not a random key.
const WORD_RUN = /[a-z]{7,}/;

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

const escapePointer = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Scans every string (keys included) in a parsed document for literal
 * credentials. The schema already blocks secrets in structural fields; this
 * pass covers free-form places a schema cannot police, such as Tool
 * inputSchema defaults and Agent instructions (ADR-0004). Messages never echo
 * the offending value.
 */
export function scanSecrets(document) {
  const issues = [];
  const visit = (node, path) => {
    if (typeof node === 'string') {
      const reason = secretReason(node);
      if (reason) issues.push({ code: 'literal-secret', instancePath: path, message: `value looks like a literal secret (${reason}); use a secretRef` });
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const childPath = `${path}/${escapePointer(key)}`;
        const reason = secretReason(key);
        if (reason) issues.push({ code: 'literal-secret', instancePath: childPath, message: `key looks like a literal secret (${reason})` });
        visit(value, childPath);
      }
    }
  };
  visit(document, '');
  return issues;
}
