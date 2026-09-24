# Attachments

A note carries up to `MAX_IMAGES_PER_NOTE` images of up to 5 MB each, and in both modes the note holds
**references**, never the bytes:

- **Connected mode:** `attachment:<id>`, an image in the server's attachment store (below).
- **Open mode:** `local:<sha256>`, an image in this browser's IndexedDB (`storage/localImages.ts`).

`data:` URLs appear only in export and import files. Inline, every note write, every conflict retry,
every `GET /api/notes/:id` would carry the bytes of every image on the note, and in open mode a few
photos filled `localStorage`'s ~5 MB, after which every save failed, text included. Referred to, a note
carries a few dozen bytes per image. `StoredImage` draws either kind through a `blob:` URL.

## Shrinking on attach

Before an image is stored, in either mode, the client makes it a sensible size (`utils/shrinkImage.ts`):
an image larger than 2560 pixels on its long edge is redrawn at 2560 and re-encoded, as WebP (JPEG where
the browser cannot encode WebP), or as PNG if it was a PNG, so screenshots stay crisp. An image within
the edge but over a megabyte is re-encoded only if that makes it smaller, and smaller images and GIFs
(whose animation a redraw would stop) are kept byte for byte. A phone photo usually comes out a few
hundred kilobytes, and the redraw drops its EXIF data (camera, location). The 5 MB limit is the ceiling
for what is not shrunk.

## How an image gets there

The client uploads each image as it is attached: `POST /api/attachments` with the raw file (no base64)
and its type in `Content-Type`, answered with `{ ref: "attachment:<id>" }`. The editor draws the image at
once from the local file, shows the upload's progress, and puts the reference in the note when it is
stored. A failed upload stays in the editor, marked, with **Try again** and **Remove**, rather than
saving a note that refers to nothing; closing the editor cancels what is still uploading. The REST
adapter also uploads any image that reaches a note write still inline (an import, something shared to
the app), so what it sends is references.

The server checks an upload's leading bytes against the type it was sent as (PNG, JPEG, GIF, WebP,
AVIF) and refuses a mismatch with 415, since the file is served back with that type and `nosniff`; over
the image limit is 413. An upload is stored under the uploader.

- **Content-addressed per owner.** An attachment is keyed by the SHA-256 of its bytes within its
  owner's store, so the same image sent again (a conflict retry, a stale tab, a duplicate note) resolves
  to the attachment that already holds it rather than a second copy.
- **Owned by the note's owner.** An image in a note belongs to the note's owner, whose notes it is swept
  with; see [Note writes](#note-writes).

## Reading

`GET /api/attachments/:id` returns the bytes with their image type, to the owner and to anyone holding
an accepted share of a note of the owner's that refers to it, while the owner has not trashed that note.
To anyone else it is a 404. The response is `Cache-Control: private, immutable` (an id names one set of
bytes for good), `nosniff`, and carries a sandboxing CSP. It has its own per-user rate limit, wider than
the notes API's, since a grid asks for one image per card.

The client cannot point an `<img>` at it, because the request needs the session's bearer token. It
fetches each attachment once per session and shows it through a `blob:` URL (`state/attachments.ts`,
`components/StoredImage.tsx`), which the page's CSP already allows.

## Leaving the session

Anything that leaves the session carries the bytes, never a reference only this server can read: the
JSON export and a single note's JSON download inline every attachment again, and give up with an error
rather than write a file missing a picture. Importing such a file into a server stores the images again.

## Sweeping

`attachments.sweep` runs hourly on `startPeriodicJob` (`lib/attachmentCleanup.ts`). It marks an
attachment no note refers to with the time it noticed, clears the mark when a note refers to it again,
and deletes it once it has been unreferenced for 90 days. That matches the client's version history,
which refers to attachments by id and keeps versions for 90 days, so a version restored within its life
still finds its images.

## Note writes

A note's `images` accepts `attachment:<id>` references only; an inline `data:` image, or anything else,
is refused with 422 ("Upload images first"). Note writes are therefore held to the same 1 MiB body
limit as the rest of the API, and uploads (one raw image, up to the image limit) are the only route
allowed more. A reference the note's owner holds passes through; one held by another account is
copied into the owner's store if the writer may read it (an editor adding their own upload, or copying
an image out of a note shared with them); anything else is refused (`attachments/store.ts`).

Inline images from before this, which only development databases ever held, were dropped by migration
`0013-drop-inline-images` rather than moved.

## Open mode

Images go into an IndexedDB store keyed by the SHA-256 of their bytes, so one attached twice is stored
once. IndexedDB holds binary and gets a share of the disk rather than `localStorage`'s few megabytes. The
first image stored asks the browser to keep the site's storage persistent
(`navigator.storage.persist()`), since in open mode it is the only copy. A refusal for want of space is
reported like a `localStorage` one (`storage/quota.ts`), and the attach stays in the editor with a
retry. On load, images no note refers to any more (a note deleted for good, an image removed) are
swept after a day's grace, which spares one just attached to an unsaved draft. Images from before
this, held inline in notes, are moved into IndexedDB on first load. Like open-mode notes, they belong to
one browser profile; export and import move them, as `data:` URLs.

## Storage

Attachments live in the database (`attachments`: `BLOB` in SQLite, `BYTEA` in Postgres), so a database
backup is a complete backup. A disk or S3-compatible backend behind the same `AttachmentsRepo` is
possible later, and would let non-image files be attached.
