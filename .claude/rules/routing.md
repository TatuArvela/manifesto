---
paths:
  - "packages/client/src/state/router.ts"
  - "packages/client/src/state/sheetHistory.ts"
  - "packages/client/src/hooks/useBackToClose.ts"
  - "packages/client/src/hooks/useViewTransition.ts"
  - "packages/client/src/components/App.tsx"
  - "packages/client/src/hooks/useAccountCheck.ts"
  - "packages/client/vite.config.ts"
  - "packages/shared/src/tags.ts"
---

# Routing

`state/router.ts` keeps `activeView` and `activeTag` the same as `location.pathname`. The path has
the prefix from the `BASE_URL` of Vite. There are eight views and eight paths:

- `/` shows the active notes.
- `/tags` and `/tags/<tag>` show the tags. A nested tag has its own path, `/tags/work/clients`. The
  app encodes each part of the path separately. `isTagWithin` and the other path helpers are in
  `shared/src/tags.ts`.
- `/reminders`, `/auto-notes`, `/archived`, `/trash`, `/search` and `/admin`.

`/admin` shows only for an admin in connected mode. `App` (`useAccountCheck`) sends all other users
to `/`, but only after `/me` answers. The persisted user can be older than a grant of admin rights.
The `githubPagesSpaFallback` Vite plugin copies `dist/index.html` to `dist/404.html`. Thus, GitHub
Pages serves the SPA for all unknown paths.

## View transitions

A change of the view or the tag plays `hooks/useViewTransition.ts`:

- A note on both boards moves from its old position to its new position.
- A note that is only on the old board fades out where it was.
- A note that is new on the board fades in.
- All other content cross-fades.
- The new-note pad (`data-view-slide`) does not do these. It slides down from under the top edge of
  the board, and back up under it.

When Preact renders the new board, the old board is gone. Thus, a signal `effect` does the first
step. The effect runs on the change itself, which is before the render (the render is one microtask
later). The effect records the position of each card. It also puts an inert copy of the content over
`<main>`, to fade out. When the layout of the new board is complete, the code hides the cards in the
copy that are also on the new board.

The animation moves the content in place. Do not remount it with a `key`, because that deletes the
measurements of the masonry grid. The animation starts from a layout effect. If it starts after
paint, the new view shows fully for one frame first. `App` calls the hook after `usePaneSlide`.
Thus, if a sidebar opens in the same change, the sidebar starts from closed when the code measures
the cards. The `.no-motion` override in `styles/preferences.css` does not apply to a Web Animation.
Thus, the hooks read the `animations` preference themselves.

## Tags sidebar

On a wide screen, the sidebar of the Tags view opens and closes as a drawer (`usePaneSlide`, in the
same folder). The animation changes its width. The edge of the sidebar pushes the board. The tree
inside is right-aligned at its full width, and moves with the sidebar. `App` keeps the pane mounted
through `usePresence` until it is closed. While the pane moves, the content of the board stays at
its final width, because the masonry grid otherwise changes its columns in each frame. During that
time, the board clips the content at the sides.
