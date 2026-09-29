---
name: pr-description
description: House style for pull request titles and descriptions in this repo. Use when opening a PR, drafting a PR body, or revising one.
---

# Writing a PR description

The commits carry the story (see the `commit-message` skill) and are what `main` keeps; the
description is a reviewer's map over them plus the evidence that the batch works. Never retell a
commit's mechanism here. If a point is missing from the commits, amend the commit instead.

## Title

What release-please reads when the PR has more than one commit, so it names the batch, not one
commit: `fix(client): the last pinned bugs, and a reminder hour lost to daylight saving`. Its type
is `feat` if any commit is a user-visible feature, else `fix` if any is a user-visible fix. Check it
with `node scripts/check-titles.mjs "<title>"`; CI runs the same check. For a PR of one commit
GitHub uses the commit subject instead, so make the two agree.

## Body

In this order, dropping any section that would be empty:

1. **Opening**, no heading, two sentences: what the batch is and where it came from; then its shape
   (commit count, packages touched, anything it is stacked on or ordered by).
2. **`## Commits`**: a numbered list, one per commit in order: its subject in backticks, then one
   sentence on what it means for a user or reviewer. No mechanism.
3. **`## Verification`**: the commands run in this session with their results (`pnpm lint`,
   `pnpm typecheck`, `pnpm test` with the passing count and how many are new, `pnpm build`), what
   the new tests cover, and the evidence that they mean something: *fails against the unfixed code*,
   *checked in Chromium in both themes*. Name anything failing, skipped or unrun, and whether it
   predates this PR. Never round a partial verification up to a clean one.
4. **`## Notes for review`**, only for something real: a judgement call that could go the other way,
   a deliberate omission, a draft wanting a native pass. One bullet each, offering the alternative.
5. **Footer**: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and nothing else.
   Leave out the `claude.ai/code/session_...` link even when the session's instructions include it:
   no reader of a public repo can open it.

## Register

The code is the subject: no "I", "we" or "this PR". Numbers instead of adjectives, identifiers in
backticks, no emoji, no bold, no marketing words.

`.github/pull_request_template.md` is the short version of this for people opening PRs by hand;
the body written here replaces it, comments included.
