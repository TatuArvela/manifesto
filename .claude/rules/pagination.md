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

`/api/v1/notes` and `/api/v1/sync` send pages with `?limit=&cursor=`. The order is
`(updatedAt, id)`. If two notes save in the same millisecond, the timestamp alone does not give an
order. A page boundary between those two notes then repeats one note and loses the other. The
client gets all of the pages, because it calculates `allTags`, the tag counts and the filter chain
from the full list. Paging sets a limit on the size of a response. It does not change the model.

A listed note contains its images. In connected mode, the images are a sealed list of references.
The list is small, so it can go with the note. When `StoredImage` draws an image, it gets the bytes
from `GET /api/v1/attachments/:id`. `imageCount`, `hasUnloadedImages` and `ensureImages` are from
an older design, where a listing did not include the images. The server does not send the count
now. Thus, in both modes `images` is complete, and those three do nothing. We keep them for the
callers that still use them.
