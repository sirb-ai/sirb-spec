import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_ID, KIND_TO_ID, RESOURCE_ID, createAjv, loadSchemas } from './helpers/ajv.mjs';

const schemas = loadSchemas();
const ajv = createAjv();

// Object subschemas that are intentionally free-form (ADR-0004).
const FREE_FORM_EXEMPT = new Set([
  'tool.schema.json#/$defs/spec/properties/inputSchema', // a JSON Schema, not values
  'resource.schema.json#/properties/spec', // validated by the kind schema it dispatches to
]);

// Property names that must hold a secret reference rather than a value.
const SECRET_NAME = /(apikey|api_key|token|secret|password|passwd|credentials?|privatekey|connection)$/i;
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
        if (name === 'secretRef' || !SECRET_NAME.test(name)) continue;
        if (prop === false) continue; // forbidding a property is always allowed
        assert.ok(
          SECRET_SOURCE_REFS.has(prop.$ref),
          `${file}${ptr}/properties/${name} looks secret and must be a secretSource reference`,
        );
      }
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
