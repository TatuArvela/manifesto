# API

The API is the contract between the Manifesto client and server. Any server implementing this contract is compatible with the Manifesto client.

## REST API

### Notes

| Method   | Path             | Description          |
|----------|------------------|----------------------|
| `GET`    | `/api/notes`     | List notes, one page at a time |
| `GET`    | `/api/notes/:id` | Get a single note    |
| `POST`   | `/api/notes`     | Create a note        |
| `PUT`    | `/api/notes/:id` | Update a note        |
| `DELETE` | `/api/notes/:id` | Permanently delete   |

The notes a user sees are their own and the ones [shared with them](features/sharing-with-people.md)
that they accepted. A shared note is theirs to read (and, as an editor, to write), and their
personal fields are theirs to change, `trashed` included. A viewer's `PUT` with a shared field, and
a recipient's with `readonly` or `source`, is `403` with nothing written. A recipient's `DELETE`
removes the note from their notes (their share goes, the note stays with everyone else) and answers
`204`, as emptying it from their own trash.

### Sharing

Bearer-protected, and share the per-user API limit.

| Method   | Path                                 | Description |
|----------|--------------------------------------|-------------|
| `POST`   | `/api/notes/:id/shares`              | Invite an account: `{ userId, role }`, `201` `{ note }` |
| `PUT`    | `/api/notes/:id/shares/:userId`      | Change their role: `{ role }`, `{ note }` |
| `DELETE` | `/api/notes/:id/shares/:userId`      | Remove them or withdraw the invitation (owner), or leave the note (the user themselves): `204` |
| `GET`    | `/api/invitations`                   | Invitations waiting for the signed-in user: `{ invitations: ShareInvitation[] }` |
| `POST`   | `/api/invitations/:noteId/accept`    | Accept: `{ note }`, the recipient's copy |
| `POST`   | `/api/invitations/:noteId/decline`   | Decline: `204` |
| `GET`    | `/api/users?q=`                      | Accounts to share with: `{ users: DirectoryUser[] }` |

`role` is `"edit"` or `"view"`. The `{ note }` a share route returns is the owner's copy, with
`sharing` brought up to date.

- Inviting, changing a role and removing someone else are the owner's: another participant gets
  `403`, and someone who cannot see the note `404`.
- Inviting yourself, or to an automatic note (`readonly`), is `422`. Inviting someone who already
  holds an invitation or a share, or to a note in the trash, is `409`. An unknown `userId` is `404`.
- Accepting or declining an invitation that is not there (withdrawn, the note trashed or deleted, or
  already answered) is `404`. Declining is for invitations only; leaving an accepted note is the
  `DELETE` above.
- `ShareInvitation` is `{ noteId, role, owner: ShareUser, title, content, color, font, invitedAt }`:
  the note's text whole, with the owner's color and its font, so the invitation can show the note
  itself. Attachments and link previews come with the note once it is accepted. Invitations to a
  note in the trash are not listed.

`GET /api/users` depends on `USER_LOOKUP`. Under `search` (the default) it returns up to 10
accounts whose username, display name or email contains `q`, regardless of case, each as
`DirectoryUser` `{ id, username, displayName, avatarColor, email? }`. Under `exact` it returns
only an account whose username or email address is `q` exactly (regardless of case), and never
includes `email`. Either way the caller is never among the results, and an empty `q` returns none.

### Search

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/search?q=`  | Search notes, one page at a time |

A note matches when, for every word of `q`, its title or content holds a word that starts with it:
`mil eg` finds "Milk and eggs", and `ilk` finds nothing, since matching is by word prefix and not
inside a word. Case folds as JavaScript's `toLowerCase()` does, in every script; accents are kept, so
`aiti` does not find "äiti". Words are cut per Unicode (UAX #29), which also splits scripts written
without spaces. A query with no word in it at all (`->`, an emoji) falls back to a case-insensitive
substring match. Results are paged newest first, like `GET /api/notes`; they are not ranked by
relevance, because the cursor is a place in the `(updatedAt, id)` order.

### API tokens

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/tokens`     | The caller's personal API tokens (`ApiTokensResponse`), never their secrets |
| `POST`   | `/api/tokens`     | Mint one (`ApiTokenCreateRequest`); the response carries the secret, once |
| `DELETE` | `/api/tokens/:id` | Revoke one; sockets opened with it close with `4401` |

A personal API token is a bearer token like a session, and works on every endpoint a session does,
the WebSockets included, under either auth provider. It starts with `mfp_`, is stored as a SHA-256
hash, has no sliding expiry (only the one chosen when minting, or none), and records when it was last
used. It cannot manage tokens, change a password or email address, or use `/api/admin/*`: those
answer `403` to a token, so a token given to a script cannot be used to take over its account. Ending
a user's sessions (a password change, an admin reset) ends their tokens too, since whoever knew the
password could have minted one. A user holds at most 50.

### Webhooks

