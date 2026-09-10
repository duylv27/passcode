import { execFileSync } from 'node:child_process'

/**
 * In dev (unpackaged) runs, package.json's version field is stale --
 * the release workflow only bumps it inside its own ephemeral CI
 * checkout (see .github/workflows/release.yml's "Sync package version to
 * tag" step) and never commits that bump back to the repo. So a plain
 * `app.getVersion()` always reports whatever version happened to be last
 * committed to package.json, not the actual latest release tag.
 *
 * This derives a "what would the next release be called" string from git
 * instead: the latest reachable tag, bumped to the next minor with a
 * "-snapshot" suffix whenever HEAD isn't that exact tagged commit with a
 * clean working tree (i.e. there's unreleased work, committed or not).
 * Packaged builds skip this entirely and use app.getVersion(), since the
 * CI bump *is* baked into what actually gets built and shipped there.
 */
export function resolveDevVersion(cwd: string): string | null {
  try {
    const describe = execFileSync('git', ['describe', '--tags', '--long', '--dirty'], {
      cwd,
      encoding: 'utf8'
    }).trim()

    // Format: v0.2.0-0-g16acc7c[-dirty]
    const match = describe.match(/^v?(\d+)\.(\d+)\.(\d+)-(\d+)-g[0-9a-f]+(-dirty)?$/)
    if (!match) return null

    const [, major, minor, , commitsAhead, dirty] = match
    const isExactRelease = commitsAhead === '0' && !dirty
    if (isExactRelease) return `${major}.${minor}.${match[3]}`

    return `${major}.${Number(minor) + 1}.0-snapshot`
  } catch {
    // Not a git checkout (e.g. an extracted source archive), or git isn't
    // on PATH -- fall back silently to package.json's version.
    return null
  }
}
