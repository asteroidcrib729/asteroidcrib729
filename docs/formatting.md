# Formatting my profile repository

I use Prettier **3.9.10**, installed as an exact development dependency with an
npm lockfile. I use Node.js 24 locally and in the Prettier workflow.

## Local commands

From the repository root in PowerShell:

```powershell
npm.cmd ci
npm.cmd run format
npm.cmd run format:check
```

`format` applies formatting to supported project files. `format:check` validates
formatting without modifying files and exits unsuccessfully when changes are
needed. In shells where `npm` runs directly, the equivalent commands are
`npm run format` and `npm run format:check`.

I keep the shared settings in `.prettierrc.json`: single quotes for JavaScript,
a print width of 100, preserved Markdown prose wrapping, and LF line endings.
`.gitattributes` keeps text checkouts consistent across Windows and Linux.

I can also run the existing regression checks with:

```powershell
npm.cmd test
```

## GitHub Actions

The [Prettier workflow](../.github/workflows/prettier.yml) checks formatting on
pushes to `main` and on pull requests. It installs the locked dependencies with
`npm ci --ignore-scripts` before running `npm run format:check`. Check jobs have
read-only repository access.

To apply formatting from GitHub Actions, I open **Actions → Prettier → Run workflow**,
select **main**, and enable **Apply formatting and commit changes on main**.
That manual job runs the formatter, checks the result, runs the regression tests,
and commits changed tracked files to `main`. Without the option enabled, a manual
run performs the formatting check. Selecting another branch also performs only
the check; automatic formatting commits are limited to manual runs on `main`.

Formatting commits credit Faraz Hussain as author and GitHub Actions as committer.
The job shares the asset publishers' concurrency group to avoid competing pushes.
It skips commits when nothing changed. Repository branch rules still apply.

## Generated content

I exclude generated SVGs, `node_modules/`, `dist/`, and the npm-managed lockfile
using `.prettierignore`. The generated JSON metric snapshot remains included.

The Featured Projects table is protected by Prettier's Markdown range-ignore
comments. Its updater owns that block and continues to display the original
repository descriptions. The rest of `README.md` is formatted normally. The
existing profile workflows do not need to install Prettier to regenerate their
content, and their output stays compatible with the formatting check.

These commands use Prettier's documented [local installation](https://prettier.io/docs/install.html),
[CLI check/write modes](https://prettier.io/docs/cli), and
[generated-content exclusions](https://prettier.io/docs/ignore).

The local setup and checks are verified before publication. A fresh hosted
workflow run is still required after these files are committed and pushed.
