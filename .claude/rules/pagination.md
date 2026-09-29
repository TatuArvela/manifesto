---
paths:
  - "packages/client/src/hooks/useNoteImages.ts"
  - "packages/client/src/state/notesStore.ts"
  - "packages/client/src/storage/RestApiAdapter.ts"
  - "packages/server/src/routes/notes*.ts"
  - "packages/server/src/routes/search*.ts"
  - "packages/server/src/storage/**/notes*.ts"
---

# Pagination

`/api/notes` and `/api/search` page with `?limit=&cursor=`, ordered by `(updatedAt, id)`, because two
notes saved in the same millisecond have no order by timestamp alone, and a page boundary between
them would repeat one and drop the other. A *listed* note carries `imageCount` and an empty
`images`; the bytes come from `GET /api/notes/:id`. The client drains every page, because
`allTags`, tag counts and the filter chain are computed over the whole list. Paging bounds a
response, it does not change the model. `useNoteImages` hangs `ensureImages` off an
`IntersectionObserver` so a grid fetches only what is scrolled past. Three callers need the bytes
and say so: the editor's add-an-image handler (which would otherwise write an empty list over every
existing attachment), the JSON export, and the `images` search filter. Open mode resolves the same
call locally, so both modes behave alike.
