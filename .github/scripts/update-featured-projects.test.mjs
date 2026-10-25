import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  START,
  END,
  collectPinnedRepositories,
  renderProjectsTable,
  replaceFeaturedProjects,
  updateFeaturedProjects,
} from './update-featured-projects.mjs';

const repo = (name, description = null) => ({
  name,
  description,
  url: `https://github.com/example/${name}`,
  isPrivate: false,
});
const response = (nodes) => ({
  data: {
    user: {
      pinnedItems: {
        nodes,
        totalCount: nodes.length,
        pageInfo: { hasNextPage: false },
      },
    },
  },
});
const document = (newline = '\n') =>
  [
    'Introduction stays unchanged.',
    START,
    '',
    '| Project | Description |',
    '| :--- | :--- |',
    '| Old project | Old description |',
    '',
    END,
    '',
    'Other sections stay unchanged.',
    '',
  ].join(newline);

test('collects only profile repository pins in API order with original descriptions', async () => {
  const nodes = [
    repo('second', 'Exact GitHub description.'),
    repo('first', 'Another description.'),
  ];
  const projects = await collectPinnedRepositories(async (query, variables) => {
    assert.match(query, /pinnedItems\(first: 6, types: REPOSITORY\)/);
    assert.equal(variables.login, 'asteroidcrib729');
    return response(nodes);
  });
  assert.deepEqual(
    projects,
    nodes.map(({ name, url, description }) => ({ name, url, description })),
  );
  const table = renderProjectsTable(projects);
  assert.ok(table.indexOf('[second]') < table.indexOf('[first]'));
  assert.ok(
    table.includes('**[second](https://github.com/example/second)** | Exact GitHub description.'),
  );
});

test('escapes table and HTML markup while keeping metadata wording and row structure', async () => {
  const description = 'A | B [docs](url) <img src=x> & `code` *stars* _value_ \\path\nNext line';
  const projects = await collectPinnedRepositories(async () =>
    response([repo('project_name', description)]),
  );
  assert.equal(projects[0].description, description);
  const table = renderProjectsTable(projects);
  assert.equal(table.split('\n').length, 3);
  assert.equal(table.split('\n')[2].split('|').length, 4);
  assert.ok(
    table.includes('A &#124; B &#91;docs&#93;(url) &lt;img src=x&gt; &amp; &#96;code&#96;'),
  );
  assert.ok(table.includes('&#42;stars&#42; &#95;value&#95; &#92;path Next line'));
  assert.doesNotMatch(table, /<img|\[docs\]/);
});

test('does not invent a description or substitute popular repositories for empty pins', async () => {
  const projects = await collectPinnedRepositories(async () => response([repo('no-description')]));
  assert.ok(renderProjectsTable(projects).endsWith('** |  |'));
  const empty = await collectPinnedRepositories(async () => response([]));
  assert.equal(renderProjectsTable(empty), '| Project | Description |\n| :--- | :--- |');
});

test('updates only the marked block, preserves LF and CRLF, and is idempotent', () => {
  for (const newline of ['\n', '\r\n']) {
    const original = document(newline);
    const projects = [repo('new-project', 'Description from GitHub.')];
    const updated = replaceFeaturedProjects(original, projects);
    assert.equal(
      updated.slice(0, updated.indexOf(START)),
      original.slice(0, original.indexOf(START)),
    );
    assert.equal(updated.slice(updated.indexOf(END)), original.slice(original.indexOf(END)));
    assert.doesNotMatch(updated, /Old project|Old description/);
    assert.ok(updated.includes('[new-project](https://github.com/example/new-project)'));
    assert.equal(replaceFeaturedProjects(updated, projects), updated);
    if (newline === '\r\n') assert.doesNotMatch(updated.replaceAll('\r\n', ''), /\n/);
  }
  for (const broken of [
    '',
    `${END}\n${START}`,
    `${START}\n${START}\n${END}`,
    `${START}\n${END}\n${END}`,
  ]) {
    assert.throws(() => replaceFeaturedProjects(broken, []), /markers/);
  }
});

test('rejects partial API results, private metadata, duplicate pins, and unsafe URLs', async () => {
  const partial = response([repo('project')]);
  partial.data.user.pinnedItems.totalCount = 2;
  const truncated = response([repo('project')]);
  truncated.data.user.pinnedItems.pageInfo.hasNextPage = true;
  for (const invalid of [
    { errors: [{ message: 'Rate limited' }] },
    { data: { user: null } },
    partial,
    truncated,
    response([null]),
    response([{ ...repo('project'), isPrivate: true }]),
    response([repo('project'), repo('project')]),
    response([{ ...repo('project'), url: 'javascript:alert(1)' }]),
    response([{ ...repo('project'), description: undefined }]),
  ]) {
    await assert.rejects(
      collectPinnedRepositories(async () => invalid),
      /retaining Featured Projects/,
    );
  }
});

test('updates the README from pin changes and preserves it on request or validation failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-pins-'));
  const path = join(directory, 'README.md');
  try {
    await writeFile(path, document());
    const first = await updateFeaturedProjects(path, async () =>
      response([repo('first', 'First description.')]),
    );
    assert.equal(first.changed, true);
    const same = await updateFeaturedProjects(path, async () =>
      response([repo('first', 'First description.')]),
    );
    assert.equal(same.changed, false);
    await updateFeaturedProjects(path, async () =>
      response([repo('replacement', 'Changed upstream description.')]),
    );
    const previous = await readFile(path, 'utf8');
    assert.doesNotMatch(previous, /\[first\]/);
    assert.ok(previous.includes('Changed upstream description.'));
    await assert.rejects(
      updateFeaturedProjects(path, async () => {
        throw new Error('Network failure');
      }),
      /Network failure/,
    );
    assert.equal(await readFile(path, 'utf8'), previous);
    await assert.rejects(
      updateFeaturedProjects(path, async () => ({ data: { user: null } })),
      /Incomplete/,
    );
    assert.equal(await readFile(path, 'utf8'), previous);
    await writeFile(path, 'README without markers');
    let requested = false;
    await assert.rejects(
      updateFeaturedProjects(path, async () => {
        requested = true;
        return response([]);
      }),
      /markers/,
    );
    assert.equal(requested, false);
    assert.equal(await readFile(path, 'utf8'), 'README without markers');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('profile-pins-'));
    await rm(directory, { recursive: true, force: true });
  }
});
