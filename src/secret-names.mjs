// One definition of "a name that holds a secret", used by the loader and,
// through scripts/gen-secret-patterns.mjs, by the schema's name patterns.
//
// A name is split into words (kebab-case, snake_case, SCREAMING_SNAKE,
// camelCase). It names a secret when its LAST word is a secret word, or when it
// ends in "key" qualified by a credential word (apiKey, ACCESS_KEY,
// ocp-apim-subscription-key). In env var and header names any trailing KEY
// counts (OPENAI_KEY, x-trace-key); in data keys a bare trailing "key" is
// usually not a secret (partitionKey, cacheKey). Matching on whole words, and on the last word
// only, keeps tokenCount, maxTokens, authorName, KEYBOARD_LAYOUT,
// partitionKey and x-session-id from being treated as secrets.

export const SECRET_WORDS = [
  'apikey', 'token', 'secret', 'password', 'passwd', 'pwd', 'passphrase',
  'credential', 'credentials', 'auth', 'authorization', 'oauth',
  'signature', 'sig', 'cookie', 'dsn', 'privatekey', 'secretkey', 'accesskey',
];

// Words that make a trailing "key" a credential.
export const KEY_QUALIFIERS = [
  'api', 'private', 'access', 'secret', 'account', 'subscription', 'master',
  'signing', 'encryption', 'license', 'client', 'functions', 'auth', 'app',
  'service', 'storage', 'admin',
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
  if (SECRET_WORDS.includes(last)) return true;
  if (last === 'key') return anyKey || w.length === 1 || KEY_QUALIFIERS.includes(w.at(-2));
  return false;
}
