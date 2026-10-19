# Releasing

Manifesto uses one shared version for all three packages (`@manifesto/client`, `@manifesto/server`,
`@manifesto/shared`). [release-please](https://github.com/googleapis/release-please) controls the
releases. A merge of a release PR starts a release.

## How it works

1. Each push to `main` runs `.github/workflows/release.yml`.
2. The `release-please` job reads the [Conventional Commit](https://www.conventionalcommits.org/)
   messages since the last release. It keeps an open PR, "chore(main): release X.Y.Z", which
   increases the versions and updates `CHANGELOG.md`.
3. A merge of that PR makes a `vX.Y.Z` git tag and a GitHub Release.
4. Then the `artifacts` job builds a client bundle and a multi-arch server image. It attaches the
   client bundle to the release.

## Versions between releases

Only the release commit has the version `X.Y.Z`. A build of a later commit reports three things, as
semver build metadata: the previous release, the number of commits since that release, and the short
SHA of the commit. An example is `0.1.5+14.bf5a6dd`. The GitHub Pages deployment of `main` shows this
in Settings. A server image that you build from a branch gives this in `/api/v1/health`.

`packages/build-version` calculates the version from the git history. Thus, a CI checkout that
builds needs `fetch-depth: 0`. To override the version, set `MANIFESTO_VERSION`, for example as a
Docker build arg. The build context of the image has no `.git`.

## Conventional commits

A squash merge makes the PR title into the commit message. Thus, release-please reads the PR title.

| Prefix | Increase | Example |
|---|---|---|
| `feat:` | minor (for example `0.1.0` → `0.2.0`) | `feat: add tag autocomplete` |
| `fix:` | patch (for example `0.1.0` → `0.1.1`) | `fix: handle empty search query` |
| `feat!:` or a `BREAKING CHANGE:` footer | minor while in `0.x` (semver usually gives major; `bump-minor-pre-major` changes it) | `feat!: rename note color enum` |
| `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:` | no release | `chore: bump dependencies` |

## What ships per release

- **Client zip**: `manifesto-client-vX.Y.Z.zip`, attached to the GitHub Release. It is an open-mode
  build with the base path `/`. Put it on any static host. It has the default product name. To
  rebrand it, you do not have to build it again. See
  [Rebranding](../specification/client/deployment.md#rebranding).
- **Server image**: `ghcr.io/tatuarvela/manifesto-server:X.Y.Z` and `:latest`, multi-arch
  (`linux/amd64`, `linux/arm64`). It is signed with cosign (keyless, by digest), and has an SBOM and
  SLSA provenance attached. [Server Deployment](../specification/server/deployment.md) tells how to
  verify them.
- **GitHub Release**: release notes that the workflow makes automatically from the PR titles since
  the previous tag.

## Post-release checklist

- [ ] `gh release view vX.Y.Z` shows the attached client zip.
- [ ] `docker pull ghcr.io/tatuarvela/manifesto-server:X.Y.Z` works from a clean machine.
- [ ] `curl https://<server>/api/v1/health` reports `version: "X.Y.Z"`.
- [ ] `https://tatuarvela.github.io/manifesto/` shows the new version in Settings → About. Do a
  hard refresh to go past the service worker.

## Before 1.0.0

From 1.0.0, the compatibility policy in [API](../specification/api.md#compatibility) applies to the
public API. Also, stored notes must continue to open in all subsequent releases. These tasks must
be complete before 1.0.0:

- **API versioning**: put the public surface under a versioned path. Then a subsequent breaking
  change can be adjacent to the old one.
- **Data versioning**: put a version on stored notes, and add a migration layer in the client for
  both modes. Server migrations already have versions (`storage/migrations.ts`).
- **Replacement of the account key**: step 8 of
  [Encryption](../specification/features/encryption.md#order-of-building).

## Not planned

We examined these items, and decided not to do them now. Each one can come after 1.0.0, because none
of them changes a contract:

- An independent version for each package
- A prebuilt client bundle for connected mode
- A Docker Hub mirror
- A server tarball for self-hosters who do not use Docker
