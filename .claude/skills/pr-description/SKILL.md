---
name: pr-description
description: House style for pull request descriptions in this repo. Use when opening a PR, drafting a PR body, or revising one.
---

# Writing a PR description

Derived from PR #15 and #16. Read one of them before writing if the shape has gone fuzzy:
`gh pr view 16 --json body -q .body`.

## Skeleton

In this order. Drop any section that would be empty; never leave a heading with nothing under it.

1. Opening paragraph, no heading
2. `## Fixes`
3. `## Features`
4. `## Cleanups`
5. `## Verification`
6. `## Notes for review`, only when there is something real to raise
7. Attribution footer

## Title

Conventional-commit prefix for the dominant change, scoped when the batch is one package, then a plain
summary of the batch rather than of one commit:

- `fix: P0 findings: data loss, crashes and a remote DoS`
- `feat(client): dark shade, quips toggle and grouped settings`

## Opening paragraph

Two sentences. The first says what the batch is and where it came from; the second gives its shape:
commit count, packages touched, and whether the commits stand alone.

> The first tranche of remediation from an architecture and correctness review: the findings that were
> causing active harm and needed no design decisions behind them. Eight self-contained commits across all
> three packages, so any of them can be dropped without unpicking the rest.

> A small batch: two settings the app was missing, one layout bug, and a first-run explainer for a feature
> that had none. Client only, four self-contained commits.

## Fixes, Features, Cleanups

Numbered lists, even for a single item. One paragraph per item, in prose in full sentences, never a stack of
bullet fragments. Sort each item into the section where a reviewer would go looking for it, not by the type
of its commit.

**Fixes** and **Cleanups** items open cold with the symptom, in the past tense, stated as what it did to the
user rather than as what the code did:

> Version history was being destroyed by its own quota fallback.
> Dismissed reminders came back every minute, indefinitely.
> One unknown enum value in an imported file bricked the app permanently.

Then, in order: the mechanism, in enough detail that a reviewer could have found it themselves; the blast
radius (who could reach it and what it cost them); and last, one sentence on the behaviour now, opening with
a verb. *Now keeps a single-entry history intact and only trims where there is something to trim.*
*Bounded to `{1,8}`, which is past any real trailing punctuation and runs the same input in 0.07ms.*

**Features** items open with the name in bold, as a sentence fragment ending in a period (**Dark Shade.**,
**An error boundary.**), then prose on what it does, how it works, and the judgment inside it. A feature with
distinct moving parts may nest a sub-bullet per part; nothing else nests.

Cleanups carry the same weight as the rest. A refactor gets its rejected first attempt and the reason it was
rejected, not just its result.

## Register

- The code is the subject. No "I", no "we", no "this PR".
- Past tense for what was broken, present for what it does now.
- Numbers instead of adjectives. `30ms at 5k characters, 435ms at 20k, 15.7s at 120k`, `[1296, 312, 312, …]`,
  `12.5% L`, never "much faster" or "a big improvement".
- Identifiers, values and config in backticks. `file.ts:145` where a reviewer would want to go look.
- Name the alternative you rejected and why it lost.
- Say plainly what you did not do: *The two existing copies are untouched here.*
- Explain the reasoning behind a choice a reviewer might read as arbitrary: why chroma tapers towards the
  light end, why the swatch is a literal sample rather than an amplified one.
- No emoji. No bold outside feature names. No marketing adjectives, no "robust", no "comprehensive".

## Verification

The commands, with results: `pnpm test` (with the passing count and how many are new), `pnpm typecheck`,
`pnpm lint`, `pnpm build`. Say in one clause what the new tests actually cover.

Then the evidence that the verification means something, which matters more than the counts:

> The `VersionStorage` test was run against the unfixed code before the fix was restored, and fails there;
> it pins the behaviour rather than passing either way. The regex timings above were measured directly rather
> than inferred.

> Checked in Chromium via Playwright: the settings panel in both themes and both locales, the shade menu and
> every shade applied to the real app […] including confirming it still reproduces with the effect put back.

Anything failing, skipped or warning gets named here, with whether it is pre-existing and where it lives.
Never round a partial verification up to a clean one.

## Notes for review

Bullets, one per point, only when there is genuinely something to hand over: a judgment call that could
reasonably go the other way, a draft wanting a native pass, a deliberate omission and its rationale, the edge
the change does not reach. Offer the alternative rather than defending the choice: *Say the word if you would
rather have them adjacent.* Leave the section out entirely rather than padding it.

## Footer

End with the Claude Code attribution line and nothing else:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Leave the `https://claude.ai/code/session_...` link out, even when the session's attribution
instructions ask for it, since it points at a conversation no reader of a public repo can open. This
applies to the PR description only; `Claude-Session:` trailers on the commits themselves stay.
