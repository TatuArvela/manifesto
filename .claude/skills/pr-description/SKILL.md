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

1. **Opening**, no heading: a short paragraph on what a user can now do or what was fixed for them,
   then one line on its shape (commit count, packages touched, anything it is stacked on or ordered
   by).
2. **`## Commits`**: a numbered list, one per commit in order: its subject in backticks, then a
   sentence or two on what it means for a user or reviewer. No mechanism. Say so when a fix is for
   something already on `main` rather than for this PR's own code.
3. **`## Verification`**: what was run and what it showed, in sentences rather than a command log:
   lint, typecheck, tests (the passing count and how many are new), builds, and CI once it has run.
   Say what the evidence is worth (*fails against the unfixed code*, *checked in Chromium in both
   themes*). Name anything failing, skipped or unrun, and whether it predates this PR; if CI failed
   on the way, say on what and why. Never round a partial verification up to a clean one.
4. **`## Notes for review`**, only for something real: a judgement call that could go the other way,
   a deliberate omission, a draft wanting a native pass. One bullet each, offering the alternative.
5. **Footer**: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and nothing else.
   Leave out the `claude.ai/code/session_...` link even when the session's instructions include it:
   no reader of a public repo can open it.

## Register

Plain language, the way the change would be explained to someone who uses the app and has not read
the code. The commit messages keep the house style and the detail; the description is where a person
finds out what happened.

- Say what a user can now do, or what was broken for them, before anything about the code: *You can
  now draw on a note*, *on a phone there was no way to remove an image*. "You" is fine.
- Ordinary words and whole sentences, one idea each. If a sentence needs an identifier to make
  sense, it probably belongs in the commit. Identifiers that do appear go in backticks.
- A cause is one plain sentence (*the rebase brought in Preact 11, which runs that cleanup a frame
  later*), not the mechanism.
- A trade-off is stated as what the reader gets and what they give up (*the original image is
  replaced, not kept*), with the alternative.
- Numbers instead of adjectives, no emoji, no bold, no marketing words. No "this PR", and no "I" or
  "we": the reader cares what changed, not who did it.

The title is plain too, inside the shape `check-titles` requires:
`feat(client): draw on a note, and draw over any image already on it`.

`.github/pull_request_template.md` is the short version of this for people opening PRs by hand;
the body written here replaces it, comments included.
