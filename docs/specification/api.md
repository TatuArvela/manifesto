# API

The API is the contract between the Manifesto client and the server. All servers that implement this
contract are compatible with the Manifesto client.

The server describes itself as an OpenAPI 3.1 document at `GET /api/v1/openapi.json` (public), for
third-party clients and code generators. Its request bodies are the zod schemas with which the routes
validate, converted (`src/openapi.ts`). `openapi.test.ts` compares its list of operations with the
routes that the app registers. Thus, it always agrees with them. This page stays the prose
description of the contract.

## Compatibility

People other than the operator of the server build scripts with API tokens, AI assistants, webhook
receivers and calendar apps against this API. They cannot all change when the API changes. Thus, from
1.0.0, part of the API will continue to work across releases, as below.

**Before 1.0.0, there is no promise.** Each release can change or remove anything, also the public
surface, and tells this in its release notes. Where it costs little, we still mark items as deprecated
before we remove them. But this is a courtesy, not a guarantee.

### The path

All routes are under `/api/v1/`, also the two sockets. Only the `/.well-known/` documents stay where
their RFCs put them. The `v1` is the version of the contract, not of the app. A release that obeys the
policy below stays on it. A change that the policy permits only after a deprecation can come as
`/api/v2/`, served together with `/api/v1/` while the deprecation runs.

Calendar apps and assistants keep two addresses from before the path had a version. Thus, the server
redirects them with `308`, which keeps the method and the body: a calendar feed
(`/api/calendar/<token>.ics`) and the MCP endpoint (`/api/mcp`). If the refresh of an assistant still
names `/api/mcp` as its resource, the server reads it as `/api/v1/mcp`. Nothing else under the old
`/api/` answers.

### What is covered

The **public surface**:

- Each operation that a personal API token or an MCP token can call (those with an
  `x-token-scope`), with its path, parameters, request and response bodies, status codes and error
  `code`s.
- The operations that programs call without a credential: `/api/v1/health`, `/api/v1/capabilities`,
  `/api/v1/openapi.json`, the calendar feed (`/api/v1/calendar/<token>.ics`), public links
  (`/api/v1/public/*`), and OAuth for assistants (`/api/v1/oauth/register`, `/api/v1/oauth/token` and
  the `/.well-known/` documents).
- `/api/v1/ws` as a token sees it: the handshake, the events and their shapes.
- The MCP tools: their names, inputs and outputs.
- Webhooks: the events, the `WebhookPayload`, the headers and the signature scheme.
- The token prefixes (`mfp_`, `mfm_`, `mfr_`, `mfc_`) and the scope names.

The OpenAPI document marks each operation `x-stability: public` or `client`. The **client surface**
is all other parts: the operations that only a session can call (sign-in, the security of the
account, tokens, the management of webhooks, `/api/v1/admin/*`) and `/api/v1/yjs`. It exists for the
web client of this server, which is released with it. It can change in each release, with a note in
the release notes. `/api/v1/yjs` has its own control for that. The server refuses an editor that is
older than its schema, and asks it to reload.

### What a release may do

From 1.0.0, a release can always do these things in the public surface:

- Add operations, MCP tools, webhook events, scopes and token kinds.
- Add optional request fields and parameters, and fields to responses and payloads.
- Add values to a set from which a response or payload takes values (an audit action, an event, a
  note color).
- Make a limit more generous, or accept what it refused before.

Thus, a program written against it must ignore fields that it does not know. It must use an unknown
value as a value that it has no use for.

A release can do these things only after a deprecation:

- Remove or rename an operation, a field, an MCP tool, an event, a scope or a header.
- Change the meaning or the type of a field.
- Make an optional field required, or accept less than before.
- Change a status code or an error `code` on which a caller acts.
- Require a scope that an operation did not require before.

### Deprecating

An item that will go has the mark deprecated in the OpenAPI document (`deprecated: true`, with
`x-deprecated-since` and, if there is one, `x-use-instead`), on this page, and in the release notes of
the release that deprecates it. It continues to work for a minimum of **two minor releases** after
that release. The release that removes it tells this in its notes.

Two things do not wait. A security fix can close what it must immediately. Rate limits and size limits
can become stricter to protect a server. Both are different for each deployment, and a caller must
already handle `429` and `413`.

### Between the client and the server

