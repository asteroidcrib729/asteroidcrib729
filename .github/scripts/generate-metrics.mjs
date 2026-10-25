import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { calculateLegacyRank } from './calculate-rank.mjs';

export const username = 'asteroidcrib729';

// Use only public repositories. Paginate rather than silently truncating at 100.
const query = `query($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    openIssues: issues(states: OPEN) { totalCount }
    closedIssues: issues(states: CLOSED) { totalCount }
    repositoriesContributedTo(contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }
    ownedPublicRepositories: repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions totalPullRequestContributions
      totalIssueContributions totalPullRequestReviewContributions
      totalRepositoryContributions totalRepositoriesWithContributedCommits
      restrictedContributionsCount contributionCalendar { totalContributions }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER,
      privacy: PUBLIC, isFork: false, orderBy: {field: NAME, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 100, orderBy: {field: SIZE, direction: DESC}) {
          pageInfo { hasNextPage }
          edges { size node { name } }
        }
      }
    }
  }
}`;

export async function githubRequest(document, variables) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  // Local use: let gh manage credentials; never print or persist the token.
  if (!token) {
    return JSON.parse(
      execFileSync('gh', ['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({ query: document, variables }),
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
    );
  }
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

export async function collectMetrics(request, now = new Date()) {
  const year = now.getUTCFullYear();
  const variables = {
    login: username,
    from: `${year}-01-01T00:00:00Z`,
    to: now.toISOString(),
    after: null,
  };
  const languages = new Map();
  const seenCursors = new Set();
  let activity;
  let rankInputs;
  let stars = 0;
  let repositories = 0;
  do {
    const response = await request(query, variables);
    if (response.errors?.length)
      throw new Error('GitHub GraphQL returned errors; retaining the previous snapshot');
    const user = response.data?.user;
    if (!user?.contributionsCollection || !user.repositories)
      throw new Error('Incomplete GitHub response');
    activity ??= user.contributionsCollection;
    rankInputs ??= {
      totalCommits: activity.totalCommitContributions,
      totalRepos: user.ownedPublicRepositories?.totalCount,
      contributions: user.repositoriesContributedTo?.totalCount,
      followers: user.followers?.totalCount,
      prs: user.pullRequests?.totalCount,
      issues: (user.openIssues?.totalCount ?? NaN) + (user.closedIssues?.totalCount ?? NaN),
    };
    // A personal local token must not accidentally publish restricted activity.
    if (activity.restrictedContributionsCount !== 0) {
      throw new Error(
        'Restricted activity detected; generate with the public-scoped Actions token',
      );
    }
    for (const repo of user.repositories.nodes) {
      if (repo.languages.pageInfo.hasNextPage)
        throw new Error('Repository language list was truncated');
      repositories += 1;
      stars += repo.stargazerCount;
      for (const { size, node } of repo.languages.edges) {
        languages.set(node.name, (languages.get(node.name) || 0) + size);
      }
    }
    const page = user.repositories.pageInfo;
    if (!page.hasNextPage) break;
    if (!page.endCursor || seenCursors.has(page.endCursor))
      throw new Error('Repository pagination did not advance');
    seenCursors.add(page.endCursor);
    variables.after = page.endCursor;
  } while (true);

  const counts = [
    activity.contributionCalendar?.totalContributions,
    activity.totalCommitContributions,
    activity.totalPullRequestContributions,
    activity.totalIssueContributions,
    activity.totalPullRequestReviewContributions,
    activity.totalRepositoryContributions,
    activity.totalRepositoriesWithContributedCommits,
    stars,
    ...languages.values(),
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid metric count; retaining the previous snapshot');
  }
  rankInputs.stargazers = stars;
  const rank = {
    method: 'GitHub Readme Stats legacy formula; calendar-year commits',
    source:
      'https://github.com/anuraghazra/github-readme-stats/blob/4b656ebabb8cb866d08bd010df29845372027018/src/calculateRank.js',
    inputs: rankInputs,
    ...calculateLegacyRank(rankInputs),
  };
  return {
    username,
    year,
    generatedAt: now.toISOString(),
    from: variables.from,
    to: variables.to,
    scope: 'Public activity; languages and stars from owned public non-fork repositories',
    activity,
    stars,
    repositories,
    rank,
    languages: [...languages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
  };
}

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  );
const colors = ['#7aa2f7', '#2ac3de', '#e0af68', '#bb9af7', '#9ece6a', '#64748b'];

function card(title, description, body, metrics, footnote) {
  const stamp = metrics.generatedAt.slice(0, 16).replace('T', ' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="284" viewBox="0 0 480 284" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title>
  <desc id="desc">${escape(description)}</desc>
  <rect width="480" height="284" rx="8" fill="#1a1b27"/>
  <g font-family="Segoe UI, Arial, sans-serif">
    <g transform="translate(0 -36)">${body}</g>
    <text x="240" y="247" text-anchor="middle" fill="#a9b1d6" font-size="11">${escape(footnote)}</text>
    <text x="240" y="267" text-anchor="middle" fill="#a9b1d6" font-size="11">Updated ${escape(stamp)} UTC · Refresh every 12 hours</text>
  </g>
</svg>
`;
}

export function renderCards(metrics) {
  const a = metrics.activity;
  const rows = [
    ['Total contributions', a.contributionCalendar.totalContributions],
    ['Commit contributions', a.totalCommitContributions],
    ['Pull request contributions', a.totalPullRequestContributions],
    [
      'Issue / review contributions',
      `${a.totalIssueContributions} / ${a.totalPullRequestReviewContributions}`,
    ],
    ['Repository creations', a.totalRepositoryContributions],
    ['Repositories with commits', a.totalRepositoriesWithContributedCommits],
    ['Stars (public non-forks, all time)', metrics.stars],
  ];
  const statsBody = rows
    .map(
      ([label, value], i) =>
        `<text x="24" y="${72 + i * 28}" fill="#a9b1d6" font-size="14">${escape(label)}</text>
    <text x="312" y="${72 + i * 28}" text-anchor="end" fill="#2ac3de" font-size="16" font-weight="600">${escape(value)}</text>`,
    )
    .join('\n    ');
  const progress = Math.max(0, Math.min(100, 100 - metrics.rank.score));
  const rankRing = `<g aria-label="Legacy rank ${escape(metrics.rank.level)}; ring fill ${progress.toFixed(2)} percent">
    <circle cx="402" cy="150" r="46" fill="none" stroke="#7aa2f7" stroke-opacity="0.2" stroke-width="6"/>
    <circle cx="402" cy="150" r="46" fill="none" stroke="#7aa2f7" stroke-width="6" stroke-linecap="round"
      pathLength="100" stroke-dasharray="${progress.toFixed(4)} 100" transform="rotate(-90 402 150)"/>
    <text x="402" y="160" text-anchor="middle" fill="#2ac3de" font-size="30" font-weight="700">${escape(metrics.rank.level)}</text>
    </g>`;

  const totalBytes = metrics.languages.reduce((sum, language) => sum + language.bytes, 0);
  const displayed = metrics.languages.slice(0, 5);
  if (metrics.languages.length > 5) {
    displayed.push({
      name: 'Other',
      bytes: metrics.languages.slice(5).reduce((sum, language) => sum + language.bytes, 0),
    });
  }
  let x = 24;
  const bars = displayed
    .map((language, i) => {
      const width = totalBytes ? (language.bytes / totalBytes) * 432 : 0;
      const bar = `<rect x="${x.toFixed(3)}" y="58" width="${width.toFixed(3)}" height="12" fill="${colors[i]}"/>`;
      x += width;
      return bar;
    })
    .join('\n    ');
  const labels = displayed
    .map(
      (language, i) =>
        `<circle cx="30" cy="${99 + i * 28}" r="5" fill="${colors[i]}"/>
    <text x="44" y="${104 + i * 28}" fill="#a9b1d6" font-size="14">${escape(language.name)}</text>
    <text x="448" y="${104 + i * 28}" text-anchor="end" fill="#2ac3de" font-size="14">${(totalBytes ? (language.bytes / totalBytes) * 100 : 0).toFixed(2)}%</text>`,
    )
    .join('\n    ');
  return {
    stats: card(
      `GitHub Activity · ${metrics.year}`,
      rows.map((row) => row.join(': ')).join('; ') +
        `; Legacy rank: ${metrics.rank.level}; rating ring, not a contribution streak`,
      statsBody + rankRing,
      metrics,
      'Public activity · UTC calendar year; stars are all time',
    ),
    languages: card(
      'Public Repository Languages',
      'Share of all detected language bytes; top five plus other.',
      totalBytes
        ? bars + labels
        : '<text x="24" y="100" fill="#a9b1d6">No language bytes detected</text>',
      metrics,
      `${metrics.repositories} owned public non-fork repos · All detected bytes`,
    ),
  };
}

export async function generate(
  outputDirectory = 'assets',
  request = githubRequest,
  now = new Date(),
) {
  // Fetch and validate everything before touching any generated files.
  const metrics = await collectMetrics(request, now);
  const cards = renderCards(metrics);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDirectory, 'github-stats.svg'), cards.stats),
    writeFile(resolve(outputDirectory, 'github-languages.svg'), cards.languages),
    writeFile(
      resolve(outputDirectory, 'github-metrics.json'),
      JSON.stringify(metrics, null, 2) + '\n',
    ),
  ]);
  console.log(
    `Generated public ${metrics.year} metrics for ${username}: ${metrics.activity.totalCommitContributions} commits, ${metrics.activity.contributionCalendar.totalContributions} contributions`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate(process.argv[2]);
}
