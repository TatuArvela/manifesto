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

`/api/v1/notes` and `/api/v1/sync` page with `?limit=&cursor=`, ordered by `(updatedAt, id)`, because two
notes saved in the same millisecond have no order by timestamp alone, and a page boundary between
them would repeat one and drop the other. The client drains every page, because `allTags`, tag
counts and the filter chain are computed over the whole list. Paging bounds a response, it does not
change the model.

A listed note carries its images: in connected mode they are a sealed list of references, small
enough to travel with the note, and the bytes of each come from `GET /api/v1/attachments/:id` when
`StoredImage` draws it. `imageCount`, `hasUnloadedImages` and `ensureImages` are from when a
listing left the images behind; a server no longer sends the count, so in both modes `images` is
complete and those are no-ops kept for the callers that still ask.
