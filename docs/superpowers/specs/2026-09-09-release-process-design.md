# Release Process Design

## Context

PassCode already has a tag-triggered `.github/workflows/release.yml` that builds
a Windows installer with electron-builder and publishes it to GitHub Releases
when a `v*.*.*` tag is pushed. It syncs the tag's version into `package.json`
at build time so the installer filename and GitHub Release match.

What's missing is everything *around* that: how versions get decided, how
frequently builds happen, how tags get created, and how release notes get
written and shown to users. This spec defines that process end to end.

Maintainer is solo. All code changes land on `main` via PR; the repo already
uses conventional commit prefixes (`feat:`, `fix:`, `docs:`, etc.) in its
history.

## Overview

- Every PR merge to `main` triggers CI to cut an automatic **snapshot
  pre-release** — a real, installable build tagged and published as a GitHub
  pre-release. This gives a continuous trail of testable builds with zero
  manual steps.
- **Stable releases** are a deliberate, occasional action: the maintainer
  decides it's time, CI suggests a version bump from the commit history since
  the last stable tag, the maintainer reviews/adjusts and writes user-facing
  release notes, merges a small release PR, then pushes the final tag. That
  tag's build publishes as the "Latest" GitHub Release.
- Both flows reuse the *existing* `release.yml` — no new build pipeline, just
  new tag-producing steps in front of it.

## Versioning scheme

**Pre-1.0 policy** (current phase — repo is at `0.2.0`):
- Any release containing at least one `feat:` commit since the last stable
  tag → **minor** bump (`0.2.0` → `0.3.0`).
- A release with only `fix:`/`chore:`/`docs:`/etc. commits → **patch** bump
  (`0.2.0` → `0.2.1`).
- Breaking changes get no special version treatment pre-1.0 (there's no
  public API/back-compat contract to protect yet); they count as `feat:` for
  bump purposes but must be called out clearly in the changelog.
- `1.0.0` is a deliberate, manual decision made later, marking "ready for
  general use" — not triggered automatically by any commit pattern.

**Snapshot versions** (every merge to `main`):
- Computed as `<latest-stable-tag, patch+1>-snapshot.<N>`, e.g. after
  `v0.2.0`, snapshots are `v0.2.1-snapshot.1`, `v0.2.1-snapshot.2`, ...
- This is a traceable, monotonically increasing label. It does not try to
  predict whether the eventual stable release will actually be `0.2.1` or
  `0.3.0` — semver prerelease identifiers (`-snapshot.N`) always sort before
  the final version, which is all that's required.
- Because the version string contains a prerelease identifier,
  electron-builder's GitHub publisher automatically marks these as
  **pre-release** (not "Latest") — no extra config needed.

## Snapshot builds (automatic)

New workflow, `.github/workflows/snapshot.yml`, triggered `on: push` to
`main`:

1. Skip if the triggering commit message starts with `release:` (these
   commits are release-prep commits handled by the stable flow below —
   skipping avoids cutting a redundant/inconsistent snapshot for them).
2. Find the latest **stable** tag: `git describe --tags --match
   "v[0-9]*.[0-9]*.[0-9]*" --abbrev=0`, which — because of the glob —
   naturally excludes tags containing `-snapshot.`.
3. Bump its patch version by 1, append `-snapshot.<github.run_number>`.
4. Create an annotated git tag with that version and push it.
5. The tag push triggers the existing `release.yml` (its trigger pattern
   `v*.*.*` also matches prerelease-style tags like `v0.2.1-snapshot.3`) — it
   builds and publishes as usual, landing as a GitHub pre-release
   automatically due to the prerelease identifier.

No `package.json` changes are committed to `main` for snapshots —
`release.yml` already syncs the version into `package.json` transiently at
build time (it does this today for stable tags too).

**Known limitation:** if a snapshot workflow run happens to race a
release-prep merge before its tag exists yet, the computed snapshot base
version may look one patch/minor behind what's about to ship. This is
cosmetic only (snapshot versions are disposable build labels, not
predictions) and is not worth engineering around.

## Stable release flow (manual, deliberate)

1. Maintainer decides it's time to ship.
2. Run a local script, `npm run release:prepare`, that:
   - Finds all commits since the last stable tag.
   - Scans them for `feat:`/`fix:`/etc. prefixes to **suggest** a bump type
     (minor vs. patch) per the policy above.
   - Prints the suggestion and a draft changelog grouped by type (Features /
     Fixes / Other), derived from commit messages.
3. Maintainer confirms or overrides the suggested bump type.
4. The script writes:
   - The bumped version into `package.json`.
   - A new entry at the top of `CHANGELOG.md`, seeded from the draft but
     meant to be hand-edited into user-facing language before committing
     (see "Release notes content" below).
