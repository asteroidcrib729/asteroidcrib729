import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

const expected = {
  GIT_AUTHOR_NAME: 'Faraz Hussain',
  GIT_AUTHOR_EMAIL: 'farazhussain5000@gmail.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
};
const workflows = Object.fromEntries(
  ['snake', 'metrics', 'validate', 'prettier'].map((name) => [
    name,
    readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), 'utf8').replaceAll(
      '\r\n',
      '\n',
    ),
  ]),
);

function workflowIdentity(source) {
  // These workflows deliberately declare four simple scalars at workflow scope.
  const block = source.match(/^env:\n((?:[ \t]+[^\n]*\n)+)/m)?.[1];
  assert.ok(block, 'Workflow must declare its Git identity at workflow scope');
  return Object.fromEntries(
    [...block.matchAll(/^  (GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL)): (.+)$/gm)].map(
      ([, key, value]) => [key, value],
    ),
  );
}

for (const [name, source] of Object.entries(workflows)) {
  test(`${name} workflow commits credit the owner and record the bot as committer`, async () => {
    const identity = workflowIdentity(source);
    assert.deepEqual(identity, expected);
    const directory = await mkdtemp(join(tmpdir(), 'profile-attribution-'));
    const git = (args) =>
      execFileSync(
        'git',
        [
          '-c',
          'commit.gpgsign=false',
          '-c',
          `core.hooksPath=${join(directory, 'no-hooks')}`,
          ...args,
        ],
        {
          cwd: directory,
          env: { ...process.env, ...identity },
          encoding: 'utf8',
        },
      ).trim();
    try {
      git(['init', '--quiet', '--initial-branch=main']);
      git([
        '-c',
        'user.name=Different Bot',
        '-c',
        'user.email=different-bot@example.com',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'Verify workflow attribution',
      ]);
      assert.deepEqual(
        git(['log', '-1', '--format=%an%n%ae%n%cn%n%ce']).split(/\r?\n/),
        Object.values(expected),
      );
    } finally {
      // Only remove the exact task-owned temporary repository created above.
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('profile-attribution-'));
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('both asset publishers use the default branch and serialize pushes', () => {
  for (const name of ['snake', 'metrics']) {
    assert.match(workflows[name], /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflows[name], /git push origin HEAD:main/);
    assert.match(workflows[name], /group: profile-generated-assets/);
    assert.match(workflows[name], /cancel-in-progress: false/);
    assert.match(workflows[name], /with:\n          ref: main/);
    assert.match(workflows[name], /if ! git diff --cached --quiet;/);
    assert.doesNotMatch(workflows[name], /--allow-empty|target_branch: gh-pages/);
  }
  assert.match(workflows.snake, /cp dist\/github-contribution-grid-snake\.svg assets\//);
  assert.match(workflows.snake, /cp dist\/github-contribution-grid-snake-dark\.svg assets\//);
});

test('validation remains read-only and runs the attribution checks', () => {
  assert.match(workflows.validate, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflows.validate, /contents: write|git commit|git push/);
  assert.match(workflows.validate, /node --test \.github\/scripts\/\*\.test\.mjs/);
});

test('the metrics workflow publishes the generated pins block alongside its snapshots', () => {
  const source = workflows.metrics;
  const sync = source.indexOf('node .github/scripts/update-featured-projects.mjs');
  const staging = source.indexOf(
    'git add -- README.md assets/github-stats.svg assets/github-languages.svg assets/github-metrics.json',
  );
  assert.ok(sync >= 0 && staging > sync);
  assert.match(source.slice(sync, staging), /Lint generated README/);
});

test('Prettier commits are limited to manual runs on main with serialized pushes', () => {
  const source = workflows.prettier;
  assert.match(source, /permissions:\n  contents: read/);
  const formatJob = source.slice(source.indexOf('\n  format:\n'));
  assert.match(
    formatJob,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.write && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(formatJob, /contents: write/);
  assert.match(formatJob, /group: profile-generated-assets/);
  assert.match(formatJob, /with:\n          ref: main/);
  assert.match(formatJob, /git add --update/);
  assert.match(formatJob, /git push origin HEAD:main/);
  assert.ok(formatJob.indexOf('npm run format:check') < formatJob.indexOf('git add --update'));
  assert.ok(formatJob.indexOf('npm test') < formatJob.indexOf('git add --update'));
  assert.doesNotMatch(source, /pull_request_target/);
});
