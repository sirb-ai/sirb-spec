// Builds the schema regexes that recognise secret names from the word lists in
// src/secret-names.mjs. test/secret-names.test.mjs fails if the patterns in the
// schemas drift from this output.
//
//   node scripts/gen-secret-patterns.mjs         # print
//   node scripts/gen-secret-patterns.mjs --write # update common.schema.json
//
// Lookbehinds are single, fixed-width words, so ECMAScript, .NET and Python
// all accept them.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECRET_WORDS, KEY_QUALIFIERS, NON_SECRET_KEY_QUALIFIERS, NOT_ALONE, IDENTIFIER_WORDS } from '../src/secret-names.mjs';

const END = '(?![\\s\\S])';
const ci = (s) => s.replace(/[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`);
const cap = (s) => s.replace(/^\[([A-Z])[a-z]\]/, '$1'); // first letter upper-case only
const alt = (xs) => `(${xs.join('|')})`;

// Multi-word secret words may be written api_key / apiKey / API-KEY.
const SPLITS = { apikey: ['api', 'key'], privatekey: ['private', 'key'], secretkey: ['secret', 'key'], accesskey: ['access', 'key'] };

const STYLES = {
  kebab: { sep: '-', start: '(^|-)', word: (w) => w },
  snake: { sep: '_', start: '(^|_)', word: (w) => w.toUpperCase() },
  mixed: { sep: '[_.-]?', start: '(^|[_.-])', word: ci },
};

/** Whole-name pattern: the name's last word is a secret word (src/secret-names.mjs). */
export function namePattern(style) {
  const { sep, start, word } = STYLES[style];
  const fixedSep = style === 'mixed' ? '[_.-]' : sep;
  const spell = (w) => (SPLITS[w] && style === 'mixed' ? SPLITS[w].map(word).join(sep) : word(w));
  const anywhere = SECRET_WORDS.filter((w) => !NOT_ALONE.includes(w)).map(spell);
  const notAlone = NOT_ALONE.map(spell);
  const key = word('key');
  const branches = [`${start}${alt(anywhere)}${END}`, `.${fixedSep}${alt(notAlone)}${END}`, `^${key}${END}`];
  if (style === 'mixed') {
    // Data keys: "key" counts only after a credential qualifier. camelCase
    // word boundaries are a lower-case letter or digit before an upper-case one.
    const qualified = `${alt(KEY_QUALIFIERS.map(word))}${sep}${key}`;
    branches.push(`${start}${qualified}${END}`);
    branches.push(`[a-z0-9]${alt(anywhere.map(cap))}${END}`, `[a-z0-9]${alt(notAlone.map(cap))}${END}`);
    branches.push(`[a-z0-9]${alt(KEY_QUALIFIERS.map((w) => cap(word(w))))}${sep}${key}${END}`);
  } else {
    // Env var and header names: any trailing "key" except after a known non-secret qualifier.
    const lookbehinds = NON_SECRET_KEY_QUALIFIERS.map((w) => `(?<!${word(w)})`).join('');
    branches.push(`${lookbehinds}${sep}${key}${END}`);
  }
  return branches.join('|');
}

/** URL query or fragment parameter whose name is a secret name. */
export function queryPattern() {
  const { sep, word } = STYLES.mixed;
  const words = SECRET_WORDS.map((w) => (SPLITS[w] ? SPLITS[w].map(word).join(sep) : word(w)));
  const qualified = `${alt(KEY_QUALIFIERS.map(word))}${sep}${word('key')}`;
  // A bare "key" counts only as the whole parameter name (?key=), like data keys.
  return `[?&#;](([^=&#;\\s]{0,64}[_.-])?${alt([...words, qualified])}|${word('key')})=`;
}

/** Header or env var name whose last word marks an identifier or digest. */
export function identifierNamePattern(style) {
  const { start, word } = STYLES[style];
  return `${start}${alt(IDENTIFIER_WORDS.map(word))}${END}`;
}

export function generate() {
  return {
    headerNamePattern: namePattern('kebab'),
    envNamePattern: namePattern('snake'),
    keyNamePattern: namePattern('mixed'),
    credentialQueryPattern: queryPattern(),
  };
}

export const identifierPatterns = () => ({ httpHeaders: identifierNamePattern('kebab'), envVars: identifierNamePattern('snake') });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = generate();
  if (process.argv.includes('--write')) {
    const common = fileURLToPath(new URL('../schema/v1alpha1/common.schema.json', import.meta.url));
    const schema = JSON.parse(readFileSync(common, 'utf8'));
    for (const [k, pattern] of Object.entries(out)) schema.$defs[k] = { ...schema.$defs[k], type: 'string', pattern };
    for (const [map, pattern] of Object.entries(identifierPatterns())) {
      schema.$defs[map].patternProperties = { [pattern]: { $ref: '#/$defs/identifierValue' } };
    }
    writeFileSync(common, JSON.stringify(schema, null, 2) + '\n');
    const wfPath = fileURLToPath(new URL('../schema/v1alpha1/workflow.schema.json', import.meta.url));
    const wf = JSON.parse(readFileSync(wfPath, 'utf8'));
    const [ref] = Object.values(wf.$defs.valueMap.patternProperties);
    wf.$defs.valueMap.patternProperties = { [out.keyNamePattern]: ref };
    writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
  }
  console.log(JSON.stringify(out, null, 2));
}