`/api/webhooks`: see [Webhooks](features/webhooks.md).

### Version history

| Method   | Path                         | Description          |
|----------|------------------------------|----------------------|
| `GET`    | `/api/notes/:id/versions`    | The note's versions, newest first (`NoteVersionsResponse`) |
| `POST`   | `/api/notes/:id/versions`    | Add a version (`NoteVersionCreateRequest`); owner and editors |

See [Version History](features/version-history.md).

### Attachments

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `GET`    | `/api/attachments/:id`   | The bytes of an image a note refers to as `attachment:<id>` |

`Note.images` accepts image `data:` URLs and `attachment:<id>` references. The server stores every
inline image it is sent and answers with references; see [Attachments](features/attachments.md).

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
form a note stores: the client shrinks them to the 64 KB a note accepts. A
server with previews turned off (`LINK_PREVIEWS=off`) replies `404`. Limited to
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

`POST /api/auth/login` takes `{ username, password }`, and an optional
`newPassword` that is read only when the account holds a temporary password an
admin issued. Without it such a sign-in answers `403`
`{ "error": "...", "code": "password_change_required" }` and issues no session;
with it (at least 8 characters, and different from the temporary one) the server
sets the new password and signs in. A wrong password is `401` either way, so
the flag is never disclosed to a guess. See
[Account Administration](features/accounts.md#temporary-passwords).

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
| `GET`    | `/api/auth/methods`   | Public: `{ provider: "local" \| "oidc", userLookup: "search" \| "exact" }`. Used by the client to pick the login UI, and how the share dialog finds people. |
| `GET`    | `/api/auth/me`        | Bearer-protected: `{ user: AuthUser }`. Used by the client to fetch the current user from a token (e.g. after consuming an OIDC callback fragment), and on start to pick up admin rights granted or revoked since sign-in. |
| `PUT`    | `/api/auth/me`        | Bearer-protected: set or clear (`null`) your own email address with `{ email }`: `{ user: AuthUser }`. An account that signs in with single sign-on is `409`, since the identity provider owns its address. |

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

### Request and Response Format

- Content type: `application/json`
- Note objects follow the schema defined in [Data Model](data-model.md)
- `POST /api/notes` accepts a note without `id`, `createdAt`, or `updatedAt` (server assigns these). `trashedAt` is server-assigned too: it is derived from `trashed`, and a value sent by a client is ignored
- `PUT /api/notes/:id` accepts a partial note (only the fields being changed), and supports `If-Match: <updatedAt>` for optimistic concurrency. On a stale match the server replies `412 Precondition Failed` with the current note so the client can run a 3-way merge and retry. Note: the compare-and-swap is timestamp-based at millisecond precision, so two writes that complete within the same millisecond can both succeed (the second silently overwrites the first). For high-concurrency editing of the same note, use the Yjs collaboration socket instead.
- List endpoints return `{ "notes": Note[], "nextCursor": string | null }`
- Single note endpoints return `{ "note": Note }`
- Errors return `{ "error": string }`, plus a `code` where a client has to do something other than show the message (`password_change_required`, and `email_taken` to tell a taken address from a taken username)

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

### Attachments are not in a listing

A note returned by a list endpoint carries `imageCount` and an **empty**
`images`. The bytes come from `GET /api/notes/:id`, which returns the note
whole.

This is what makes a listing's size a function of how many notes a user has
rather than of how many pictures they have attached, each of which may be up to
1.5 MB, inlined as a `data:` URL in the note itself (see
[Data Model](data-model.md#images)). A client must therefore not read an empty
`images` as "this note has no pictures": compare it with `imageCount`, and fetch
the note before doing anything that needs the bytes: drawing them, exporting
the note, or writing a new list of attachments back.

In open mode nothing is ever separated from its note, so `imageCount` is absent
there and `images` is always complete.

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
| `invitation:removed` | Server → Client | An invitation is gone (accepted in another tab, declined, withdrawn, the note trashed or deleted): `{ noteId }` |
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

The application socket authenticates by passing the bearer token through `Sec-WebSocket-Protocol` alongside the `manifesto-session` subprotocol.

### Collaboration socket: `/api/yjs`

A Hocuspocus-backed Yjs channel for per-note collaborative editing. One endpoint serves every note: Hocuspocus multiplexes documents over a single socket by name, so the note id travels in the protocol as the document name rather than in the path.

Authentication uses the Hocuspocus `Auth` message, not `Sec-WebSocket-Protocol`: clients send the bearer token as the provider's `token` option. The server's `onAuthenticate` hook resolves the token to a user and then verifies that the user may edit the note named by that document (its owner, or an accepted recipient with the `edit` role), rejecting with a permission-denied message before the document is created or joined. Losing that right closes the user's socket with `4403`. Checking the document name rather than a path segment is what makes the check binding: Hocuspocus keys its document map on the name in the frame and never reads the URL.

Persisted Y.Doc state lives in the configured storage driver (SQLite or Postgres).
