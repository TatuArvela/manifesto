# Attachments

A note carries up to `MAX_IMAGES_PER_NOTE` images of up to 5 MB each, and in both modes the note holds
**references**, never the bytes:

- **Connected mode:** `attachment:<id>`, an image in the server's attachment store (below).
- **Open mode:** `local:<sha256>`, an image in this browser's IndexedDB (`storage/localImages.ts`).

A link preview's thumbnail and favicon are held the same way, and everything below applies to them
too: they are sealed, claimed for the note's owner, served to its recipients, swept when no preview
or image refers to them, and inlined again on export (where one that cannot be read is left out and its card
kept, since it is a picture of the linked page rather than something the user attached).

`data:` URLs appear only in export and import files. Inline, every note write, every conflict retry,
every `GET /api/notes/:id` would carry the bytes of every image on the note, and in open mode a few
photos filled `localStorage`'s ~5 MB, after which every save failed, text included. Referred to, a note
carries a few dozen bytes per image. `StoredImage` draws either kind through a `blob:` URL.

## Drawings

**Draw** in an open note's menu opens a drawing pad: a sheet of white paper to draw on with a finger, a
pen or a mouse. Done puts the drawing on the note as a PNG image, through the same path as an attached
picture, so it is stored, shown, shared and exported like one, and takes one of the note's image slots.

- Four inks (black, red, blue, green), three pen widths, an eraser, undo of the last stroke, and clear.
  A tap leaves a dot.
- The paper is 1600 by 1200 and opaque, so a drawing reads the same on a note of any colour and in
  either theme. It is shown as large as fits, keeping its shape.
- One pointer draws at a time, the first one down: a second finger or a resting palm is ignored. No
  gesture of the page takes a stroke away (the paper alone has `touch-action: none`), the stroke follows
  the pointer past the paper's edge, and a touch the system cancels keeps what was drawn.
- Closing the pad with a drawing on it asks first, by the close button, Escape or Back, and choosing
  not to discard leaves Back the pad's. Done on empty paper adds nothing. Done or closing with the pen
  still down counts the line being drawn.
- If the picture cannot be made, the pad says so and stays open with the drawing on it.
- The pad is not offered on a note that cannot be changed (shared to view, or an auto-note).

### Drawing over an image

Each image in an open note has a **Draw on image** button beside its delete button (both shown as the
image is pointed at, and always on a touch screen). It opens that image
on the pad as the paper, and Done puts the result in the image's place (at the end, if the image was
removed meanwhile). This is how a drawing is changed after it is saved, and how a photo is annotated.

- A drawing is a picture once it is on the note, so its old lines are part of the paper: undo and clear
  reach only the lines of this sitting, and the eraser paints white over whatever is under it, a photo
  included. Keeping the strokes would need somewhere to store them beside the image.
- The paper takes the image's shape. Its long edge is at least a new drawing's 1600 (a line drawn on a
  thumbnail would be blocks) and at most `MAX_IMAGE_EDGE`; pens are scaled to look the same width on
  screen.
- The result is a PNG, which keeps lines crisp however often a drawing is reopened, unless that comes
  to over a megabyte, as it does over a photo: then it is a JPEG. An animated GIF becomes a still.
- Done with nothing drawn leaves the image as it was. The original is replaced, not kept, and the
  drawing takes its description, which still says what is under the lines.

### Describing an image

