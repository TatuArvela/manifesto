# Contributing to Manifesto

Thanks for taking the time to look. Manifesto is a small, MIT-licensed side project, so the contribution process is light.

## Licensing of contributions

By submitting a contribution (pull request, patch, issue with code, etc.), you agree that your contribution is licensed under the [MIT License](LICENSE), the same license as the project. There is no Contributor License Agreement to sign; the inbound license matches the outbound license.

You retain copyright on your contribution. You are not assigning it to anyone.

## Before opening a pull request

- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` locally.
- Write commit subjects and the PR title as conventional commits (`fix(client): ...`); they become
  the changelog. `pnpm install` sets up a `commit-msg` hook that checks them, and CI checks again.
- Keep changes focused. Smaller PRs are easier to review and more likely to land.
- For larger changes, open an issue first to check that the direction makes sense.

## Dependency updates

Dependabot opens grouped pull requests every Monday (`.github/dependabot.yml`): one for minor and patch
updates of runtime dependencies, one for development ones, one for GitHub Actions, and a pull request of
its own for each major update or base image. They run the same CI as any other pull request.

Actions in `.github/workflows/` are pinned to a commit, with the release it is in as a comment
(`uses: actions/checkout@<sha> # v7.0.1`), because a tag can be moved to other code after it is
reviewed. Dependabot updates both together. `zizmor` audits the workflows on every change to them
(`.github/workflows/zizmor.yml`); it does not fail the run, and its findings land in code scanning.

## Scope

Manifesto is intentionally small. The maintainer is not committing to active development, so:

- Bug fixes and small improvements are welcome.
- Large new features may not be accepted into the main repo; feel free to fork.
- Issues may not always get a response. That's not personal.

## Name and logo

The name "Manifesto" and the project logo are free to use. Fork it, rename it, keep the name, swap the logo, ship a competing version, whatever works for you. There is no trademark to defend here.
