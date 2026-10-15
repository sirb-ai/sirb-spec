import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import YAML from 'yaml';
import { validateDocument } from './validator.mjs';
import { scanSecrets } from './secrets.mjs';

export const DEFAULT_LIMITS = { maxBytes: 1024 * 1024, maxDocuments: 100 };

/** Thrown by loadOrThrow; `issues` holds every problem found. */
export class SirbLoadError extends Error {
  constructor(issues, filename) {
    const where = filename ? `${filename}: ` : '';
    super(`${where}${issues.length} issue(s); first: [${issues[0].code}] ${issues[0].instancePath ?? ''} ${issues[0].message}`);
    this.name = 'SirbLoadError';
    this.issues = issues;
  }
}

export function formatFromFilename(filename) {
  const ext = extname(filename ?? '').toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  return undefined;
}

const issue = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * Rejects YAML features that have no JSON equivalent or that let a document
 * say one thing to a reviewer and another to a parser: anchors and aliases
 * (also the "billion laughs" expansion), merge keys, explicit tags and
 * non-string keys.
 */
function structuralIssues(doc, index) {
  const issues = [];
  YAML.visit(doc, {
    Alias() {
      issues.push(issue('yaml-alias', 'aliases are not allowed', { document: index }));
    },
    Node(_, node) {
      if (node.anchor) issues.push(issue('yaml-alias', `anchors are not allowed (&${node.anchor})`, { document: index }));
      // Parsed nodes carry a tag only when the source wrote one explicitly.
      if (node.tag) issues.push(issue('yaml-tag', `explicit tags are not allowed (${node.tag})`, { document: index }));
    },
    Pair(_, pair) {
      const key = pair.key;
      if (YAML.isScalar(key) && key.value === '<<') {
        issues.push(issue('yaml-merge-key', 'merge keys (<<) are not allowed', { document: index }));
      } else if (!YAML.isScalar(key) || typeof key.value !== 'string') {
        issues.push(issue('non-string-key', 'mapping keys must be strings', { document: index }));
      }
    },
  });
  return issues;
}

/**
 * Parses a YAML 1.2 (core schema) or JSON text into documents without
 * validating them. YAML 1.2 is used so `on`, `yes` and `no` stay strings.
 * Returns { documents, issues }.
 */
export function parse(text, { format = 'yaml', maxBytes = DEFAULT_LIMITS.maxBytes, maxDocuments = DEFAULT_LIMITS.maxDocuments } = {}) {
  if (format !== 'yaml' && format !== 'json') throw new TypeError(`unsupported format: ${format}`);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { documents: [], issues: [issue('too-large', `input exceeds ${maxBytes} bytes`)] };
  }
  if (format === 'json') {
    try {
      JSON.parse(text);
    } catch (e) {
      return { documents: [], issues: [issue('syntax', e.message)] };
    }
  }

  const docs = YAML.parseAllDocuments(text, { version: '1.2', schema: 'core', uniqueKeys: true, merge: false, strict: true });
  const list = Array.isArray(docs) ? docs : [];
  const issues = [];
  if (list.length > maxDocuments) {
    return { documents: [], issues: [issue('too-many-documents', `stream has ${list.length} documents; limit is ${maxDocuments}`)] };
  }

  const documents = [];
  list.forEach((doc, index) => {
    const docIssues = [];
    for (const e of [...doc.errors, ...doc.warnings]) {
      const code = e.code === 'DUPLICATE_KEY' ? 'duplicate-key' : e.code === 'TAG_RESOLVE_FAILED' ? 'yaml-tag' : 'syntax';
      docIssues.push(issue(code, e.message.split('\n')[0], { document: index }));
    }
    if (doc.errors.length === 0) docIssues.push(...structuralIssues(doc, index));
    issues.push(...docIssues);
    // Never resolve a document that has issues: toJS would expand aliases.
    documents.push(docIssues.length ? undefined : doc.toJS({ maxAliasCount: 0 }));
  });
  if (list.length === 0) issues.push(issue('empty', 'no documents found'));
  return { documents, issues };
}

/**
 * The reference loader: parse, validate every document against its kind
 * schema, then scan for literal secrets. A result is valid only when there
 * are no issues at all.
 */
export function load(text, options = {}) {
  const format = options.format ?? formatFromFilename(options.filename) ?? 'yaml';
  const { documents, issues } = parse(text, { ...options, format });
  if (issues.length === 0) {
    documents.forEach((document, index) => {
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        issues.push(issue('not-an-object', 'each document must be a mapping', { document: index }));
        return;
      }
      for (const i of validateDocument(document)) issues.push({ ...i, document: index });
      for (const i of scanSecrets(document)) issues.push({ ...i, document: index });
    });
  }
  return { valid: issues.length === 0, documents: issues.length === 0 ? documents : [], issues };
}

export function loadOrThrow(text, options = {}) {
  const result = load(text, options);
  if (!result.valid) throw new SirbLoadError(result.issues, options.filename);
  return result.documents;
}

export async function loadFile(path, options = {}) {
  return load(await readFile(path, 'utf8'), { filename: path, ...options });
}
