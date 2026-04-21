# Data Model

## Note

A note is the fundamental entity in Manifesto.

### Schema

| Field       | Type             | Required | Description                              |
|-------------|------------------|----------|------------------------------------------|
| `id`        | `string`         | Yes      | ULID — unique, lexicographically sortable |
| `title`     | `string`         | Yes      | Note title (can be empty string)         |
| `content`   | `string`         | Yes      | Markdown content (can be empty string)   |
| `color`     | `NoteColor`      | Yes      | Color theme for the note                 |
| `font`      | `NoteFont`       | Yes      | Font style for the note                  |

| `pinned`    | `boolean`        | Yes      | Whether the note is pinned to the top    |
| `archived`  | `boolean`        | Yes      | Whether the note is archived             |
| `trashed`   | `boolean`        | Yes      | Whether the note is in trash             |
| `trashedAt` | `string \| null` | Yes      | ISO 8601 timestamp when trashed, `null` if not trashed |
| `position`  | `number`         | Yes      | Sort position for manual ordering (default sort mode) |
| `tags`      | `string[]`       | Yes      | Tags attached to the note                |
| `images`    | `string[]`       | Yes      | Attached images as data URLs             |
| `linkPreviews` | `LinkPreview[]` | Yes    | Link preview cards attached to the note  |
| `reminder`  | `NoteReminder \| null` | Yes | Scheduled reminder, or `null` when not set |
| `createdAt` | `string`         | Yes      | ISO 8601 creation timestamp              |
| `updatedAt` | `string`         | Yes      | ISO 8601 last modification timestamp     |

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

The `default` color means no specific color — the note uses the base card background.

## NoteFont

An enum of font styles available for notes.

```
default | permanent-marker | comic-relief
```

The `default` font uses the base application font. `permanent-marker` and `comic-relief` are decorative web fonts loaded on demand.

## LinkPreview

A preview card attached to a note for a URL. Created only when a link is inserted via the editor toolbar or when a URL is pasted — never regenerated on save.

| Field         | Type     | Required | Description                                |
|---------------|----------|----------|--------------------------------------------|
| `url`         | `string` | Yes      | Original URL                               |
| `title`       | `string` | Yes      | Page title (falls back to the URL)         |
| `description` | `string` | No       | Short page description                     |
| `image`       | `string` | No       | Thumbnail image URL (og:image / twitter:image) |
| `favicon`     | `string` | No       | Site favicon URL                           |
| `domain`      | `string` | Yes      | Host portion of the URL, e.g. `www.k-ruoka.fi` |

Metadata is fetched from a configurable endpoint (defaults to microlink.io). If fetching fails, a minimal preview with just `url`, `title = url`, and `domain` is stored so the link is still represented.

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
