// Adapted from Anurag Hazra's GitHub Readme Stats (MIT).
// Source: https://github.com/anuraghazra/github-readme-stats/blob/4b656ebabb8cb866d08bd010df29845372027018/src/calculateRank.js
// Copyright (c) 2020 Anurag Hazra. See LICENSE.github-readme-stats.

const normalCdf = (mean, sigma, to) => {
  const z = (to - mean) / Math.sqrt(2 * sigma * sigma);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + (z < 0 ? -1 : 1) * erf);
};

// Preserve the historical weights and thresholds rather than changing the
// meaning of the legacy badge. This is a card-specific score, not a GitHub rank.
export function calculateLegacyRank({
  totalRepos,
  totalCommits,
  contributions,
  followers,
  prs,
  issues,
  stargazers,
}) {
  const values = [totalRepos, totalCommits, contributions, followers, prs, issues, stargazers];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid legacy rank input');
  }
  const score =
    (totalCommits * 1.65 +
      contributions * 1.65 +
      issues +
      stargazers * 0.75 +
      prs * 0.5 +
      followers * 0.45 +
      totalRepos) /
    100;
  // The original formula intentionally omits the commit weight from this sum.
  const normalizedScore =
    normalCdf(score, 1 + 25 + 45 + 60 + 100, 1.65 + 1 + 0.75 + 0.5 + 0.45 + 1) * 100;
  const level =
    normalizedScore < 1
      ? 'S+'
      : normalizedScore < 25
        ? 'S'
        : normalizedScore < 45
          ? 'A++'
          : normalizedScore < 60
            ? 'A+'
            : 'B+';
  return { level, score: normalizedScore };
}
