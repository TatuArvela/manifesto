# MCP (AI assistants)

Connected mode offers an endpoint for AI assistants that speak the
[Model Context Protocol](https://modelcontextprotocol.io/) (Claude Code, Claude Desktop, Cursor and
others), so a user can ask an assistant to find, read, write or tidy their notes. Each user connects
theirs from Settings (**API tokens**, "Used by: An AI assistant (MCP)"), which offers it only when the server
has MCP on.

## Connecting an assistant

An assistant that can sign in through the browser (Claude Code, Claude Desktop, Cursor and most
others that speak the protocol over HTTP) needs only the address:

```bash
claude mcp add --transport http manifesto https://notes.example/api/mcp
```

The first time it connects, it opens a page of the client in the browser, where the user signs in
if they are not already, sees which assistant is asking, chooses whether it may change notes or
only read them and how long it stays connected, confirms with their password, and is sent back to
the assistant. See [Signing in through the browser](#signing-in-through-the-browser).

An assistant that cannot sign in that way takes a token minted by hand. Minting an assistant's token
shows its secret once, with the command that connects Claude Code:

```bash
claude mcp add --transport http manifesto https://notes.example/api/mcp \
  --header "Authorization: Bearer mfm_..."
```

Any other client takes the same two things: the URL `<server>/api/mcp` over HTTP, and the token as a
bearer token in the `Authorization` header.

## Signing in through the browser

The server is an OAuth 2.1 authorization server for `/api/mcp` and nothing else, as the protocol's
[authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
section describes. It is on whenever MCP is and the server knows where its client is: `APP_URL`, or
the client it serves itself (`CLIENT_DIR`). Without either, there is no page to send the user to, so
the endpoints below answer `404` and tokens minted by hand are the only way in.

- **Discovery**: a request to `/api/mcp` without a valid token answers `401` with
  `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`
  (RFC 9728), which names this server as the authorization server, whose metadata is at
  `/.well-known/oauth-authorization-server` (RFC 8414). Its addresses are built from the one the
  request came to, so behind a TLS proxy `TRUST_PROXY` must be on for them to say `https`.
- **Clients**: an assistant identifies itself either by the `https` address of its own metadata
  document (a Client ID Metadata Document, which the server reads through the same guard as link
  previews: public addresses only, no redirects, at most 5 KB, kept five minutes), or by registering
  (`POST /api/oauth/register`, RFC 7591). Every client is public: none holds a secret, and PKCE
  (`S256` only) stands in for one. A registered client that is never given a grant is removed after
  a day. The consent page says which kind is asking: a metadata document's host vouches for the name
  it shows, while a registered client's name is only what it said about itself.
- **Where an assistant is sent back**: `https`, `http` to this computer only (`localhost`,
  `127.0.0.1`, `[::1]`, on any port, since a desktop app listens on whichever is free), or a scheme
  of the app's own (`cursor://`). Schemes a browser would run or read (`javascript:`, `data:`,
  `file:` and the like) are refused at registration, and the page does not trust that alone.
- **Consent**: `/oauth/authorize` is a page of the client. It asks the server about the request
  (`GET /api/oauth/client`) and, once the user agrees, for a code (`POST /api/oauth/authorize`), both
  with the user's session. Agreeing asks for the password (or, without one, a recent sign-in), as
  minting a token by hand does, and counts toward the same limit of 50 tokens. A user who signs in
  through the identity provider from that page comes back to it after. A code is good once, for two
  minutes, and only with the verifier of the challenge it was issued for.
- **Tokens**: `POST /api/oauth/token` trades the code for an access token (`mfm_`, an hour) and a
  refresh token (`mfr_`), which trades for the next pair; each refresh replaces both. The refresh
  token is not a bearer token anywhere. One that comes back after it was replaced has been copied,
  and ends the grant for the assistant and the copy alike. A `resource` other than `/api/mcp` is
  refused (`invalid_target`).
- **The grant** is an MCP token like one minted by hand: listed in Settings under **API tokens**,
  named after the assistant and marked as connected by signing in, with the access and lifetime the
  user chose. Revoking it there, a password change or an admin reset ends it at once.

## Agent skill

The tools say what each one does; the repository's [`skills/manifesto/`](../../../skills/manifesto/SKILL.md)
says how to use them well, as an [Agent Skill](https://agentskills.io/) an assistant loads when the
user asks about their notes: look for the note a change belongs in before creating one, read before
changing and pass `updatedAt`, send the whole text and tag list since both replace, reuse the user's
tags, archive rather than trash, and treat what a note says as data rather than instructions.

It is versioned with the tools it describes, and a test fails when a tool or a note colour changes
without it. To use it with Claude Code, copy the folder into `~/.claude/skills/`; other assistants
that read Agent Skills take the same folder.

## Tools

| Tool | Does | Writes |
|---|---|---|
| `search_notes` | Notes whose title or content contains a query, newest first, paged | |
| `list_notes` | A page of notes, most recently changed first, by view (active, archived, trashed, all) and tag | |
| `get_note` | One note in full | |
| `list_tags` | Every tag outside the trash, with how many notes carry it | |
| `create_note` | A note at the top of the board: Markdown content, optional title, colour, tags, pin | yes |
| `update_note` | Change some fields of a note, or restore it from the trash | yes |
| `trash_note` | Move a note to the trash | yes |

A note comes back as an assistant needs it: id, title, content, colour, tags, pinned, archived,
trashed, reminder, image count, the user's role on it, and when it was created and last changed.
Layout, fonts and attachment references are left out.

There is no tool that deletes. The most an assistant can do is move a note to the trash, where it can be
restored for 30 days like any other.

`update_note` and `trash_note` take the `updatedAt` the assistant read. If the note has changed since
(in another tab, on another device, by someone it is shared with), the change is refused and the
assistant is told to read the note again, rather than writing over the other change. Without
`updatedAt` the change is applied to whatever the note holds now.

## What a token can do

An assistant's token (`mfm_...`), whether minted by hand or given by signing in, is a
[personal API token](../api.md#api-tokens) of its own kind:

- It works at `/api/mcp` and nowhere else. The REST API and both WebSockets refuse it, so a secret
  copied out of an assistant's settings can do only what the tools above do.
- It can be **read only** (the `notes:read` scope without `notes:write`), chosen when it is minted.
  The tools that write are then not offered, and the routes they would call refuse it.
- Everything else is as for an API token: it is stored as a hash, it expires when its owner chose or
  never, it records when it was last used, revoking it in Settings stops it at once, and it ends with
  the user's sessions (a password change, an admin reset).

## How it works

Each tool is one or more calls to the [REST API](../api.md), made inside the server with the
assistant's token. Authentication, validation, the roles of [shared notes](sharing-with-people.md),
rate limits and the `If-Match` check apply as they do to the web client, and a change an assistant
makes reaches the user's open tabs and their [webhooks](webhooks.md) like any other. A viewer of a
shared note can read it through an assistant and not change it.

The endpoint is the protocol's Streamable HTTP transport in its stateless form, written for this server
rather than taken from the MCP SDK: `POST /api/mcp` takes one JSON-RPC message (or, under protocol
`2025-03-26`, a batch) and answers with JSON. It keeps no session and never streams, so `GET` and
`DELETE` answer `405`. It speaks protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`, and
offers tools only (no prompts or resources). A request carrying an `Origin` that is neither in
`CORS_ORIGINS` nor the server's own host is refused, so a web page elsewhere cannot use a browser to
reach a server on the user's network.

## Privacy

What an assistant reads through these tools goes to wherever that assistant runs, which for most is
its vendor's service. That is the user's choice, made by minting the token and connecting it; a
read-only token limits what the assistant can change, not what it can read. See
[Privacy](privacy.md).

## Server

`MCP` (on by default) turns the endpoint on or off; see
[Server Deployment](../server/deployment.md). On opens nothing by itself, since the endpoint answers
only a token a user has minted or agreed to give. Off, `/api/mcp` and the sign-in endpoints answer
404, no assistant token can be minted or given, and existing ones stop working with it.
