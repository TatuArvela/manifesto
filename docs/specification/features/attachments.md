# Attachments

A note carries up to `MAX_IMAGES_PER_NOTE` images of up to 1.5 MB each. Open mode keeps them inline in
the note, as `data:` URLs, because the note in `localStorage` is all there is. Connected mode keeps them
outside the note, in the server's **attachment store**, and the note refers to each one as
`attachment:<id>` (`isAttachmentRef` in `@manifesto/shared`).

Inline, every note write, every conflict retry, every `GET /api/notes/:id` and every version a client
keeps would carry the bytes of every image on the note. Referred to, they carry a few dozen bytes each,
and the bytes travel once.

## How an image gets there

The client does not upload anything separately. It attaches an image as it always has, inline, and the
server takes the bytes out on the way in: on `POST /api/notes` and on a `PUT` that sends `images`, each
`data:` image is put in the store and replaced with its reference before the note is written. Replies,
broadcasts and listings then carry the reference.

- **Content-addressed per owner.** An attachment is keyed by the SHA-256 of its bytes within its
  owner's store, so the same image sent again (a conflict retry, a stale tab, a duplicate note) resolves
  to the attachment that already holds it rather than a second copy.
- **Owned by the note's owner.** An editor adding an image to someone else's note stores it under the
  note's owner, whose notes it belongs to and whose sweep collects it.
- **References are checked.** A reference the owner already holds passes through. One held by another
  account is copied into the owner's store if the writer may read it (an editor copying an image out of
  a note shared with them); otherwise the write is refused with 422, so a crafted reference cannot lend
  a note someone else's image.

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

## Existing notes

Images written before the store existed are moved into it by the job's first run at startup,
(`moveInlineImagesToStore`), a batch at a time. The move does not stamp `updated_at`: it changes how an
image is held, not the note, and must not invalidate an `If-Match` token a client holds. Until a note
is moved it is served inline as before, and both forms can sit in one `images` array.

## Storage

Attachments live in the database (`attachments`: `BLOB` in SQLite, `BYTEA` in Postgres), so a database
backup is a complete backup. A disk or S3-compatible backend behind the same `AttachmentsRepo` is
possible later, and would let non-image files be attached.
