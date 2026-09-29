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

A pasted link gets a plain card at once (`appendStubPreviews`, all of a paste's URLs in *one*
write: building each from the same note kept only the last). `state/linkPreviews.ts` then asks
`storage.fetchLinkPreview`, which is always null in open mode, since its CSP forbids reaching a
third party. In connected mode the server fetches the page and returns the images raw;
`utils/previewImage.ts` redraws them through a canvas to fit 64 KB, and `state/linkPreviews.ts`
uploads each as an attachment, so a preview's `image` / `favicon` is a reference like `Note.images`
(claimed, swept and inlined on export alongside them). Previews travel in every listing and write,
and inline ones pushed a note past the 1 MiB body limit. Anything that finds what refers to an
attachment reads both `images` and `link_previews` (`referencesOf` in `storage/attachmentMapping.ts`).

On the server, `src/linkPreview/safeFetch.ts` is an SSRF boundary. It checks *every* resolved
address with `addressPolicy.ts` and connects to the checked one through a pinned `lookup`. Handing
the hostname to the HTTP client instead re-resolves it, which is a DNS rebinding hole. Redirects
must go back through the check. Tests reach a loopback server only through the explicit
`isAllowedAddress` / `allowAnyPort` seams.
