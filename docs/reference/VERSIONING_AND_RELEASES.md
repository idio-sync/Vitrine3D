# Versioning and Releases

## Overview

Vitrine3D uses **Semantic Versioning** (MAJOR.MINOR.PATCH) with automated version management via **release-please** and **Conventional Commits**.

- **Alpha pre-releases** are published from the `dev` branch (e.g., `v1.1.0-alpha.1`)
- **Stable releases** are published from the `main` branch (e.g., `v1.1.0`)
- **All release artifacts** — Docker images, Tauri desktop builds, and Android APKs — are versioned and published automatically

## Commit Message Format

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is enforced locally by a commitlint git hook.

### Format

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Types and Their Effect on Versioning

| Type | Description | Version Bump |
|------|-------------|-------------|
| `feat` | New feature | MINOR (1.0.0 → 1.1.0) |
| `fix` | Bug fix | PATCH (1.0.0 → 1.0.1) |
| `docs` | Documentation only | PATCH |
| `style` | Formatting, whitespace | PATCH |
| `refactor` | Code change that neither fixes nor adds | PATCH |
| `perf` | Performance improvement | PATCH |
| `test` | Adding or correcting tests | PATCH |
| `chore` | Build process, tooling, dependencies | PATCH |
| `ci` | CI configuration changes | PATCH |
| `BREAKING CHANGE` | Footer or `!` after type | MAJOR (1.0.0 → 2.0.0) |

### Examples

```bash
# Feature — bumps MINOR
git commit -m "feat: add flight path elevation profile"

# Bug fix — bumps PATCH
git commit -m "fix: sidebar overflow on narrow viewports"

# Scoped commit
git commit -m "feat(kiosk): add exhibit theme attract mode"

# Breaking change — bumps MAJOR
git commit -m "feat!: change archive manifest to v2 schema"

# Or with footer
git commit -m "refactor: restructure manifest format

BREAKING CHANGE: manifest.json schema changed from v1 to v2"
```

### What Happens if a Commit Message is Rejected

The commitlint hook runs before the commit is created. If the message doesn't conform:

```
⧗   input: updated stuff
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
```

Simply re-commit with a valid message.

## Release Flow

### Day-to-Day Development (No Releases Triggered)

```
Developer writes code
    │
    ▼
git commit -m "feat: add annotation colors"   ← commitlint validates
    │
    ▼
git push origin dev
    │
    ▼
release-please creates or updates a standing Release PR
  (accumulates changes, updates CHANGELOG draft)
    │
    ▼
Continue pushing commits — same PR keeps updating
No builds triggered. No tags created. No artifacts published.
```

### Publishing an Alpha Release

When you're ready to cut an alpha:

1. Go to the release-please PR on GitHub (titled something like "chore(main): release vitrine3d 1.1.0-alpha.1")
2. Review the auto-generated changelog
3. Merge the PR

This triggers:
- Git tag `v1.1.0-alpha.1` is created
- Docker image pushed as `vitrine3d:1.1.0-alpha.1`
- Tauri desktop builds (Windows/Linux/macOS) attached to a GitHub pre-release
- Android APK attached to the same GitHub pre-release
- `CHANGELOG.md` updated in the repo

Push more commits after merging → release-please opens a new PR for `v1.1.0-alpha.2`.

### Publishing a Stable Release

1. Merge `dev` into `main`
2. release-please opens a stable Release PR on `main` (e.g., "release vitrine3d 1.1.0")
3. Merge the PR

This triggers:
- Git tag `v1.1.0` is created
- Docker image pushed as `vitrine3d:1.1.0` and `vitrine3d:latest`
- Tauri desktop builds attached to a GitHub release (not pre-release)
- Android APK attached to the same release

## Version Sources

The version is maintained in 4 locations, all kept in sync automatically by release-please:

| File | Field | Notes |
|------|-------|-------|
| `package.json` | `version` | Primary source of truth (Node release type) |
| `src-tauri/tauri.conf.json` | `version` | Tauri desktop/Android builds |
| `src-tauri/Cargo.toml` | `package.version` | Rust/Cargo build |
| `src/modules/archive-creator.ts` | `packer_version` | Embedded in exported archive manifests |

A version sync test (`src/modules/__tests__/version-sync.test.ts`) verifies all 4 sources match. Run `npm test` to check.

## Docker Image Tags

| Tag | Source | Example |
|-----|--------|---------|
| Branch name | Every push | `vitrine3d:dev`, `vitrine3d:main` |
| Semantic version | Release PR merge | `vitrine3d:1.1.0`, `vitrine3d:1.1.0-alpha.1` |
| `latest` | Main branch push | `vitrine3d:latest` |

## Configuration Files

| File | Purpose |
|------|---------|
| `release-please-config.json` | release-please settings, extra-files for version sync |
| `.release-please-manifest.json` | Tracks current version (updated by release-please) |
| `commitlint.config.js` | Commit message validation rules |
| `.husky/commit-msg` | Git hook that runs commitlint |
| `.github/workflows/release-please.yml` | GitHub Action that runs release-please |

## Troubleshooting

### "I committed with a bad message before the hook was installed"

The hook only validates future commits. Existing history is unaffected. release-please will still work — it just won't categorize commits without conventional prefixes.

### "release-please isn't creating a PR"

- Check that the workflow ran: Actions → Release Please
- Commits need at least one `feat:` or `fix:` prefix to trigger a version bump
- `chore:` and `docs:` commits alone may not create a release PR depending on configuration

### "I need to manually bump the version"

Update `.release-please-manifest.json` with the desired version. release-please will use it as the baseline for the next bump.

### "Version sync test is failing"

One of the 4 version sources is out of sync. Check each file listed in the Version Sources table above and ensure they all have the same version string.
