# API

The API is the contract between the Manifesto client and server. Any server implementing this contract is compatible with the Manifesto client.

The server describes itself as an OpenAPI 3.1 document at `GET /api/openapi.json` (public), for
third-party clients and code generators. Request bodies in it are the zod schemas the routes validate
with, converted (`src/openapi.ts`), and `openapi.test.ts` holds its list of operations to the routes the
app registers, so it cannot fall behind. This page stays the prose account of the contract.

## Compatibility

Scripts with API tokens, AI assistants, webhook receivers and calendar apps are built against this API
by people other than whoever runs the server, and they cannot all move when it does. So from 1.0.0 on,
part of it is promised to keep working across releases, as below.

**Before 1.0.0, none of it is promised.** Any release may change or remove anything, the public surface
included, and says so in its release notes. Marking what goes as deprecated first is still the habit
where it costs little, but it is a courtesy, not a guarantee.

### What is covered

The **public surface**:

- every operation a personal API token or an MCP token can call (those with an `x-token-scope`), with
  its path, parameters, request and response bodies, status codes and error `code`s;
- the operations programs call with no credential: `/api/health`, `/api/capabilities`, `/api/openapi.json`, the calendar
  feed (`/api/calendar/<token>.ics`), public links (`/api/public/*`), and OAuth for assistants
  (`/api/oauth/register`, `/api/oauth/token` and the `/.well-known/` documents);
- `/api/ws` as a token sees it: the handshake, the events and their shapes;
- the MCP tools: their names, inputs and outputs;
- webhooks: the events, the `WebhookPayload`, the headers and the signature scheme;
- the token prefixes (`mfp_`, `mfm_`, `mfr_`, `mfc_`) and the scope names.

The OpenAPI document marks each operation `x-stability: public` or `client`. The **client surface** is
everything else: what only a session may call (sign-in, the account's security, tokens, webhooks'
management, `/api/admin/*`) and `/api/yjs`. It exists for this server's own web client, which is
released with it, and may change in any release, with a note in the release notes. `/api/yjs` has a
gate of its own for that: an editor older than the server's schema is refused and asked to reload.

### What a release may do

From 1.0.0, always, within the public surface:

- add operations, MCP tools, webhook events, scopes and token kinds;
- add optional request fields and parameters, and fields to responses and payloads;
- add values to a set a response or payload draws from (an audit action, an event, a note colour);
- make a limit more generous, or accept what it refused before.

So a program written against it should ignore fields it does not know, and treat a value it does not
know as it would one it has no use for.

Only after a deprecation:

- remove or rename an operation, a field, an MCP tool, an event, a scope or a header;
- change what a field means, or its type;
- make an optional field required, or accept less than before;
- change a status code or an error `code` a caller acts on;
- require a scope an operation did not require before.

### Deprecating

What is to go is marked deprecated in the OpenAPI document (`deprecated: true`, with
`x-deprecated-since` and, when there is one, `x-use-instead`), on this page, and in the release notes
of the release that deprecates it. It keeps working for at least **two minor releases** after that one,
and the release that removes it says so in its notes.

Two things do not wait. A security fix may close what it has to at once. Rate limits and size limits
may tighten to protect a server; both are per deployment anyway, and a caller already has to handle
`429` and `413`.

### Between the client and the server

The web client is released with the server, but a tab left open, an installed app or a client built
for another deployment can meet a server of another version. The client reads every field a newer
server added as optional (the pattern in `api.ts` is "absent from servers from before it"), and turns a
feature off when the server does not say it has it, rather than trying it and failing.

## REST API

### Notes

| Method   | Path             | Description          |
|----------|------------------|----------------------|
| `GET`    | `/api/notes`     | List notes, one page at a time |
| `GET`    | `/api/notes/:id` | Get a single note    |
| `POST`   | `/api/notes`     | Create a note        |
| `POST`   | `/api/notes/import` | Import up to 100 notes, keeping their ids |
| `PUT`    | `/api/notes/:id` | Update a note        |
| `PUT`    | `/api/notes/:id/key` | Put the note under a new key (owner, session only) |
| `DELETE` | `/api/notes/:id` | Permanently delete   |
| `DELETE` | `/api/notes`     | Permanently delete every note the user owns |

The notes a user sees are their own and the ones [shared with them](features/sharing-with-people.md)
that they accepted. A shared note is theirs to read (and, as an editor, to write), and their
personal fields are theirs to change, `trashed` included. A viewer's `PUT` with a shared field, and
a recipient's with `readonly` or `source`, is `403` with nothing written. A recipient's `DELETE`
removes the note from their notes (their share goes, the note stays with everyone else) and answers
`204`, as emptying it from their own trash. `DELETE /api/notes` deletes only the notes the user
owns; the ones shared with them stay.

`POST /api/notes/import` takes `{ "notes": [...] }`, at most `MAX_NOTES_PER_IMPORT` (100)
per request, each a note as `POST /api/notes` takes it plus the `createdAt` it had where it
came from. An `id` the user owns is updated in place, so importing the same backup twice changes
nothing; an `id` shared with them is skipped. An `id` taken by anyone else's note is not imported
and is named in `taken`: a sealed note is bound to its id, so the client seals it again under a new
one and sends it once more. Images must be attachment references, as for any note write. It answers
`{ "created": number, "updated": number, "skipped": number, "taken"?: string[] }`. A backup larger
than one request, by count or by the 1 MiB body limit, is sent in several.

#### Sealed notes

The app seals a note in the browser before it sends it, and the server stores and returns it
sealed ([Encryption](features/encryption.md)). A token that carries keys is the exception: for a
request that presents one the server opens and seals with those keys, so it sends and is sent a
readable `Note`, with an `id` the server assigns, as this page describes everywhere else. A token
without keys is refused the note routes with `403`. Every route above takes and answers a
`SealedNote` (`packages/shared/src/api/sealed.ts`) for a session:

