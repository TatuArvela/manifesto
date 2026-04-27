# Releasing

Manifesto uses a single shared version across all three packages (`@manifesto/client`, `@manifesto/server`, `@manifesto/shared`). Releases are driven by [release-please](https://github.com/googleapis/release-please) and triggered by merging a release PR.

## How it works

1. Every push to `main` runs `.github/workflows/release.yml`.
2. The `release-please` job inspects [Conventional Commit](https://www.conventionalcommits.org/) messages since the last release and maintains an open "chore(main): release X.Y.Z" PR that bumps versions and updates `CHANGELOG.md`.
3. Merging that PR creates a `vX.Y.Z` git tag and a GitHub Release.
4. The `artifacts` job then builds a client bundle and a multi-arch server image, and attaches the client bundle to the release.

## Conventional commits

PR titles become commit messages on squash-merge, so the PR title is what release-please reads.

| Prefix | Bump | Example |
|---|---|---|
| `feat:` | minor (e.g. `0.1.0` → `0.2.0`) | `feat: add tag autocomplete` |
| `fix:` | patch (e.g. `0.1.0` → `0.1.1`) | `fix: handle empty search query` |
| `feat!:` or `BREAKING CHANGE:` footer | minor while in `0.x` (semver normally says major; `bump-minor-pre-major` rewrites it) | `feat!: rename note color enum` |
| `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:` | no release | `chore: bump dependencies` |

## What ships per release

- **Client zip**: `manifesto-client-vX.Y.Z.zip` attached to the GitHub Release. Open-mode build with base path `/`. Drop on any static host.
- **Server image**: `ghcr.io/tatuarvela/manifesto-server:X.Y.Z` and `:latest`, multi-arch (`linux/amd64`, `linux/arm64`).
- **GitHub Release**: notes auto-generated from the PR titles since the previous tag.

## Post-release checklist

- [ ] `gh release view vX.Y.Z` shows the client zip attached.
- [ ] `docker pull ghcr.io/tatuarvela/manifesto-server:X.Y.Z` works from a clean machine.
- [ ] `curl https://<server>/api/health` reports `version: "X.Y.Z"`.
- [ ] `https://tatuarvela.github.io/manifesto/` shows the new version in Settings → About (hard-refresh past the service worker).

### One-time on first release (v0.1.0)

- [ ] Remove the `release-as: "0.1.0"` line from `release-please-config.json` in a follow-up PR. Otherwise every release PR will keep proposing 0.1.0.
- [ ] Mark the GHCR package public at `https://github.com/users/TatuArvela/packages/container/manifesto-server/settings`. New GHCR packages are private by default.

## Deferred (not in v0.1.0)

The following surfaces are intentionally not stabilised yet and will need their own work before a 1.0:

- `/api/v1/` path versioning + a documented breaking-change policy
- `schemaVersion` on the `Note` type and a client-side migration layer
- Versioned server migrations (currently idempotent `CREATE TABLE IF NOT EXISTS`)
- Per-package independent versions
- A connected-mode prebuilt client bundle
- Cosign signatures, SBOM, SLSA provenance
- Docker Hub mirror
- Server tarball for non-Docker self-hosters
- PR-title commitlint enforcement
