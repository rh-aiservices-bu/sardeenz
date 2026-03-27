---
description: Prepare a versioned release with changelog, version bumps, commit, and PR creation.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Prepare and execute a release for this project: analyze changes, determine the version, update all version references, generate a changelog entry, create a release commit, and open a PR.

## Step 1: Determine Version Bump

1. Identify the latest git tag (or latest version in `CHANGELOG.md` if no tags exist).
2. List all commits since the last release on the `dev` branch using `git log`.
3. Categorize commits:
   - **Breaking changes** → major bump
   - **New features** → minor bump
   - **Bug fixes only** → patch bump
4. **Default to minor bump** unless only bug fixes are present (then patch) or breaking changes exist (then major).
5. If the user provided a specific version in their input, use that instead.
6. **Always confirm the target version with the user before proceeding.** Show your reasoning (commit summary and bump rationale).

## Step 2: Verify CUDA/Container Dependencies (if applicable)

If any commits touch container build files (`docker/`, `Makefile`, or Python dependency versions like vLLM/kvcached):

1. **Before editing any files**, verify that referenced package versions actually exist in their upstream repositories using `WebFetch` or `Bash`.
2. List the verified versions and confirm with the user before proceeding.

## Step 3: Update Version References

Update the version string in these files:

- `package.json` (root) — the `"version"` field
- `package-lock.json` — run `npm install --package-lock-only` after updating `package.json` to sync it

No other `package.json` files in workspaces carry independent versions.

## Step 4: Generate Changelog Entry

1. Use the `/generate-changelog` skill if available, otherwise:
2. Add a new section at the top of `CHANGELOG.md` (after the `# Changelog` header and intro line).
3. Follow the existing changelog format and style exactly (see prior entries for reference).
4. Group changes by theme (not by commit). Use descriptive sub-headings.
5. Include the release date in `YYYY-MM-DD` format.

## Step 5: Create Release Commit

1. Stage all changed files.
2. Create a commit with message: `chore: release vX.Y.Z - <brief summary>`
   - The summary should be a short phrase describing the main theme (e.g., "upgrade vLLM to 0.14.1 and kvcached to 0.1.4").
3. **Do NOT push.** Ask the user to push the branch themselves (hooks prevent direct pushing).

## Step 6: Create Pull Request

1. Wait for the user to confirm they have pushed the `dev` branch.
2. Once confirmed, create a PR from `dev` → `main` with:
   - Title: `Release vX.Y.Z`
   - Body: Include the changelog entry for this release.
3. Share the PR URL with the user.

## Operating Principles

- **Always ask before acting** on irreversible steps (version choice, PR creation).
- **Verify before editing** — especially for container/CUDA dependency versions.
- **Follow existing conventions** — match the style of prior changelog entries and commit messages.
- **No surprises** — show the user what you plan to do at each step and get confirmation.
