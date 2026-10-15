import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_TO_ID, RESOURCE_ID, createAjv } from '../src/index.mjs';
import { BASE_ID, loadSchemas } from '../src/validator.mjs';

const schemas = loadSchemas();
const ajv = createAjv();

// Object subschemas that are intentionally free-form (ADR-0004).
const FREE_FORM_EXEMPT = new Set([
  'tool.schema.json#/$defs/spec/properties/inputSchema', // a JSON Schema, not values
  'resource.schema.json#/properties/spec', // validated by the kind schema it dispatches to
]);

// Property names that must hold a secret reference rather than a value. The
// match is unanchored so plurals and suffixed forms (apiKeys, privateKeyPem,
// secretValue) are caught; NOT_SECRET lists the reviewed exceptions.
const SECRET_NAME = /(api_?keys?|tokens?|secrets?|passw(or)?ds?|credentials?|private_?keys?|connection|signing)/i;
const NOT_SECRET = new Set([
  'secretRef', // the reference itself
  'secretEnv', // map of name -> secretSource
  'maxTokens',
  'maxOutputTokens',
  'maxTokensPerRun',
  'tokenUrl', // OAuth endpoint, not a credential
]);
const SECRET_SOURCE_REFS = new Set([
  'common.schema.json#/$defs/secretSource',
  '#/$defs/secretSource',
]);

// if/then/else overlays only narrow an object that is already closed by its
// parent, so the structural checks below apply to the parent alone.
const inConditional = (ptr) => /\/(if|then|else)(\/|$)/.test(ptr);

/** Yields [pointer, subschema] for every subschema object in a schema. */
function* walk(node, pointer = '#') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* walk(item, `${pointer}/${i}`);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  yield [pointer, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const' || key === 'default' || key === 'enum') continue;
    yield* walk(value, `${pointer}/${key}`);
  }
}

for (const [file, schema] of Object.entries(schemas)) {
  test(`${file} declares draft 2020-12 and a canonical $id`, () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, BASE_ID + file);
  });

  test(`${file} compiles in strict mode`, () => {
    assert.ok(ajv.getSchema(schema.$id), `could not compile ${file}`);
  });

  test(`${file} closes every object that declares properties`, () => {
    for (const [ptr, sub] of walk(schema)) {
      if (sub.type === 'object' && sub.properties && !inConditional(ptr)) {
        assert.equal(sub.additionalProperties, false, `${file}${ptr} must set additionalProperties: false`);
      }
    }
  });

  test(`${file} has no undeclared free-form objects`, () => {
    for (const [ptr, sub] of walk(schema)) {
      if (sub.type !== 'object' || sub.properties || inConditional(ptr)) continue;
      const declaredMap = 'propertyNames' in sub;
      assert.ok(
        declaredMap || FREE_FORM_EXEMPT.has(`${file}${ptr}`),
        `${file}${ptr} is a free-form object; declare propertyNames or add it to the exemption list`,
      );
    }
  });

  test(`${file} types secret-named properties as secretSource`, () => {
    for (const [ptr, sub] of walk(schema)) {
      if (!sub.properties || inConditional(ptr)) continue;
      for (const [name, prop] of Object.entries(sub.properties)) {
        if (NOT_SECRET.has(name) || !SECRET_NAME.test(name)) continue;
        if (prop === false) continue; // forbidding a property is always allowed
        assert.ok(
          SECRET_SOURCE_REFS.has(prop.$ref),
          `${file}${ptr}/properties/${name} looks secret and must be a secretSource reference`,
        );
      }
    }
  });

  test(`${file} bounds every number so all runtimes can represent it`, () => {
    // ADR-0010: .NET binds integers to int/long and JS loses precision above 2^53.
    for (const [ptr, sub] of walk(schema)) {
      if (sub.type !== 'integer' && sub.type !== 'number') continue;
      assert.ok('maximum' in sub || 'exclusiveMaximum' in sub, `${file}${ptr} needs a maximum`);
      assert.ok(Math.abs(sub.maximum ?? sub.exclusiveMaximum) <= Number.MAX_SAFE_INTEGER, `${file}${ptr} maximum exceeds 2^53-1`);
    }
  });

  test(`${file} anchors patterns portably`, () => {
    // ADR-0010: `$` also matches before a trailing newline in Python and .NET,
    // so the end of input is written (?![\s\S]), which means the same everywhere.
    for (const [ptr, sub] of walk(schema)) {
      if (typeof sub.pattern !== 'string') continue;
      assert.ok(!/(^|[^\\])\$$/.test(sub.pattern), `${file}${ptr} ends with a bare $; use (?![\\s\\S])`);
    }
  });

  test(`${file} uses no dialect-specific regex format`, () => {
    // ADR-0010: format "regex" means ECMA-262 in Ajv and .NET Regex in JsonSchema.Net.
    for (const [ptr, sub] of walk(schema)) {
      assert.notEqual(sub.format, 'regex', `${file}${ptr} uses format: regex; use common safeRegex`);
    }
  });
}

test('every kind has a schema whose kind const matches', () => {
  const resource = schemas['resource.schema.json'];
  assert.deepEqual(Object.keys(KIND_TO_ID).sort(), [...resource.properties.kind.enum].sort());
  for (const [kind, id] of Object.entries(KIND_TO_ID)) {
    const file = id.slice(BASE_ID.length);
    assert.ok(schemas[file], `missing ${file}`);
    assert.equal(schemas[file].properties.kind.const, kind);
  }
});

test('resource envelope dispatches to every kind schema', () => {
  const targets = schemas['resource.schema.json'].allOf.map((c) => c.then.$ref).sort();
  const expected = Object.values(KIND_TO_ID).map((id) => id.slice(BASE_ID.length)).sort();
  assert.deepEqual(targets, expected);
  assert.ok(ajv.getSchema(RESOURCE_ID));
});
