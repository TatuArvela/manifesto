# Sharing Notes via URL

Manifesto supports sharing individual notes as self-contained URLs. The note data is encoded entirely in the URL hash fragment, so no server is required; it works with any static host (e.g., GitHub Pages).

A link made that way can never be taken back, since it carries the note itself. In connected mode a
note can also be published by a [public link](#public-links): a server row the owner can revoke,
with an expiry, a password and a view limit.

## How It Works

### Generating a Share Link

1. User opens a note and selects **Share link** from the kebab menu (or from the card's kebab menu)
2. The app encodes the note's shareable fields into a compressed, URL-safe string
3. The full URL (`https://host/#share=<payload>`) is copied to the clipboard
4. A toast confirms "Link copied to clipboard"

### Opening a Share Link

1. Recipient opens the URL in their browser
2. The app detects `#share=` in the URL hash on startup
3. A modal shows the shared note as a read-only preview
4. The recipient can:
   - **Save**: creates a new note in their storage (new ULID, current timestamps, default position)
   - **Discard**: dismisses the modal with no side effects
5. The `#share=` hash is cleared from the URL in both cases

## Payload

### Included Fields

Only content-related fields are encoded:

| Field     | Type         | Description                |
|-----------|--------------|----------------------------|
| `title`   | `string`     | Note title                 |
| `content` | `string`     | Markdown content           |
| `color`   | `NoteColor`  | Color theme                |
| `font`    | `NoteFont`   | Font choice                |
| `tags`    | `string[]`   | Tags attached to the note  |

### Excluded Fields

These are receiver-specific or ephemeral and are not shared:

- `id`: receiver gets a new ULID
- `position`: receiver gets default position
- `pinned`, `archived`, `trashed`, `trashedAt`: receiver gets a fresh active note
- `createdAt`, `updatedAt`: receiver gets current timestamps
- Version history is not included

### Encoding

1. Build a JSON object with the included fields
2. Serialize to a JSON string
3. Compress with LZ-String's `compressToEncodedURIComponent` (already a project dependency)
4. Append as `#share=<compressed>`

`compressToEncodedURIComponent` produces a URI-safe string (A-Z, a-z, 0-9, `+`, `-`, with `$` as padding), so no percent-encoding is needed.

### Decoding

1. Read `window.location.hash`
2. Strip the `#share=` prefix
3. Decompress with LZ-String's `decompressFromEncodedURIComponent`
4. Parse the JSON
5. Validate that required fields are present and have correct types

## Size Limits

Most browsers support URLs of at least 2,000 characters. A typical note (title + a few paragraphs + tags) compresses to under 500 characters. Notes with very long content (>4 KB uncompressed) may exceed practical URL limits. The app does not enforce a hard limit but warns the user if the generated URL exceeds 2,000 characters.

## Trashed and Archived Notes

Trashed and archived notes can still be shared: the share payload only carries content fields, so the recipient always gets a fresh, active note regardless of the original's state.

## Public Links

In connected mode, a note's owner can publish it by a revocable public link: **Public links** in the
note's menu. Anyone holding the link reads the note on a page of its own (`/p/<token>` on the app's
address), with no account. It is off when the server sets `PUBLIC_LINKS=off`, and the menu item is
not shown then.

- **What it shows**: the title, the text (rendered and sanitized like a card), the colour, the font,
  the pictures and the link previews. Not the tags, the owner, or anything about the note's place
  among the owner's notes.
- **Live or snapshot**: a live link shows the note as it is when opened; a snapshot shows it as it was
  when the link was made, whatever changes after. A snapshot's pictures are kept for it while it can
  still be opened, even after the note drops them.
- **Expiry, password, view limit**: each optional, set when the link is made. A view is counted when
  the note is handed out, so after the password, and a link past its limit or its expiry no longer
  opens. The pictures of a note still load for ten minutes after its last view, so a link limited to
  one view shows them to that one viewer.
- **Revoking** deletes the link: it stops working at once, for everyone. The dialog lists each link
  with its view count, its last view and whether it has a password or has stopped.
- **The note's life decides the link's**: while the note is in the trash its links do not open, and
  come back if it is restored; deleting the note deletes them.
- **Only the owner** makes, lists and revokes a note's links; someone it is shared with cannot
  publish it. Automatic notes and notes in the trash cannot be published.
- **Every failure looks the same**: a link never made, revoked, expired, used up, or on a note in the
  trash all say only that the link does not open a note. Wrong passwords are limited per address and
  per link.
- **Not for search engines**: the public routes send `X-Robots-Tag: noindex` and `no-store`, and no
  `Referer` leaves the page.

A link's token is 128 random bits, kept as it is so the owner can copy the link again. Making and
revoking a link are written to the [audit log](accounts.md).

### Links that can edit

A live link can be made with **Anyone with the link can edit**. Its page then has an Edit button, and
whoever holds the link can change the note's title and text, with no account.

- **What it may change**: the title and the text, as Markdown, and nothing else: not the colour, the
  tags, the pictures or anything about the note's place among the owner's notes. A snapshot cannot be
  made editable, and neither can a link with a view limit, which would stop its holder half way.
- **On top of what was shown**: an edit is sent with the time of the copy it was made from, and is
  refused (`412`) if the note has changed since, so nobody writes over a change they never saw. The page
  then replays the visitor's edit onto the note as it now stands where that can be done without
  guessing and saves once more; where it cannot, it shows the note as it stands, keeps the visitor's
  text in the editor, and leaves the choice to them.
- **Reaching the owner**: the write is the owner's as far as storage goes and reaches their open tabs
  like any other. An editor open on the note takes it in as it does a write through the API or MCP.
  Editing through a link is not live collaboration: the visitor saves, and does not see the owner type.
- **What is kept**: the first edit of a sitting (thirty minutes) keeps the note as it stood in its
  [version history](version-history.md), marked "Before an edit through a public link", and writes
  "Note edited through a public link" to the audit log with the first characters of the link's token,
  where the owner's own Activity page shows it. Later saves in the same sitting do neither.
- **Limits**: on top of the limit on public link requests, an address makes at most 60 edits a minute
  and one link takes at most 600 an hour from anywhere.
- **Failing the same way**: an edit sent to a link that only reads, that has expired or been revoked,
  whose note is in the trash, or without the password's proof, answers as a link that does not exist.

A link that can edit lets anyone who gets hold of it change the note, so it is for a shopping list sent
to the household, not for anything the owner would mind finding rewritten. Revoking it stops it at once.
Not offered: editing live alongside the owner (an anonymous writer on the collaboration socket).
