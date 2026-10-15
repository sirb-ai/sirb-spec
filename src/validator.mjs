import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const SCHEMA_DIR = fileURLToPath(new URL('../schema/v1alpha1/', import.meta.url));
export const API_VERSION = 'sirb/v1alpha1';
export const BASE_ID = 'https://sirb.ai/schemas/v1alpha1/';
export const RESOURCE_ID = `${BASE_ID}resource.schema.json`;
export const COMMON_ID = `${BASE_ID}common.schema.json`;

export const KIND_TO_ID = {
  Agent: `${BASE_ID}agent.schema.json`,
  Workflow: `${BASE_ID}workflow.schema.json`,
  Tool: `${BASE_ID}tool.schema.json`,
  Memory: `${BASE_ID}memory.schema.json`,
  KnowledgeBase: `${BASE_ID}knowledgebase.schema.json`,
  ModelBinding: `${BASE_ID}modelbinding.schema.json`,
  UIBinding: `${BASE_ID}uibinding.schema.json`,
  Policy: `${BASE_ID}policy.schema.json`,
};

/** Loads every schema file in schema/v1alpha1, keyed by file name. */
export function loadSchemas() {
  const schemas = {};
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
    schemas[file] = JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
  }
  return schemas;
}

/**
 * The reference validator configuration (ADR-0002). strictRequired is off
 * because conditional `then: { required: [...] }` blocks name properties
 * declared on the parent schema, which strict mode reports as unknown.
 * Format assertion is on and is required for conformance.
 */
export function createAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  for (const schema of Object.values(loadSchemas())) ajv.addSchema(schema);
  return ajv;
}

let shared;
function sharedAjv() {
  shared ??= createAjv();
  return shared;
}

/** Ajv names a failing `false` subschema "false schema"; the spec calls it "false". */
export function normalizeKeyword(keyword) {
  return keyword === 'false schema' ? 'false' : keyword;
}

function propertyOf(error) {
  const p = error.params ?? {};
  // Errors raised inside propertyNames carry the key on the error itself.
  return p.missingProperty ?? p.additionalProperty ?? p.propertyName ?? error.propertyName;
}

/**
 * Validates one parsed document against the schema for its kind (or the
 * resource envelope when the kind is unknown). Returns spec-level issues.
 */
export function validateDocument(document, ajv = sharedAjv()) {
  const id = KIND_TO_ID[document?.kind] ?? RESOURCE_ID;
  const validate = ajv.getSchema(id);
  if (validate(document)) return [];
  return validate.errors.map((e) => ({
    code: 'schema',
    instancePath: e.instancePath,
    keyword: normalizeKeyword(e.keyword),
    ...(propertyOf(e) !== undefined && { property: propertyOf(e) }),
    message: e.message,
  }));
}
