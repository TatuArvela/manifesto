# Sharing Notes via URL

Manifesto supports sharing individual notes as self-contained URLs. The note data is encoded entirely in the URL hash fragment, so no server is required — it works with any static host (e.g., GitHub Pages).

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
   - **Save** — creates a new note in their storage (new ULID, current timestamps, default position)
   - **Discard** — dismisses the modal with no side effects
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

- `id` — receiver gets a new ULID
- `position` — receiver gets default position
- `pinned`, `archived`, `trashed`, `trashedAt` — receiver gets a fresh active note
- `createdAt`, `updatedAt` — receiver gets current timestamps
- Version history is not included

### Encoding

1. Build a JSON object with the included fields
2. Serialize to a JSON string
3. Compress with LZ-String's `compressToEncodedURIComponent` (already a project dependency)
4. Append as `#share=<compressed>`

`compressToEncodedURIComponent` produces a URI-safe string (A-Z, a-z, 0-9, `+`, `-`, with `$` as padding) — no percent-encoding needed.

### Decoding

1. Read `window.location.hash`
2. Strip the `#share=` prefix
3. Decompress with LZ-String's `decompressFromEncodedURIComponent`
4. Parse the JSON
5. Validate that required fields are present and have correct types

## Size Limits

Most browsers support URLs of at least 2,000 characters. A typical note (title + a few paragraphs + tags) compresses to under 500 characters. Notes with very long content (>4 KB uncompressed) may exceed practical URL limits. The app does not enforce a hard limit but warns the user if the generated URL exceeds 2,000 characters.

## Trashed and Archived Notes

Trashed and archived notes can still be shared — the share payload only carries content fields, so the recipient always gets a fresh, active note regardless of the original's state.
