---
paths:
  - "packages/client/src/state/router.ts"
  - "packages/client/src/state/sheetHistory.ts"
  - "packages/client/src/hooks/useBackToClose.ts"
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
