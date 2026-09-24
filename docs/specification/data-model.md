# Data Model

## Note

A note is the fundamental entity in Manifesto.

### Schema

| Field       | Type             | Required | Description                              |
|-------------|------------------|----------|------------------------------------------|
| `id`        | `string`         | Yes      | ULID: unique, lexicographically sortable |
| `title`     | `string`         | Yes      | Note title (can be empty string)         |
| `content`   | `string`         | Yes      | Markdown content (can be empty string)   |
| `color`     | `NoteColor`      | Yes      | Color theme for the note                 |
| `font`      | `NoteFont`       | Yes      | Font style for the note                  |

| `pinned`    | `boolean`        | Yes      | Whether the note is pinned to the top    |
| `archived`  | `boolean`        | Yes      | Whether the note is archived             |
| `trashed`   | `boolean`        | Yes      | Whether the note is in trash             |
| `trashedAt` | `string \| null` | Yes      | ISO 8601 timestamp when trashed, `null` if not trashed. Server-assigned: it drives hard deletion 30 days later, so `POST`/`PUT` derive it from `trashed` and the server clock and ignore any value a client sends. |
| `position`  | `number`         | Yes      | Sort position for manual ordering (default sort mode) |
| `tags`      | `string[]`       | Yes      | Tags attached to the note                |
| `images`    | `string[]`       | Yes      | Attached images as `data:` URLs, or in connected mode `attachment:<id>` references; see [Images](#images) |
| `linkPreviews` | `LinkPreview[]` | Yes    | Link preview cards attached to the note  |
| `reminder`  | `NoteReminder \| null` | Yes | Scheduled reminder, or `null` when not set |
| `createdAt` | `string`         | Yes      | ISO 8601 creation timestamp              |
| `updatedAt` | `string`         | Yes      | ISO 8601 last modification timestamp. On a shared note, the last change by anyone, including a participant's change to their own personal fields |
| `sharing`   | `NoteSharing`    | No       | Who else has the note; see [NoteSharing](#notesharing). Server-assigned, connected mode only |

### Images

A client attaches images inline, as base64 `data:` URLs, rather than uploading them to a separate endpoint. In open mode they stay that way: the note is self-contained, and there is no server to upload to. In connected mode the server takes the bytes out of every note it is sent and stores them in its attachment store, and `images` holds `attachment:<id>` references to them (matching `ATTACHMENT_REF_PATTERN`). An export always inlines them again, so a file is self-contained in either mode. See [Attachments](features/attachments.md).

The accepted form is narrow, and the server enforces it on every write:

| Constraint | Value |
|------------|-------|
| Scheme | `data:`, or an `attachment:<id>` reference the writer may read. A remote `http(s)` URL in `images` is rejected. |
| Media type | `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/avif` |
| Encoding | `;base64,` followed by base64-alphabet characters, anchored at both ends |
| Per-image size | 5 MiB of source image, after the client has shrunk it (photos are kept at 2560 pixels on the long edge, see [Attachments](features/attachments.md)). Enforced on the encoded URL, whose cap is derived from it: base64 emits 4 characters per 3 bytes and the `data:image/…;base64,` prefix counts too, so a hand-rounded encoded cap rejects a full-size image 18 bytes short of the advertised number. |
| Images per note | 20 |
| Whole request | 1 MiB on `/api/notes`, since a note carries references; one image upload may be up to the per-image size |

`image/svg+xml` is **excluded on purpose.** SVG is a document format that happens to have an image media type: it can carry script, so admitting it would let a note ship executable markup into any surface that renders an attachment by URL. The same reasoning excludes every non-image `data:` media type.

The constants are declared once in `@manifesto/shared` (`IMAGE_DATA_URL_PATTERN`, `MAX_IMAGE_DATA_URL_BYTES`, `MAX_IMAGES_PER_NOTE`) and read by the client, the server's validation schemas, and this table.

Over-cap images are refused by the client before they are attached, so the user gets a message naming the file rather than a `422` from a later save.

Being inlined is what makes a note self-contained, and also what makes a list of
notes large: twenty attachments at 5 MB is a 100 MB note, and a hundred such
notes is a list response no client wants. So the bytes stay in the note but are
left out of a *listing*. A note from `GET /api/notes` or `GET /api/search`
carries `imageCount` and an empty `images`, and `GET /api/notes/:id` returns it
whole. `imageCount` is derived by the server from `images` on every write and is
never accepted from a client; in open mode it is absent, because nothing there
is ever separated from its note. See [API](api.md#attachments-are-not-in-a-listing).

### Identifiers

Notes use [ULID](https://github.com/ulid/spec) (Universally Unique Lexicographically Sortable Identifier) for the `id` field.

- Timestamp-prefixed, so they sort chronologically
- Globally unique without coordination (important for offline and sync scenarios)
- URL-safe, 26 characters
- Example: `01HWQA3Z5PKXJ8F0D0Y3MNWKQB`

### Timestamps

All timestamps are ISO 8601 strings in UTC.

- `createdAt` is set once when the note is created
- `updatedAt` is set on every modification
- Example: `2026-04-10T10:30:00.000Z`

## NoteColor

An enum of predefined color names. Using names instead of hex values allows the UI to map colors differently per theme (light vs. dark mode).

```
default | red | orange | yellow | green | teal | blue | purple | pink | brown | gray
```

The `default` color means no specific color; the note uses the base card background.

## NoteFont

An enum of font styles available for notes.

```
default | serif | monospace | permanent-marker | comic-relief | rouge-script
```

Each value is a kind of face rather than a named one, so a note looks alike on every device. The client labels them Sans-serif, Serif, Monospace, Marker, Comic and Script. `default` is the base application font, a sans-serif. `serif` and `monospace` are system font stacks ending in their generic family. `permanent-marker`, `comic-relief` and `rouge-script` are decorative web fonts loaded on demand.

## LinkPreview

A preview card attached to a note for a URL. Created only when a link is inserted via the editor toolbar or when a URL is pasted into the note's body, never regenerated on save. A note holds at most 20. See [Link Previews](features/link-previews.md).

| Field         | Type     | Required | Description                                |
|---------------|----------|----------|--------------------------------------------|
| `url`         | `string` | Yes      | Original URL, `http` or `https`, at most 2048 characters |
| `title`       | `string` | Yes      | Page title (falls back to the URL), at most 500 characters |
| `description` | `string` | No       | Short page description, at most 2000 characters |
| `image`       | `string` | No       | Thumbnail, inlined as an image `data:` URL of at most 64 KB |
| `favicon`     | `string` | No       | Site icon, inlined the same way            |
| `domain`      | `string` | Yes      | Host portion of the URL, e.g. `www.k-ruoka.fi` |

In open mode a preview is only `url`, `title = url` and `domain`. In connected mode the server reads the page and the client fills in the rest, shrinking the images to fit. `image` and `favicon` accept the same image subtypes as [Images](#images); a server also accepts an `http(s)` URL there, so a row written before previews were inlined stays updatable, but the client never writes one and drops it on import.

## NoteSharing

Present on a note that has been shared with at least one other account, as the reader sees it.
Server-assigned and never accepted from a client; absent in open mode and on a note nobody was
invited to. See [Sharing with People](features/sharing-with-people.md).

| Field     | Type                          | Description |
|-----------|-------------------------------|-------------|
| `role`    | `"owner" \| "edit" \| "view"` | The reader's relationship to the note |
| `owner`   | `ShareUser`                   | Whose note it is |
| `members` | `NoteMember[]`                | Everyone but the owner, by when they were invited. The owner is also told about invitations not yet accepted; everyone else sees only the people who accepted |

`ShareUser` is `{ id, username, displayName, avatarColor }`. `NoteMember` adds `role`
(`"edit"` or `"view"`) and `accepted` (a boolean).

The fields of a shared note split in two, declared once in `@manifesto/shared` as
`SHARED_NOTE_FIELDS` and `PERSONAL_NOTE_FIELDS`:

| Shared by everyone | Each participant's own |
|--------------------|------------------------|
| `title`, `content`, `font`, `images`, `linkPreviews` | `color`, `pinned`, `archived`, `trashed`, `trashedAt`, `position`, `tags`, `reminder` |

`readonly` and `source` are the owner's alone. A recipient's `trashed` is their own trash; the
owner's is different, because a note in its owner's trash is not shown to anyone else at all.

## NoteReminder

A scheduled reminder attached to a note. See [Reminders](features/reminders.md) for the delivery model.

| Field         | Type                  | Required | Description                                 |
|---------------|-----------------------|----------|---------------------------------------------|
| `time`        | `string`              | Yes      | ISO 8601 local-wall-clock datetime when the reminder next fires |
| `recurrence`  | `ReminderRecurrence`  | Yes      | `none` \| `daily` \| `weekly` \| `monthly` \| `yearly` |
| `timezone`    | `string`              | Yes      | IANA timezone captured at creation          |
| `lastFiredAt` | `string`              | No       | ISO 8601 of the last actual fire, used for cross-tab / service-worker dedupe |

## NoteVersion

A snapshot of a note's title and content at a point in time, used for [Version History](features/version-history.md).

| Field       | Type     | Required | Description                              |
|-------------|----------|----------|------------------------------------------|
| `noteId`    | `string` | Yes      | ULID of the note this version belongs to |
| `timestamp` | `string` | Yes      | ISO 8601 timestamp when the version was captured |
| `title`     | `string` | Yes      | Note title at this point in time         |
| `content`   | `string` | Yes      | Note content at this point in time       |

## Example

```json
{
  "id": "01HWQA3Z5PKXJ8F0D0Y3MNWKQB",
  "title": "Shopping list",
  "content": "## Groceries\n- [x] Milk\n- [ ] Eggs\n- [ ] Bread\n\nDon't forget **coupons**!",
  "color": "yellow",
  "font": "default",
  "position": 1024,
  "pinned": true,
  "archived": false,
  "trashed": false,
  "trashedAt": null,
  "tags": ["personal"],
  "images": [],
  "linkPreviews": [],
  "reminder": null,
  "createdAt": "2026-04-10T10:30:00.000Z",
  "updatedAt": "2026-04-10T14:22:00.000Z"
}
```