The web client is released with the server. But a tab that stays open, an installed app, or a client
built for a different deployment can meet a server of a different version. The client reads each field
that a newer server added as optional (the pattern in `api.ts` is "absent from servers from before
it"). It turns a feature off when the server does not say that it has it. It does not try the feature
and fail.

## REST API

### Notes

| Method   | Path             | Description          |
|----------|------------------|----------------------|
| `GET`    | `/api/v1/notes`     | List notes, one page at a time |
| `GET`    | `/api/v1/notes/:id` | Get one note         |
| `POST`   | `/api/v1/notes`     | Create a note        |
| `POST`   | `/api/v1/notes/import` | Import up to 100 notes, and keep their ids |
| `PUT`    | `/api/v1/notes/:id` | Update a note        |
| `PUT`    | `/api/v1/notes/:id/key` | Put the note under a new key (owner, session only) |
| `DELETE` | `/api/v1/notes/:id` | Delete permanently   |
| `DELETE` | `/api/v1/notes`     | Delete permanently all notes that the user owns |

A user sees their own notes, and the notes [shared with them](features/sharing-with-people.md) that
they accepted.

- A user can read a shared note (and, as an editor, write it). They can change their own personal
  fields, also `trashed`.
- A `PUT` with a shared field by a viewer, and a `PUT` with `readonly` or `source` by a recipient, get
  `403`, and nothing is written.
- A `DELETE` by a recipient removes the note from their notes (their share goes, and the note stays
  with all other persons), and answers `204`, as when they empty it from their own trash.
- `DELETE /api/v1/notes` deletes only the notes that the user owns. The notes shared with them stay.

`POST /api/v1/notes/import` takes `{ "notes": [...] }`, a maximum of `MAX_NOTES_PER_IMPORT` (100) for
each request. Each item is a note as `POST /api/v1/notes` takes it, plus the `createdAt` that it had
in its source.

- The server updates an `id` that the user owns in place. Thus, if you import the same backup two
  times, nothing changes.
- The server skips an `id` that is shared with the user.
- The server does not import an `id` that a note of a different person has, and names it in `taken`.
  A sealed note is bound to its id. Thus, the client seals it again under a new id, and sends it one
  more time.
- The server writes a note that the user owns only under the key that it has. If a note arrives under
  a different `key` or `keyVersion` (sealed before the key of the note was replaced), the server does
  not write it, and names it in `stale`. The client reads the note again, and seals under its key.
- Images must be attachment references, as for all note writes.
- It answers
  `{ "created": number, "updated": number, "skipped": number, "taken"?: string[], "stale"?: string[] }`.
- If a backup is larger than one request, by count or by the 1 MiB body limit, the client sends it
  in many requests.

#### Sealed notes

The app seals a note in the browser before it sends it. The server stores and returns it sealed
([Encryption](features/encryption.md)). A token that carries keys is the exception. For a request with
such a token, the server opens and seals with those keys. Thus, the token sends and gets a readable
`Note`, with an `id` that the server gives, as all other parts of this page describe. The server
refuses the note routes to a token without keys, with `403`. For a session, each route above takes
and answers a `SealedNote` (`packages/shared/src/api/sealed.ts`):

- **Sealed under the note key**: `title`, `content`, `excerpt` (the first 140 characters of the
  text), `font`, `images` (the list of the images of the note) and `linkPreviews`.
- **Sealed under the personal key of the reader**: `color` and `tags`. Each is `""` when never set.
  A shared note reaches its recipient in that way the first time.
- **`reminderKey`**, on a note with a reminder: the note key wrapped under the own reminder key of the
  reader, for their calendar feed. It belongs to the reader, as the reminder does.
- **`format`**: the [format](data-model.md#format) of the words under the note key.
  - A write that contains one of those words also contains `format` (if not, `422`).
  - The statement that writes it compares it with the format of the note. Words in an older format
    than that of the note get `409` with `code: "note_format_newer"`. They come from an app that must
    reload.
  - The server accepts words in a newer format only with all of the words (if not, `409`,
    `note_format_incomplete`), because a note keeps one format for all of its words.
  - An import over a note in a newer format skips it.
- **`key`**: the note key wrapped under the own notes key of the reader. `keyVersion` tells under
  which note key the values are. `previousKeys` is present after the key was replaced. It contains the
  previous keys, sealed under the current key of the note. These open the versions, comments and
  edits written under them. `rekeyDue: true` tells the owner, and nobody else, that a person who had
  the key does not have the note now.
- **Readable**, because the server acts on them: `id`, `format`, `pinned`, `archived`, `trashed`,
  `trashedAt`, `position`, `reminder`, `readonly`, `source`, `sharing`, `createdAt` and `updatedAt`.

A sealed value is `e1.` and the base64url of a nonce, the ciphertext and its tag. The server checks
that shape and a size for each field. It answers `422` for all other values in a sealed field. It has
no key. Thus, it can only check the shape. It cannot limit a title to 500 characters or a note to 50
tags now. The client that seals a note does this.

The client selects the `id` of a new note, because each sealed value is bound to the id of its note.
`POST /api/v1/notes` takes it, and answers `409` for an id that is taken.

- A write that contains `images` also contains `imageRefs`. A write that contains `linkPreviews` also
  contains `previewRefs`. These are the `attachment:` references that each sealed list names. Thus,
  the server knows which images a note still uses. The server never sends them back.
- `content` goes with `excerpt`.

### Sharing

These routes need a bearer token, and share the API limit for each user.

| Method   | Path                                 | Description |
|----------|--------------------------------------|-------------|
| `POST`   | `/api/v1/notes/:id/shares`              | Invite an account: `{ userId, role, key? }`, `201` `{ note }` |
| `PUT`    | `/api/v1/notes/:id/shares/:userId/key`  | Give its key to a person on the note (`OfferedKey`), as a person who has it: `204`. `409` when they do not wait for one and the caller is not the owner |
| `PUT`    | `/api/v1/notes/:id/held-key`            | A recipient keeps the replaced key of the note under their own notes key: `{ key, keyVersion }`, `{ note }` |
| `GET`    | `/api/v1/users/:id/keys`                | The public keys of an account: `{ userId, version, publicKeys }`. `404` until it has some |
| `PUT`    | `/api/v1/notes/:id/shares/:userId`      | Change their role: `{ role }`, `{ note }` |
| `DELETE` | `/api/v1/notes/:id/shares/:userId`      | Remove them or withdraw the invitation (owner), or leave the note (the user themselves): `204` |
| `GET`    | `/api/v1/invitations`                   | The invitations that wait for the signed-in user: `{ invitations: ShareInvitation[] }` |
| `POST`   | `/api/v1/invitations/:noteId/accept`    | Accept, and keep the key of the note: `{ key, keyVersion }`. The answer is `{ note }`, the copy of the recipient |
| `POST`   | `/api/v1/invitations/:noteId/decline`   | Decline: `204` |
| `GET`    | `/api/v1/notes/:id/comments`            | The [comments](features/sharing-with-people.md#comments) of a note, oldest first: `{ comments: NoteComment[] }`. All persons who can see the note |
| `POST`   | `/api/v1/notes/:id/comments`            | Write one: `{ id, body, keyVersion }`, the text sealed under the note key and bound to the id that the client selected. `201` `{ comment }`. `409` when the note has 500, or the id is taken |
| `PUT`    | `/api/v1/notes/:id/comments/:commentId` | Change your own: `{ body, keyVersion }`, `{ comment }` with `editedAt` set. `403` for the comment of a different person |
| `DELETE` | `/api/v1/notes/:id/comments/:commentId` | Delete your own, or any comment as the owner of the note: `204` |
| `GET`    | `/api/v1/users?q=`                      | Accounts to share with: `{ users: DirectoryUser[] }` |
| `GET`    | `/api/v1/teams`                         | The teams of the signed-in user: `{ teams: Team[] }` |
| `GET`    | `/api/v1/notes/:id/team-shares`         | The teams with which the note is shared (owner): `{ teamShares: TeamShare[] }` |
| `POST`   | `/api/v1/notes/:id/team-shares`         | Share with a team of the owner: `{ teamId, role }`, `201` `{ teamShares }`. Its members get invitations |
| `PUT`    | `/api/v1/notes/:id/team-shares/:teamId` | Change the role of the team, and of its members: `{ role }`, `{ teamShares }` |
| `DELETE` | `/api/v1/notes/:id/team-shares/:teamId` | Stop the share with the team, and remove the note from the persons who had it through the team: `204` |
| `GET`    | `/api/v1/notes/:id/links`               | The [public links](features/sharing.md#public-links) of the note (owner): `{ links: PublicLink[] }` |
| `POST`   | `/api/v1/notes/:id/links`               | Publish it: `{ mode, expiresInDays?, password?, maxViews?, sealedLinkKey, wrappedKey? or snapshot? }`, `201` `{ link }` (owner) |
| `DELETE` | `/api/v1/notes/:id/links/:token`        | Revoke a link: `204` (owner) |

`role` is `"edit"` or `"view"`. The `{ note }` that a share route returns is the copy of the owner,
with an updated `sharing`.

The `body` of a comment is a ciphertext. `keyVersion` tells under which note key it is. The server
checks the shape and the size (if not correct, `422`). It cannot check that the text has 1 to 2000
characters, and cannot trim it now. The client that seals it does this.

A token that carries keys reads and writes a comment in plain words, as it does a note. It sends
`{ body }` (trimmed, 1 to 2000 characters, if not `422`) with no `id` or `keyVersion`. The server
seals it under the key of the note and selects the id. Each `body` in the answer is readable. The list
does not include a comment that does not open with the keys of the token. A note whose key they do
not open gets `409`.

- Only the owner can invite, change a role, and remove a different person. A different participant
  gets `403`. A person who cannot see the note gets `404`.
- An invitation of yourself, or to an automatic note (`readonly`), gets `422`. An invitation of a
  person who already has an invitation or a share, or to a note in the trash, gets `409`. An unknown
  `userId` gets `404`.
- To accept or decline an invitation that is not there (withdrawn, the note trashed or deleted, or
  already answered) gets `404`. Decline is only for invitations. To leave an accepted note, use the
  `DELETE` above.
- `ShareInvitation` is `{ noteId, role, owner: ShareUser, title, content, font, keyVersion, offered,
  invitedAt }`: the title, text and font of the note, sealed under its note key. Thus, the invitation
  can show the note itself. The color of the owner belongs to the owner, and is not part of it.
  Attachments and link previews come with the note after the recipient accepts it. The list does not
  include invitations to a note in the trash.

#### Handing the note's key on

A shared note is sealed. Thus, all persons on it need its key
([Encryption](features/encryption.md#sharing)):

- **`OfferedKey`** is `{ keyVersion, ephemeral, wrapped, signer, signature }`: the note key sealed
  under the agreement of an ephemeral P-256 key and the public key of the recipient. The account that
  wrapped it signs it, over the note, the version, the recipient and the wrap. The server stores and
  sends it. It only checks its shape, that `signer` is the caller, and that it is for the current key
  of the note.
- **With the invitation**: the client of the owner sends it as `key` when the recipient has public
  keys. Without one, the `offered` of the invitation is `null`. The invitation waits for a key, shows
  nothing, and cannot be accepted yet.
- **Later, by a person who has the note**: `PUT /api/v1/notes/:id/shares/:userId/key`.
  - A share to a team reaches members for whom the client of the owner did not wrap a key. The first
    client of a person on the note does it.
  - `NoteMember.waitingForKey` is `true` while nobody did it. All persons on the note can see it.
  - Only a person who waits gets a key in this way. For a person who has the key, or has an offer of
    it that they did not take, all persons other than the owner get `409`. If not, each holder could
    put their own key in place of the real key.
  - The client of the recipient checks the signature, and that the key opens the sealed fields of the
    note. It keeps no key that fails either check.
- **Accepting** sends the key back, wrapped under the own notes key of the recipient, as they keep the
  key of their own note. It gets `409` when it is for a different key than the current key of the
  note.
- **A recipient whose copy is behind** the key of the note (after a replacement) gets the note with
  `key: ""` and the current `offered`. The client takes it, and stores it with
  `PUT /api/v1/notes/:id/held-key`.
- **A note is due a new key** when a share ends whose holder ever got the key (removed, left,
  declined, withdrawn, expired from the trash of the recipient, the removal of the team or the
  account), or when a live public link is revoked.
  - The app of the owner then sends `PUT /api/v1/notes/:id/key` with `{ keyVersion, key,
    previousKeys, title, content, excerpt, font, images, linkPreviews, links? }`: all values under the
    note key sealed again, `keyVersion` one more than that of the note (if not, `409`), and
    `{ token, wrappedKey }` for each live link that stays.
  - `If-Match` contains the `updatedAt` of the note from which those fields were sealed again. It is
    required (without it, `428`). A note written after that gets `412`, and the app reads it again.
    Thus, a key replacement never undoes the edit of a person.
  - The server moves the full note at the same time, and answers `{ note }`.
  - All other persons on the note are then `waitingForKey` until a client that has the new key wraps
    it for them.
  - A `PUT /api/v1/notes/:id` that contains sealed words tells their key in `keyVersion`. It gets
    `409` when the note is not under that key now. The check is part of the write. Thus, a replacement
    cannot occur between the two. The write of a token has the same check against the key under which
    the server sealed it.

The client of the recipient uses no offered key whose signature does not pass the check against the
signing key of the account that it names. It takes that signing key only if it is the key that it
remembers for them.

| Method | Path                            | Description |
| ------ | ------------------------------- | ----------- |
| `GET`  | `/api/v1/auth/keys/seen`           | `{ seen }`: the public keys of other accounts that this account saw, by account id. Each is sealed under its own personal key |
| `PUT`  | `/api/v1/auth/keys/seen/:userId`   | `{ sealed }`: remember the keys of that account, over the previous value. `204`, or `409` after 5000 accounts |

Session only. The server gives out public keys (`GET /api/v1/users/:id/keys`). Thus, it could give out
its own key. With this list, a client can tell a key that it knows from a key that changed. The server
keeps the list, and can read none of it. The list goes when the keys of the account go.

A person reads a public link without an account. None of these routes sends a bearer token:

| Method   | Path                                   | Description |
|----------|----------------------------------------|-------------|
| `GET`    | `/api/v1/public/:token`                   | The note: `{ note: PublicNote, wrappedKey, access: null }`, and counts a view. `401` `{ passwordRequired: true }` for a link with a password, and counts nothing |
| `POST`   | `/api/v1/public/:token/unlock`            | With `{ password }`: `{ note, wrappedKey, access }`, and counts a view. `403` for a wrong password |
| `GET`    | `/api/v1/public/:token/attachments/:id`   | A picture that the note shows, sealed, and no other. A link with a password needs `X-Link-Access: <access>` |

`mode` is `"live"` or `"snapshot"`. `PublicLink` is `{ token, noteId, mode, expiresAt, hasPassword,
maxViews, viewCount, lastViewedAt, createdAt, sealedLinkKey }`. `PublicNote` is `{ id, keyVersion,
format, title, content, font, images, linkPreviews, updatedAt }`. Each word of it is sealed. A snapshot
comes with the `format` in which its copy was sealed.

What a link shows opens only with its **link key**: 256 random bits that the app of the owner makes,
and puts in the fragment of the address (`/p/<token>#k=<key>`). No browser sends the fragment to a
server. The key is not the token, and the server never has it.

- A `live` link is created with `wrappedKey`, the note key wrapped by the link key. It answers with the
  sealed fields of the note.
- A `snapshot` link is created with `snapshot`: a copy of the note sealed under a key derived from the
  link key, and the attachment references that it names, which must belong to the note.
- `sealedLinkKey` is the link key sealed under the personal key of the owner. The server gives it
  back, so that the owner can copy the address again.
- The server still controls the password, the expiry and the view limit.
- Each public route answers the same `404` for a link that does not open (never made, revoked,
  expired, at its view limit, its note in the trash; with `PUBLIC_LINKS=off`, the 404 of a route that
  does not exist). It sends `Cache-Control: no-store` and `X-Robots-Tag: noindex`. It has a limit for
  each address. `unlock` also has a limit for each link.
- The owner routes take the `sharing` token scope. They answer `403` to all other persons on the note.

A team that the owner is not in gets `404`, the same as a team that does not exist. `Team` is
`{ id, name, source, memberCount }`. `source` is `local` (made by an admin) or `oidc` (a group at the
identity provider). `TeamShare` is `{ teamId, name, role }`. A share or an invitation that came through
a team names it: `NoteMember.team` and `ShareInvitation.team` are `{ id, name }`, absent for a direct
share. [Sharing with people](features/sharing-with-people.md#teams) gives the rules for what a team
share does to each member.

`GET /api/v1/users` depends on `USER_LOOKUP`.

- With `exact` (the default), it returns only an account whose username or email address is exactly
  `q` (whatever the case), as `DirectoryUser` `{ id, username, displayName, avatarColor, email? }`. It
  never includes `email`.
- With `search`, it returns up to 10 accounts whose username, display name or email contains `q`,
  whatever the case, with `email`.
- In both cases, the results never include the caller. An empty `q` returns nothing.

### Search

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/v1/search?q=`  | Search notes, one page at a time |

The server cannot read a note. Thus, it cannot search notes for the app. The app searches the notes
that it opened in memory ([Search](features/search.md)). A session gets `403`. The route is for a
token that carries a key. The server opens the notes of the account in memory for the request. It
returns the notes whose title or text contains `q`, whatever its case, newest first.

### Sync

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/v1/sync?since=` | The notes changed since a checkpoint, one page at a time. The last page also has all visible ids and the next checkpoint |

See [Catching up after a reconnect](#catching-up-after-a-reconnect).

### API tokens

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/v1/tokens`     | The personal API tokens of the caller (`ApiTokensResponse`), never their secrets |
| `POST`   | `/api/v1/tokens`     | Make one (`ApiTokenCreateRequest`). The response contains the secret, one time |
| `DELETE` | `/api/v1/tokens/:id` | Revoke one. Sockets opened with it close with `4401` |

A personal API token is a bearer token, the same as a session, with both auth providers.

- It starts with `mfp_`, and is stored as a SHA-256 hash.
- It has no sliding expiry. It has only the expiry selected when it was made, or none.
- It records its last use.
- When the sessions of a user end (a password change, an admin reset), their tokens also end, because
  a person who knew the password could have made one.
- A user can have a maximum of 50.

A token reaches only what its **scopes** name. You select them when you make the token:

| Scope | Reaches |
|---|---|
| `notes:read` | List, read and search notes, their versions and images, the export, and `/api/v1/ws` |
| `notes:write` | Create, change, import and delete notes, upload images, link previews, and `/api/v1/yjs`. Includes `notes:read` |
| `sharing` | Invite people to a note, change or remove them, answer invitations, find accounts |
| `account:read` | `GET /api/v1/auth/me` and the preferences of the account |
| `account:write` | Change the preferences and the recorded language. Includes `account:read` |

A request outside its scopes gets `403`, which names the missing scope. A socket closes with `4401`.

- The scope of each operation is `x-token-scope` in `/api/v1/openapi.json`. Tokens cannot use an
  operation that names no scope.
- The same document marks what only a session can call (`x-session-only`), what only an admin can call
  (`x-admin-only`), and the rate limits of an operation (`x-rate-limits`). The server enforces the
  protection of each route from that one list. Thus, the document and the route always agree.
- No scope reaches the functions that only a session can use (to manage tokens and webhooks, a
  password or email address, two-factor sign-in, `/api/v1/admin/*`). Thus, a script cannot use its
  token to take control of its account.
- A token made without `scopes` gets `notes:read` and `notes:write`. All tokens from before scopes also
  got only these.

A **calendar token** (`kind: "calendar"`, `mfc_`) is not a bearer token. Nothing accepts it in an
`Authorization` header.

- It is the address of the reminder feed of the user, `GET /api/v1/calendar/<token>.ics`, because a
  calendar app that subscribes to a URL sends no header. It opens that feed and nothing else. It has
  no scopes.
- The feed is iCalendar (`text/calendar`). It has one event for each note with a reminder that is not
  in the trash: at the time of the reminder in its timezone (`TZID`), with the same repetition
  (`RRULE`), fifteen minutes long, with an alarm when it starts.
- Clients can cache it for five minutes. All failures (a wrong, revoked or expired token, or an
  address without `.ics`) get `404`.
- See [Reminders](features/reminders.md#calendar-feed).

The app makes the address of a feed as it makes a token that carries keys (`tokenHash`, `prefix`,
`wrappedKeys`). It wraps only the reminder key of the account.

- A sealed note that has a reminder contains `reminderKey`, the note key wrapped under the reminder key
  of its reader. The client sends it with the reminder.
- The server clears it when the reminder is cleared, or when the key of the note is replaced. It gives
  it back only to that reader.
- For a request to the address of the feed, the server opens the reminder key from the address. It
  then opens each note that has a reminder, through `reminderKey`.
- An event whose note has no copy yet has the name "Reminder", and contains no text.

`POST /api/v1/tokens` with `"kind": "mcp"` makes a token for an AI assistant.

- It starts with `mfm_`. It works at `/api/v1/mcp` and nowhere else (the REST API and both sockets
  answer `403`, or close with `4401`).
- It accepts only `notes:read` and `notes:write`. With only `notes:read`, it is read only.
- The server refuses it with `403` when `MCP` is off.
- Each listed token contains its `kind` and `scopes`. A token that an assistant got through a sign-in
  also contains `oauthClientId`. Its `prefix` is only that of its first access token, because each
  refresh replaces the secret.

### Generating a client

`GET /api/v1/openapi.json` is an OpenAPI 3.1 document that a client generator can read, for each
language that has one. It is the same on all deployments of a version. The server prints it without a
database or a configuration. Thus, a build can generate code from it with nothing running:

```sh
node dist/cli.js openapi > openapi.json        # or: curl https://notes.example/api/v1/openapi.json
npx openapi-typescript openapi.json -o manifesto.d.ts      # TypeScript types
```

For a different language, use a generator that reads OpenAPI 3.1, not only 3.0. The document writes a
value that can be null in the 3.1 way (`type: ["string", "null"]`, or `anyOf` with `null`).

A generator gets:

- An `operationId` for each operation, made of the method and the words of the path
  (`getNotesById` for `GET /api/v1/notes/:id`). It is unique, and changes only when the route
  changes.
- Request bodies that are the converted schemas with which the server validates. Thus, they are
  always up to date.
- For the public surface, response bodies in which each property has a type and is required, unless it
  is optional. These include the full note (with the persons who share it), the paged listings, sync,
  the account, the capabilities, invitations, the user lookup, versions, comments, teams, public
  links, link previews and uploads. A color, a font and a link preview are each one named type in all
  places. The document describes the operations of the client surface (`x-stability: client`) by
  name, with less detail.
- `x-token-scope` on each operation that a token reaches, with the name of the scope that it needs.

`openapi.conformance.test.ts` calls the server, and checks its real answers against those response
schemas. Thus, if a developer adds a field to a response and the document does not have it, the build
fails. The schemas stay open (no `additionalProperties: false`). Thus, a client generated from one
version can still read a later server that answers with more fields.

Programs in TypeScript have a shorter way: the wire types are in `@manifesto/shared`.

### MCP

`POST /api/v1/mcp`: the Model Context Protocol endpoint for AI assistants. It accepts only an MCP
token. See [MCP](features/mcp.md).

An assistant can also get its token through a sign-in in the browser (OAuth 2.1), as
[MCP](features/mcp.md#signing-in-through-the-browser) describes:

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/.well-known/oauth-protected-resource/api/v1/mcp` | Where to sign in for `/api/v1/mcp` (RFC 9728). Also without the path |
| `GET`  | `/.well-known/oauth-authorization-server` | The metadata of the authorization server (RFC 8414) |
| `POST` | `/api/v1/oauth/register` | Register a public client (RFC 7591) |
| `POST` | `/api/v1/oauth/token` | A form: trade a code and its PKCE verifier, or a refresh token, for an `mfm_` token for one hour and the next `mfr_` refresh token |
| `GET`  | `/api/v1/oauth/client` | Session only: the client of a consent (`OAuthClientInfo`) |
| `POST` | `/api/v1/oauth/authorize` | Session only, with the password: agree (`OAuthAuthorizeRequest`). The answer is the redirect address of the client. With `codeHash` and `wrappedKeys` (the own code of the app, and the keys of the grant wrapped under it), the address comes without a code, and the app adds it. Without them, the server makes the code, and the grant reaches no note |

The first four answer all origins (CORS `*`), because they contain nothing that a browser adds by
itself. `features.mcpSignIn` in `/api/v1/capabilities` tells if the server offers this.

### Webhooks

`/api/v1/webhooks`: see [Webhooks](features/webhooks.md).

### Push

Session only. These routes are for the web client. See
[Reminders](features/reminders.md#push-from-the-server).

| Method   | Path                      | Description |
|----------|---------------------------|-------------|
| `GET`    | `/api/v1/push/key`           | The push public key of the server, for `pushManager.subscribe`: `{ publicKey }` |
| `POST`   | `/api/v1/push/subscriptions` | Keep the subscription of this browser: `{ endpoint, keys: { p256dh, auth } }`, `204`. The endpoint must be `https`. It replaces an existing subscription with the same endpoint |
| `DELETE` | `/api/v1/push/subscriptions` | Forget it: `{ endpoint }`, `204`. Stays open with `WEB_PUSH` off |

### Version history

| Method   | Path                         | Description          |
|----------|------------------------------|----------------------|
| `GET`    | `/api/v1/notes/:id/versions`    | The versions of the note, newest first: `{ versions: SealedNoteVersion[] }` |
| `POST`   | `/api/v1/notes/:id/versions`    | Add a version (`SealedNoteVersionCreateRequest`). Owner and editors |

The `title` and `content` of a version are sealed under the note key, and bound to the own `id` of the
version, which the client selects (`409` for an id that is taken). `keyVersion` tells under which note
key it is, and `format` tells the [format](data-model.md#format) of its words.

See [Version History](features/version-history.md).

### Attachments

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `POST`   | `/api/v1/attachments`       | Upload an image sealed in the browser: the sealed bytes, and its address in `X-Attachment-Address`. The answer is `{ ref }` |
| `POST`   | `/api/v1/attachments/claim` | Give images to the owner of the note that will name them: `{ noteId?, refs }`. The answer is `{ refs }`, the reference to name for each |
| `GET`    | `/api/v1/attachments/:id`   | The sealed bytes of an image to which a note refers as `attachment:<id>`, as `application/octet-stream` |

The sealed `images` of a note names `attachment:<id>` references from uploads, with the key and the
type of each. See [Attachments](features/attachments.md).

A token that carries keys sends and gets the image itself:

- `POST /api/v1/attachments` takes the bytes of the image, with no `X-Attachment-Address`. The server
  checks that they are a PNG, JPEG, GIF, WebP or AVIF image (if not, `415`, whatever the
  `Content-Type` says). It seals them, and answers `{ ref }` to put in the `images` of a note.
- `GET /api/v1/attachments/:id?note=<note id>` answers the image, with its own `Content-Type`. `note`
  is a note of the account of the token that names the image. The key that opens an image is inside
  the note. You can omit it for an image that the same account uploaded with a token. It gets `400`
  when it is necessary and missing.
- A token attaches images to notes that its own account owns. If it uploads an image for a note that a
  different person owns, the server refuses the image when the note is written (`422`), as for all
  images that do not belong to the owner.

### Link previews

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `GET`    | `/api/v1/link-preview?url=` | Read the title, description, image and favicon of a page |

It requires authentication.

- `url` must be `http` or `https`, with a maximum of 2048 characters. If not, the server sends `422`.
- The response is `{ "preview": LinkPreview | null }`. It is `null` when the server could not get the
  page (it was down, not HTML, too slow, or on an address that is not public). This is a usual answer,
  not an error.
- `image` and `favicon` are the source images as the server got them, inlined as `data:` URLs of up to
  1.5 MB. They are **not** the form that a note stores. The client makes each one 64 KB or smaller,
  and uploads it with `POST /api/v1/attachments`. The note contains the reference.
- A server with previews off (`LINK_PREVIEWS=off`) sends `404`, as for a route that it does not have.
- The limit is 40 requests each minute for each user, in addition to the general API limit.

[Link Previews](features/link-previews.md#what-the-server-fetches) tells what the server gets and does
not get.

### Authentication

The configured auth provider owns the endpoints under `/api/v1/auth/*`. There are two providers now:

**Local** (`AUTH_PROVIDER=local`):

| Method   | Path                  | Description          |
|----------|-----------------------|----------------------|
| `POST`   | `/api/v1/auth/register`  | Create an account: `{ username, password, email? }` |
| `POST`   | `/api/v1/auth/login`     | Log in               |
| `POST`   | `/api/v1/auth/logout`    | Log out              |
| `POST`   | `/api/v1/auth/password`  | Change your own password |
| `GET`    | `/api/v1/auth/two-factor` | If two-factor is on, and if an authenticator app is set up: `{ enabled, authenticator }` |
| `POST`   | `/api/v1/auth/two-factor/setup`, `/enable`, `/disable` | The authenticator app. `enable` and `disable` answer `204` |
| `GET`    | `/api/v1/auth/passkeys`  | Your passkeys (`PasskeysResponse`), never their keys |
| `POST`   | `/api/v1/auth/passkeys/options` | With `{ password }`: options for `navigator.credentials.create()` |
| `POST`   | `/api/v1/auth/passkeys`  | `{ name?, response }`: add the passkey that the browser made |
| `DELETE` | `/api/v1/auth/passkeys/:id` | With `{ password }`: remove one |
| `POST`   | `/api/v1/auth/passkey/options` | Public: a challenge to sign in with only a passkey |
| `POST`   | `/api/v1/auth/passkey/login` | Public: `{ response }`, the answer of the browser. `AuthSuccessResponse` |
| `POST`   | `/api/v1/auth/sign-in-link` | Public: `{ email, locale? }`, sends a sign-in link by mail. Always `204` |
| `POST`   | `/api/v1/auth/sign-in-link/confirm` | Public: `{ token, otp?, passkey? }`. `AuthSuccessResponse` |
| `POST`   | `/api/v1/auth/recovery`  | Public: `{ username, verifier }`, the first step of a sign-in with the [recovery key](#account-keys). `RecoveryOpenResponse` |
| `POST`   | `/api/v1/auth/recovery/complete` | Public: the second step, with `newPassword` and the new wrapped keys. `AuthSuccessResponse` |

Passkey options and answers use the JSON forms of WebAuthn, with binary values as base64url.

- The server accepts a ceremony only from a page from which the client of this server is served (an
  `Origin` in `CORS_ORIGINS`, that of `APP_URL`, or the origin of this server). The host of that page
  is the relying party ID. All other origins get `400`.
- Each challenge is good one time, for five minutes, and only for its purpose and its account.
- A sign-in with only a passkey requires that the device verified its user. It has a throttle of 60
  requests each 15 minutes for each address. All failures get the same `401`.

See [Accounts](features/accounts.md#two-factor-sign-in).

`POST /api/v1/auth/login` takes `{ username, password }`, and an optional `newPassword`. The server
reads `newPassword` only when the account has a temporary password from an admin.

- Without it, such a sign-in gets `403` `{ "error": "...", "code": "password_change_required" }`, and
  no session.
- With it (8 characters or more, and different from the temporary password), the server sets the new
  password and signs in.
- A wrong password gets `401` in both cases. Thus, a guess never learns about the flag.

See [Account Administration](features/accounts.md#temporary-passwords).

With two-factor sign-in on, a correct password gets `403` with `code: "two_factor_required"` and
`twoFactor: { authenticator, passkey }`. These tell if the account has an authenticator app, and give
a challenge for its passkeys on this address (null when it has none there). The same request sent
again with `otp` (an authenticator code) or `passkey` (the answer of the browser) signs in. There are
no recovery codes. An account that lost its factors signs in with its
[recovery key](#account-keys).

`POST /api/v1/auth/sign-in-link/confirm` signs in with the token of a mailed link (`MAGIC_LINKS`, and
only with `SMTP_URL`; if not, both routes get `404`).

- A token that is unknown, used, or older than 15 minutes gets `410`.
- For an account with two-factor sign-in, it gets the same `403` `two_factor_required` as `/login`.
  The same request sent again with `otp` or `passkey` signs in. A wrong one gets `401`
  `two_factor_invalid`, and the link stays usable.
- Such an account gets `429` with `Retry-After` while its budget of failed sign-ins is used up. An
  account without a second factor does not.

See [Accounts](features/accounts.md#signing-in-with-a-link).

Sign-in has two budgets. Each budget answers `429` with a `Retry-After` header.

- **For each source address**: 10 requests each 15 minutes, shared with `/register` and `/password`.
  The server counts an IPv6 client on its /64, because the addresses inside one /64 belong to one
  subscriber. If the server counted the full address, that subscriber could change it freely.
- **For each account name**: 10 failed sign-ins each 15 minutes. A caller that moves between addresses
  cannot avoid this part. The correct password clears the count of the name. The lock ends with the
  window. It does not wait for an admin.
- The server counts a name that no account has in exactly the same way as a name that exists, with
  the same password verification. Thus, the refusal, its time, and the lock do not tell which accounts
  exist.
- Both counts are in the server process. Thus, with more than one node, each node has its own counts.

`POST /api/v1/auth/password` needs a bearer token, and takes `{ currentPassword, newPassword }`.

- It answers `204`. Then it ends all other sessions of the account, and closes their sockets. The
  calling session continues.
- A wrong current password gets `403`, not `401`, because the session itself is correct.
- A new password that is the same as the current password gets `422`. An account with no password
  (single sign-on) gets `409`.
- It shares the sign-in throttle.

**OIDC** (`AUTH_PROVIDER=oidc`):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/v1/auth/login`     | 302 to the authorization endpoint of the IdP (Authorization Code Flow + PKCE) |
| `GET`    | `/api/v1/auth/callback`  | The IdP redirects here. The server exchanges the code, makes a session, and sends a 302 to the client |
| `POST`   | `/api/v1/auth/logout`    | Log out                                                                  |

The login flow is bound to one browser.

- `GET /api/v1/auth/login` sets a `manifesto_oidc_flow` cookie (`HttpOnly`, `SameSite=Lax`,
  `Path=/api/v1/auth`, `Secure` when the redirect URI is https) that contains the `state` that it
  gave.
- The callback refuses each request whose cookie does not match its `state` parameter. Without this,
  an attacker can capture a callback URL from their own login, and send it to a victim. The victim then
  signs in to the account of the attacker.
- The server clears the cookie immediately after a callback uses it. Thus, it is never a long-lived
  credential.
- Both endpoints have a throttle for each IP (30 requests in 15 minutes, shared).

**Provider-agnostic** (always available):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/v1/auth/me`        | Needs a bearer token: `{ user: AuthUser }`. The client uses it to get the current user from a token (for example, after it reads an OIDC callback fragment), and at start to get admin rights given or removed since the sign-in. |
| `PUT`    | `/api/v1/auth/me`        | Needs a bearer token: set or clear (`null`) your own email address with `{ email }`: `{ user: AuthUser }`. An account that signs in with single sign-on gets `409`, because the identity provider owns its address. |
| `DELETE` | `/api/v1/auth/me`        | Only a session: delete your own account and all of its data, with `{ password }` as below: `204`. The last admin gets `409`. Its sessions end, and its notes go out of the notes of all persons who shared them. See [Accounts](features/accounts.md#deleting-your-own-account). |
| `GET`    | `/api/v1/auth/me/activity` | Only a session: your own lines of the audit log, where you are the actor or the target, newest first, as `AuditLogResponse` (`limit`, `before`). An entry where a different person acted on you has `ip: null`. |
| `GET`    | `/api/v1/auth/me/prefs`  | Needs a bearer token: your [preferences](features/preferences.md) as your clients sent them, `{ prefs }`. It is a flat object. Each value is sealed under the personal key of the account, and bound to its name. `{}` until a client sent some. |
| `PATCH`  | `/api/v1/auth/me/prefs`  | Needs a bearer token: set some preferences with `{ prefs }`. Each value is sealed. A key set to `null` removes it. The answer is `{ prefs }` with the result. A maximum of 100 keys of up to 64 characters. `422` for a value that is not a ciphertext. `413` if the result would be larger than 32 KB as JSON. All sockets of the account get `prefs:updated`. |
| `PUT`    | `/api/v1/auth/me/locale` | Needs a bearer token: record the language of your client with `{ locale }` (a tag such as `fi`): `204`. `AuthUser.locale` gives it back. Mail that a different person causes for you, a share invitation, is in this language. |

#### Account keys

The browser makes and wraps the keys with which the notes of an account are encrypted
([Encryption](features/encryption.md#keys)). The server stores them, and gives them back to the own
sessions of the account. It can open none of them. All of these routes are session-only. The routes
that check a password or the recovery key have the same throttle as a sign-in (10 requests in 15
minutes for each address, and the budget of failed attempts for each name).

| Method   | Path                              | Description |
|----------|-----------------------------------|-------------|
| `GET`    | `/api/v1/auth/keys`                  | `AccountKeysResponse`: `{ keys, sessionEndsAt }`. `keys` is null before the account is set up. After that, it is `{ version, wrappedBySecret, publicKeys, wrappedPrivateKeys }`. `sessionEndsAt` is the last possible end of this session. At that time, a device removes the keys that it holds. |
| `PUT`    | `/api/v1/auth/keys`                  | `AccountKeysSetupRequest`: the first keys of the account. `204`, or `409` when it already has keys. |
| `DELETE` | `/api/v1/auth/keys`                  | With `{ password? }`: remove the keys of the account, so that it is set up again. This is for when the secret key and the recovery key are both lost. `204`. It ends the other sessions and the tokens of the account. |
| `POST`   | `/api/v1/auth/keys/confirm`          | With `{ password? }`: `204` when the [confirmation](features/accounts.md#confirming-a-change-from-a-session) is correct. The client asks before it shows the secret key that it holds. |
| `POST`   | `/api/v1/auth/keys/secret`           | `{ password?, wrappedBySecret }`: a new secret key. `204`. It ends the other sessions of the account, and keeps its tokens. |
| `POST`   | `/api/v1/auth/keys/recovery`         | `{ password?, wrappedByRecovery, recoveryVerifier }`: a new recovery key. `204`. |
| `POST`   | `/api/v1/auth/keys/recover`          | `{ verifier }`: the first step to use the recovery key while signed in. `RecoveryOpenResponse`: `{ userId, version, wrappedByRecovery, hasPassword }`. A wrong key gets `403` with `code: "recovery_key_invalid"`. |
| `POST`   | `/api/v1/auth/keys/recover/complete` | `{ verifier, wrappedBySecret, wrappedByRecovery, recoveryVerifier }`: the second step, a new secret key and recovery key in place of the used keys. `204`. `409` if the recovery key was used in the meantime. It ends the other sessions and the tokens of the account. |

Each wrapped key is a ciphertext: `e1.` and the base64url of a nonce, the AES-256-GCM ciphertext and
its tag. The server refuses all other values in its place with `422`. That is all that it can check.
A public key is an uncompressed P-256 point as base64url. The recovery key never goes to the server.
`verifier` is 32 bytes that the browser derives from it, as base64url. The server keeps its SHA-256.

`POST /api/v1/auth/recovery` and `/api/v1/auth/recovery/complete` are the same two steps with nobody
signed in. They are for a local account that lost its password or its second factors.

- They take `username` with the other values.
- The second step takes `newPassword` and sets it. It ends all sessions and tokens of the account,
  and answers `AuthSuccessResponse`.
- A wrong key and a username that no account has get the same `401`.
- An account that signs in through single sign-on signs in there, and uses the routes above.

`AuthUser` is `{ id, username, displayName, avatarColor, email, isAdmin }`. `email` is a string or
`null`.

The server checks only the shape of an email address (something, `@`, something; a maximum of 254
characters). It is unique, whatever the case, and it is optional. An address that a different account
has gets `409` with `code: "email_taken"`, in all places where you give it: registration,
`PUT /api/v1/auth/me`, or the admin routes. See
[Account Administration](features/accounts.md#email-addresses).

### Administration

These routes need a bearer token, and the caller must be an admin. The server checks this against
the database on each request (if not, `403`). They share the API limit for each user. See
[Account Administration](features/accounts.md) for the rules.

| Method   | Path                              | Description |
|----------|-----------------------------------|-------------|
| `GET`    | `/api/v1/admin/users`                | All accounts, by username: `{ users: AdminUser[] }` |
| `POST`   | `/api/v1/admin/users`                | Create an account from `{ username, email? }`: `201` `{ user, temporaryPassword }` |
| `PUT`    | `/api/v1/admin/users/:id`            | Give or remove admin rights with `{ isAdmin }`, set or clear the address with `{ email }`, or both: `{ user }` |
| `POST`   | `/api/v1/admin/users/:id/password`   | Reset the password, and end all sessions of the account: `{ user, temporaryPassword }` |
| `DELETE` | `/api/v1/admin/users/:id`            | Delete the account with its notes and sessions: `204` |
| `GET`    | `/api/v1/admin/checks`               | What the [setup checks](features/accounts.md#setup-checks) of the overview read: `{ appUrl, trustProxy, proxy, backup, mail }` |
| `POST`   | `/api/v1/admin/checks/mail`          | Send a test message to the own address of the caller: `{ sent }`. `409` without a mail setup, or without an address on the account |

`AdminUser` is `{ id, username, displayName, avatarColor, email, isAdmin, provider,
mustChangePassword, noteCount, createdAt, lastSeenAt }`. `provider` is `"local"` or `"oidc"`.
`lastSeenAt` is the latest use of a session of the account, or `null` when it has none.

- The temporary password shows only in that one response. The server stores only a hash. You cannot
  get it again.
- Creating an account and resetting a password get `404` with `AUTH_PROVIDER=oidc`, where the
  identity provider owns both. A password reset of an account that signs in with single sign-on gets
  `409`.
- A username that is taken gets `409`, and an invalid username `422`. An email address that is taken
  gets `409` with `code: "email_taken"`. A `PUT` with neither field gets `422`.
- An action on your own account (`PUT`, reset or `DELETE` with your own id) gets `409`. So does each
  action that would leave the server with no admin.
- An unknown id gets `404`.

All `/api/v1/notes`, `/api/v1/search`, `/api/v1/invitations` and `/api/v1/users` endpoints require
authentication. Requests send a session token in the `Authorization: Bearer <token>` header. The auth
provider controls the token format and how the token is given. Clients treat it as opaque.

### Capabilities

`GET /api/v1/capabilities` is public. It tells what the server is and what it offers, as
`CapabilitiesResponse`:

- `version`.
- How to sign in (`auth`): the providers, if the password form is folded away, and if registration,
  reset by mail, sign-in by a mailed link and passkey sign-in are on.
- Which features are on (`features`): one boolean for each feature that a host can turn off (below),
  and `mcpSignIn` and `userLookup` (how people are found for a share).
- The `limits` that a caller would otherwise meet as a `413`, `409` or `422`: request and image bytes,
  images and link previews for each note, notes for each page and for each import, the number and age
  of kept versions, tokens, webhooks and passkeys for each account, public link views, and preference
  bytes.
- `editorSchemaVersion`.
- `defaultPrefs`: the preferences that the host set as the defaults of the server (`DEFAULT_PREFS`,
  empty unless set; see [Preferences](features/preferences.md#defaults-from-the-server)).

The server reads each value from the code that enforces it. Thus, it always agrees with the behavior
of the server.

The web client reads it before a person signs in, to select what to show. It replaced
`GET /api/v1/auth/methods`, which does not exist now.

### Features a host can turn off

`features` names each of them, as `SERVER_FEATURES` in `@manifesto/shared` lists them: `sharing`,
`teams`, `publicLinks`, `linkPreviews`, `calendar`, `apiTokens`, `mcp`, `webhooks`, `passkeys`,
`magicLinks`, `pushReminders` and `twoFactor`. [Deployment](server/deployment.md#turning-features-off)
tells which variable switches each one, and what it includes. `teams` needs `sharing`, and is reported
off with it.

An operation that belongs to a feature has the mark `x-feature` in `/api/v1/openapi.json`.

- While the feature is off, the operation answers the same `404` as a path for which the server has no
  route, before authentication. Thus, a caller cannot tell a feature that is off from a feature that
  the server never had.
- The ways out of a feature never have the mark, and stay open:
  `DELETE /api/v1/notes/:id/shares/:userId`, the listing and the `DELETE` of team shares, the listing
  and the `DELETE` of passkeys, the two-factor status and `disable`, and the listing and the `DELETE`
  of tokens.
- The server refuses a personal API token (`apiTokens`) or an MCP token (`mcp`) whose feature is off
  in all places, as an unknown token. `POST /api/v1/tokens` answers `403` for a kind whose feature is
  off.

### Request and Response Format

- Content type: `application/json`.
- Note objects follow the schema in [Data Model](data-model.md).
- `POST /api/v1/notes` accepts a note without `createdAt` or `updatedAt` (the server sets these),
  under an `id` that the client selected. The server also sets `trashedAt`. It calculates it from
  `trashed`, and ignores a value that a client sends.
- `PUT /api/v1/notes/:id` accepts a partial note (only the fields that change). It supports
  `If-Match: <updatedAt>` for optimistic concurrency.
  - On a stale match, the server replies `412 Precondition Failed` with the current note. The client
    can then run a 3-way merge and try again.
  - Note: the compare-and-swap uses timestamps with millisecond precision. Thus, if two writes complete
    in the same millisecond, both can succeed. The second write then silently overwrites the first.
  - For editing of the same note with high concurrency, use the Yjs collaboration socket.
- List endpoints return `{ "notes": [...], "nextCursor": string | null }`.
- Single note endpoints return `{ "note": ... }`, the note [sealed](#sealed-notes).
- Errors return `{ "error": string }`. They also return a `code` where a client must do something
  other than show the message: `password_change_required`, `email_taken` (to tell a taken address from
  a taken username), and `note_format_newer` / `note_format_incomplete` for the
  [format of a note](data-model.md#format).
- `PUT /api/v1/auth/me`, `DELETE /api/v1/auth/me`, `POST /api/v1/tokens`, `POST /api/v1/webhooks` and
  the two-factor changes take the `password` of the account in the body.
  - Without it, they answer `403` with `confirmation_required`.
  - With a wrong password, they answer `403` with `password_incorrect`. After too many wrong
    passwords, they answer `429`.
  - An account without a password gets `403` with `reauthentication_required`, unless its session was
    signed in during the last 15 minutes. `GET /api/v1/auth/login?reauth=1` signs in again.
  - See [Accounts](features/accounts.md#confirming-a-change-from-a-session).

### Paging the list endpoints

`GET /api/v1/notes` and `GET /api/v1/search` return one page. When there is more, they return an
opaque `nextCursor` that you send back as `?cursor=`.

- `?limit=` sets the page size. The default is 200. The server clamps it to 500, and does not refuse a
  larger value. A caller that asks for more than one page wants as much as possible, and a `400` tells
  it nothing on which it can act.
- The server **refuses** a cursor that it did not write, with `400`. If it started again from the top,
  a paging client would get the first page again and again.

Notes are in the order `(updatedAt, id)`, descending. The id is a real part of the key. Two notes
saved in the same millisecond have no order by timestamp alone. If a page boundary is between them,
the server would repeat one note and lose the other.

The first-party client gets all pages on load. It keeps all notes of a user in memory, because it
calculates tag counts, filters and open-mode search from the full list. Paging sets a limit on one
response. It does not change what the client keeps.

### Catching up after a reconnect

`GET /api/v1/sync` answers "what changed since I last looked". Thus, a client that was offline reads
only what it missed, not all of its notes. It pages as the list endpoints do (`?limit=`, `?cursor=`,
the same order). It returns the notes whose row or members changed after `?since=`, without their
attachments. Omit `since` to get all notes.

Only the last page also contains:

- **`checkpoint`**: an opaque value. Send it back as `since` the next time.
  - The server sets it when the client asks for the first page. Thus, a change during the paging goes
    into the next sync, and is not lost between pages.
  - It is two minutes before the time when the server took it. A write gets its timestamp when its
    request starts, and can commit after a sync read. Thus, each sync reads the last two minutes again.
    A client must accept a note that it already has, unchanged, without a problem.
  - The server refuses a checkpoint that it did not write, with `400`.
- **`ids`**: all notes that the user can see, changed or not. The server does not record deletions.
  Thus, with this list, a client learns that a note that it has was deleted, emptied from the trash,
  or taken away from it (its share removed, or the note trashed by its owner). It can drop such a
  note, but only a note that it had before it sent the request. A note that arrived after that can be
  newer than the ids.

A note counts as changed when its `updatedAt` moves (each write by any person, also the personal
fields of a recipient), or when its members change: a person is invited, accepts, gets a different
role, is removed, or leaves because their share expired from their trash. A change of members does not
move `updatedAt`, because that is the `If-Match` token, and a change of members must not make the
write of a person fail.

The client keeps the checkpoint. The server stores nothing for each device.

### Images in a listing

A listed note contains its sealed `images`, as all other fields. The list contains references, a few
dozen bytes for each image. The bytes of each image come from `GET /api/v1/attachments/:id` when a
card draws it. The server does not send `imageCount` now.

## WebSocket APIs

The server has two WebSocket endpoints. Their authentication is different, because the collaboration
socket is a Hocuspocus room, not a plain JSON stream. See each section below.

### Application socket: `/api/v1/ws`

A JSON event stream. It distributes REST writes, and tracks presence.

| Event              | Direction        | Description                              |
|--------------------|------------------|------------------------------------------|
| `note:created`     | Server → Client  | A new note was created                   |
| `note:updated`     | Server → Client  | A note changed                           |
| `note:deleted`     | Server → Client  | A note was permanently deleted           |
| `presence:join`    | Server → Client  | A user started to look at or edit a note |
| `presence:leave`   | Server → Client  | A user stopped to look at or edit a note |
| `invitation:created` | Server → Client | A person offered this user a note, or changed the offer: `{ invitation: ShareInvitation }` |
| `comment:created`, `comment:updated` | Server → Client | A comment of a note was written or edited: `{ comment }`, to all persons who can see the note |
| `comment:deleted` | Server → Client | A comment is gone: `{ noteId, id }` |
| `invitation:removed` | Server → Client | An invitation is gone (accepted in a different tab, declined, withdrawn, the note trashed or deleted): `{ noteId }` |
| `prefs:updated`    | Server → Client  | The preferences of the account changed, on any device: `{ prefs }`, the full copy |
| `heartbeat`        | Server → Client  | Sent each 30 seconds. It contains nothing |
| `presence:update`  | Client → Server  | The client looks at or edits a note      |

REST is the authoritative write path. The REST handlers make the server send the `note:*` events. A
`note:edit` client→server event is reserved, but the server does not handle it now.

A change to a shared note goes to each participant, each as their own copy (their personal fields,
their role in `sharing`) in `note:updated`. A person who cannot see a note now (removed from it, or the
owner trashed it) gets `note:deleted` for it. A restore from the trash sends `note:updated` again. A
client handles that as an insert for a note that it does not have.

`presence:update` names a note by id. The server sends it only if the user can see that note, and only
to the owner of the note and the people who accepted it. A person gets a `presence:join` for each other
person already on a note that they can see, each time that they could not have heard the announcement:
when they open the note themselves, when their socket connects, and when they get the note (they
accept it, or its owner restores it from the trash) while a person is on it.

A connection can stop without a close (a network change, a device that sleeps, a NAT that forgot it).
It then stays open at both ends until TCP stops. Thus, each end watches for silence.

- Each 30 seconds, the server sends a protocol ping and a `heartbeat` event. It terminates a peer that
  did not answer the previous ping. This ends its presence, as all other departures do.
- A browser answers pings without the page, but the page cannot see them. For this reason, the event
  exists.
- A client that heard a `heartbeat`, and then hears nothing for 75 seconds, handles the socket as
  closed and reconnects. It does the same when it comes back to the foreground after a longer time.
- A client that never heard one, because the server is older, does not judge the socket by silence.

The application socket authenticates with the bearer token in `Sec-WebSocket-Protocol`, together with
the `manifesto-session` subprotocol. A frame from the client can be a maximum of 16 KiB. A larger frame
closes the socket with `1009`. Both sockets check their credential again each five minutes. They close
with `4401` when it does not open them now (an expired session or token).

### Collaboration socket: `/api/v1/yjs`

A Yjs channel with Hocuspocus, for collaborative editing of each note. One endpoint serves all notes.
Hocuspocus sends many documents over one socket, by name. Thus, the note id is in the protocol as the
document name, not in the path.

Authentication uses the Hocuspocus `Auth` message, not `Sec-WebSocket-Protocol`. Clients send the
bearer token as the `token` option of the provider.

- The `onAuthenticate` hook of the server resolves the token to a user. Then it verifies that the user
  can edit the note that the document names (its owner, or an accepted recipient with the `edit`
  role).
- If not, it refuses with a permission-denied message, before the document is created or joined.
- When a user loses that right, the server closes their socket with `4403`.
- The check uses the document name, not a path segment. This makes the check binding: Hocuspocus uses
  the name in the frame as the key of its document map, and never reads the URL.

The server changes awareness states when they come in. Each one gets the authenticated user as `user`
(`{ id, name, color }`, from the display name and the avatar color of the account). The server drops a
state for a client id that a different connection already publishes.

The connection URL contains the editor schema version of the client as `?editor=<n>`. A version below
the `EDITOR_SCHEMA_VERSION` of the server, or a value that is not a number, gets a refusal at the
`Auth` message with the reason `editor-outdated` (see
[Collaborative Editing](features/collaborative-editing.md#editor-versions)). A URL without the
parameter counts as version 1.

The configured storage driver (SQLite or Postgres) keeps the persisted Y.Doc state. A frame, and the
full state of a note, can be a maximum of 8 MiB. A larger frame closes the socket with `1009` before
the server reads it. If a state becomes larger than that, the server does not store it, and
disconnects its editors with the same code.

That document contains only ciphertext. The text of the note is in a second document that never goes
out of the browser. The document that syncs here is a list (`log`) of entries. Each entry is an edit to
the first document, or a snapshot of all of it, sealed under a key derived from the note key
([Collaborative Editing](features/collaborative-editing.md#sealed),
[Encryption](features/encryption.md#collaboration)). An awareness state is `{ sealed }`, a cursor sealed
in the same way, next to the `user` that the server adds.
