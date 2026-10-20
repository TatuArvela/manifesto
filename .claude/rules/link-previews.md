---
paths:
  - "packages/client/src/state/linkPreviews.ts"
  - "packages/client/src/utils/previewImage.ts"
  - "packages/client/src/utils/linkPreview.ts"
  - "packages/client/src/hooks/useDraftLinkPreviews.ts"
  - "packages/client/src/components/LinkPreview*.tsx"
  - "packages/server/src/linkPreview/**"
  - "packages/server/src/storage/attachmentMapping.ts"
---

# Link Previews

When you paste a link, a plain card shows immediately. `appendStubPreviews` writes all of the URLs
of a paste in *one* write. An older design built each card from the same note, and only the last
card stayed.

Then `state/linkPreviews.ts` calls `storage.fetchLinkPreview`. In open mode this always gives null,
because the CSP of open mode does not let the app connect to a third party. In connected mode, the
server gets the page and sends back the raw images. `utils/previewImage.ts` draws each image again
through a canvas, to make it 64 KB or smaller. Then `state/linkPreviews.ts` uploads each image as an
attachment.

Thus, the `image` and `favicon` of a preview are references, the same as `Note.images`. The app
claims them, sweeps them, and inlines them on export, together with the note images. Previews go
with each listing and each write. Inline previews made a note body larger than the 1 MiB limit.
Code that finds the references to an attachment must read both `images` and `link_previews`
(`referencesOf` in `storage/attachmentMapping.ts`).

On the server, `src/linkPreview/safeFetch.ts` is an SSRF boundary:

- It checks *each* resolved address with `addressPolicy.ts`.
- It connects to the checked address through a pinned `lookup`. If you give the hostname to the
  HTTP client, the client resolves the name again. This opens a DNS rebinding hole.
- Each redirect must go through the check again.

Tests can connect to a loopback server only through the explicit `isAllowedAddress` and
`allowAnyPort` seams.
