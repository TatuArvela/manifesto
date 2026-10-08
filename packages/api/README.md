# @manifesto/api

A small client for a Manifesto server's REST API, for scripts and bots. No dependencies; it uses the
platform's `fetch`, so it runs in Node, Deno, Bun and a browser. The types are the server's own.

```ts
import { createClient } from "@manifesto/api";

const api = createClient({
  url: "https://notes.example",
  token: process.env.MANIFESTO_TOKEN ?? "", // a personal API token, mfp_...
});

const note = await api.notes.create({
  title: "Backup finished",
  content: "Nightly backup ran at 03:00.",
  tags: ["ops"],
});

for await (const each of api.notes.searchAll("backup")) {
  console.log(each.updatedAt, each.title);
}
```

Mint the token under Settings > API tokens. It reads and writes notes unless it was given other
scopes; `me()` needs `account:read`.

## What it covers

| Call | Request |
|---|---|
| `notes.list({ limit, cursor })` | One page, most recently changed first |
| `notes.all({ limit })` | An async iterator over every note, a page at a time |
| `notes.get(id)` | One note, with its images |
| `notes.create({ content, ... })` | A new note; everything but `content` has the app's default |
| `notes.update(id, changes, { ifMatch })` | The fields given; with `ifMatch`, refused if the note changed since |
| `notes.trash(id)`, `notes.restore(id)` | Into and out of the trash |
| `notes.delete(id)` | For good; a note shared with the account is left instead |
| `notes.search(query, page)`, `notes.searchAll(query)` | Notes holding every word |
| `images.get(reference)` | The bytes of an `attachment:<id>`, as a `Blob` |
| `me()` | The token's account |
| `capabilities()` | The server's version, features and limits |

Every method is one request, nothing is cached or retried, and what the server refuses is thrown as a
`ManifestoApiError` with the `status` it gave (`0` when it could not be reached), its `code` where it
has one, `retryAfter` on a `429`, and on a `412` the note as the server now holds it:

```ts
try {
  await api.notes.update(note.id, { content }, { ifMatch: note.updatedAt });
} catch (err) {
  if (err instanceof ManifestoApiError && err.status === 412) {
    // err.current is the note someone else changed meanwhile
  }
}
```

Sharing, tokens, webhooks and the admin API are left out: the first is rarely scripted, and the rest
are session-only on the server, so no token reaches them. The whole API is in
[`docs/specification/api.md`](../../docs/specification/api.md) and `GET /api/openapi.json`.

## Using it

The package is part of this repository's workspace and is not published to npm. It is TypeScript
source with only erasable syntax and a type-only import of `@manifesto/shared`, so Node 22.18 or newer
runs it as it is from a clone:

```sh
node --input-type=module -e '
  import { createClient } from "./packages/api/src/index.ts";
  const api = createClient({ url: process.env.MANIFESTO_URL, token: process.env.MANIFESTO_TOKEN });
  console.log((await api.notes.list({ limit: 5 })).notes.map((n) => n.title));
'
```

Its tests run it against the real server app (`pnpm --filter @manifesto/api test`).
