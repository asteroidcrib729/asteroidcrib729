import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('README local src and srcset assets exist and are valid SVGs', () => {
  const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
  const refs = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)]
    .map(([, target]) => target)
    .filter((target) => !/^https?:\/\//.test(target));

  assert.ok(refs.length >= 4, 'Expected local asset references in README.md');
  for (const relPath of refs) {
    const absPath = resolve(repoRoot, relPath);
    assert.ok(existsSync(absPath), `Missing local asset referenced by README.md: ${relPath}`);
    if (relPath.endsWith('.svg')) {
      const svg = readFileSync(absPath, 'utf8');
      assert.match(svg, /<svg\b[^>]*>/, `Invalid SVG header in ${relPath}`);
      assert.match(svg, /<\/svg>\s*$/, `Invalid SVG footer in ${relPath}`);
    }
  }
});

test('assets/github-metrics.json parses cleanly with expected fields', () => {
  const metrics = JSON.parse(readFileSync(resolve(repoRoot, 'assets/github-metrics.json'), 'utf8'));
  assert.equal(metrics.username, 'asteroidcrib729');
  assert.ok(Number.isSafeInteger(metrics.year));
  assert.ok(Number.isSafeInteger(metrics.activity?.contributionCalendar?.totalContributions));
  assert.ok(Array.isArray(metrics.languages));
});