Each image in an open note also has a **Describe image** button, which opens the image viewer with
the focus on a description field under the image; the viewer has the field whenever the note can be
changed. The description is what a screen reader reads in the image's place: every view of the note
shows it as the image's `alt`, and names the image's open button with it. It is saved when the field
is left, the viewer moves to another image or closes, and only if it changed. See
[Images](../data-model.md#images) for how it is kept, and [Accessibility](../accessibility.md).

## Shrinking on attach

Before an image is stored, in either mode, the client makes it a sensible size (`utils/shrinkImage.ts`):
an image larger than 2560 pixels on its long edge is redrawn at 2560 and re-encoded, as WebP (JPEG where
the browser cannot encode WebP), or as PNG if it was a PNG, so screenshots stay crisp. An image within
the edge but over a megabyte is re-encoded only if that makes it smaller, and smaller images and GIFs
(whose animation a redraw would stop) are kept byte for byte. A phone photo usually comes out a few
hundred kilobytes, and the redraw drops its EXIF data (camera, location). The 5 MB limit is the ceiling
for what is not shrunk.

## Sealed in the browser

In connected mode an image is encrypted before it is uploaded, and the server stores bytes it cannot
read ([Encryption](encryption.md#images)):

- **Its key** is made from the uploader's account key and the image's own bytes (an HMAC), and the
  image is sealed under it with AES-256-GCM.
- **Its address** is a second HMAC of the bytes, under another key of the account's. The server finds
  an attachment by it, so the same image sent again (a conflict retry, a stale tab, a duplicate note)
  resolves to the attachment that already holds it, and the address says nothing to anyone without
  the key.
- **The key travels in the note.** The note's sealed list of images holds each one's id, key and
  type, which is how every device of the account, and everyone a note is shared with, opens them. A
  preview's thumbnail and icon are held the same way inside the sealed previews. In the app a note
  names its images by reference alone, and the keys wait beside it (`Sealer` in
  `storage/sealing.ts`) to be sealed back in.
- **The type** is the client's to say and to check. The sealing client reads it from the image's
  leading bytes (PNG, JPEG, GIF, WebP, AVIF), whatever the file was handed over as, and refuses
  anything else. The opening client takes only those five types and checks the leading bytes again
  after decrypting, since the type in a note was written by whoever attached the image; one that
  fails is not shown.

## How an image gets there

The client uploads each image as it is attached: `POST /api/attachments` with the sealed bytes (no
base64) and the image's address in `X-Attachment-Address`, answered with
`{ ref: "attachment:<id>" }`. The editor draws the image at once from the local file, shows the
upload's progress, and puts the reference in the note when it is stored. A failed upload stays in
the editor, marked, with **Try again** and **Remove**, rather than saving a note that refers to
nothing; closing the editor cancels what is still uploading. The REST adapter also uploads any image
that reaches a note write still inline (an import, something shared to the app), so what it sends is
references.

The server stores what it is sent as bytes of no stated kind: sealed, an image cannot be told from
anything else, so nothing is read from its leading bytes any more. An upload without an address, or
with nothing in it, is 422; over the image limit (plus the 28 bytes sealing adds) is 413. An upload
is stored under the uploader, once for an address.

## Reading

`GET /api/attachments/:id` returns the sealed bytes as `application/octet-stream`, to the owner and
to anyone holding an accepted share of a note of the owner's that refers to it, while the owner has
not trashed that note. To anyone else it is a 404. The response is `Cache-Control: private, immutable`
(an id names one set of bytes for good), `nosniff`, and carries a sandboxing CSP. It has its own
per-user rate limit, wider than the notes API's, since a grid asks for one image per card.

The client fetches each attachment once per session, opens it with the key its note holds, and shows
it through a `blob:` URL of the type it turned out to be (`state/attachments.ts`,
`components/StoredImage.tsx`), which the page's CSP already allows.

## Leaving the session

Anything that leaves the session carries the bytes, never a reference only this server can read: the
export zip and a single note's JSON download inline every attachment again, and give up with an error
rather than write a file missing a picture. Importing such a file into a server stores the images again.

## Sweeping

`attachments.sweep` runs hourly on `startPeriodicJob` (`jobs/attachmentCleanup.ts`). It marks an
attachment no note refers to with the time it noticed, clears the mark when a note refers to it again,
and deletes it once it has been unreferenced for 90 days. That matches the client's version history,
which refers to attachments by id and keeps versions for 90 days, so a version restored within its life
still finds its images.

## Note writes

A note names its images inside ciphertext, so a write that carries the sealed list carries the
references it names beside it (`imageRefs`, and `previewRefs` for link previews): these are the
server's record of which attachments a note uses, for serving them to its recipients and for the
sweep. Each must be an `attachment:<id>` reference; anything else is refused with 422. Note writes
are held to the same 1 MiB body limit as the rest of the API, and uploads (one sealed image, up to
the image limit) are the only route allowed more.

Every attachment a note refers to belongs to the note's owner, whose notes it is swept with and
whose account it goes with. A readable note could have a reference rewritten under it; a sealed one
cannot, so the image is made the owner's before the note is sealed:

- **`POST /api/attachments/claim`** takes `{ noteId?, refs }` and answers `{ refs }`, the owner's own
  reference for each in order. One the owner already holds comes back as it is. One held by another
  account (an editor's own upload, or an image copied out of a note shared with them) is stored again
  for the owner if the caller may read it, under a new id: the sealed bytes are the same, so the key
  the note holds still opens them. `noteId` is the note about to be written, and absent for one not
  made yet, whose owner is the caller. A viewer is refused (403), and so is a reference the caller
  cannot read (422). A token that carries keys does not call it: the server makes the images of a
  token's write the owner's as it seals the note, and the key kept with the token's upload goes
  into the note under the owner's reference.
- **The write** then names the references it was given. One that is not the owner's by then is
  refused with 422 (`attachments/store.ts`), or a crafted reference would lend a note someone else's
  image.

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
