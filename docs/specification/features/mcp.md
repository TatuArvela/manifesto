# MCP (AI assistants)

Connected mode offers an endpoint for AI assistants that speak the
[Model Context Protocol](https://modelcontextprotocol.io/) (Claude Code, Claude Desktop, Cursor and
others), so a user can ask an assistant to find, read, write or tidy their notes. Each user connects
theirs from Settings (**API tokens**, "Used by: An AI assistant"), which offers it only when the server
has MCP on.

## Connecting an assistant

Minting an assistant's token shows its secret once, with the command that connects Claude Code:

```bash
claude mcp add --transport http manifesto https://notes.example/api/mcp \
  --header "Authorization: Bearer mfm_..."
```

Any other client takes the same two things: the URL `<server>/api/mcp` over HTTP, and the token as a
bearer token in the `Authorization` header.

Sign-in through the browser (the OAuth flow some clients offer for remote servers) is not supported:
the token is the credential.

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

An assistant's token (`mfm_...`) is a [personal API token](../api.md#api-tokens) of its own kind:

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
only a token a user has minted. Off, `/api/mcp` answers 404, no assistant token can be minted, and
existing ones stop working with it.
