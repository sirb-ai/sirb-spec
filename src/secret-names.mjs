// One definition of "a name that holds a secret", used by the loader and,
// through scripts/gen-secret-patterns.mjs, by the schema's name patterns.
//
// A name is split into words (kebab-case, snake_case, SCREAMING_SNAKE,
// camelCase). It names a secret when its LAST word is a secret word, or when it
// ends in "key" qualified by a credential word (apiKey, ACCESS_KEY,
// ocp-apim-subscription-key).
//
// - Env var and header names: a trailing KEY counts (OPENAI_KEY, x-api-key)
//   unless the word before it is a known non-secret qualifier
//   (x-idempotency-key, CACHE_KEY).
// - Data keys: a trailing "key" counts only after a credential qualifier, so
//   partitionKey and cacheKey stay data.
// - PWD on its own is the shell's working directory, not a password; it
//   counts only as the last word of a longer name (DB_PWD).
//
// Matching on whole words, and on the last word only, keeps tokenCount,
// maxTokens, authorName, KEYBOARD_LAYOUT and x-session-id from being treated
// as secrets.

export const SECRET_WORDS = [
  'apikey', 'token', 'secret', 'password', 'passwd', 'pwd', 'passphrase',
  'credential', 'credentials', 'auth', 'authorization', 'oauth',
  'signature', 'sig', 'cookie', 'dsn', 'privatekey', 'secretkey', 'accesskey',
];

// Secret words that only count as the last word of a longer name.
export const NOT_ALONE = ['pwd'];

// Words that make a trailing "key" a credential in data keys.
export const KEY_QUALIFIERS = [
  'api', 'private', 'access', 'secret', 'account', 'subscription', 'master',
  'signing', 'encryption', 'license', 'client', 'functions', 'auth', 'app',
  'service', 'storage', 'admin',
];

// Words that make a trailing "key" NOT a credential in env var and header names.
export const NON_SECRET_KEY_QUALIFIERS = [
  'idempotency', 'partition', 'cache', 'sort', 'primary', 'foreign', 'routing',
  'shard', 'lookup', 'dedup', 'dedupe', 'object', 'row', 'group', 'public',
  'publishable', 'hash', 'index', 'map', 'composite',
];

// Last words that mark a name as holding an identifier or digest
// (x-request-id, IMAGE_SHA256, etag). Such values may be 32-hex strings.
export const IDENTIFIER_WORDS = [
  'id', 'uuid', 'guid', 'etag', 'match', 'digest', 'checksum', 'hash', 'sha',
  'sha1', 'sha256', 'md5', 'version', 'revision', 'commit',
];

/** Splits a name into lower-case words. */
export function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * @param {string} name
 * @param {{ anyKey?: boolean }} [options] anyKey: treat every trailing "key"
 *   as a secret (env var and header names).
 */
export function isSecretName(name, { anyKey = false } = {}) {
  const w = words(name);
  if (w.length === 0) return false;
  const last = w.at(-1);
  if (SECRET_WORDS.includes(last)) return !(NOT_ALONE.includes(last) && w.length === 1);
  if (last !== 'key') return false;
  if (w.length === 1) return true;
  return anyKey ? !NON_SECRET_KEY_QUALIFIERS.includes(w.at(-2)) : KEY_QUALIFIERS.includes(w.at(-2));
}

export function isIdentifierName(name) {
  return IDENTIFIER_WORDS.includes(words(name).at(-1));
}
