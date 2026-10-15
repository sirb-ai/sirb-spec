import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../scripts/gen-secret-patterns.mjs';
import { isSecretName } from '../src/secret-names.mjs';
import { ROOT } from './helpers/paths.mjs';

const common = JSON.parse(readFileSync(join(ROOT, 'schema', 'v1alpha1', 'common.schema.json'), 'utf8')).$defs;
const workflow = JSON.parse(readFileSync(join(ROOT, 'schema', 'v1alpha1', 'workflow.schema.json'), 'utf8')).$defs;
const generated = generate();

test('schema name patterns match scripts/gen-secret-patterns.mjs (run it with --write)', () => {
  for (const [def, pattern] of Object.entries(generated)) assert.equal(common[def].pattern, pattern, def);
  assert.deepEqual(Object.keys(workflow.valueMap.patternProperties), [generated.keyNamePattern]);
});

// The schema regexes and the loader's isSecretName must agree on every case.
const CASES = {
  headerNamePattern: { anyKey: true, yes: ['authorization', 'x-api-key', 'x-auth', 'ocp-apim-subscription-key', 'x-functions-key', 'cookie', 'set-cookie', 'x-amz-security-token', 'key'], no: ['x-session-id', 'x-request-id', 'keep-alive', 'x-keycloak-realm', 'x-token-count', 'x-author'] },
  envNamePattern: { anyKey: true, yes: ['OPENAI_API_KEY', 'OPENAI_KEY', 'GH_OAUTH', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'APIKEY', 'DATABASE_DSN', 'STRIPE_KEY'], no: ['KEYBOARD_LAYOUT', 'AUTHOR_NAME', 'TOKENIZERS_PARALLELISM', 'GITHUB_TOKEN_FILE', 'AUTH_MODE', 'MONKEY', 'CACHE_KEY_PREFIX'] },
  keyNamePattern: { anyKey: false, yes: ['apiKey', 'api_key', 'token', 'accessToken', 'clientSecret', 'password', 'dbPassword', 'privateKey', 'authToken', 'sig', 'auth'], no: ['tokenCount', 'maxTokens', 'authorName', 'partitionKey', 'idempotencyKey', 'secretName', 'tokenUrl', 'cacheKey', 'keyword'] },
};

for (const [def, { anyKey, yes, no }] of Object.entries(CASES)) {
  test(`${def} and isSecretName agree`, () => {
    const re = new RegExp(common[def].pattern, 'u');
    for (const n of yes) {
      assert.ok(re.test(n), `${def} misses ${n}`);
      assert.ok(isSecretName(n, { anyKey }), `isSecretName misses ${n}`);
    }
    for (const n of no) {
      assert.ok(!re.test(n), `${def} flags ${n}`);
      assert.ok(!isSecretName(n, { anyKey }), `isSecretName flags ${n}`);
    }
  });
}

test('credentialQueryPattern uses whole parameter-name words', () => {
  const re = new RegExp(common.credentialQueryPattern.pattern, 'u');
  for (const u of ['?api_key=1', '?apiKey=1', '?a=1&access_token=2', '?X-Amz-Signature=1', '?sig=1', '?client_secret=1']) assert.ok(re.test(`https://x.example/${u}`), u);
  for (const u of ['?country_code=US', '?author=me', '?keyword=foo', '?tokens=5', '?code=abc']) assert.ok(!re.test(`https://x.example/${u}`), u);
});
