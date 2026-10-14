<!--
The title becomes the changelog line: "type(scope): what the batch does".
`node scripts/check-titles.mjs "<title>"` lists the rules; CI checks it.
Explain each change in its commit message; here, summarise the PR as a whole
rather than listing its commits.
-->

<!-- What this changes for someone using the app, in a sentence or two. -->

## What changes

<!-- Only if it does more than one thing: a bullet per outcome, not per commit. -->

## Verification

<!-- What you ran and what it showed. Say if anything failed or was skipped. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
