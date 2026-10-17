---
paths:
  - "packages/client/src/state/router.ts"
  - "packages/client/src/state/sheetHistory.ts"
  - "packages/client/src/hooks/useBackToClose.ts"
  - "packages/client/src/hooks/useViewTransition.ts"
  - "packages/client/src/components/App.tsx"
  - "packages/client/vite.config.ts"
  - "packages/shared/src/tags.ts"
---

# Routing

`state/router.ts` syncs `activeView` / `activeTag` with `location.pathname` (base-prefixed from
Vite's `BASE_URL`). Eight views, eight paths: `/` → active, `/tags` and `/tags/<tag>` → tags (a nested tag is a path of its own, `/tags/work/clients`, each
part encoded by itself; `isTagWithin` and the rest of the path helpers are in `shared/src/tags.ts`),
`/reminders`, `/auto-notes`, `/archived`, `/trash`, `/search`, `/admin`. `/admin` renders only for an
admin in connected mode; `App` sends anyone else to `/` once `/me` has answered, not before, since the
persisted user can predate a grant. The `githubPagesSpaFallback` Vite
plugin copies `dist/index.html` to `dist/404.html` so GitHub Pages serves the SPA for any unknown
path.

Changing the view or the tag plays `hooks/useViewTransition.ts`. A note on both boards moves from
where it was to where it is now, one only on the board before fades out where it stood, one new to
the board fades in, and everything else cross-fades. The new-note pad (`data-view-slide`) slides
down from under the board's top edge and back up under it instead. The board before is gone once
Preact renders the new one, so a signal `effect`, which runs on the change itself and so before the
render a microtask later, notes where every card is and lays an inert copy of the content over
`<main>` to fade out; once the new board is laid out, the copy's cards that are on it too are hidden.
The content is animated in place, never remounted by a `key`, which would throw away the masonry
grid's measurements, and from a layout effect: after paint, the new view shows whole for a frame
first. `App` calls it after `usePaneSlide`, so a sidebar opening in the same change has started from
closed when the cards are measured. A Web Animation is not reached by the `.no-motion` override in
`styles/preferences.css`, so the hooks read the `animations` preference themselves.

On a wide screen the Tags view's sidebar opens and closes as a drawer (`usePaneSlide`, beside it):
its width is animated, so the board is carried by its edge and the tree inside, right-aligned at its
full width, rides on it. `App` keeps the pane mounted through `usePresence` until it has closed.
While it moves, the board's content is held at the width it ends at, since the masonry grid would
otherwise reflow its columns every frame, and the board clips it sideways for that moment.
