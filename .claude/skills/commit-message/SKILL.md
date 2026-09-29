---
name: commit-message
description: House style for commit messages in this repo. Use whenever writing, amending or rewording a commit message.
---

# Writing a commit message

PRs are squash-merged with every commit's message kept in the squashed body, so the commits are the
lasting record of why the code is the way it is. The PR description only points at them.

## Subject

The shape (type, scope, length, punctuation) is checked by `scripts/check-titles.mjs`, run by the
`commit-msg` hook and again in CI; its error lists the rules. The judgement it cannot check:

- Say what the software now does, in the user's terms, not what the diff did:
  `fix: reminders keep the day they were set for`, not `fix: pass day to nextOccurrence`.
- Pick the type by what a user of the release would notice: a refactor that fixes a bug is a `fix`.

## Body

Always one, after a blank line: the subject says what, the body says why. Prose wrapped at 72
columns, identifiers in backticks, no headings, emoji or bold.

- **Fix**: the symptom as the user met it, past tense, with numbers (*A daily reminder at 02:30 in
  New York fired at 03:30 from 8 March on, for good.*). Then the mechanism, in enough detail that a
  reviewer could have found it. Then who could reach it, if not obvious. Last, a paragraph on the
  behaviour now, in the present tense (*The next occurrence is now worked out from ...*).
- **Feature**: what it does, how, and the judgement inside it: the default, the edge it refuses, the
  alternative that lost. Distinct parts may be a `- ` list of full sentences.
- **Refactor**: `No change in behaviour.`, with evidence where it is checkable, then what moved where.

Then, only if true: `Behaviour changes:` for anything observable beyond the subject, `Found while
...` for where a bug turned up, and what was deliberately left undone.

`git log -1 --format=%B 726df61` holds three good examples.

## One reason per commit

A fix found in passing gets a commit of its own, not a paragraph in someone else's, so any commit can
be dropped from the PR without unpicking the rest.

## Trailers

After a blank line, the attribution trailer the session's instructions give, and nothing else.
