---
name: pr-description
description: House style for pull request titles and descriptions in this repo. Use when opening a PR, drafting a PR body, or revising one.
---

# Writing a PR description

The commits carry the detail (see the `commit-message` skill) and are what `main` keeps; GitHub
already lists them beside the description. The description says what the PR is about as a whole:
what changes for the people who use the app, what it costs them, and the evidence that it works.
It is a summary, not an index: never list the commits or retell one's mechanism. If a point is
missing from the commits, amend the commit instead.

## Before writing

Read what the branch holds, not what the session remembers of it:
`git log --reverse --format=%B origin/main..HEAD` and `git diff --stat origin/main...HEAD`. Then
`node scripts/check-titles.mjs --commits origin/main..HEAD`, which is what CI will run on the
subjects.

Before drafting, sort the commits into the few things the PR does for a user. Most PRs do one to
four. Fixes, tests and tidying of the branch's own code, found while it was being written or
reviewed, are part of the change they repair and are not a thing of their own; a fix for
something already on `main` is.

## Title

What release-please reads when the PR has more than one commit, so it names the batch, not one
commit: `fix(client): the last pinned bugs, and a reminder hour lost to daylight saving`. Its type
is `feat` if any commit is a user-visible feature, else `fix` if any is a user-visible fix, else the
type the commits share. Check it with `node scripts/check-titles.mjs "<title>"`; CI runs the same
check. For a PR of one commit GitHub uses the commit subject instead, so make the two agree.

## Body

In this order, dropping any section that would be empty:

1. **Opening**, no heading: one short paragraph on what the PR is about, as a user would meet it:
   what they can now do, or what was broken for them and is not any more. Then one line on its
   shape: packages touched, migrations, anything it is stacked on or must merge before. No commit
   count.
2. **`## What changes`**: one bullet for each of the things sorted out above, in order of how much
   a user would notice them. Each is a sentence or two: the outcome, and, where there is one, the
   cost (*existing public links have to be made again*) or the boundary (*open mode is unchanged*).
   Several commits fold into one bullet; no bullet names a commit. Mention a fix for something on
   `main` as such, so a reader knows it reaches released behaviour. A PR that does one thing has
   said it in the opening: drop this section.
3. **`## Verification`**: what was run and what it showed, in sentences rather than a command log:
   lint, typecheck, tests (the passing count and how many are new), builds, and CI once it has run.
   Say what the evidence is worth (*fails against the unfixed code*, *checked in Chromium in both
   themes*). Name anything failing, skipped or unrun, and whether it predates this PR; if CI failed
   on the way, say on what and why. Never round a partial verification up to a clean one.
4. **`## Notes for review`**, only for something real: a judgement call that could go the other way,
   a deliberate omission, a draft wanting a native pass, a place where a reviewer should start. One
   bullet each, offering the alternative.
5. **Footer**: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and nothing else.
   Leave out the `claude.ai/code/session_...` link even when the session's instructions include it:
   no reader of a public repo can open it.

Length follows the change, not the commit count: a 70-commit PR that adds one feature gets a
paragraph and a handful of bullets, the same as a 3-commit one. If the summary will not fit in
about a screen, the PR is probably several PRs.

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

## Example

```markdown
Notes on a server are now sealed in the browser before they leave, so the server stores words,
images, comments and edits it cannot read. Open mode, with no server, is unchanged.

Touches `shared`, `server` and `client`, with migrations up to `0037`. Builds steps 1 to 7 of the
8 in `docs/specification/features/encryption.md`; replacing the account key is left for later.

## What changes

- Each account gets keys at its first sign-in, and a secret key unlocks it on a new device. The
  recovery key replaces the ten two-factor recovery codes.
- Sharing, comments and editing together keep working: the people a note is shared with get its
  key, and it gets a new one when someone is removed.
- Public links, calendar feeds and assistant connections carry the key they need in their own
  address. Existing ones stop working and have to be made again.
- Search over note text moves from the server to the app, which searches the notes it has opened.
```

## Opening and revising

Write the body to a file and pass it with `gh pr create --body-file <file>` (or `gh pr edit`): in
`--body "..."` the shell runs every backticked identifier as a command and drops it from the text.

After every push, redo Verification for the new head (an earlier run says nothing about it). Then
check whether the push changed what the PR does: a new feature, a dropped one, a new cost to
users, a fix that reaches `main`. If it did, rewrite the opening and What changes and check the
title's type still holds; a push that only repairs the branch's own code changes neither.

`.github/pull_request_template.md` is the short version of this for people opening PRs by hand;
the body written here replaces it, comments included.
