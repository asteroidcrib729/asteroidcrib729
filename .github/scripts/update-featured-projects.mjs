import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubRequest, username } from './generate-metrics.mjs';

export const START = '<!-- FEATURED-PROJECTS:START -->';
export const END = '<!-- FEATURED-PROJECTS:END -->';

const query = `query($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      totalCount
      pageInfo { hasNextPage }
      nodes {
        ... on Repository { name url description isPrivate }
      }
    }
  }
}`;

export async function collectPinnedRepositories(request = githubRequest) {
  const response = await request(query, { login: username });
  if (response.errors?.length)
    throw new Error('GitHub returned errors; retaining Featured Projects');
  const pins = response.data?.user?.pinnedItems;
  if (
    !pins ||
    !Array.isArray(pins.nodes) ||
    !Number.isSafeInteger(pins.totalCount) ||
    pins.totalCount !== pins.nodes.length ||
    pins.nodes.length > 6 ||
    pins.pageInfo?.hasNextPage !== false
  ) {
    throw new Error('Incomplete pinned repositories response; retaining Featured Projects');
  }
  const seen = new Set();
  return pins.nodes.map((repo) => {
    if (
      !repo ||
      repo.isPrivate !== false ||
      typeof repo.name !== 'string' ||
      !repo.name ||
      !(repo.description === null || typeof repo.description === 'string') ||
      typeof repo.url !== 'string' ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.url) ||
      seen.has(repo.url)
    ) {
      throw new Error('Invalid pinned repository metadata; retaining Featured Projects');
    }
    seen.add(repo.url);
    // Retain GitHub's pin order and description verbatim in the data model.
    return { name: repo.name, url: repo.url, description: repo.description };
  });
}

// Render metadata as literal text inside Markdown table cells. Escaping changes
// only markup, not the displayed wording. Missing descriptions stay blank.
const cell = (value) =>
  (value ?? '')
    .replace(
      /[&<>|[\]`*_\\~]/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '|': '&#124;',
          '[': '&#91;',
          ']': '&#93;',
          '`': '&#96;',
          '*': '&#42;',
          _: '&#95;',
          '\\': '&#92;',
          '~': '&#126;',
        })[char],
    )
    .replace(/[\r\n\t]+/g, ' ');

export function renderProjectsTable(projects) {
  return [
    '| Project | Description |',
    '| :--- | :--- |',
    ...projects.map(
      (repo) => `| **[${cell(repo.name)}](${repo.url})** | ${cell(repo.description)} |`,
    ),
  ].join('\n');
}

function blockBounds(readme) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (
    start < 0 ||
    end < start + START.length ||
    readme.indexOf(START, start + START.length) !== -1 ||
    readme.indexOf(END, end + END.length) !== -1
  ) {
    throw new Error('Featured Projects markers must appear exactly once and in order');
  }
  return { start, end };
}

export function replaceFeaturedProjects(readme, projects) {
  const { start, end } = blockBounds(readme);
  const newline = readme.includes('\r\n') ? '\r\n' : '\n';
  const table = renderProjectsTable(projects).replaceAll('\n', newline);
  return (
    readme.slice(0, start + START.length) +
    newline +
    newline +
    table +
    newline +
    newline +
    readme.slice(end)
  );
}

export async function updateFeaturedProjects(readmePath = 'README.md', request = githubRequest) {
  const original = await readFile(readmePath, 'utf8');
  blockBounds(original);
  // Finish the API request and validate all metadata before changing the README.
  const projects = await collectPinnedRepositories(request);
  const updated = replaceFeaturedProjects(original, projects);
  const changed = updated !== original;
  if (changed) await writeFile(readmePath, updated, 'utf8');
  console.log(
    `Featured Projects: ${projects.length} pinned repositories; ${changed ? 'updated' : 'unchanged'}`,
  );
  return { projects, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await updateFeaturedProjects(process.argv[2]);
}
