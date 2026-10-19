# Auto-notes

Auto-notes are cards that small JavaScript plugins from the user make. Nobody types them. A plugin
runs on each refresh and returns one or more notes. Thus, the card always shows a current answer: the
days until a date, whose turn it is this week, how much of the year is past.

The app does not store the output of an auto-note as a note. The plugin source is the source of
truth, and the app calculates the cards from it again.

## Behavior

- Auto-notes show in the **Auto-notes** view (`/auto-notes`), and together with ordinary notes in the
  other views. The usual filters apply.
- Their title and content are read-only. You cannot edit a generated card, because the next run
  writes over the edit.
- All other parts of the card belong to the user. You can change the color, pin, tags, archive,
  trash and reminders. Those changes stay across runs (see [Overrides](#overrides)).
- A card has a refresh control that runs the plugins again on demand.
- A plugin that throws does not disappear silently. An error note replaces its card. The error note
  has the title `⚠ <plugin name>` and contains the message. The plugin also stores the same message,
  so that the management UI can show it.
- You manage plugins in **Settings → Auto-notes**: add, enable/disable, refetch a URL plugin, or
  remove.

### When plugins re-run

There is no polling timer. All enabled plugins run again when:

- The app mounts.
- The plugin list changes (a plugin is added, removed, enabled, disabled or refetched, or what it can
  read changes).
- The locale changes.
- The user asks for a refresh from a card.
- A note that a plugin [reads](#reading-notes) is added, changed or removed. The run starts one
  second after the last such change. Thus, while you type a note, the plugins do not run at each
  pause.

Runs occur in sequence. If a refresh request arrives during a run, it waits in a queue. Many requests
become one new run, which does not overlap the current run.

## Plugin Format

A plugin is a plain JavaScript source string, not a module. It has two requirements.

**A title directive.** The first line that is not empty must be a `// @title <name>` comment. The app
refuses all other sources with `MissingTitleError`. The name is in the source. Thus, a plugin cannot
get an incorrect label after a paste or a refetch.

**A `_default` assignment.** The sandbox looks for a global `_default`. It is one function, or an
array of functions. The sandbox calls each function with the plugin context. Each function returns a
note or an array of notes.

```js
// @title Year progress

function yearProgress({ today, locale, stdlib }) {
  return { title: "Year progress", content: "…", color: "green" };
}

_default = yearProgress;
```

### Plugin context

Each function gets one `ctx` argument:

| Field | Type | Description |
| --- | --- | --- |
| `today` | `string` | The current time as an ISO 8601 timestamp, from `new Date().toISOString()`. It stays the same for the full run. Thus, all plugins in one pass see the same clock. |
| `locale` | `string` | The active UI locale (`"en"`, `"fi"`, …). |
| `stdlib` | `object` | Date helpers, with the locale and the translated relative-time labels already bound. |
| `notes` | `object[]` | The notes that the plugin [reads](#reading-notes). It is empty for a plugin that reads none. |
| `reads` | `string[]` | The tags that it reads now. It is empty until the user permits them. |

### Standard library

`ctx.stdlib` has `addDays`, `daysBetween`, `firstFuture`, `lastPast`, `lastOccurrence`, `formatDate`,
`formatDateTime`, `relativeDays` and `approxUntil`. The app serializes them into the sandbox as
source, and binds them again there. Thus, a plugin gets working date calculations, and the app
exposes nothing else of itself.

`approxUntil` and `relativeDays` make phrases such as "in two weeks" with the message catalogue of the
app. For this reason, a change of the locale runs all plugins again.

### Returned notes

A function returns one note object or an array of them. A plugin that exports many functions returns
one result for each function. The app flattens the result. Thus, it accepts an array of arrays.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | `string` | yes | Refused if missing or not a string. |
| `content` | `string` | yes | Markdown. Refused if missing or not a string. |
| `color` | `NoteColor` | no | Must be a known color name. If not, the app removes it. |
| `font` | `NoteFont` | no | Must be a known font name. If not, the app removes it. |
| `pinned` | `boolean` | no | |
| `tags` | `string[]` | no | The app removes entries that are not strings. The maximum is 50, the same as the limit of the server. |
| `position` | `number` | no | Must be finite. The defaults put auto-notes before ordinary notes. |
| `key` | `string` | no | A stable sub-id. Thus, a plugin that returns many notes keeps the overrides of each one across runs. |

`title` and `content` are strict, because a note without them is not a note. All optional fields are
lenient. The app removes a bad value, and does not fail the run. One incorrectly spelled color must
not remove the full output of a plugin.

## Reading notes

A plugin can see some of the notes of the user. Thus, a card can collect data from other notes: the
open items of all lists, the number of notes of a project, the changes of this week. This uses the
interface of the sandbox. The plugin gets no special right. It gets a copy to look at.

- **Asking.** The plugin names tags in its header, adjacent to the title: `// @reads todo, work`, on
  one line or on many lines, in the block of comments at the start of the source. The app ignores a
  directive lower in the source. The maximum is 20 tags.
- **Permission.** To ask is not to have.
  - The row of the plugin in the Auto-notes view tells what it asks to read, with **Allow**. Until
    then, it runs with an empty `ctx.notes`.
  - **Stop** removes the permission.
  - The plugin keeps the permission (`reads`). A plugin reads a tag only while its source still asks
    for it and the user permitted it.
  - If a refetch asks for more tags, the plugin reads no more until the user permits the new tags. If
    a refetch asks for fewer tags, the plugin reads less immediately. It must ask again for a tag that
    it removed.
- **What it sees.** `ctx.notes` contains:
  - The notes of the user that have one of those tags, or a tag nested under one (`work` includes
    `work/clients`). Trashed notes are not included.
  - The most recently changed first, a maximum of 500.
  - Each note as `{ id, title, content, tags, color, pinned, archived, createdAt, updatedAt }`, with a
    maximum of 20 000 characters of `content`.
  - No images, link previews or reminders, and no generated notes. Thus, a plugin never reads the
    output of a different plugin, or its own output.
  - Notes shared with the user, as on the board.
- **No writes.** The list and all of its contents are frozen, and there is nothing behind them. A
  plugin returns cards, as before. It cannot change a note.
- **Nothing leaves.** The sandbox has no network (`connect-src 'none'`, and a worker cannot
  navigate). Thus, the return value of a plugin is its only output.
  - The policy of the app (`img-src 'self'`) already refuses an image from a different site. But a
    deployment can make that policy less strict, or remove it, and the browser gets an image when it
    draws a card.
  - Thus, the app draws the cards of a plugin that reads **without images** (and without other items
    that have a `src`), on the board and when they open. The alternative text of the image stays.
  - This applies to a card made while the plugin read notes, until a later run replaces it, also if
    you stopped the plugin after that.
  - You cannot duplicate such a card into an ordinary note, because the ordinary note draws the
    images.
- **Its own worker.** Plugins usually share one worker. There, a plugin can leave a copy of what it
  read for a plugin whose cards show images. It can also wait for the notes of a different plugin.
  Thus, a run that gets notes gets a new frame and a new worker, which the app removes when the run
  ends.
  - A link also stays. It goes nowhere until the user follows it, but a plugin can put what it read
    in a link. Thus, be as careful with the links on such a card as with a link in a message from a
    stranger.
  - Generated notes never get link previews.
- **Only in a worker.** Some engines run plugins on the thread of the frame (see below). There, a
  plugin can point the hidden frame to any address, with what it read in the URL. Thus, on such an
  engine, a plugin that has notes to read fails with an error card that tells this, and reads
  nothing.

[`docs/examples/open-tasks.js`](../../examples/open-tasks.js) collects each unticked checklist item of
the notes with the tag `todo`.

## Execution and Sandboxing

Auto-notes run code that the user pasted. Thus, the plugin runs at three levels of isolation from the
app, and each level has a different job.

1. **An iframe with an opaque origin.** `public/autonotes-sandbox.html` loads through `iframe.src`
   with `sandbox="allow-scripts"` and no `allow-same-origin`. Thus, the frame cannot reach host
   storage, cookies or DOM. It cannot be a `srcdoc` frame, because those get the `script-src 'self'`
   of the host. A frame from a real URL has its own CSP. Thus, it can permit the `unsafe-eval` that a
   plugin needs, and the policy of the app stays strict.
2. **A blob Worker inside the frame.** This makes the two-second timeout possible. A plugin that
   never returns uses only the thread of the worker. Thus, the timer still fires, and the removal of
   the frame also removes the worker. If an engine does not permit a worker at an opaque origin, the
   frame runs the plugin on its own thread. The `init-ok` message of the frame reports this, and the
   host shows a warning. On that path, a `while (true)` blocks the page, and the timeout cannot
   operate.
3. **Validation on the host side.** The frame returns `JSON.stringify({ value })`, and validates
   nothing on purpose. The check must be outside the sandbox. A plugin that took control of its frame
   passes all checks that the frame makes about itself.

A site-wide `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` do not
break this frame, although the opaque origin makes it seem so. The browser checks both against the
origin of the framed URL, which is the origin of the site. Thus, the frame renders, and plugins
continue to run. It needs no exemption from the security headers of a host. See
[Security headers](../client/deployment.md#security-headers).

The protocol between the host and the frame:

1. The frame sends `sandbox-booted`.
2. The host replies with `init`, which contains the prelude of the standard library.
3. The frame evaluates it, starts its worker, and sends `init-ok`.
4. Each call is then a `run` message. The answer is `run-ok` or `run-err`.

## Plugin Sources

A plugin comes from one of two origins:

- **Inline**: source pasted into Settings, stored as it is.
- **URL**: fetched from an HTTPS URL. The app caches the fetched source with the time of the fetch.
  Thus, plugins work offline. **Refetch** gets the current version, and reads the title from it again.

The app fetches a URL plugin. It does not link to it. Thus, an edit at the remote end does not reach
an existing installation until you refetch it.

## Data Model

Plugins are in `localStorage` under `manifesto:auto-notes`. Each one is a `PluginSource`:

- `id`: the local identifier
- `name`: from the `// @title` directive
- `enabled`: the app skips disabled plugins
- `origin`: `{ kind: "inline", source }` or `{ kind: "url", url, fetchedAt, source }`
- `lastError`: the message from the most recent failed run, if there is one
- `reads`: the tags from which the user permitted it to read notes, if there are any

A generated note is an ordinary `Note` that the app assembles in memory, with:

- `id`: `generated:<pluginId>:<key or index>`
- `readonly`: `true`
- `source`: `{ kind: "auto-note", pluginId, noteKey }`

### Overrides

The app stores the changes of the user to a generated card separately, in `localStorage` under
`manifesto:auto-note-overrides`. The key is the id of the generated note. The app merges them into the
note when it renders the note. An override can contain `color`, `pinned`, `tags`, `archived`,
`trashed`, `trashedAt`, `reminder` and `position`.

The plugin owns the content. Thus, "permanently delete" on an auto-note clears its override, and
deletes nothing. The card comes back on the next run in its default state. To stop a card, disable or
remove its plugin.

## Limits

| Limit | Value |
| --- | --- |
| Plugin run timeout | 2 seconds |
| Notes per plugin run | 100 |
| Tags per generated note | 50 |
| Plugin source size | 256 KB |
| Tags a plugin may ask to read | 20 |
| Notes a plugin is shown | 500 |
| Characters of one note's text it is shown | 20 000 |

## Limitations

- Auto-notes are local to the device. The app never sends plugins, overrides or generated cards to
  the server. A plugin that you add on one device does not show on a different device.
- The app does not write generated notes to the storage. Thus, they are not in exports or in the
  version history.
- You cannot edit the title and the content. Only the plugin can change them.
- The two-second timeout cannot operate on engines that do not permit a Worker at an opaque origin
  (the host shows a warning when it finds this).

## Examples

[`docs/examples/`](../../examples/) contains four example plugins with comments: a year-progress bar,
a bin-collection countdown, a mail-delivery schedule, and a plugin that reads notes to collect their
open tasks.
