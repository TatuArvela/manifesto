# Releasing

Manifesto uses a single shared version across all three packages (`@manifesto/client`, `@manifesto/server`, `@manifesto/shared`). Releases are driven by [release-please](https://github.com/googleapis/release-please) and triggered by merging a release PR.

## How it works

1. Every push to `main` runs `.github/workflows/release.yml`.
2. The `release-please` job inspects [Conventional Commit](https://www.conventionalcommits.org/) messages since the last release and maintains an open "chore(main): release X.Y.Z" PR that bumps versions and updates `CHANGELOG.md`.
3. Merging that PR creates a `vX.Y.Z` git tag and a GitHub Release.
4. The `artifacts` job then builds a client bundle and a multi-arch server image, and attaches the client bundle to the release.

## Versions between releases

Only the release commit is `X.Y.Z`. A build of any later commit reports the release it follows, the number of commits since, and its own short SHA, as semver build metadata: `0.1.5+14.bf5a6dd`. That is what the GitHub Pages deployment of `main` shows in Settings, and what `/api/health` answers for a server image built by hand from a branch. `packages/build-version` works this out from git history, so a CI checkout that builds needs `fetch-depth: 0`. Set `MANIFESTO_VERSION` to override it, for example as a Docker build arg, since the image's build context has no `.git`.

## Conventional commits

PR titles become commit messages on squash-merge, so the PR title is what release-please reads.

| Prefix | Bump | Example |
|---|---|---|
| `feat:` | minor (e.g. `0.1.0` → `0.2.0`) | `feat: add tag autocomplete` |
| `fix:` | patch (e.g. `0.1.0` → `0.1.1`) | `fix: handle empty search query` |
| `feat!:` or `BREAKING CHANGE:` footer | minor while in `0.x` (semver normally says major; `bump-minor-pre-major` rewrites it) | `feat!: rename note color enum` |
| `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:` | no release | `chore: bump dependencies` |

## What ships per release

- **Client zip**: `manifesto-client-vX.Y.Z.zip` attached to the GitHub Release. Open-mode build with base path `/`. Drop on any static host. It carries the default product name; rebranding it needs no rebuild; see [Rebranding](../specification/client/deployment.md#rebranding).
- **Server image**: `ghcr.io/tatuarvela/manifesto-server:X.Y.Z` and `:latest`, multi-arch (`linux/amd64`, `linux/arm64`), signed with cosign (keyless, by digest), with an SBOM and SLSA provenance attached. Verifying them is in [Server Deployment](../specification/server/deployment.md).
- **GitHub Release**: notes auto-generated from the PR titles since the previous tag.

## Post-release checklist

- [ ] `gh release view vX.Y.Z` shows the client zip attached.
- [ ] `docker pull ghcr.io/tatuarvela/manifesto-server:X.Y.Z` works from a clean machine.
- [ ] `curl https://<server>/api/health` reports `version: "X.Y.Z"`.
- [ ] `https://tatuarvela.github.io/manifesto/` shows the new version in Settings → About (hard-refresh past the service worker).

## Before 1.0.0

From 1.0.0 the public API is under the compatibility policy in [API](../specification/api.md#compatibility), and stored notes have to keep opening across releases. Still to do before then:

- **API versioning**: the public surface under a versioned path, so a later breaking change can live beside the old one.
- **Data versioning**: a version on stored notes, and a migration layer in the client for both modes. Server migrations are already versioned (`storage/migrations.ts`).
- **Replacing the account key**: step 8 of [Encryption](../specification/features/encryption.md#order-of-building).

## Not planned

Considered and left out for now; each can come after 1.0.0, since none changes a contract:

- Per-package independent versions
- A prebuilt client bundle for connected mode
- A Docker Hub mirror
- A server tarball for self-hosters without Docker
