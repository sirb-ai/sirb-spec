// Builds the schema regexes that recognise secret-named keys from the word
// lists in src/secret-names.mjs. test/secret-names.test.mjs fails if the
// patterns in common.schema.json drift from this output.
//
//   node scripts/gen-secret-patterns.mjs        # print
//   node scripts/gen-secret-patterns.mjs --write # update common.schema.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECRET_WORDS, KEY_QUALIFIERS } from '../src/secret-names.mjs';

const END = '(?![\\s\\S])';
const ci = (s) => s.replace(/[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`);
const alt = (xs) => `(${xs.join('|')})`;

// Multi-word secret words, e.g. "apikey", may be written api_key / apiKey / API-KEY.
const SPLITS = { apikey: ['api', 'key'], privatekey: ['private', 'key'], secretkey: ['secret', 'key'], accesskey: ['access', 'key'] };

function forms(style) {
  const sep = { kebab: '-', snake: '_', mixed: '[_.-]?' }[style];
  const word = (w) => (style === 'kebab' ? w : style === 'snake' ? w.toUpperCase() : ci(w));
  const join = (parts) => parts.map(word).join(sep);
  const single = SECRET_WORDS.map((w) => (SPLITS[w] && style !== 'kebab' && style !== 'snake' ? join(SPLITS[w]) : word(w)));
  // Env var and header names: any trailing KEY. Data keys: only a qualified one.
  const qualified = style === 'mixed' ? `${alt(KEY_QUALIFIERS.map(word))}${sep}${word('key')}` : word('key');
  return { single, qualified, key: word('key') };
}

/** Whole-key pattern: the key's last word is a secret word. */
export function namePattern(style) {
  const { single, qualified, key } = forms(style);
  const start = { kebab: '(^|-)', snake: '(^|_)', mixed: '(^|[_.-])' }[style];
  const branches = [`${start}${alt(single)}${END}`, `${start}${qualified}${END}`, `^${key}${END}`];
  if (style === 'mixed') {
    // camelCase: a word boundary is a lower-case letter or digit followed by an upper-case letter.
    const cap = (re) => re.replace(/^\[([A-Z])([a-z])\]/, '$1');
    branches.push(`[a-z0-9]${alt(single.map(cap))}${END}`, `[a-z0-9]${cap(qualified.slice(1)).replace(/^/, '(')}${END}`);
  }
  return branches.join('|');
}

/** URL query parameter whose name's last word is a secret word. */
export function queryPattern() {
  const { single, qualified } = forms('mixed');
  return `[?&]([^=&#\\s]{0,64}[_.-])?${alt([...single, qualified])}=`;
}

export function generate() {
  return {
    headerNamePattern: namePattern('kebab'),
    envNamePattern: namePattern('snake'),
    keyNamePattern: namePattern('mixed'),
    credentialQueryPattern: queryPattern(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = generate();
  if (process.argv.includes('--write')) {
    const path = fileURLToPath(new URL('../schema/v1alpha1/common.schema.json', import.meta.url));
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    for (const [k, pattern] of Object.entries(out)) schema.$defs[k] = { ...schema.$defs[k], type: 'string', pattern };
    writeFileSync(path, JSON.stringify(schema, null, 2) + '\n');
  }
  console.log(JSON.stringify(out, null, 2));
}
