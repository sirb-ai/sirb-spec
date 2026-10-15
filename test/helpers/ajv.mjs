import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA_DIR = join(ROOT, 'schema', 'v1alpha1');
export const BASE_ID = 'https://sirb.ai/schemas/v1alpha1/';
export const RESOURCE_ID = `${BASE_ID}resource.schema.json`;

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

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Loads every schema file in schema/v1alpha1, keyed by file name. */
export function loadSchemas() {
  const schemas = {};
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
    schemas[file] = readJson(join(SCHEMA_DIR, file));
  }
  return schemas;
}

/**
 * The reference validator configuration (ADR-0002). strictRequired is off
 * because conditional `then: { required: [...] }` blocks name properties
 * declared on the parent schema, which strict mode reports as unknown.
 */
export function createAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  for (const schema of Object.values(loadSchemas())) ajv.addSchema(schema);
  return ajv;
}
