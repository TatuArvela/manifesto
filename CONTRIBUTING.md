# Contributing to Manifesto

Thank you for your interest. Manifesto is a small side project with the MIT license. Thus, the
procedure to contribute is simple.

## Licensing of contributions

When you send a contribution (a pull request, a patch, an issue with code, or other), you agree that
your contribution has the [MIT License](LICENSE). This is the same license as the project. You do
not sign a Contributor License Agreement. The license for contributions is the same as the license
for the project.

You keep the copyright on your contribution. You do not give it to a different person.

## Before opening a pull request

- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` on your computer.
- Write the commit subjects and the PR title as conventional commits (`fix(client): ...`). They
  become the changelog. `pnpm install` installs a `commit-msg` hook that checks them. CI checks them
  again.
- Make each change about one topic. A small PR is easier to review, and it is more likely to merge.
- For a large change, open an issue first. This lets you make sure that the direction is correct.

## Dependency updates

Each Monday, Dependabot opens grouped pull requests (`.github/dependabot.yml`):

- One for minor and patch updates of runtime dependencies.
- One for development dependencies.
- One for GitHub Actions.
- A separate pull request for each major update or base image.

Dependabot proposes a release when the release is one week old. It proposes security updates
immediately. These pull requests run the same CI as all other pull requests.

The actions in `.github/workflows/` are pinned to a commit. A comment gives the release that
contains the commit (`uses: actions/checkout@<sha> # v7.0.1`). We do this because a person can move
a tag to different code after a review. Dependabot updates the commit and the comment together.
`zizmor` audits the workflows each time they change (`.github/workflows/zizmor.yml`). It does not
make the run fail. Its findings go to code scanning.

## Scope

Manifesto is small on purpose. The maintainer does not promise active development. Thus:

- Bug fixes and small improvements are welcome.
- The main repository possibly does not accept large new features. You can make a fork.
- Issues possibly do not always get a response. This is not personal.

## Name and logo

You can use the name "Manifesto" and the project logo freely. You can make a fork, change the name,
keep the name, change the logo, or release a competing version. There is no trademark to protect.
