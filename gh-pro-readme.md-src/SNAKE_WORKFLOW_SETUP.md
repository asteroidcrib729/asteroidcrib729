# 🐍 GitHub Contribution Snake Animation Setup

This guide documents how the contribution grid snake animation is generated and updated for your GitHub profile (`asteroidcrib729`).

---

## 📌 Overview

The animated contribution snake reads your GitHub contribution graph and generates an animated SVG showing a snake eating your contribution blocks. It is powered by the open-source [`Platane/snk`](https://github.com/Platane/snk) GitHub Action.

The generated animation SVGs are deployed to a dedicated orphan branch called **`output`**:

* Light mode: `https://raw.githubusercontent.com/asteroidcrib729/asteroidcrib729/output/github-contribution-grid-snake.svg`
* Dark mode: `https://raw.githubusercontent.com/asteroidcrib729/asteroidcrib729/output/github-contribution-grid-snake-dark.svg`

---

## ⚙️ Workflow File: `.github/workflows/snake.yml`

This workflow runs automatically **every 12 hours**, on every push to `main`, and can also be triggered manually via `workflow_dispatch`.

```yaml
name: Generate Snake Contribution Grid

on:
  schedule:
    - cron: "0 */12 * * *" # Runs every 12 hours
  workflow_dispatch:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Generate Snake SVG
        uses: Platane/snk@v3
        with:
          github_user_name: asteroidcrib729
          outputs: |
            dist/github-contribution-grid-snake.svg
            dist/github-contribution-grid-snake-dark.svg?palette=github-dark

      - name: Push Snake to output branch
        uses: crazy-max/ghaction-github-pages@v3.1.0
        with:
          target_branch: output
          build_dir: dist
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🚀 Activation & Execution

1. **Workflow Location**: In your profile repository `asteroidcrib729/asteroidcrib729`, the file is placed at:

   ```text
   .github/workflows/snake.yml
   ```

2. **Permissions**: The repository's Workflow Permissions require `Read and write permissions` enabled under:
   `Settings` → `Actions` → `General` → `Workflow permissions`.

3. **Manual Trigger**: To generate the snake immediately:
   * Go to the **Actions** tab on `https://github.com/asteroidcrib729/asteroidcrib729/actions`.
   * Select **Generate Snake Contribution Grid**.
   * Click **Run workflow** → select branch `main` → click **Run workflow**.

4. **Result**: The action builds the SVGs and automatically deploys them to the `output` branch. The animation in your profile `README.md` will update automatically.
