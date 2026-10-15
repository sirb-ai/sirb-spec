import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import YAML from 'yaml';
import { validateDocument } from './validator.mjs';
import { scanSecrets, scanComments } from './secrets.mjs';
import { compilePolicyPattern } from './policy-regex.mjs';

// maxDepth counts nested mappings and sequences, including the document root.
export const DEFAULT_LIMITS = { maxBytes: 1024 * 1024, maxDocuments: 100, maxDepth: 64 };

/** Thrown by loadOrThrow only; `issues` holds every error found. */
export class SirbLoadError extends Error {
  constructor(issues, filename) {
    const where = filename ? `${filename}: ` : '';
    super(`${where}${issues.length} error(s); first: [${issues[0].code}] ${issues[0].instancePath ?? ''} ${issues[0].message}`);
    this.name = 'SirbLoadError';
    this.issues = issues;
  }
}

export function formatFromFilename(filename) {
  const ext = extname(typeof filename === 'string' ? filename : '').toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  return undefined;
}

const error = (code, message, extra = {}) => ({ code, severity: 'error', message, ...extra });
const isError = (i) => i.severity === 'error';

function toText(input) {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(input);
  return undefined;
}

/**
 * Upper bound on flow-collection nesting, found by scanning the raw text once
 * before parsing so that "[[[[..." cannot exhaust the parser. Brackets inside
 * quoted scalars and comments are ignored. A quote only opens a scalar at a
 * token boundary, so an apostrophe in plain text (don't) cannot switch the
 * count off.
 */
const QUOTE_OPENS_AFTER = new Set([undefined, ' ', '\t', '\n', '\r', '[', '{', ',', ':', '-', '?']);
function flowDepth(text) {
  let depth = 0;
  let max = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if ((c === '"' || c === "'") && QUOTE_OPENS_AFTER.has(text[i - 1])) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '[' || c === '{') max = Math.max(max, ++depth);
    else if ((c === ']' || c === '}') && depth > 0) depth--;
  }
  return max;
}

/**
 * Rejects YAML features that have no JSON equivalent or that let a document
 * say one thing to a reviewer and another to a parser: anchors and aliases
 * (also the "billion laughs" expansion), merge keys, explicit tags,
 * non-string keys and `__proto__` keys. Also enforces maxDepth. Iterative.
 */
/**
 * Collects every comment token from the parser's token stream (iteratively),
 * with its exact line and the index of the document it belongs to.
 */
function* recordComments(tokens, comments, lineCounter) {
  let document = -1;
  for (const token of tokens) {
    if (token.type === 'document') document++;
    const stack = [token];
    while (stack.length) {
      const t = stack.pop();
      if (Array.isArray(t)) {
        for (const x of t) if (x && typeof x === 'object') stack.push(x);
      } else if (t.type === 'comment') {
        comments.push({ text: t.source.slice(1), line: lineCounter.linePos(t.offset).line, document: Math.max(document, 0) });
      } else {
        for (const v of Object.values(t)) if (v && typeof v === 'object') stack.push(v);
      }
    }
    yield token;
  }
}

function structuralIssues(doc, index, maxDepth) {
  const issues = [];
  const at = { document: index };
  const stack = [{ node: doc.contents, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node) continue;
    if (YAML.isAlias(node)) {
      issues.push(error('yaml-alias', 'aliases are not allowed', at));
      continue;
    }
    if (node.anchor) issues.push(error('yaml-alias', `anchors are not allowed (&${node.anchor})`, at));
    // Parsed nodes carry a tag only when the source wrote one explicitly.
    if (node.tag) issues.push(error('yaml-tag', `explicit tags are not allowed (${node.tag})`, at));
    if (!YAML.isMap(node) && !YAML.isSeq(node)) continue;
    if (depth >= maxDepth) {
      issues.push(error('too-deep', `nesting exceeds ${maxDepth} levels`, at));
      continue;
    }
    // Duplicate keys are found here with a Set (linear); the yaml library's
    // own uniqueKeys check is quadratic in the number of keys.
    const seen = new Set();
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i];
      if (YAML.isPair(item)) {
        const key = item.key;
        if (YAML.isScalar(key) && key.value === '<<') issues.push(error('yaml-merge-key', 'merge keys (<<) are not allowed', at));
        else if (!YAML.isScalar(key) || typeof key.value !== 'string') issues.push(error('non-string-key', 'mapping keys must be strings', at));
        else if (key.value === '__proto__') issues.push(error('forbidden-key', '"__proto__" is not allowed as a key', at));
        else if (seen.has(key.value)) issues.push(error('duplicate-key', `duplicate key "${key.value.slice(0, 64)}"`, at));
        else seen.add(key.value);
        if (YAML.isNode(key) && !YAML.isScalar(key)) stack.push({ node: key, depth: depth + 1 });
        stack.push({ node: item.value, depth: depth + 1 });
      } else {
        stack.push({ node: item, depth: depth + 1 });
      }
    }
  }
  return issues;
}

/**
 * Parses YAML 1.2 (core schema) or JSON into documents without validating
 * them. YAML 1.2 is used so `on`, `yes` and `no` stay strings. Never throws.
 * Returns { documents, issues }.
 */
export function parse(input, options = {}) {
  try {
    return parseUnsafe(input, options);
  } catch (e) {
    return { documents: [], issues: [error('internal', `parser failure: ${e?.message ?? e}`)] };
  }
}

