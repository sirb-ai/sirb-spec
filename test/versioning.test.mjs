import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers/paths.mjs';

// SR-SPEC-05: versioned with semver; breaking changes need a new apiVersion
// and a migration (ADR-0009, VERSIONING.md).
const SCHEMA_ROOT = join(ROOT, 'schema');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const frozen = JSON.parse(readFileSync(join(SCHEMA_ROOT, 'frozen.json'), 'utf8')).frozen;
const versionDirs = readdirSync(SCHEMA_ROOT).filter((d) => statSync(join(SCHEMA_ROOT, d)).isDirectory());
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Orders apiVersions: v1alpha1 < v1alpha2 < v1beta1 < v1 < v2alpha1. */
function versionKey(dir) {
  const [, major, stage = 'ga', n = '0'] = dir.match(/^v(\d+)(?:(alpha|beta)(\d+))?$/);
  return [Number(major), { alpha: 0, beta: 1, ga: 2 }[stage], Number(n)];
}
const isLater = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

test('package version is semver', () => {
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/);
});

test('package stays below 1.0.0 while only alpha apiVersions exist', () => {
  if (versionDirs.every((d) => d.includes('alpha'))) assert.ok(pkg.version.startsWith('0.'));
});

for (const dir of versionDirs) {
  test(`schema/${dir} is a valid apiVersion directory whose schemas declare sirb/${dir}`, () => {
    assert.match(dir, /^v[1-9][0-9]*((alpha|beta)[1-9][0-9]*)?$/);
    const common = JSON.parse(readFileSync(join(SCHEMA_ROOT, dir, 'common.schema.json'), 'utf8'));
    assert.equal(common.$defs.apiVersion.const, `sirb/${dir}`);
    for (const file of readdirSync(join(SCHEMA_ROOT, dir))) {
      const schema = JSON.parse(readFileSync(join(SCHEMA_ROOT, dir, file), 'utf8'));
      assert.ok(schema.$id.includes(`/schemas/${dir}/`), `${dir}/${file} $id must contain /schemas/${dir}/`);
    }
  });
}

test('alpha apiVersions are never frozen', () => {
  for (const dir of Object.keys(frozen)) assert.ok(!dir.includes('alpha'), `${dir} is alpha`);
});

for (const [dir, files] of Object.entries(frozen)) {
  test(`frozen schema/${dir} is unchanged`, () => {
    for (const [file, hash] of Object.entries(files)) {
      const path = join(SCHEMA_ROOT, dir, file);
      assert.ok(existsSync(path), `${dir}/${file} was removed from a frozen apiVersion`);
      assert.equal(sha256(path), hash, `${dir}/${file} changed; breaking changes need a new apiVersion`);
    }
    const extra = readdirSync(join(SCHEMA_ROOT, dir)).filter((f) => !(f in files));
    assert.deepEqual(extra, [], `files added to frozen schema/${dir}; add them in a new apiVersion`);
  });

  test(`frozen schema/${dir} has a migration to every later apiVersion`, () => {
    const later = versionDirs.filter((d) => isLater(d, dir));
    for (const to of later) {
      assert.ok(existsSync(join(ROOT, 'migrations', `${dir}-to-${to}.mjs`)), `missing migrations/${dir}-to-${to}.mjs`);
    }
  });
}

test('CHANGELOG has an entry for the package version', () => {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(`## ${pkg.version}`), `CHANGELOG.md has no "## ${pkg.version}" section`);
});
