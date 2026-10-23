# Data Model

## Note

A note is the main entity in Manifesto.

### Schema

| Field       | Type             | Required | Description                              |
|-------------|------------------|----------|------------------------------------------|
| `id`        | `string`         | Yes      | ULID: unique, lexicographically sortable |
| `title`     | `string`         | Yes      | Note title (can be an empty string)      |
| `content`   | `string`         | Yes      | Markdown content (can be an empty string) |
| `color`     | `NoteColor`      | Yes      | Color theme for the note                 |
| `font`      | `NoteFont`       | Yes      | Font style for the note                  |

| `pinned`    | `boolean`        | Yes      | If the note is pinned to the top         |
| `archived`  | `boolean`        | Yes      | If the note is archived                  |
| `trashed`   | `boolean`        | Yes      | If the note is in the trash              |
| `trashedAt` | `string \| null` | Yes      | ISO 8601 timestamp of the move to the trash, `null` if not trashed. The server sets it. It controls the hard deletion 30 days later. Thus, `POST`/`PUT` calculate it from `trashed` and the server clock, and ignore all values that a client sends. |
| `position`  | `number`         | Yes      | Sort position for manual ordering (default sort mode) |
| `tags`      | `string[]`       | Yes      | Tags attached to the note                |
| `images`    | `string[]`       | Yes      | References to attached images: `attachment:<id>` in connected mode, `local:<sha256>` in open mode. See [Images](#images) |
| `imageAlts` | `string[]`       | No       | The description of each image, in the order of `images`. `""` for an image without one. Absent when no image has one. See [Images](#images) |
| `linkPreviews` | `LinkPreview[]` | Yes    | Link preview cards attached to the note  |
| `reminder`  | `NoteReminder \| null` | Yes | Scheduled reminder, or `null` when not set |
| `createdAt` | `string`         | Yes      | ISO 8601 creation timestamp              |
| `updatedAt` | `string`         | Yes      | ISO 8601 timestamp of the last change. On a shared note, it is the last change by any person. This includes a change by a participant to their own personal fields |
| `sharing`   | `NoteSharing`    | No       | Who else has the note. See [NoteSharing](#notesharing). The server sets it, in connected mode only |

### Images

A note contains references to its images, never their bytes:

- `attachment:<id>` (a ULID that matches `ATTACHMENT_REF_PATTERN`): an image that the client uploaded
  to the attachment store of the server.
- `local:<sha256>` (`LOCAL_IMAGE_REF_PATTERN`): an image that open mode keeps in the IndexedDB of the
  browser.

A server accepts only the first. An export replaces both with `data:` URLs. Thus, a file is
self-contained in both modes. An import stores those images again. See
[Attachments](features/attachments.md).

These are the limits for an image. The client checks them before it stores an image, and the server
checks them on upload:

| Constraint | Value |
|------------|-------|
| Media type | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`. The server reads it from the first bytes of an upload |
| Per-image size | 5 MiB (`MAX_IMAGE_SOURCE_BYTES`), after the client makes it smaller. Photos are kept at 2560 pixels on the long edge |
| Images per note | 20 |
| Whole request | 1 MiB on `/api/v1/notes`, because a note contains only references. One upload can be up to the per-image size |

`image/svg+xml` is **excluded on purpose.** SVG is a document format that has an image media type. It can contain script. If the app accepted it, a note could send executable markup into each surface that renders an attachment by URL.

In an export or import file, an image is a base64 `data:` URL (`IMAGE_DATA_URL_PATTERN`, `MAX_IMAGE_DATA_URL_BYTES`). This is the only place where bytes and a note go together.

The client refuses images that are larger than the limit before it stores them. Thus, the user gets a message with the name of the file, not an error from a later save.

Each image can have a description (`imageAlts`), up to 1000 characters (`MAX_IMAGE_ALT_LENGTH`). A
screen reader reads this text in place of the image. Each view of the note uses it as the `alt` of the
image. It stays aligned with `images`:

- An image keeps its own description when it moves.
- A removed image removes its description.
- A drawing over an image gets the description of that image.

In a sealed note, the description is inside the entry of the image in the sealed list. Thus, it is
never written separately from the list.

A card gets only the images that it shows. A note contains references, and the bytes of each image
come from `GET /api/v1/attachments/:id`.

### On the server

This page describes a note as the app keeps it. In connected mode, the server never sees a note in
this form. The browser seals `title`, `content`, `font`, `images`, `linkPreviews`, `color` and `tags`
before the note goes out, and the server stores a `SealedNote` ([API](api.md#sealed-notes),
[Encryption](features/encryption.md)). The client that seals a note applies the limits on this page
(500 characters for a title, 50 tags). The client that opens a note applies them again.

### Format

What the words of a note contain (the text, the image entries, the link previews) can change from
one release to the next. Thus, each place that keeps a note records the **format** of the note. The
format is a number. It is 1 for all notes from before the app recorded formats. Each change makes it
one higher (`currentNoteFormat()` in `packages/shared/src/noteFormat.ts`). The app always keeps a
note in the current format:

- **Reading**: when the app reads a note in an older format, it upgrades the words with the steps in
  `NOTE_FORMAT_STEPS`, one for each format, in order. A read changes nothing in the place that keeps
  the note.
- **Writing**: a write records the current format. A sealed note keeps one format for all of its
  words. Thus, a write that changes a word of a note in an older format sends all words. It sends the
  words that it did not change as it read and upgraded them.
- **A newer format**: if the format is newer than the build can read, the app never shows the note as
  if it understood it, and never writes over it. You must reload an older tab or a cached build
  first.

| Where | Records the format in | Newer than this build |
|---|---|---|
| Open mode | `manifesto:notes:format`, for the notes and their versions together. The app upgrades it one time, as a whole | Not read and not written. Each action tells you to reload |
| Connected mode | `format` on each sealed note, version and public link snapshot. It is not sealed ([API](api.md#sealed-notes)) | Not on the board. The board tells how many, and tells you to reload. The server refuses a write in an older format (`409`, `note_format_newer`) |
| An export | `manifest.json` in the zip ([Export and Import](features/export-import.md#export)) | The app refuses the import |
| Notes not stored yet | Each record of the draft of the composer, and of the unsent notes on the device | The app does not change them. They stay for the newer build |

A format describes only the words. When a note opens, the app checks the color, the tags and the
other fields. The shared document in which a note is edited has its own version
(`EDITOR_SCHEMA_VERSION`).

### Identifiers

Notes use a [ULID](https://github.com/ulid/spec) (Universally Unique Lexicographically Sortable Identifier) for the `id` field.

- It starts with a timestamp. Thus, ULIDs sort in time order.
- It is globally unique without coordination. This is important for offline use and for sync.
- It is URL-safe, with 26 characters.
- Example: `01HWQA3Z5PKXJ8F0D0Y3MNWKQB`

### Timestamps

All timestamps are ISO 8601 strings in UTC.

- The app sets `createdAt` one time, when it creates the note.
- The app sets `updatedAt` on each change.
- Example: `2026-04-10T10:30:00.000Z`

## NoteColor

An enum of predefined color names. The enum uses names, not hex values. Thus, the UI can give each theme (light mode and dark mode) different colors.

```
default | red | orange | yellow | green | teal | blue | purple | pink | brown | gray
```

The `default` color means no specific color. The note uses the base card background.

## NoteFont

An enum of the font styles that notes can use.

```
default | serif | monospace | permanent-marker | comic-relief | rouge-script
```

Each value is a type of face, not a named face. Thus, a note looks the same on all devices. The client shows them as Sans-serif, Serif, Monospace, Marker, Comic and Script. `default` is the base font of the application, a sans-serif. `serif` and `monospace` are system font stacks that end in their generic family. `permanent-marker`, `comic-relief` and `rouge-script` are decorative web fonts that load on demand.

## LinkPreview

A preview card for a URL, attached to a note. The app makes it only when you insert a link with the editor toolbar, or paste a URL into the body of the note. It never makes it again on save. A note can have a maximum of 20. See [Link Previews](features/link-previews.md).

| Field         | Type     | Required | Description                                |
|---------------|----------|----------|--------------------------------------------|
| `url`         | `string` | Yes      | The original URL, `http` or `https`, a maximum of 2048 characters |
| `title`       | `string` | Yes      | The title of the page (or the URL, if there is no title), a maximum of 500 characters |
| `description` | `string` | No       | A short description of the page, a maximum of 2000 characters |
| `image`       | `string` | No       | A thumbnail. It is a stored image reference, as in [Images](#images) |
| `favicon`     | `string` | No       | The site icon, kept in the same way               |
| `domain`      | `string` | Yes      | The host part of the URL, for example `www.k-ruoka.fi` |

In open mode, a preview has only `url`, `title = url` and `domain`. In connected mode, the server reads the page, and the client fills the other fields. The client makes each image 64 KB or smaller, and uploads it as an attachment. Thus, `image` and `favicon` are `attachment:` references. For a preview imported in open mode, they are `local:` references. As for `images`, a `data:` URL shows only in an export or import file. A server also accepts an `http(s)` URL there. Thus, you can still update a row written before the app stored previews. But the client never writes such a URL, and removes it on import.

## NoteSharing

This field is present on a note that is shared with one or more other accounts. It shows the note as
the reader sees it. The server sets it, and never accepts it from a client. It is absent in open
mode, and on a note to which nobody was invited. See
[Sharing with People](features/sharing-with-people.md).

| Field     | Type                          | Description |
|-----------|-------------------------------|-------------|
| `role`    | `"owner" \| "edit" \| "view"` | The relation of the reader to the note |
| `owner`   | `ShareUser`                   | The owner of the note |
| `members` | `NoteMember[]`                | All persons other than the owner, in the order of their invitations. The owner also sees the invitations that are not accepted yet. All other persons see only the people who accepted |

`ShareUser` is `{ id, username, displayName, avatarColor }`. `NoteMember` adds `role`
(`"edit"` or `"view"`) and `accepted` (a boolean).

The fields of a shared note are in two groups. `@manifesto/shared` declares them one time, as
`SHARED_NOTE_FIELDS` and `PERSONAL_NOTE_FIELDS`:

| Shared by all persons | Personal to each participant |
|--------------------|------------------------|
| `title`, `content`, `font`, `images`, `imageAlts`, `linkPreviews` | `color`, `pinned`, `archived`, `trashed`, `trashedAt`, `position`, `tags`, `reminder` |

`readonly` and `source` belong only to the owner. The `trashed` of a recipient is their own trash.
The `trashed` of the owner is different, because no other person sees a note that is in the trash of
its owner.

## NoteReminder

A scheduled reminder, attached to a note. See [Reminders](features/reminders.md) for the delivery model.

| Field         | Type                  | Required | Description                                 |
|---------------|-----------------------|----------|---------------------------------------------|
| `time`        | `string`              | Yes      | ISO 8601 local wall-clock time of the next fire of the reminder |
| `recurrence`  | `ReminderRecurrence`  | Yes      | `none` \| `daily` \| `weekly` \| `monthly` \| `yearly` |
| `day`         | `number`              | No       | 1 to 31: the day of the month on which a monthly or yearly reminder repeats. It is present only while a shorter month clamped `time` to a different day ([Recurrence](features/reminders.md#recurrence)) |
| `timezone`    | `string`              | Yes      | The IANA timezone, recorded at creation          |
| `lastFiredAt` | `string`              | No       | ISO 8601 time of the last real fire. The tabs and the service worker use it to prevent duplicates |
| `urgent`      | `true`                | No       | An urgent reminder stays at its time when it fires, and fires again until the user marks it done ([Urgent reminders](features/reminders.md#urgent-reminders)). Present only as `true` |

## NoteVersion

A snapshot of the title and the content of a note at one time. [Version History](features/version-history.md) uses it.

| Field       | Type     | Required | Description                              |
|-------------|----------|----------|------------------------------------------|
| `noteId`    | `string` | Yes      | The ULID of the note of this version |
| `timestamp` | `string` | Yes      | ISO 8601 timestamp of the time when the app recorded the version |
| `title`     | `string` | Yes      | The note title at that time               |
| `content`   | `string` | Yes      | The note content at that time            |

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