function parseUnsafe(input, { format = 'yaml', maxBytes = DEFAULT_LIMITS.maxBytes, maxDocuments = DEFAULT_LIMITS.maxDocuments, maxDepth = DEFAULT_LIMITS.maxDepth } = {}) {
  if (format !== 'yaml' && format !== 'json') return { documents: [], issues: [error('invalid-format', `unsupported format: ${String(format)}`)] };
  let text;
  try {
    text = toText(input);
  } catch {
    return { documents: [], issues: [error('invalid-input', 'input is not valid UTF-8')] };
  }
  if (text === undefined) return { documents: [], issues: [error('invalid-input', 'input must be a string or bytes')] };
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { documents: [], issues: [error('too-large', `input exceeds ${maxBytes} bytes`)] };
  if (flowDepth(text) > maxDepth) return { documents: [], issues: [error('too-deep', `nesting exceeds ${maxDepth} levels`)] };
  if (format === 'json') {
    try {
      JSON.parse(text);
    } catch (e) {
      return { documents: [], issues: [error('syntax', e.message)] };
    }
  }

  // parseAllDocuments, spelled out so comment tokens can be recorded on the way.
  const comments = [];
  const lineCounter = new YAML.LineCounter();
  const composer = new YAML.Composer({ version: '1.2', schema: 'core', uniqueKeys: false, merge: false, strict: true });
  const tokens = new YAML.Parser(lineCounter.addNewLine).parse(text);
  const list = Array.from(composer.compose(recordComments(tokens, comments, lineCounter), false, text.length));
  if (list.length > maxDocuments) {
    return { documents: [], issues: [error('too-many-documents', `stream has ${list.length} documents; limit is ${maxDocuments}`)] };
  }
  const issues = [];
  const documents = [];
  list.forEach((doc, index) => {
    const docIssues = [];
    for (const e of [...doc.errors, ...doc.warnings]) {
      const code = e.code === 'DUPLICATE_KEY' ? 'duplicate-key' : e.code === 'TAG_RESOLVE_FAILED' ? 'yaml-tag' : 'syntax';
      docIssues.push(error(code, e.message.split('\n')[0], { document: index }));
    }
    if (doc.errors.length === 0) docIssues.push(...structuralIssues(doc, index, maxDepth));
    issues.push(...docIssues);
    // Never resolve a document that has issues: toJS would expand aliases.
    documents.push(docIssues.length ? undefined : doc.toJS({ maxAliasCount: 0 }));
  });
  if (list.length === 0) issues.push(error('empty', 'no documents found'));
  return { documents, issues, comments };
}

/** Policy patterns must also compile in the linear-time engine (JSON Schema cannot check that). */
function policyPatternIssues(document, index) {
  if (document.kind !== 'Policy') return [];
  const issues = [];
  document.spec.rules.forEach((rule, r) => {
    (rule.match?.patterns ?? []).forEach((pattern, p) => {
      const compiled = compilePolicyPattern(pattern, { caseInsensitive: rule.match.caseInsensitive });
      if (!compiled.ok) issues.push(error('invalid-regex', compiled.reason, { document: index, instancePath: `/spec/rules/${r}/match/patterns/${p}` }));
    });
  });
  return issues;
}

/**
 * The reference loader: parse, validate every document against its kind
 * schema, then scan for literal secrets. Never throws: every problem is an
 * issue with a `severity`. A result is valid when no issue is an error;
 * warnings (possible secrets in free text) do not make it invalid.
 */
export function load(input, options = {}) {
  try {
    return loadUnsafe(input, options ?? {});
  } catch (e) {
    return { valid: false, documents: [], issues: [error('internal', `loader failure: ${e?.message ?? e}`)] };
  }
}

function loadUnsafe(input, options) {
  const format = options.format ?? formatFromFilename(options.filename) ?? 'yaml';
  const { documents, issues, comments = [] } = parse(input, { ...options, format });
  // Comments are scanned even when the document is invalid: a key in a
  // comment of a broken file is still a leak.
  issues.push(...scanComments(comments));
  if (issues.every((i) => i.severity !== 'error')) {
    documents.forEach((document, index) => {
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        issues.push(error('not-an-object', 'each document must be a mapping', { document: index }));
        return;
      }
      const schemaIssues = validateDocument(document);
      // A field already rejected by the schema needs no extra warning.
      const rejected = new Set(schemaIssues.map((i) => i.instancePath));
      for (const i of schemaIssues) issues.push({ ...i, document: index });
      for (const i of scanSecrets(document)) if (!(i.severity === 'warning' && rejected.has(i.instancePath))) issues.push({ ...i, document: index });
      if (schemaIssues.length === 0) issues.push(...policyPatternIssues(document, index));
    });
  }
  const valid = !issues.some(isError);
  return { valid, documents: valid ? documents : [], issues };
}

export function loadOrThrow(input, options = {}) {
  const result = load(input, options);
  if (!result.valid) throw new SirbLoadError(result.issues.filter(isError), options.filename);
  return result.documents;
}

/** Like load(), for a file path. Read failures are returned as an `io` issue. */
export async function loadFile(path, options = {}) {
  let input;
  try {
    input = await readFile(path);
  } catch (e) {
    return { valid: false, documents: [], issues: [error('io', `cannot read ${path}: ${e.code ?? e.message}`)] };
  }
  return load(input, { filename: path, ...options });
}
