# Profile metrics audit

I checked all five originally tracked files, the live contribution calendar,
both hosted metric cards, the featured project sources, and recent workflow runs
on October 25, 2026. The figures below are a dated observation; the generated
cards and [JSON snapshot](../assets/github-metrics.json) contain their own timestamps.

## Why 616 commits did not match 658 contributions

I reproduced both screenshot values from the live endpoints. GitHub's explicit
2026 contribution collection returned:

| Metric                                 | Count |
| :------------------------------------- | ----: |
| Commit contributions                   |   598 |
| Pull request contributions             |    51 |
| Issue contributions                    |     0 |
| Pull request review contributions      |     0 |
| Repository creation contributions      |     9 |
| Total contributions                    |   658 |
| Repositories with commit contributions |    12 |

These are different units: **598 + 51 + 9 = 658**. GitHub documents
[which actions count as contributions](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference).
The profile's activity overview showed contributions across 14 repositories;
that includes contribution types beyond commits, so it need not equal 12.

There was also a real year-label error. The old hosted stats card returned
**616** under **Total Commits (2026)**. A GitHub API query without explicit dates
also returned 616, whereas the explicitly bounded 2026 query returned 598.
The default collection reported a start in October 2025, outside 2026.
Adding `commits_year=2026` to this particular deployment still returned 616.
Disabling `count_private` also left it at 616. I therefore replaced the service
rather than relying on those parameters to correct it.

The old card response had `Cache-Control: public, max-age=7200`. Caching can delay
updates, but a fresh response with the explicit year parameter reproduced the
same incorrect number; caching alone did not explain the discrepancy.

## Other findings and corrections

| Finding                                   | Evidence and correction                                                                                                                                                                                                                                                                                                                                            |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ambiguous repository count                | The old card showed `Contributed to: 1`, matching GitHub's `repositoriesContributedTo` field. This is a different scope from all repositories in the yearly overview. I now show the explicitly bounded `totalRepositoriesWithContributedCommits` value and label it accordingly.                                                                                  |
| Mixed time periods                        | The old card mixed a default contribution period with all-time PR and issue totals. My activity counts now share explicit UTC year-to-date bounds. Stars are separately labeled all time.                                                                                                                                                                          |
| Unsupported private-count expectation     | `count_private=true` did not change the live response. My workflow uses its repository-scoped token and publishes public activity; it does not claim to include private repositories.                                                                                                                                                                              |
| Language percentages looked comprehensive | The old card displayed five languages totaling about 100%, without explaining the denominator. My card aggregates all owned public non-fork repositories, paginates repository results, and groups languages after the top five as Other. Its denominator includes every detected language byte. These percentages do not measure proficiency or development time. |
| Automation contribution credit            | Both asset-generating workflows credit Faraz Hussain as author and GitHub Actions as committer. They publish to the default branch, `main`. GitHub reports Pages disabled for this repository, so future snake commits no longer rely on `gh-pages` eligibility. Historical commits are unchanged.                                                                 |
| Different snake date range                | The snake uses a rolling calendar and runs every 12 hours. It is not the same period as the year-to-date card. I added that distinction beside the animation.                                                                                                                                                                                                      |
| Snake links excluded from validation      | The link-check configuration ignored generated snake image references. Both published SVGs existed and the latest snake run succeeded on October 25. I removed the blanket exclusion. Both SVGs now live in `assets/` on the default branch and are linked below for validation without adding captions beneath the README animation.                              |
| Description source drift                  | The source audit identified ChatWell as a FastAPI/Groq support prototype and Cold Mailer as a PySide6 desktop workbench. Featured Projects now displays each pinned repository's GitHub description directly, without custom wording. Description changes belong in that repository's GitHub About settings.                                                       |
| Incorrect encryption claim                | The encryption project's `main.py` imports `cryptography.fernet.Fernet` and `sha3_512`; the previous public/private key claim was incorrect. The generated Featured Projects table now uses its repository description directly.                                                                                                                                   |

