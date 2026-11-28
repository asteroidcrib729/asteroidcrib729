import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { pushWithRetry } from './push-with-retry.mjs';

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
    assert.match(workflows[name], /permissions:\n  contents: read/);
    assert.match(workflows[name], /runs-on: ubuntu-24\.04/);
    assert.match(workflows[name], /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflows[name], /node \.github\/scripts\/push-with-retry\.mjs origin HEAD:main/);
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
  assert.match(
    workflows.validate,
    /markdown-link-check@3\.15\.0 --config \.markdown-link-check\.json README\.md docs/,
  );
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
  assert.match(formatJob, /node \.github\/scripts\/push-with-retry\.mjs origin HEAD:main/);
  assert.ok(formatJob.indexOf('npm run format:check') < formatJob.indexOf('git add --update'));
  assert.ok(formatJob.indexOf('npm test') < formatJob.indexOf('git add --update'));
  assert.doesNotMatch(source, /pull_request_target/);
});

test('pushWithRetry retries transient network errors with exponential backoff', async () => {
  let attempts = 0;
  const delays = [];
  const usedAttempt = await pushWithRetry({
    maxAttempts: 4,
    baseDelayMs: 100,
    sleepFn: async (ms) => {
      delays.push(ms);
    },
    gitRunner: () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('Command failed');
        error.stderr =
          "fatal: unable to access 'https://github.com/example/repo/': Failed to connect to github.com port 443";
        throw error;
      }
      return '';
    },
  });
  assert.equal(usedAttempt, 3);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('pushWithRetry fails fast on permanent auth or permission errors', async () => {
  let attempts = 0;
  await assert.rejects(
    pushWithRetry({
      maxAttempts: 4,
      baseDelayMs: 100,
      sleepFn: async () => {
        throw new Error('Should not sleep on permanent failure');
      },
      gitRunner: () => {
        attempts += 1;
        const error = new Error('Command failed');
        error.stderr =
          'remote: Permission to example/repo.git denied to github-actions[bot].\nfatal: The requested URL returned error: 403';
        throw error;
      },
    }),
    /failed on attempt 1/,
  );
  assert.equal(attempts, 1);
});

test('pushWithRetry rebases and succeeds when remote main advances in a shallow clone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-push-retry-'));
  const remoteDir = join(root, 'remote.git');
  const seedDir = join(root, 'seed');
  const peerDir = join(root, 'peer');
  const botDir = join(root, 'bot');
  const gitIn = (cwd, args) =>
    execFileSync(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${join(root, 'no-hooks')}`,
        '-c',
        'user.name=Test User',
        '-c',
        'user.email=test@example.com',
        ...args,
      ],
      { cwd, encoding: 'utf8' },
    ).trim();

  try {
    gitIn(root, ['init', '--bare', '--initial-branch=main', remoteDir]);
    const remoteUrl = pathToFileURL(remoteDir).href;

    gitIn(root, ['clone', '--quiet', remoteUrl, seedDir]);
    gitIn(seedDir, ['checkout', '-B', 'main']);
    await writeFile(join(seedDir, 'README.md'), 'initial\n');
    await writeFile(join(seedDir, 'snake.svg'), '<svg>v1</svg>\n');
    gitIn(seedDir, ['add', '.']);
    gitIn(seedDir, ['commit', '-m', 'init']);
    gitIn(seedDir, ['push', '-u', 'origin', 'main']);

    // Simulate actions/checkout with fetch-depth=1 while a concurrent commit lands on main.
    gitIn(root, ['clone', '--quiet', '--depth=1', '--branch', 'main', remoteUrl, botDir]);
    gitIn(root, ['clone', '--quiet', '--branch', 'main', remoteUrl, peerDir]);
    await writeFile(join(peerDir, 'README.md'), 'concurrent update\n');
    gitIn(peerDir, ['add', 'README.md']);
    gitIn(peerDir, ['commit', '-m', 'concurrent readme update']);
    gitIn(peerDir, ['push', 'origin', 'main']);

    await writeFile(join(botDir, 'snake.svg'), '<svg>v2</svg>\n');
    gitIn(botDir, ['add', 'snake.svg']);
    gitIn(botDir, ['commit', '-m', 'chore: update contribution snake']);

    const attempt = await pushWithRetry({
      remote: 'origin',
      refspec: 'HEAD:main',
      cwd: botDir,
      baseDelayMs: 0,
    });
    assert.equal(attempt, 2);
    assert.match(
      gitIn(remoteDir, ['log', '-n', '2', '--oneline']),
      /chore: update contribution snake/,
    );
    assert.match(gitIn(remoteDir, ['show', 'main:README.md']), /concurrent update/);
    assert.match(gitIn(remoteDir, ['show', 'main:snake.svg']), /<svg>v2<\/svg>/);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('profile-push-retry-'));
    await rm(root, { recursive: true, force: true });
  }
});