- **Sealed under the note key**: `title`, `content`, `excerpt` (the first 140 characters of the
  text), `font`, `images` (the list of the note's images) and `linkPreviews`.
- **Sealed under the reader's personal key**: `color` and `tags`. Either is `""` when never set,
  which is how a shared note first reaches its recipient.
- **`reminderKey`**, on a note with a reminder, is the note key wrapped under the reader's own
  reminder key, for their calendar feed. It is the reader's own, like the reminder.
- **`key`** is the note key wrapped under the reader's own notes key, and `keyVersion` says which
  note key the values are under. `previousKeys`, present once the key has been replaced, is the
  keys before it sealed under the one the note has now: what opens the versions, comments and
  edits written under them. `rekeyDue: true` tells the owner, and nobody else, that someone who
  held the key no longer holds the note.
- **Readable**, since the server acts on them: `id`, `pinned`, `archived`, `trashed`, `trashedAt`,
  `position`, `reminder`, `readonly`, `source`, `sharing`, `createdAt` and `updatedAt`.

A sealed value is `e1.` and the base64url of a nonce, the ciphertext and its tag. The server checks
that shape and a size for each field, and answers `422` for anything else in a sealed field: it
holds no key, so the shape is all it can check. It can no longer hold a title to 500 characters or
a note to 50 tags; the client that seals a note does.

The client chooses a new note's `id`, since every sealed value is bound to the id of its note:
`POST /api/notes` takes it, and answers `409` for one that is taken. A write that carries `images`
carries `imageRefs` beside it, and one that carries `linkPreviews` carries `previewRefs`: the
`attachment:` references each sealed list names, which is how the server knows which images a note
still uses. They are never sent back. `content` travels with `excerpt`.

### Sharing

Bearer-protected, and share the per-user API limit.

| Method   | Path                                 | Description |
|----------|--------------------------------------|-------------|
| `POST`   | `/api/notes/:id/shares`              | Invite an account: `{ userId, role, key? }`, `201` `{ note }` |
| `PUT`    | `/api/notes/:id/shares/:userId/key`  | Hand someone on the note its key (`OfferedKey`), as anyone who holds it: `204` |
| `PUT`    | `/api/notes/:id/held-key`            | A recipient keeps the note's replaced key under their own notes key: `{ key, keyVersion }`, `{ note }` |
| `GET`    | `/api/users/:id/keys`                | An account's public keys: `{ userId, version, publicKeys }`; `404` until it has any |
| `PUT`    | `/api/notes/:id/shares/:userId`      | Change their role: `{ role }`, `{ note }` |
| `DELETE` | `/api/notes/:id/shares/:userId`      | Remove them or withdraw the invitation (owner), or leave the note (the user themselves): `204` |
| `GET`    | `/api/invitations`                   | Invitations waiting for the signed-in user: `{ invitations: ShareInvitation[] }` |
| `POST`   | `/api/invitations/:noteId/accept`    | Accept, keeping the note's key: `{ key, keyVersion }`, answered with `{ note }`, the recipient's copy |
| `POST`   | `/api/invitations/:noteId/decline`   | Decline: `204` |
| `GET`    | `/api/notes/:id/comments`            | The [comments](features/sharing-with-people.md#comments) beside a note, oldest first: `{ comments: NoteComment[] }`. Anyone who can see the note |
| `POST`   | `/api/notes/:id/comments`            | Write one: `{ id, body, keyVersion }`, the text sealed under the note key and bound to the id the client chose, `201` `{ comment }`; `409` when the note holds 500, or the id is taken |
| `PUT`    | `/api/notes/:id/comments/:commentId` | Change one's own: `{ body, keyVersion }`, `{ comment }` with `editedAt` set; `403` for anyone else's |
| `DELETE` | `/api/notes/:id/comments/:commentId` | Delete one's own, or any as the note's owner: `204` |
| `GET`    | `/api/users?q=`                      | Accounts to share with: `{ users: DirectoryUser[] }` |
| `GET`    | `/api/teams`                         | The teams the signed-in user is in: `{ teams: Team[] }` |
| `GET`    | `/api/notes/:id/team-shares`         | The teams the note is shared with (owner): `{ teamShares: TeamShare[] }` |
| `POST`   | `/api/notes/:id/team-shares`         | Share with a team the owner is in: `{ teamId, role }`, `201` `{ teamShares }`; its members are invited |
| `PUT`    | `/api/notes/:id/team-shares/:teamId` | Change the team's role, and its members' with it: `{ role }`, `{ teamShares }` |
| `DELETE` | `/api/notes/:id/team-shares/:teamId` | Stop sharing with the team, taking the note from those who had it through it: `204` |
| `GET`    | `/api/notes/:id/links`               | The note's [public links](features/sharing.md#public-links) (owner): `{ links: PublicLink[] }` |
| `POST`   | `/api/notes/:id/links`               | Publish it: `{ mode, expiresInDays?, password?, maxViews?, sealedLinkKey, wrappedKey? or snapshot? }`, `201` `{ link }` (owner) |
| `DELETE` | `/api/notes/:id/links/:token`        | Revoke a link: `204` (owner) |

`role` is `"edit"` or `"view"`. The `{ note }` a share route returns is the owner's copy, with
`sharing` brought up to date.

A comment's `body` is a ciphertext, and `keyVersion` says which note key it is under. The server
holds it to the shape and size of one (`422` otherwise) and can no longer hold its text to 1 to 2000
characters or trim it: the client that seals it does.

A token that carries keys reads and writes a comment in plain words, as it does a note: it sends
`{ body }` (trimmed, 1 to 2000 characters, `422` otherwise) with no `id` or `keyVersion`, the
server seals it under the note's key and chooses the id, and every `body` it is answered with is
readable. A comment that does not open with the token's keys is left out of the list, and a note
whose key they do not open is `409`.

- Inviting, changing a role and removing someone else are the owner's: another participant gets
  `403`, and someone who cannot see the note `404`.
- Inviting yourself, or to an automatic note (`readonly`), is `422`. Inviting someone who already
  holds an invitation or a share, or to a note in the trash, is `409`. An unknown `userId` is `404`.
- Accepting or declining an invitation that is not there (withdrawn, the note trashed or deleted, or
  already answered) is `404`. Declining is for invitations only; leaving an accepted note is the
  `DELETE` above.
- `ShareInvitation` is `{ noteId, role, owner: ShareUser, title, content, font, keyVersion, offered,
  invitedAt }`: the note's title, text and font, sealed under its note key, so the invitation can
  show the note itself. The owner's colour is their own and is not part of it. Attachments and link
  previews come with the note once it is accepted. Invitations to a note in the trash are not listed.

#### Handing the note's key on

A shared note is sealed, so everyone on it needs its key ([Encryption](features/encryption.md#sharing)):

- **`OfferedKey`** is `{ keyVersion, ephemeral, wrapped, signer, signature }`: the note key sealed
  under what an ephemeral P-256 key and the recipient's public key agree on, and signed by the
  account that wrapped it, over the note, the version, the recipient and the wrap. The server stores
  and passes it on, and checks only its shape, that `signer` is the caller, and that it is for the
  key the note is under.
- **With the invitation**: the owner's client sends it as `key` when the recipient has public keys.
  Without one the invitation's `offered` is `null`: it is waiting for a key, shows nothing, and
  cannot be accepted yet.
- **Later, by anyone who holds the note**: `PUT /api/notes/:id/shares/:userId/key`. A share to a
  team reaches members the owner's client never wrapped for, and the first client of anyone on the
  note does it. `NoteMember.waitingForKey` is `true` while nobody has, for everyone on the note to
  see.
- **Accepting** sends the key back wrapped under the recipient's own notes key, as they keep the
  key of a note of their own; `409` when it is for another key than the note is now under.
- **A recipient whose copy is behind** the note's key (after it was replaced) is sent the note with
  `key: ""` and the current `offered`, takes it, and stores it with `PUT /api/notes/:id/held-key`.
- **A note is due a new key** when a share whose holder was ever handed the key ends (removed,
  left, declined, withdrawn, the team's or the account's going) or a live public link is revoked.
  The owner's app then sends `PUT /api/notes/:id/key` with `{ keyVersion, key, previousKeys, title,
  content, excerpt, font, images, linkPreviews, links? }`: everything under the note key sealed
  again, `keyVersion` one more than the note's (`409` otherwise), and for each live link that
  stays `{ token, wrappedKey }`. The server moves the whole note at once and answers `{ note }`.
  Everyone else on the note is then `waitingForKey` until a client holding the new key wraps it
  for them. A `PUT /api/notes/:id` that carries sealed words says which key they are under in
  `keyVersion`, and is answered `409` when the note has left that key.

The recipient's client uses no offered key whose signature does not check against the signing key
of the account it names, and takes that signing key only if it is the one it remembers for them.

| Method | Path                            | Description |
| ------ | ------------------------------- | ----------- |
| `GET`  | `/api/auth/keys/seen`           | `{ seen }`: the public keys this account has seen of others, by account id, each sealed under its own personal key |
| `PUT`  | `/api/auth/keys/seen/:userId`   | `{ sealed }`: remember that account's keys, over what was remembered before; `204`, or `409` past 5000 accounts |

Session only. The server hands out public keys (`GET /api/users/:id/keys`), so it could hand out
one of its own; this list is how a client tells a key it has met from one that changed. The server
keeps it and can read none of it. It goes when the account's keys do.

A public link is read without an account, and none of these send a bearer token:

| Method   | Path                                   | Description |
|----------|----------------------------------------|-------------|
| `GET`    | `/api/public/:token`                   | The note: `{ note: PublicNote, wrappedKey, access: null }`, counting a view; `401` `{ passwordRequired: true }` for a link with a password, counting nothing |
| `POST`   | `/api/public/:token/unlock`            | With `{ password }`: `{ note, wrappedKey, access }`, counting a view; `403` for a wrong one |
| `GET`    | `/api/public/:token/attachments/:id`   | A picture the note shows, sealed, and no other; a link with a password needs `X-Link-Access: <access>` |

`mode` is `"live"` or `"snapshot"`. `PublicLink` is `{ token, noteId, mode, expiresAt, hasPassword,
maxViews, viewCount, lastViewedAt, createdAt, sealedLinkKey }`; `PublicNote` is `{ id, keyVersion,
title, content, font, images, linkPreviews, updatedAt }`, every word of it sealed.

What a link shows opens only with its **link key**, 256 random bits the owner's app makes and puts
in the fragment of the address (`/p/<token>#k=<key>`), which no browser sends to a server. The key
is not the token, and the server never holds it. A `live` link is created with `wrappedKey`, the
note key wrapped by the link key, and answers with the note's own sealed fields; a `snapshot` link
is created with `snapshot`, a copy of the note sealed under a key derived from the link key, and
the attachment references it names, which must be the note's. `sealedLinkKey` is the link key
sealed under the owner's personal key, handed back so the owner can copy the address again. The
password, the expiry and the view limit stay gates the server keeps. Every public route answers the same `404` for a link that does not
open (never made, revoked, expired, used up, its note in the trash; with `PUBLIC_LINKS=off`, the 404 of
a route that does not exist), sends
`Cache-Control: no-store` and `X-Robots-Tag: noindex`, and is limited per address; `unlock` also per
link. The owner routes take the `sharing` token scope, and answer `403` to anyone else on the note.

A team the owner is not in answers `404`, as does one that does not exist. `Team` is `{ id, name,
source, memberCount }`, `source` being `local` (an admin's) or `oidc` (a group at the identity
provider); `TeamShare` is `{ teamId, name, role }`. A share or invitation that came through a team
names it: `NoteMember.team` and `ShareInvitation.team` are `{ id, name }`, absent for a direct share.
The rules for what a team share does to each member are in
[Sharing with people](features/sharing-with-people.md#teams).

`GET /api/users` depends on `USER_LOOKUP`. Under `search` (the default) it returns up to 10
accounts whose username, display name or email contains `q`, regardless of case, each as
`DirectoryUser` `{ id, username, displayName, avatarColor, email? }`. Under `exact` it returns
only an account whose username or email address is `q` exactly (regardless of case), and never
includes `email`. Either way the caller is never among the results, and an empty `q` returns none.

### Search

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/search?q=`  | Search notes, one page at a time |

The server cannot read a note, so it cannot search one for the app, which searches the notes it
has opened in memory ([Search](features/search.md)). A session is answered `403`. The route is for
a token that carries a key: the server opens the account's notes in memory for the request and
returns those whose title or text holds `q`, whatever its case, newest first.

### Sync

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/sync?since=` | The notes changed since a checkpoint, one page at a time, and on the last page every visible id and the next checkpoint |

See [Catching up after a reconnect](#catching-up-after-a-reconnect).

### API tokens

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/tokens`     | The caller's personal API tokens (`ApiTokensResponse`), never their secrets |
| `POST`   | `/api/tokens`     | Mint one (`ApiTokenCreateRequest`); the response carries the secret, once |
| `DELETE` | `/api/tokens/:id` | Revoke one; sockets opened with it close with `4401` |

A personal API token is a bearer token like a session, under either auth provider. It starts with
`mfp_`, is stored as a SHA-256 hash, has no sliding expiry (only the one chosen when minting, or none),
and records when it was last used. Ending a user's sessions (a password change, an admin reset) ends
their tokens too, since whoever knew the password could have minted one. A user holds at most 50.

A token reaches only what its **scopes** name, chosen when it is minted:

| Scope | Reaches |
|---|---|
| `notes:read` | Listing, reading and searching notes, their versions and images, the export, and `/api/ws` |
| `notes:write` | Creating, changing, importing and deleting notes, uploading images, link previews, and `/api/yjs`; includes `notes:read` |
| `sharing` | Inviting people to a note, changing or removing them, answering invitations, finding accounts |
| `account:read` | `GET /api/auth/me` and the account's preferences |
| `account:write` | Changing the preferences and the recorded language; includes `account:read` |

A request outside its scopes answers `403` naming the scope it lacks, and a socket closes with `4401`.
Each operation's scope is `x-token-scope` in `/api/openapi.json`, and an operation that names none is
closed to tokens. The same document marks what only a session may call (`x-session-only`), what only an
admin may (`x-admin-only`), and the rate limits an operation counts against (`x-rate-limits`): the
server enforces each route's protection from that one list, so the document cannot say one thing and
the route do another. No scope reaches what only a session may do (managing tokens and webhooks, a password
or email address, two-factor sign-in, `/api/admin/*`), so a token given to a script cannot be used to
take over its account. Minted without `scopes`, a token gets `notes:read` and `notes:write`, which is
also what every token from before scopes was narrowed to.

A **calendar token** (`kind: "calendar"`, `mfc_`) is not a bearer token at all: nothing accepts it in
an `Authorization` header. It is the address of the user's reminder feed, `GET
/api/calendar/<token>.ics`, since a calendar app subscribing to a URL sends no header, and opens that
and nothing else. It carries no scopes. The feed is iCalendar (`text/calendar`): one event per note
with a reminder that is not in the trash, at the reminder's time in its timezone (`TZID`), repeating
as it does (`RRULE`), fifteen minutes long, with an alarm when it starts. It may be cached for five
minutes; any failure (a wrong, revoked or expired token, or an address without `.ics`) is `404`. See
[Reminders](features/reminders.md#calendar-feed).

The app makes a feed's address as it makes a token that carries keys (`tokenHash`, `prefix`,
`wrappedKeys`), and what it wraps is the account's reminder key alone. A sealed note that has a
reminder carries `reminderKey`, the note key wrapped under its reader's reminder key, which the
client sends with the reminder; the server clears it when the reminder is cleared or the note's key
is replaced, and hands it back only to that reader. For a request to the feed's address the server
opens the reminder key from the address and, through `reminderKey`, each note that has a reminder.
An event whose note has no copy yet is named "Reminder" and holds no text.

`POST /api/tokens` with `"kind": "mcp"` mints a token for an AI assistant instead: it starts with
`mfm_`, works at `/api/mcp` and nowhere else (the REST API and both sockets answer `403` or close
with `4401`), and takes only `notes:read` and `notes:write`; with `notes:read` alone it is read only.
The server refuses one with `403` when it has `MCP` off. Every listed token carries its `kind` and
`scopes`; one an assistant was given by signing in also carries `oauthClientId`, and its `prefix` is
that of its first access token only, since each refresh replaces the secret.

### Generating a client

`GET /api/openapi.json` is an OpenAPI 3.1 document a client generator can read, for any language that
has one. It is the same on every deployment of a version, and the server prints it without a database
or any configuration, so a build can generate from it with nothing running:

```sh
node dist/cli.js openapi > openapi.json        # or: curl https://notes.example/api/openapi.json
npx openapi-typescript openapi.json -o manifesto.d.ts      # TypeScript types
```

For another language, take a generator that reads OpenAPI 3.1 and not only 3.0: the document writes
a value that may be null the 3.1 way (`type: ["string", "null"]`, or `anyOf` with `null`).

What a generator gets:

- an `operationId` for every operation, made of the method and the path's words (`getNotesById` for
  `GET /api/notes/:id`), unique and changing only when the route does;
- request bodies that are the schemas the server validates with, converted, so they cannot be out of date;
- for the public surface, response bodies with every property typed and marked required unless it is
  optional: the note in full (who it is shared with included), the paged listings, sync, the account,
  the capabilities, invitations, the user lookup, versions, comments, teams, public links, link
  previews and uploads. A color, a font and a link preview are each one named type wherever they
  appear. Operations of the client's own surface (`x-stability: client`) are described by name and
  loosely;
- `x-token-scope` on each operation a token reaches, naming the scope it needs.

`openapi.conformance.test.ts` calls the server and checks its real answers against those response
schemas, so a field added to a response without the document following fails the build. The schemas
themselves stay open (no `additionalProperties: false`), so a client generated from one version
still reads a later server that answers more.

Programs in TypeScript have a shorter road: the wire types are `@manifesto/shared`'s.

### MCP

`POST /api/mcp`: the Model Context Protocol endpoint for AI assistants, taking an MCP token only. See
[MCP](features/mcp.md).

An assistant can also be given its token by signing in through the browser (OAuth 2.1), described in
[MCP](features/mcp.md#signing-in-through-the-browser):

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/.well-known/oauth-protected-resource/api/mcp` | Where to sign in for `/api/mcp` (RFC 9728); also without the path |
| `GET`  | `/.well-known/oauth-authorization-server` | The authorization server's metadata (RFC 8414) |
| `POST` | `/api/oauth/register` | Register a public client (RFC 7591) |
| `POST` | `/api/oauth/token` | A form: trade a code and its PKCE verifier, or a refresh token, for an hour's `mfm_` token and the next `mfr_` refresh token |
| `GET`  | `/api/oauth/client` | Session only: the client a consent is about (`OAuthClientInfo`) |
| `POST` | `/api/oauth/authorize` | Session only, with the password: agree (`OAuthAuthorizeRequest`), answered with the client's redirect address. With `codeHash` and `wrappedKeys` (the app's own code, and the keys the grant carries wrapped under it) the address comes without a code, which the app adds; without them the server makes the code and the grant reaches no note |

The first four answer any origin (CORS `*`), since they carry nothing a browser adds by itself.
`/api/capabilities` says whether the server offers this, in `features.mcpSignIn`.

### Webhooks

`/api/webhooks`: see [Webhooks](features/webhooks.md).

### Push

Session-only, and the web client's own. See [Reminders](features/reminders.md#push-from-the-server).

| Method   | Path                      | Description |
|----------|---------------------------|-------------|
| `GET`    | `/api/push/key`           | The server's push public key, for `pushManager.subscribe`: `{ publicKey }` |
| `POST`   | `/api/push/subscriptions` | Keep this browser's subscription: `{ endpoint, keys: { p256dh, auth } }`, `204`. The endpoint must be `https`; one already held is replaced |
| `DELETE` | `/api/push/subscriptions` | Forget it: `{ endpoint }`, `204`. Stays open with `WEB_PUSH` off |

### Version history

| Method   | Path                         | Description          |
|----------|------------------------------|----------------------|
| `GET`    | `/api/notes/:id/versions`    | The note's versions, newest first: `{ versions: SealedNoteVersion[] }` |
| `POST`   | `/api/notes/:id/versions`    | Add a version (`SealedNoteVersionCreateRequest`); owner and editors |

A version's `title` and `content` are sealed under the note key and bound to the version's own
`id`, which the client chooses (`409` for one that is taken). `keyVersion` says which note key it is
under.

See [Version History](features/version-history.md).

### Attachments

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `POST`   | `/api/attachments`       | Upload an image sealed in the browser: the sealed bytes, its address in `X-Attachment-Address`; answers `{ ref }` |
| `POST`   | `/api/attachments/claim` | Make images the owner's of the note about to name them: `{ noteId?, refs }`, answered with `{ refs }`, the reference to name for each |
| `GET`    | `/api/attachments/:id`   | The sealed bytes of an image a note refers to as `attachment:<id>`, as `application/octet-stream` |

A note's sealed `images` names `attachment:<id>` references from uploads, with the key and type of
each; see [Attachments](features/attachments.md).

A token that carries keys sends and is sent the image itself:

- `POST /api/attachments` takes the image's bytes with no `X-Attachment-Address`. The server
  checks that they are a PNG, JPEG, GIF, WebP or AVIF image (`415` otherwise, whatever the
  `Content-Type` says), seals them, and answers `{ ref }` to put in a note's `images`.
- `GET /api/attachments/:id?note=<note id>` answers the image, with its own `Content-Type`. `note`
  is a note the token's account holds that names the image: the key that opens an image is inside
  the note. It may be left out for an image the same account uploaded with a token, and is `400`
  when it is needed and missing.
- A token attaches images to notes its own account owns. One uploaded for a note someone else owns
  is refused when the note is written (`422`), as any image that is not the owner's is.

### Link previews

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `GET`    | `/api/link-preview?url=` | Read a page's title, description, image and favicon |

Requires authentication. `url` must be `http` or `https` and at most 2048
characters, or the server replies `422`. The response is
`{ "preview": LinkPreview | null }`: `null` when the page could not be fetched
(it was down, not HTML, too slow, or on an address that is not public), which is
an ordinary answer rather than an error. `image` and `favicon` are the source
images as fetched, inlined as `data:` URLs of up to 1.5 MB, and are **not** the
form a note stores: the client shrinks each to at most 64 KB and uploads it with
`POST /api/attachments`, and the note holds the reference. A
server with previews turned off (`LINK_PREVIEWS=off`) replies `404`, as for a route it does not have. Limited to
40 requests a minute per user, on top of the general API limit. What the server
will and will not fetch is in [Link Previews](features/link-previews.md#what-the-server-fetches).

### Authentication

Endpoints under `/api/auth/*` are owned by the configured auth provider. Two providers ship today:

**Local** (`AUTH_PROVIDER=local`):

| Method   | Path                  | Description          |
|----------|-----------------------|----------------------|
| `POST`   | `/api/auth/register`  | Create account: `{ username, password, email? }` |
| `POST`   | `/api/auth/login`     | Log in               |
| `POST`   | `/api/auth/logout`    | Log out              |
| `POST`   | `/api/auth/password`  | Change your own password |
| `GET`    | `/api/auth/two-factor` | Whether two-factor is on, and whether an authenticator app is set up: `{ enabled, authenticator }` |
| `POST`   | `/api/auth/two-factor/setup`, `/enable`, `/disable` | The authenticator app; `enable` and `disable` answer `204` |
| `GET`    | `/api/auth/passkeys`  | Your passkeys (`PasskeysResponse`), never their keys |
| `POST`   | `/api/auth/passkeys/options` | With `{ password }`: options for `navigator.credentials.create()` |
| `POST`   | `/api/auth/passkeys`  | `{ name?, response }`: add the passkey the browser made |
| `DELETE` | `/api/auth/passkeys/:id` | With `{ password }`: remove one |
| `POST`   | `/api/auth/passkey/options` | Public: a challenge to sign in with a passkey alone |
| `POST`   | `/api/auth/passkey/login` | Public: `{ response }`, the browser's answer; `AuthSuccessResponse` |
| `POST`   | `/api/auth/sign-in-link` | Public: `{ email, locale? }`, mails a sign-in link; always `204` |
| `POST`   | `/api/auth/sign-in-link/confirm` | Public: `{ token, otp?, passkey? }`; `AuthSuccessResponse` |
| `POST`   | `/api/auth/recovery`  | Public: `{ username, verifier }`, the first step of signing in with the [recovery key](#account-keys); `RecoveryOpenResponse` |
| `POST`   | `/api/auth/recovery/complete` | Public: the second step, with `newPassword` and the new wrapped keys; `AuthSuccessResponse` |

Passkey options and answers are WebAuthn's JSON forms, binary values as base64url. A ceremony is
accepted only from a page this server's client is served from (an `Origin` in `CORS_ORIGINS`, that of
`APP_URL`, or this server's own), whose host is the relying party ID; any other is `400`. Each challenge
is good once, for five minutes, and for the purpose and account it was issued to. Signing in with a
passkey alone wants the device to have verified its user, is throttled at 60 requests per 15 minutes
per address, and answers any failure with the same `401`. See
[Accounts](features/accounts.md#two-factor-sign-in).

`POST /api/auth/login` takes `{ username, password }`, and an optional
`newPassword` that is read only when the account holds a temporary password an
admin issued. Without it such a sign-in answers `403`
`{ "error": "...", "code": "password_change_required" }` and issues no session;
with it (at least 8 characters, and different from the temporary one) the server
sets the new password and signs in. A wrong password is `401` either way, so
the flag is never disclosed to a guess. See
[Account Administration](features/accounts.md#temporary-passwords).

With two-factor sign-in on, a right password answers `403` with
`code: "two_factor_required"` and `twoFactor: { authenticator, passkey }`: whether
the account has an authenticator app, and a challenge for its passkeys on this
address (null when it has none there). The same request sent again with `otp`
(an authenticator code) or `passkey` (the browser's answer) signs in. There are no recovery
codes: an account that has lost its factors signs in with its [recovery key](#account-keys).

`POST /api/auth/sign-in-link/confirm` signs in with the token of a mailed link (`MAGIC_LINKS`, and only
with `SMTP_URL`; otherwise both routes are `404`). A token that is unknown, used or older than 15 minutes
is `410`. For an account with two-factor sign-in it answers the same `403` `two_factor_required` as
`/login`, and the same request sent again with `otp` or `passkey` signs in; a wrong one is `401`
`two_factor_invalid` and leaves the link usable. Such an account is `429` with `Retry-After` while its
budget of failed sign-ins is spent; one without a second factor is not. See
[Accounts](features/accounts.md#signing-in-with-a-link).

Sign-in is budgeted twice over, and either budget answers `429` with a
`Retry-After` header. Per source address, 10 requests every 15 minutes, shared
with `/register` and `/password`: an IPv6 client is counted on its /64, since
the addresses inside one belong to a single subscriber and counting the whole
address would let one of them rotate freely. Per account name, 10 failed
sign-ins every 15 minutes, which is the part a caller moving between addresses
cannot escape. The right password clears the name's count, and the lock lapses
with the window rather than waiting for an admin. A name nobody holds is
counted exactly like one that exists, and costs the same password verify, so
neither the refusal, its timing, nor the lock reports which accounts are there.
Both counts live in the server process, so with more than one node each holds
its own.

`POST /api/auth/password` is bearer-protected and takes
`{ currentPassword, newPassword }`. It answers `204`, then ends every other
session of the account and closes their sockets; the calling session carries on.
A wrong current password is `403`, not `401`, because the session itself is
fine. A new password equal to the current one is `422`, and an account with no
password (single sign-on) is `409`. It shares the sign-in throttle.

**OIDC** (`AUTH_PROVIDER=oidc`):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/auth/login`     | 302 to the IdP's authorization endpoint (Authorization Code Flow + PKCE) |
| `GET`    | `/api/auth/callback`  | IdP redirects here; server exchanges code, mints session, 302 to client  |
| `POST`   | `/api/auth/logout`    | Log out                                                                  |

The login flow is bound to one browser. `GET /api/auth/login` sets a
`manifesto_oidc_flow` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`,
`Secure` when the redirect URI is https) holding the `state` it issued, and the
callback rejects any request whose cookie does not match its `state` parameter.
Without that, a callback URL captured from an attacker's own login can be
replayed at a victim to sign them into the attacker's account. The cookie is
cleared as soon as a callback is spent, so it is never a long-lived credential.
Both endpoints are throttled per IP (30 requests / 15 minutes, shared).

**Provider-agnostic** (always available):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/auth/me`        | Bearer-protected: `{ user: AuthUser }`. Used by the client to fetch the current user from a token (e.g. after consuming an OIDC callback fragment), and on start to pick up admin rights granted or revoked since sign-in. |
| `PUT`    | `/api/auth/me`        | Bearer-protected: set or clear (`null`) your own email address with `{ email }`: `{ user: AuthUser }`. An account that signs in with single sign-on is `409`, since the identity provider owns its address. |
| `GET`    | `/api/auth/me/activity` | A session only: your own lines of the audit log, where you are the actor or the target, newest first, as `AuditLogResponse` (`limit`, `before`). An entry where someone else acted on you has `ip: null`. |
| `GET`    | `/api/auth/me/prefs`  | Bearer-protected: your [preferences](features/preferences.md) as your clients sent them, `{ prefs }`, a flat object whose values are each sealed under the account's personal key and bound to their name. `{}` until a client has sent any. |
| `PATCH`  | `/api/auth/me/prefs`  | Bearer-protected: set some preferences with `{ prefs }`, each value sealed and a key set to `null` removing it: `{ prefs }` with the result. At most 100 keys of up to 64 characters; `422` for a value that is not a ciphertext, `413` if the result would pass 32 KB as JSON. Every socket of the account hears `prefs:updated`. |
| `PUT`    | `/api/auth/me/locale` | Bearer-protected: record the language your client is set to with `{ locale }` (a tag such as `fi`): `204`. `AuthUser.locale` gives it back. Mail sent to you by someone else's action, a share invitation, is written in it. |

#### Account keys

The keys an account's notes are encrypted with ([Encryption](features/encryption.md#keys)) are made
and wrapped in the browser. The server stores them, hands them back to the account's own sessions and
can open none of them. All of these are session-only, and the ones that check a password or the
recovery key are throttled like a sign-in (10 requests per 15 minutes per address, and the per-name
budget of failed attempts).

| Method   | Path                              | Description |
|----------|-----------------------------------|-------------|
| `GET`    | `/api/auth/keys`                  | `AccountKeysResponse`: `{ keys, sessionEndsAt }`. `keys` is null before the account is set up, and otherwise `{ version, wrappedBySecret, publicKeys, wrappedPrivateKeys }`. `sessionEndsAt` is when this session ends at the latest, which is when a device removes the keys it holds. |
| `PUT`    | `/api/auth/keys`                  | `AccountKeysSetupRequest`: the account's first keys. `204`, or `409` once it has some. |
| `DELETE` | `/api/auth/keys`                  | With `{ password? }`: remove the account's keys, so it is set up again. For when the secret key and the recovery key are both lost. `204`; ends the account's other sessions and tokens. |
| `POST`   | `/api/auth/keys/confirm`          | With `{ password? }`: `204` when the [confirmation](features/accounts.md#confirming-a-change-from-a-session) holds. The client asks before it shows the secret key it holds. |
| `POST`   | `/api/auth/keys/secret`           | `{ password?, wrappedBySecret }`: a new secret key. `204`; ends the account's other sessions, and leaves its tokens. |
| `POST`   | `/api/auth/keys/recovery`         | `{ password?, wrappedByRecovery, recoveryVerifier }`: a new recovery key. `204`. |
| `POST`   | `/api/auth/keys/recover`          | `{ verifier }`: the first step of using the recovery key while signed in. `RecoveryOpenResponse`: `{ userId, version, wrappedByRecovery, hasPassword }`. A wrong key is `403` with `code: "recovery_key_invalid"`. |
| `POST`   | `/api/auth/keys/recover/complete` | `{ verifier, wrappedBySecret, wrappedByRecovery, recoveryVerifier }`: the second step, a new secret key and recovery key in place of the ones used. `204`; `409` if the recovery key was spent meanwhile. Ends the account's other sessions and tokens. |

Every wrapped key is a ciphertext: `e1.` and the base64url of a nonce, the AES-256-GCM ciphertext
and its tag. The server refuses anything else in its place with `422`, which is all it can check. A
public key is an uncompressed P-256 point as base64url. The recovery key never reaches the server:
`verifier` is 32 bytes the browser derives from it, as base64url, and the server holds its SHA-256.

`POST /api/auth/recovery` and `/api/auth/recovery/complete` are the same two steps with nobody signed
in, for a local account that has lost its password or its second factors: they take `username`
beside the rest, the second takes `newPassword`, sets it, ends every session and token the account
had and answers `AuthSuccessResponse`. A wrong key and a username nobody holds answer the same `401`.
An account that signs in through single sign-on signs in there and uses the routes above.

`AuthUser` is `{ id, username, displayName, avatarColor, email, isAdmin }`, where `email` is a
string or `null`.

An email address is checked only for its shape (something, `@`, something; at most 254
characters), is unique regardless of case, and is optional. One another account holds is `409`
with `code: "email_taken"`, wherever it is given: registering, `PUT /api/auth/me`, or the admin
routes. See [Account Administration](features/accounts.md#email-addresses).

### Administration

Bearer-protected, and the caller must be an admin, which is checked against the
database on every request (`403` otherwise). Shares the per-user API limit. See
[Account Administration](features/accounts.md) for the rules.

| Method   | Path                              | Description |
|----------|-----------------------------------|-------------|
| `GET`    | `/api/admin/users`                | Every account, by username: `{ users: AdminUser[] }` |
| `POST`   | `/api/admin/users`                | Create an account from `{ username, email? }`: `201` `{ user, temporaryPassword }` |
| `PUT`    | `/api/admin/users/:id`            | Grant or revoke admin with `{ isAdmin }`, set or clear the address with `{ email }`, or both: `{ user }` |
| `POST`   | `/api/admin/users/:id/password`   | Reset the password and end every session of the account: `{ user, temporaryPassword }` |
| `DELETE` | `/api/admin/users/:id`            | Delete the account with its notes and sessions: `204` |
| `GET`    | `/api/admin/checks`               | What the overview's [setup checks](features/accounts.md#setup-checks) read: `{ appUrl, trustProxy, proxy, backup, mail }` |
| `POST`   | `/api/admin/checks/mail`          | Send a test message to the caller's own address: `{ sent }`. `409` without mail set up or an address on the account |

`AdminUser` is `{ id, username, displayName, avatarColor, email, isAdmin, provider,
mustChangePassword, noteCount, createdAt, lastSeenAt }`, where `provider` is
`"local"` or `"oidc"` and `lastSeenAt` is the latest use of any of the account's
sessions, or `null` when it has none.

- The temporary password appears in that one response and is stored only as a
  hash; it cannot be fetched again.
- Creating an account and resetting a password are `404` under
  `AUTH_PROVIDER=oidc`, where the identity provider owns both. Resetting the
  password of an account that signs in with single sign-on is `409`.
- A taken username is `409`, and an invalid one `422`. A taken email address is `409` with
  `code: "email_taken"`. A `PUT` with neither field is `422`.
- Acting on your own account (`PUT`, reset or `DELETE` with your own id) is
  `409`, as is anything that would leave the server with no admin.
- An unknown id is `404`.

All `/api/notes`, `/api/search`, `/api/invitations` and `/api/users` endpoints require authentication. Requests include a session token in the `Authorization: Bearer <token>` header. The token format and the way it is issued depend on the auth provider; clients treat it as opaque.

### Capabilities

`GET /api/capabilities` is public, and says what the server is and offers, as `CapabilitiesResponse`:
its `version`, how to sign in (`auth`: the providers, whether the password form is folded away, whether
registration, reset by mail, sign-in by a mailed link and passkey sign-in are on), which features are on (`features`: one
boolean for each feature a host can turn off, below, plus `mcpSignIn` and `userLookup`, how people
are found to share with), the
`limits` a caller would otherwise meet as a `413`, `409` or `422` (request and image bytes, images and
link previews per note, notes per page and per import, versions kept and for how long, tokens,
webhooks and passkeys per account, public link views, preferences bytes), and `editorSchemaVersion`.
Each value is read from what enforces it, so it cannot drift from the server's behaviour.

The web client reads it before anyone signs in, to choose what to show. It replaced
`GET /api/auth/methods`, which is gone.

### Features a host can turn off

`features` names each of them, as `SERVER_FEATURES` in `@manifesto/shared` lists them: `sharing`,
`teams`, `publicLinks`, `linkPreviews`, `calendar`, `apiTokens`, `mcp`, `webhooks`, `passkeys`,
`magicLinks`, `pushReminders` and `twoFactor`. The variable that switches each, and
what it covers, is in
[Deployment](server/deployment.md#turning-features-off). `teams` needs `sharing`, and is reported
off with it.

An operation that belongs to one is marked `x-feature` in `/api/openapi.json`. While the feature is
off, it answers the same `404` as a path the server has no route for, before authentication, so a
caller cannot tell a feature that is off from one the server never had. The ways out of a feature are
never marked and stay open: `DELETE /api/notes/:id/shares/:userId`, the team shares' listing and
`DELETE`, the passkeys' listing and `DELETE`, the two-factor status and `disable`,
and the tokens' listing and `DELETE`. A personal API token (`apiTokens`) or an MCP token (`mcp`)
whose feature is off is refused wherever it is presented, as an unknown token is, and `POST
/api/tokens` answers `403` for a kind whose feature is off.

### Request and Response Format

- Content type: `application/json`
- Note objects follow the schema defined in [Data Model](data-model.md)
- `POST /api/notes` accepts a note without `createdAt` or `updatedAt` (the server assigns these), under an `id` the client chose. `trashedAt` is server-assigned too: it is derived from `trashed`, and a value sent by a client is ignored
- `PUT /api/notes/:id` accepts a partial note (only the fields being changed), and supports `If-Match: <updatedAt>` for optimistic concurrency. On a stale match the server replies `412 Precondition Failed` with the current note so the client can run a 3-way merge and retry. Note: the compare-and-swap is timestamp-based at millisecond precision, so two writes that complete within the same millisecond can both succeed (the second silently overwrites the first). For high-concurrency editing of the same note, use the Yjs collaboration socket instead.
- List endpoints return `{ "notes": [...], "nextCursor": string | null }`
- Single note endpoints return `{ "note": ... }`, the note [sealed](#sealed-notes)
- Errors return `{ "error": string }`, plus a `code` where a client has to do something other than show the message (`password_change_required`, and `email_taken` to tell a taken address from a taken username)
- `PUT /api/auth/me`, `POST /api/tokens`, `POST /api/webhooks` and the two-factor changes take the account's `password` in the body. Without it they answer `403` with `confirmation_required`, with a wrong one `403` with `password_incorrect`, and after too many wrong ones `429`. An account without a password answers `403` with `reauthentication_required` unless its session was signed in within 15 minutes; `GET /api/auth/login?reauth=1` signs in again. See [Accounts](features/accounts.md#confirming-a-change-from-a-session)

### Paging the list endpoints

`GET /api/notes` and `GET /api/search` return one page and, when there is more,
an opaque `nextCursor` to pass back as `?cursor=`. `?limit=` sets the page size;
it defaults to 200 and is clamped to 500 rather than refused, since a caller
asking for more than a page holds wants as much as it can get and a `400` tells
it nothing it can act on. A cursor the server did not write **is** refused with
`400`: quietly restarting from the top would hand a paging client the first page
over and over.

Notes are ordered by `(updatedAt, id)` descending. The id is part of the key
rather than decoration. Two notes saved in the same millisecond have no order
by timestamp alone, and a page boundary falling between them would repeat one
and drop the other.

The first-party client drains every page on load: it keeps all of a user's notes
in memory, because tag counts, filtering and open-mode search are computed over
the whole list. Paging bounds any single response; it does not change what the
client holds.

### Catching up after a reconnect

`GET /api/sync` answers "what changed since I last looked", so a client that was
offline reads what it missed rather than every note it has. It pages like the
list endpoints (`?limit=`, `?cursor=`, the same order) and returns the notes
whose row or members changed after `?since=`, without their attachments. Leave
`since` out for everything.

The last page, and only the last, also carries:

- **`checkpoint`**: opaque; send it back as `since` next time. It is fixed when
  the first page is asked for, so whatever changes while a client pages is in
  the next sync rather than lost between pages. It sits two minutes before the
  moment it was taken, because a write is stamped when its request starts and
  may commit after a sync has read: every sync therefore reads the last two
  minutes again, and a client must take a note it already holds unchanged
  without fuss. A checkpoint the server did not write is refused with `400`.
- **`ids`**: every note the user can see, changed or not. Deletions are not
  recorded, so this is how a client learns that a note it holds was deleted,
  emptied from the trash, or taken away from it (its share removed, or the note
  trashed by its owner). It may drop such a note, but only one it held before
  sending the request: a note that reached it since may be newer than the ids.

A note counts as changed when its `updatedAt` moves (any write by anyone,
including a recipient's personal fields) or when its members change: someone
invited, accepting, given another role, removed, or leaving by their share
expiring from their trash. The second does not move `updatedAt`, since that is
the `If-Match` token and a membership change is no reason to fail someone's
write.

The checkpoint is kept by the client. The server stores nothing per device.

### Images in a listing

A listed note carries its sealed `images`, like any other field: the list holds references, a few
dozen bytes an image, and the bytes of each come from `GET /api/attachments/:id` when a card draws
it. `imageCount` is no longer sent.

## WebSocket APIs

The server exposes two WebSocket endpoints. They authenticate differently, because the collaboration socket is a Hocuspocus room rather than a plain JSON stream; see each section below.

### Application socket: `/api/ws`

A JSON event stream used for fan-out of REST writes and presence tracking.

| Event              | Direction        | Description                              |
|--------------------|------------------|------------------------------------------|
| `note:created`     | Server → Client  | A new note was created                   |
| `note:updated`     | Server → Client  | A note was changed                       |
| `note:deleted`     | Server → Client  | A note was permanently deleted           |
| `presence:join`    | Server → Client  | A user started viewing/editing a note    |
| `presence:leave`   | Server → Client  | A user stopped viewing/editing a note    |
| `invitation:created` | Server → Client | Someone offered this user a note, or changed the offer: `{ invitation: ShareInvitation }` |
| `comment:created`, `comment:updated` | Server → Client | A comment beside a note was written or edited: `{ comment }`, to everyone who can see the note |
| `comment:deleted` | Server → Client | A comment is gone: `{ noteId, id }` |
| `invitation:removed` | Server → Client | An invitation is gone (accepted in another tab, declined, withdrawn, the note trashed or deleted): `{ noteId }` |
| `prefs:updated`    | Server → Client  | The account's preferences changed, on any device: `{ prefs }`, the whole copy |
| `heartbeat`        | Server → Client  | Sent every 30 seconds; carries nothing   |
| `presence:update`  | Client → Server  | The client is viewing/editing a note     |

REST is the authoritative write path; the server fans out `note:*` events from REST handlers. A `note:edit` client→server event is reserved but not currently handled.

A change to a shared note reaches every participant, each as their own copy (their personal fields,
their role in `sharing`) in `note:updated`. Someone who can no longer see a note (removed from it,
or the owner trashed it) gets `note:deleted` for it; restoring it from the trash sends
`note:updated` again, which a client treats as an insert for a note it does not have.

`presence:update` names a note by id. The server relays it only if the user can see that note, and
only to the note's owner and the people who accepted it. Someone is sent a `presence:join` for each
other person already on a note they can see whenever they could not have heard it announced:
when they open the note themselves, when their socket connects, and when they gain the note
(accepting it, or its owner restoring it from the trash) while someone is on it.

A connection that vanishes without a close (a network change, a device asleep, a NAT that forgot
it) stays open to both ends until TCP gives up, so each end watches for silence. Every 30 seconds
the server sends a protocol ping and a `heartbeat` event; a peer that has not answered the previous
ping is terminated, which ends its presence like any other departure. A browser answers pings
without the page, but cannot see them, which is why the event exists. A client that has heard a
`heartbeat` and then hears nothing for 75 seconds treats the socket as closed and reconnects, as
it does when coming back to the foreground after longer than that. A client that has never heard
one, because the server predates it, does not judge the socket by silence.

The application socket authenticates by passing the bearer token through `Sec-WebSocket-Protocol` alongside the `manifesto-session` subprotocol. A frame from the client may be at most 16 KiB; a larger one closes the socket with `1009`. Both sockets look at their credential again every five minutes and close with `4401` once it no longer opens them (an expired session or token).

### Collaboration socket: `/api/yjs`

A Hocuspocus-backed Yjs channel for per-note collaborative editing. One endpoint serves every note: Hocuspocus multiplexes documents over a single socket by name, so the note id travels in the protocol as the document name rather than in the path.

Authentication uses the Hocuspocus `Auth` message, not `Sec-WebSocket-Protocol`: clients send the bearer token as the provider's `token` option. The server's `onAuthenticate` hook resolves the token to a user and then verifies that the user may edit the note named by that document (its owner, or an accepted recipient with the `edit` role), rejecting with a permission-denied message before the document is created or joined. Losing that right closes the user's socket with `4403`. Checking the document name rather than a path segment is what makes the check binding: Hocuspocus keys its document map on the name in the frame and never reads the URL.

Awareness states are rewritten on the way in: each carries the authenticated user as `user` (`{ id, name, color }`, from the account's display name and avatar colour), and a state for a client id another connection already publishes is dropped.

The connection URL carries the client's editor schema version as `?editor=<n>`. A version below the server's `EDITOR_SCHEMA_VERSION`, or one that is not a number, is refused at the `Auth` message with the reason `editor-outdated` (see [Collaborative Editing](features/collaborative-editing.md#editor-versions)). A URL without the parameter counts as version 1.

Persisted Y.Doc state lives in the configured storage driver (SQLite or Postgres). A frame, and a note's whole state, may be at most 8 MiB: a larger frame closes the socket with `1009` before it is read, and a state that has grown past it is not stored and its editors are disconnected with the same code.

What that document holds is ciphertext. The note's text is in a second document that never leaves
the browser; the one synced here is a list (`log`) of entries, each an edit to the first or a
snapshot of all of it, sealed under a key derived from the note key
([Collaborative Editing](features/collaborative-editing.md#sealed), [Encryption](features/encryption.md#collaboration)).
An awareness state is `{ sealed }`, a cursor sealed the same way, beside the `user` the server
stamps on it.
