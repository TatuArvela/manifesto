# Attachments

A note carries up to `MAX_IMAGES_PER_NOTE` images of up to 5 MB each. Open mode keeps them inline in
the note, as `data:` URLs, because the note in `localStorage` is all there is. Connected mode keeps them
outside the note, in the server's **attachment store**, and the note refers to each one as
`attachment:<id>` (`isAttachmentRef` in `@manifesto/shared`).

Inline, every note write, every conflict retry, every `GET /api/notes/:id` and every version a client
keeps would carry the bytes of every image on the note. Referred to, they carry a few dozen bytes each,
and the bytes travel once.

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

## Storage

Attachments live in the database (`attachments`: `BLOB` in SQLite, `BYTEA` in Postgres), so a database
backup is a complete backup. A disk or S3-compatible backend behind the same `AttachmentsRepo` is
possible later, and would let non-image files be attached.
