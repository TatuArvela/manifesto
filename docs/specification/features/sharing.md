# Sharing Notes via URL

Manifesto can share one note as a self-contained URL. The URL hash fragment contains all of the note
data. Thus, no server is necessary, and it works with all static hosts (for example, GitHub Pages).

You can never revoke such a link, because the link contains the note. In connected mode, you can
also publish a note through a [public link](#public-links). A public link is a server row that the
owner can revoke. It can have an expiry, a password and a view limit.

## How It Works

### Generating a Share Link

1. The user opens a note and selects **Share > Share link** from the kebab menu, or from the kebab
   menu of the card. If Share has no other items, as in open mode, **Share link** is directly in the
   menu.
2. The app encodes the shareable fields of the note into a compressed, URL-safe string.
3. The app copies the full URL (`https://host/#share=<payload>`) to the clipboard.
4. A toast shows "Link copied to clipboard".

### Opening a Share Link

1. The recipient opens the URL in a browser.
2. When the app starts, it finds `#share=` in the URL hash.
3. A modal shows the shared note as a read-only preview.
4. The recipient can select:
   - **Save**: the app creates a new note in the storage of the recipient (new ULID, current
     timestamps, default position).
   - **Discard**: the app closes the modal and changes nothing.
5. In both cases, the app removes the `#share=` hash from the URL.

## Payload

### Included Fields

The app encodes only the fields that are about the content:

| Field     | Type         | Description                |
|-----------|--------------|----------------------------|
| `title`   | `string`     | Note title                 |
| `content` | `string`     | Markdown content           |
| `color`   | `NoteColor`  | Color theme                |
| `font`    | `NoteFont`   | Font choice                |
| `tags`    | `string[]`   | Tags attached to the note  |

### Excluded Fields

These fields are specific to the receiver, or are temporary. The app does not share them:

- `id`: the receiver gets a new ULID.
- `position`: the receiver gets the default position.
- `pinned`, `archived`, `trashed`, `trashedAt`: the receiver gets a new active note.
- `createdAt`, `updatedAt`: the receiver gets the current timestamps.
- The version history is not included.

### Encoding

1. Build a JSON object with the included fields.
2. Serialize it to a JSON string.
3. Compress it with `compressToEncodedURIComponent` of LZ-String (the project already uses
   LZ-String).
4. Append it as `#share=<compressed>`.

`compressToEncodedURIComponent` gives a URI-safe string (A-Z, a-z, 0-9, `+`, `-`, with `$` as
padding). Thus, percent-encoding is not necessary.

### Decoding

1. Read `window.location.hash`.
2. Remove the `#share=` prefix.
3. Decompress it with `decompressFromEncodedURIComponent` of LZ-String.
4. Parse the JSON.
5. Make sure that the required fields are present and have the correct types.

## Size Limits

Most browsers accept URLs of 2,000 characters or more. A typical note (a title, some paragraphs and
tags) compresses to less than 500 characters. A note with very long content (more than 4 KB before
compression) can be larger than the practical URL limits. The app does not set a hard limit. It
shows a warning if the URL is longer than 2,000 characters.

## Trashed and Archived Notes

You can also share trashed notes and archived notes. The share payload contains only the content
fields. Thus, the recipient always gets a new active note, whatever the state of the original note.

## Public Links

In connected mode, the owner of a note can publish it through a public link that the owner can
revoke: **Public links** in the menu of the note. All persons with the link can read the note on its
own page (`/p/<token>` on the address of the app), without an account. It is off when the server sets
`PUBLIC_LINKS=off`. Then the menu does not show the item.

- **What it shows**: the title, the text (rendered and sanitized as on a card), the color, the font,
  the pictures and the link previews. It does not show the tags, the owner, or data about the
  position of the note among the notes of the owner.
- **Live or snapshot**: a live link shows the note as it is when you open the link. A snapshot shows
  the note as it was when you made the link, also after changes. The server keeps the pictures of a
  snapshot while the snapshot can open, also after the note removes them.
- **Expiry, password, view limit**: each is optional. You set them when you make the link. The
  server counts a view when it sends the note, thus after the password. A link after its limit or
  its expiry does not open. The pictures of a note continue to load for ten minutes after its last
  view. Thus, a link with a limit of one view shows them to that one viewer.
- **Revoking** deletes the link. It stops immediately, for all persons. The dialog lists each link
  with its view count, its last view, and if it has a password or has stopped.
- **The note controls the link**: while the note is in the trash, its links do not open. They work
  again if you restore the note. When you delete the note, its links are deleted.
- **Only the owner** can make, list and revoke the links of a note. A person who shares the note
  cannot publish it. Automatic notes and notes in the trash cannot be published.
- **All failures look the same**: a link that was never made, a revoked link, an expired link, a
  link at its view limit, and a link to a note in the trash all tell only that the link does not
  open a note. The server sets a limit on wrong passwords for each address and for each link. It
  checks the passwords of one link one at a time. Thus, guesses that arrive together still count.
- **Not for search engines**: the public routes send `X-Robots-Tag: noindex` and `no-store`. The page
  sends no `Referer`.

The token of a link is 128 random bits. The server keeps it as it is, so that the owner can copy the
link again. The server writes each new link and each revocation to the [audit log](accounts.md). The
app does not have links that can edit.