All six featured GitHub repository links resolved. I compared the remaining
project descriptions with their README or source: the Scapy/Tkinter packet
sniffer, traffic-vision project, and portfolio descriptions were consistent.
I did not infer personal qualifications from language percentages or badges.

## How I keep the corrected figures current

The [metrics generator](../.github/scripts/generate-metrics.mjs) queries GitHub
directly with a January 1 UTC start and the generation instant as its end. The
year is calculated on every run, including January rollover. It generates two
SVGs and an auditable JSON snapshot in `assets/`. Each SVG includes its refresh
time. The language chart uses code bytes across owned public non-fork repositories;
it is independent of the activity card's year filter.

I restored the old card's letter rating and progress ring using the
[legacy ranking formula](https://github.com/anuraghazra/github-readme-stats/blob/4b656ebabb8cb866d08bd010df29845372027018/src/calculateRank.js).
This is a community card rating, not an official GitHub rating or a streak.
The formula uses corrected calendar-year commits, the API's
`repositoriesContributedTo` count, all-time PR/issue counts, followers, the count
of owned public repositories, and stars from public non-forks. Those inputs,
the formula source, and the calculated score are recorded under `rank` in the
JSON snapshot. The ring fills `100 - score` percent; its grade is calculated on
each refresh rather than hardcoded to A+. This deliberately preserves the legacy
scoring weights and thresholds instead of substituting the newer ranking system.
The adapted ranking code retains its upstream MIT license notice in
`.github/scripts/LICENSE.github-readme-stats`.

The [metrics and projects workflow](../.github/workflows/metrics.yml) runs every
12 hours, on generator changes, or manually. It commits only those three generated
metric files and `README.md`, with my account as author and the bot as committer.
API failures or incomplete pagination stop the workflow before its commit step,
leaving the previous published content available.
Scheduled Actions and GitHub's image cache can delay what viewers see; the cards
are timestamped snapshots, not real-time counters.

The snake workflow independently refreshes its two SVGs in `assets/` on `main`.
Both publishing workflows share a concurrency group so they cannot race to push
updates to the same branch.
The [light snake SVG](../assets/github-contribution-grid-snake.svg) and
[dark snake SVG](../assets/github-contribution-grid-snake-dark.svg) are checked
by the documentation link checker, including the dark variant used in the
README's picture source.

## Dynamic Featured Projects

The [Featured Projects updater](../.github/scripts/update-featured-projects.mjs)
reads my public GitHub profile pins using
`pinnedItems(first: 6, types: REPOSITORY)`, documented in GitHub's
[User GraphQL reference](https://docs.github.com/en/graphql/reference/users#user).
It preserves the API's pin order and generates a **Project / Description** table
using each repository's name, URL, and short GitHub description.

The updater replaces only the block between `FEATURED-PROJECTS:START` and
`FEATURED-PROJECTS:END` in `README.md`. There is no hardcoded repository selection
or custom description override. Descriptions come from each repository's GitHub
About field, rather than its README body. A missing description leaves the cell
blank. With no pinned repositories, the table contains only its column headings;
the updater does not substitute popular repositories or retain unpinned projects.

The existing metrics workflow runs this updater after generating the cards and
lints the generated README before committing. Once deployed, pinning, unpinning,
reordering pins, or editing a pinned repository's description will update the
table on the next successful 12-hour refresh. I can also run the workflow manually.
There are two asset refresh workflows, the validation workflow, and the separate
Prettier workflow. Featured Projects needs no additional card hosting dependency.

The updater validates the entire response before writing, checks that the markers
occur exactly once and in order, and keeps other README sections unchanged.
It escapes Markdown and HTML control characters so descriptions display as text
inside the table without changing their wording. Newlines are flattened to keep
each description in one table row. API errors or incomplete responses retain the
previous README, while an unchanged pin list and descriptions cause no README write.
The first local generation on October 25, 2026 fetched all six current repository
pins and replaced the earlier curated descriptions with their repository metadata.

## Workflow commit attribution and contribution credit

All four workflows define the same Git identity:

| Field     | Value                                                                         |
| :-------- | :---------------------------------------------------------------------------- |
| Author    | Faraz Hussain `<farazhussain5000@gmail.com>`                                  |
| Committer | github-actions[bot] `<41898282+github-actions[bot]@users.noreply.github.com>` |

GitHub linked the email above to `asteroidcrib729` on the existing published
snake commit `77038818795e0df1060780c1446fb957c3c01c60`, and the local repository's
configured author uses the same name and email. The workflows set `GIT_AUTHOR_*`
and `GIT_COMMITTER_*` explicitly so bot execution retains owner authorship.

| Workflow                                     | Commit behavior                                                                                                           |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| Generate Snake Contribution Grid             | Commits changed snake SVGs to `main`.                                                                                     |
| Refresh GitHub Metrics and Featured Projects | Commits the three metric snapshots and the generated Featured Projects block in `README.md` to `main`.                    |
| Validate Profile README                      | Runs checks with read-only repository access; creates no commits.                                                         |
| Prettier                                     | Checks formatting on pushes and pull requests; an explicit manual formatting run on `main` can commit formatting changes. |

GitHub's [contribution criteria](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)
require an account-linked author email and an eligible branch in a standalone
repository. The live repository is standalone, defaults to `main`, and reported
`has_pages: false` during this audit. Publishing future snake commits to `main`
meets the branch requirement without enabling a Pages site. The historical
`gh-pages` branch remains intact.

Workflow runs do not themselves count as commits. The publishing steps skip
commits when there are no staged changes. Commits by other people retain their
own authorship, and feature-branch commits must reach an eligible branch before
they qualify. GitHub controls the final contribution calculation and says it
can take [up to 24 hours](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions)
for qualifying commits to appear. The README snapshots refresh separately.
No workflow setting can guarantee immediate profile credit or assign arbitrary
other authors' commits to my account. Existing history has not been rewritten.

## Verification

The top badge links declare `target="_blank"` and `rel="noopener noreferrer"`
in the README source. GitHub's Markdown renderer removes those attributes from
the five destination links. I verified the rendered HTML through GitHub's
Markdown API; the new-tab image-viewer link it adds to the unlinked banner is
separate from the social links. GitHub's [markup pipeline](https://github.com/github/markup)
sanitizes rendered HTML, so the repository cannot enforce new-tab navigation
on the GitHub profile. Ctrl-click or middle-click opens web destinations in a
new tab; the email link uses the browser's configured mail handler.

I added regression checks for UTC year rollover, contribution-versus-commit
separation, repository pagination, language denominators, SVG escaping, empty
language data, API errors, invalid counts, restricted activity, truncated
responses, and preservation of the previous snapshot on a failed later page.
Rating checks also verify the upstream reference score, corrected commit input,
dynamic ring fill, and rejection of incomplete ranking inputs.
Featured Projects checks cover pin ordering, original descriptions, literal
Markdown/HTML escaping, empty descriptions and pins, pin replacements, newline
preservation, unchanged-content runs, invalid markers, API failures, and the
workflow's staging of the updated README alongside its metric snapshots.
Attribution checks create temporary Git commits using the identities declared in
all four workflow files, then inspect their author and committer fields. They
also check that both publishing workflows target `main`, share a concurrency
group, and retain the validation workflow's read-only behavior.
The validation workflow now includes these checks and lints this audit document.
My [formatting guide](formatting.md) documents Prettier installation, local
commands, CI validation, and manual formatting commits.

Local verification commands:

```powershell
node --test .github/scripts/*.test.mjs
node .github/scripts/generate-metrics.mjs
node .github/scripts/update-featured-projects.mjs
npx --yes markdownlint-cli2@0.23.2 README.md "docs/**/*.md"
npx --yes markdown-link-check@3.15.0 --config .markdown-link-check.json README.md
npx --yes markdown-link-check@3.15.0 --config .markdown-link-check.json docs/metrics-audit.md
```

For local generation I use an authenticated GitHub CLI or a `GH_TOKEN` environment
variable. Hosted generation uses the workflow's `GITHUB_TOKEN`; no personal token
is stored in this repository. These workflow changes still need to be pushed
and observed in a fresh hosted run before claiming hosted acceptance.
