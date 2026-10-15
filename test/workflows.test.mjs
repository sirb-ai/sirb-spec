import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { ROOT } from './helpers/paths.mjs';

const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

const files = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
const parsed = files.map((file) => {
  const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
  return { file, text, workflow: YAML.parse(text, { version: '1.2' }) };
});

test('at least one workflow exists', () => {
  assert.ok(files.length > 0);
});

for (const { file, text, workflow } of parsed) {
  test(`${file} pins every action by full commit SHA with a version comment`, () => {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses || step.uses.startsWith('./')) continue;
        assert.match(step.uses, PINNED, `${file} job ${jobName} uses an unpinned action: ${step.uses}`);
        const line = text.split('\n').find((l) => l.includes(step.uses));
        assert.match(line, /#\s*v\d+\.\d+\.\d+\s*$/, `${file}: ${step.uses} needs a "# vX.Y.Z" comment for Dependabot`);
      }
      if (job.uses) assert.match(job.uses, PINNED, `${file} job ${jobName} calls an unpinned reusable workflow`);
    }
  });

  test(`${file} grants exactly contents: read and no job widens it`, () => {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      assert.equal(job.permissions, undefined, `${file} job ${jobName} must not declare its own permissions`);
    }
  });

  test(`${file} does not use pull_request_target`, () => {
    assert.ok(!('pull_request_target' in (workflow.on ?? {})));
  });
}