5. Maintainer edits the changelog draft into polished, user-facing copy, then
   opens this as a normal PR titled `release: vX.Y.Z`.
   - The snapshot workflow skips this commit on merge (its `release:`
     prefix), so no redundant snapshot is cut for it.
6. After merge, maintainer creates and pushes the tag manually:
   `git tag vX.Y.Z && git push origin vX.Y.Z`.
7. The tag push triggers `release.yml` as today. Because the version has no
   prerelease suffix, electron-builder publishes it as the **"Latest"**
   GitHub Release, using the new `CHANGELOG.md` section as the release body.

## Release notes content — single source of truth

`CHANGELOG.md` (new file, repo root) is the one place release notes are
authored, in a lightweight "Keep a Changelog"-style format:

```markdown
## [0.3.0] - 2025-01-15
### Added
- Timeline now shows per-tool-type icons instead of a generic status dot.
### Improved
- Provider status and chat history no longer flash while loading.
### Fixed
- Cache read/write tokens are now tracked correctly in usage stats.
```

- Only stable releases get an entry. Snapshots never touch this file —
  nothing user-facing changes about a snapshot build.
- Written for end users: plain language, grouped by Added / Improved /
  Fixed, not raw commit messages. The `release:prepare` script's draft is a
  starting point; the maintainer edits it for tone and clarity before the
  release PR is merged.
- This file feeds both user-facing channels:
  - **GitHub Release body**: `release.yml`'s stable-tag path extracts that
    version's section from `CHANGELOG.md` and uses it as the GitHub Release
    description (via the GitHub API when creating/updating the release), so
    the download page shows polished notes instead of a commit list.
  - **In-app "What's New"** (below).

## In-app "What's New" screen

- **Bundling:** `CHANGELOG.md` is imported at build time (Vite `?raw`
  import) so it ships inside the packaged app — no network call needed,
  works fully offline.
- **Tracking what's been seen:** a new `lastSeenVersion` field in
  `appSettingsRepository`, alongside other app-level settings.
- **On launch** (main process, during existing startup sequence):
  1. Read `lastSeenVersion` and compare it to the running `app.getVersion()`,
     using a simple numeric major.minor.patch compare (prerelease suffixes
     like `-snapshot.N` are stripped for comparison purposes — no need for a
     full semver dependency).
  2. If there's no stored value yet (fresh install), just record the
     current version and show nothing — the existing Welcome screen already
     covers first-run.
  3. If the stored version differs from the current one, parse the bundled
     `CHANGELOG.md` and collect every version section newer than
     `lastSeenVersion` up to the current version. Pass those sections to the
     renderer over IPC.
  4. Update `lastSeenVersion` to the current version immediately once
     collected, so the notes only ever show once per upgrade (even if the
     user dismisses without reading).
- **Renderer:** new `WhatsNewModal` component, shown once at startup as a
  dismissible overlay (not a blocking gate) on top of whatever screen loads
  (Welcome screen or a restored session). Content renders through the
  existing `react-markdown` pipeline, grouped by the changelog's version
  headers/sections.
- If there are no new changelog sections since `lastSeenVersion` (e.g. the
  user has only been running snapshots and no stable release has shipped),
  nothing shows.

## Out of scope

- **Auto-update mechanism** (`electron-updater` or any in-app "download and
  install a newer version" flow). This spec covers building/publishing
  releases and showing notes for the version the user is already running —
  not the app fetching newer installers itself. Candidate for a future spec.
- **Multi-OS builds** (macOS/Linux). `release.yml` is Windows-only today;
  unchanged here.
- **Rollback/yanking a bad release.** Not addressed; can be a fast-follow if
  it comes up.

## Summary of new/changed files

- `.github/workflows/snapshot.yml` — new, cuts+pushes snapshot tags on every
  push to `main`.
- `.github/workflows/release.yml` — extended to post the matching
  `CHANGELOG.md` section as the GitHub Release body on stable-tag builds.
- `CHANGELOG.md` — new, root of repo, single source of truth for user-facing
  release notes.
- `scripts/release-prepare.*` (or equivalent) + `"release:prepare"` npm
  script — drafts the version bump and changelog entry from commit history.
- `src/main/db/appSettingsRepository.ts` — add `lastSeenVersion` field.
- New main-process startup check comparing `lastSeenVersion` to
  `app.getVersion()` and computing which changelog sections to show.
- New renderer component `WhatsNewModal` (plus wiring in `App.tsx`) to
  display those sections once per upgrade.
