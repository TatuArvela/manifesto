# Webhooks

In connected mode, the server can send the note events of a user to URLs that the user selects. You
can use this to connect notes to n8n, Home Assistant, a chat bot or a script. Each user manages
their webhooks in Settings (**Webhooks**). This page shows only when the server has webhooks on.

## What is sent

A webhook subscribes to `note.created`, `note.updated` and `note.deleted` (all three by default). It
fires for the events that the open tabs of its owner get: the notes of the owner, and the notes
shared with the owner. The body is a `WebhookPayload`:

```json
{
  "event": "note.updated",
  "deliveryId": "01J...",
  "occurredAt": "2026-09-23T10:00:00.000Z",
  "note": { "id": "01J...", "pinned": false, "archived": false, "updatedAt": "...", "...": "..." }
}
```

A webhook fires for a change made in the app, and the server has no key. Thus, `note` is a
`WebhookNote`. It has the fields that the server can read (`id`, `pinned`, `archived`, `trashed`,
`trashedAt`, `position`, `reminder`, `readonly`, `source`, `sharing`, `createdAt`, `updatedAt`). It
has no title, text, tags or color ([Encryption](encryption.md#webhooks)). A receiver that needs
those reads the note by its id with an API token. A deletion has `noteId` in place of `note`.

Headers:

| Header | Value |
|---|---|
| `X-Manifesto-Event` | The event, or `ping` for a test |
| `X-Manifesto-Delivery` | The id of the delivery. It is the same on each retry of one delivery |
| `X-Manifesto-Timestamp` | The Unix seconds when the server signed it |
| `X-Manifesto-Signature` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<body>`, with the secret of the webhook |

The app shows the secret (`whsec_...`) one time, when you add the webhook. A receiver calculates the
signature again over the raw body. It refuses a timestamp that is too far from its own clock,
because the timestamp is signed.

## Delivery

- Each `2xx` is a success. All other answers, a timeout (10 s) or a refused address are failures. The
  server tries two more times (after 5 s and after 30 s). It does not follow redirects.
- The deliveries of one webhook go out one at a time, in order. Thus, a receiver gets the events of a
  note in the order that they occurred.
- The dialog shows the time and the status (or the error) of the last delivery. After 20 failures in
  sequence, the webhook switches itself off. When you turn it on again, the count goes back to zero.
- **Send a test** sends a `ping`, and shows the answer.
- A user can have a maximum of 10 webhooks. Only a session can manage them. An API token cannot add
  a webhook, because a webhook sends each note of its owner to a different place.

## Recipes

[`docs/examples/webhooks/receiver.mjs`](../../examples/webhooks/receiver.mjs) is a receiver in one
file, with no dependencies (Node 20 or newer). You can run it as it is, or use its parts. Start it
where the server can reach it. Add its address under Settings > Webhooks, and give it the secret that
shows there:

```sh
WEBHOOK_SECRET=whsec_... MANIFESTO_URL=https://notes.example MANIFESTO_TOKEN=mfp_... \
  PORT=8787 node receiver.mjs
```

A delivery tells which note changed, and contains none of its words. Thus, the recipes read the note
with an [API token](accounts.md#personal-api-tokens) (`readNote`). Make a token with "Read notes"
only. It contains the key that opens each note of the account. Thus, keep it as carefully as the
secret of the webhook. Without `MANIFESTO_TOKEN`, the recipes have nothing to read. They then only
remove a mirrored file.

It does the five things that each receiver must do. These are the parts to copy into other code:

- **Verify.** It checks the signature over the raw body as it arrived, before it parses JSON, with a
  constant-time comparison. It refuses a timestamp that is more than five minutes from the clock of
  the receiver.
- **Answer first.** It sends `204`, and then does the work. A delivery waits ten seconds before it
  counts as failed, and a recipe that calls a different service can take longer.
- **Keep the order.** Because it answers first, the next delivery can arrive while the work on the
  last delivery continues. Thus, the work goes through one queue: a change to a note is never handled
  after its deletion.
- **Read the latest.** The recipe reads the note when it runs. This can be after the note changed
  again, or after its deletion. A delivery is a sign that something changed. The answer to the read
  is the current truth.
- **Expect repeats.** A delivery that did not get an answer in time comes again with the same
  `X-Manifesto-Delivery`. Thus, the receiver ignores ids that it already handled. A note that
  changes two times makes two deliveries with different ids. Thus, a recipe that creates something
  also checks if it already did, and remembers what it made. A search of the other service can be
  behind a note that a person types in now.

Each recipe is a function of the delivery. Its own environment variables switch it on:

| Recipe | What it does | Needs |
|---|---|---|
| `todoTagOpensIssue` | A note with the tag `todo` opens a GitHub issue with the title and text of the note. The id of the note goes into the issue. If a note already has an issue, the recipe does nothing. Thus, an edit or a new tag makes no second issue. | `GITHUB_REPO=owner/name`, a `GITHUB_TOKEN` with "Issues: read and write" on that repository |
| `notifyTagPushes` | A note with the tag `notify` sends a push notification through [ntfy](https://ntfy.sh) when it is created or changed. The recipe sends only the title, because all persons who guess the name of a public topic can read it. | `NTFY_URL` |
| `mirrorToFolder` | Each note as a Markdown file with front matter. The name is the id of the note. The recipe writes the file again on each change, and removes it on deletion. This is a plain-text mirror for a backup or for Git. The files are readable. Thus, the folder must be as private as the notes. | `MIRROR_DIR` |

A recipe sees each note that the owner of its webhook has, also shared notes. It sees each note as
that person sees it. A tag belongs to the owner. Thus, the tags of a different person on a shared
note do not start the recipes of the owner. The first two recipes skip trashed notes.

The same checks apply in a tool, not only in a script. In n8n or Home Assistant, calculate the
HMAC-SHA256 of `<X-Manifesto-Timestamp>.<raw body>` with the secret. Compare it with
`X-Manifesto-Signature` before you act. A workflow that only parses the JSON obeys all persons who
find its address. If the automation runs on the same local network as the server,
`WEBHOOKS=private` lets a webhook point there (see below).

`packages/server/src/webhooks/exampleReceiver.test.ts` runs the file against the real dispatcher,
and reads its notes with a real token. Thus, the example always agrees with what the server sends.

## Where a webhook may point

Deliveries go through the same SSRF boundary as link previews (`linkPreview/safeFetch.ts`). The
server checks each address of the host, and the connection goes to the checked address. `WEBHOOKS`
sets what can pass (see [Server Deployment](../server/deployment.md)):

| `WEBHOOKS` | Reaches |
|---|---|
| `public` (default) | Only public addresses, on all ports |
| `private` | Also the local network: private ranges, carrier-grade NAT (Tailscale), loopback and IPv6 ULA, for automation that runs near the server. Link-local stays blocked, because cloud metadata services answer there |
| `off` | Nothing. `/api/v1/webhooks` sends 404, and the menu item does not show |

## API

| Method | Path | |
|---|---|---|
| `GET` | `/api/v1/webhooks` | `WebhooksResponse` |
| `POST` | `/api/v1/webhooks` | `WebhookCreateRequest`. The answer is `WebhookCreatedResponse`, with the secret |
| `PUT` | `/api/v1/webhooks/:id` | `{ active }` |
| `DELETE` | `/api/v1/webhooks/:id` | |
| `POST` | `/api/v1/webhooks/:id/test` | Sends a `ping`. The answer is `{ status, error }` |
