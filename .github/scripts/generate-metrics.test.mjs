import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectMetrics, generate, renderCards } from './generate-metrics.mjs';
import { calculateLegacyRank } from './calculate-rank.mjs';

function fixture({ next = false, languages = [{ size: 100, node: { name: 'Python' } }] } = {}) {
  return {
    data: {
      user: {
        followers: { totalCount: 1 },
        pullRequests: { totalCount: 51 },
        openIssues: { totalCount: 0 },
        closedIssues: { totalCount: 0 },
        repositoriesContributedTo: { totalCount: 1 },
        ownedPublicRepositories: { totalCount: 15 },
        contributionsCollection: {
          totalCommitContributions: 598,
          totalPullRequestContributions: 51,
          totalIssueContributions: 0,
          totalPullRequestReviewContributions: 0,
          totalRepositoryContributions: 9,
          totalRepositoriesWithContributedCommits: 12,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 658 },
        },
        repositories: {
          pageInfo: { hasNextPage: next, endCursor: next ? 'page-2' : null },
          nodes: [
            {
              stargazerCount: 1,
              languages: { pageInfo: { hasNextPage: false }, edges: languages },
            },
          ],
        },
      },
    },
  };
}

test('uses a UTC calendar year, including the January rollover', async () => {
  for (const [instant, year] of [
    ['2026-12-31T23:59:59Z', 2026],
    ['2027-01-01T00:00:00Z', 2027],
  ]) {
    const metrics = await collectMetrics(async (query, variables) => {
      assert.match(query, /privacy: PUBLIC, isFork: false/);
      assert.equal(variables.from, `${year}-01-01T00:00:00Z`);
      assert.equal(variables.to, new Date(instant).toISOString());
      return fixture();
    }, new Date(instant));
    assert.equal(metrics.year, year);
    assert.equal(metrics.activity.totalCommitContributions, 598);
    assert.equal(metrics.activity.contributionCalendar.totalContributions, 658);
  }
});

test('aggregates languages and stars across repository pages', async () => {
  let calls = 0;
  const metrics = await collectMetrics(async (_, variables) => {
    calls += 1;
    assert.equal(variables.after, calls === 1 ? null : 'page-2');
    return fixture({ next: calls === 1 });
  });
  assert.equal(calls, 2);
  assert.equal(metrics.repositories, 2);
  assert.equal(metrics.stars, 2);
  assert.equal(metrics.rank.inputs.stargazers, 2);
  assert.deepEqual(metrics.languages, [{ name: 'Python', bytes: 200 }]);
});

test('preserves the upstream legacy ranking reference result', () => {
  const rank = calculateLegacyRank({
    totalCommits: 100,
    totalRepos: 5,
    followers: 100,
    contributions: 61,
    stargazers: 400,
    prs: 300,
    issues: 200,
  });
  assert.equal(rank.level, 'A+');
  assert.ok(Math.abs(rank.score - 49.25629684876535) < 1e-12);
  assert.throws(() => calculateLegacyRank({ totalCommits: NaN }), /Invalid legacy rank input/);
});

test('uses corrected calendar-year commits for a calculated rank and ring', async () => {
  const metrics = await collectMetrics(async () => fixture());
  assert.equal(metrics.rank.inputs.totalCommits, 598);
  assert.equal(metrics.rank.level, 'A+');
  const { stats } = renderCards(metrics);
  assert.match(stats, />A\+</);
  assert.match(stats, /Legacy rank/);
  const progress = 100 - metrics.rank.score;
  assert.match(stats, new RegExp(`stroke-dasharray="${progress.toFixed(4)} 100"`));
  assert.doesNotMatch(stats, /NaN|Infinity/);
  const changed = fixture();
  changed.data.user.contributionsCollection.totalCommitContributions = 5000;
  const updated = await collectMetrics(async () => changed);
  assert.ok(updated.rank.score < metrics.rank.score);
  assert.notEqual(renderCards(updated).stats, stats);
  const incomplete = fixture();
  delete incomplete.data.user.followers;
  await assert.rejects(
    collectMetrics(async () => incomplete),
    /Invalid legacy rank input/,
  );
});

test('does not normalize the top five against only their own byte counts', async () => {
  const metrics = await collectMetrics(async () =>
    fixture({
      languages: Array.from({ length: 6 }, (_, i) => ({ size: 100, node: { name: `Lang${i}` } })),
    }),
  );
  const { languages } = renderCards(metrics);
  assert.match(languages, />Other</);
  assert.equal((languages.match(/16\.67%/g) || []).length, 6);
});

test('escapes language names in SVG and handles an account without code', async () => {
  const metrics = await collectMetrics(async () =>
    fixture({ languages: [{ size: 1, node: { name: 'A&B<script>' } }] }),
  );
  const cards = renderCards(metrics);
  assert.match(cards.languages, /A&amp;B&lt;script&gt;/);
  assert.doesNotMatch(cards.languages, /<script>/);
  metrics.languages = [];
  assert.match(renderCards(metrics).languages, /No language bytes detected/);
  assert.doesNotMatch(renderCards(metrics).languages, /NaN|Infinity/);
});

test('rejects API errors, incomplete data, private counts, and truncated language data', async () => {
  await assert.rejects(
    collectMetrics(async () => ({ errors: [{ message: 'rate limited' }] })),
    /GraphQL/,
  );
  await assert.rejects(
    collectMetrics(async () => ({ data: { user: null } })),
    /Incomplete/,
  );
  const privateData = fixture();
  privateData.data.user.contributionsCollection.restrictedContributionsCount = 1;
  await assert.rejects(
    collectMetrics(async () => privateData),
    /Restricted/,
  );
  const truncated = fixture();
  truncated.data.user.repositories.nodes[0].languages.pageInfo.hasNextPage = true;
  await assert.rejects(
    collectMetrics(async () => truncated),
    /truncated/,
  );
  await assert.rejects(
    collectMetrics(async () => fixture({ next: true })),
    /pagination/,
  );
  const malformed = fixture();
  malformed.data.user.contributionsCollection.totalCommitContributions = null;
  await assert.rejects(
    collectMetrics(async () => malformed),
    /Invalid metric/,
  );
});

test('preserves the previous snapshot when GitHub fails on a later page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-metrics-'));
  try {
    const path = join(directory, 'github-stats.svg');
    await writeFile(path, 'previous snapshot');
    let calls = 0;
    await assert.rejects(
      generate(directory, async () => {
        if (++calls === 1) return fixture({ next: true });
        throw new Error('network failure');
      }),
      /network failure/,
    );
    assert.equal(await readFile(path, 'utf8'), 'previous snapshot');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
