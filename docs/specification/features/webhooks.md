# Webhooks

Connected mode can post a user's note events to URLs they choose, which is how notes get wired into n8n,
Home Assistant, a chat bot or a script. Each user manages theirs from Settings (**Webhooks**),
which appears only when the server has them on.

## What is sent

A webhook subscribes to `note.created`, `note.updated` and `note.deleted` (all three by default). It
hears exactly what its owner's open tabs hear: their own notes, and notes shared with them, each as the
owner of the webhook sees it (their own color, pin, tags and role). The body is a `WebhookPayload`:

```json
{
  "event": "note.updated",
  "deliveryId": "01J...",
  "occurredAt": "2026-09-23T10:00:00.000Z",
  "note": { "id": "01J...", "title": "...", "content": "...", "...": "..." }
}
```

A deletion carries `noteId` instead of `note`. Images arrive as `attachment:<id>` references, readable
with an API token at `GET /api/attachments/:id` (see [Attachments](attachments.md)).

Headers:

| Header | Value |
|---|---|
| `X-Manifesto-Event` | The event, or `ping` for a test |
| `X-Manifesto-Delivery` | The delivery's id; the same on every retry of one delivery |
| `X-Manifesto-Timestamp` | Unix seconds when it was signed |
| `X-Manifesto-Signature` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<body>` under the webhook's secret |

The secret (`whsec_...`) is shown once, when the webhook is added. A receiver recomputes the signature
over the raw body and rejects a timestamp too far from its own clock, since the timestamp is signed.

## Delivery

- Any `2xx` is success. Anything else, a timeout (10 s) or a refused address is a failure, retried twice
  (after 5 s and 30 s). Redirects are not followed.
- One webhook's deliveries go out one at a time, in order, so a receiver sees a note's events in the order
  they happened.
- The last delivery's time and status or error are shown in the dialog. After 20 failures in a row the
  webhook switches itself off; turning it on again resets the count.
- **Send a test** posts a `ping` and shows what came back.
- A user has at most 10 webhooks. Managing them is session-only: an API token cannot add one, since a
  webhook sends every note its owner holds somewhere else.

## Recipes

[`docs/examples/webhooks/receiver.mjs`](../../examples/webhooks/receiver.mjs) is a receiver in one file
with no dependencies (Node 20 or newer), to run as it is or to take apart. Start it where the server can
reach it, add its address under Settings > Webhooks, and give it the secret shown there:

```sh
WEBHOOK_SECRET=whsec_... PORT=8787 node receiver.mjs
```

It does the four things every receiver has to, and they are the part worth copying into anything else:

- **Verify.** The signature is checked over the raw body as it arrived, before any JSON is parsed, with a
  constant-time comparison, and a timestamp more than five minutes from the receiver's clock is refused.
- **Answer first.** It answers `204` and then does the work, since a delivery waits ten seconds before it
  counts as failed and a recipe that calls another service can take longer.
- **Keep the order.** Answering first means the next delivery arrives while the last is still being
  worked on, so the work goes through one queue: a note's change is never handled after its deletion.
- **Expect repeats.** A delivery that was not answered in time comes again with the same
  `X-Manifesto-Delivery`, so ids already handled are dropped. A note that changes twice makes two
  deliveries with different ids, so a recipe that creates something also checks whether it already has,
  and remembers what it made: a search of the other service can lag behind a note that is being typed in.

Each recipe is a function of the delivery, switched on by its own environment variables:

| Recipe | What it does | Needs |
|---|---|---|
| `todoTagOpensIssue` | A note tagged `todo` opens a GitHub issue with the note's title and text. The note's id is written into the issue, and a note that already has an issue is left alone, so editing or re-tagging it makes no second one. | `GITHUB_REPO=owner/name`, `GITHUB_TOKEN` with "Issues: read and write" on that repository |
| `notifyTagPushes` | A note tagged `notify` sends a push notification through [ntfy](https://ntfy.sh) when it is created or changed. Only the title is sent, since a public topic can be read by anyone who guesses its name. | `NTFY_URL` |
| `mirrorToFolder` | Every note as a Markdown file with front matter, named by the note's id, rewritten on each change and removed on deletion: a plain-text mirror to back up or keep in Git. | `MIRROR_DIR` |

A recipe sees every note its webhook's owner holds, shared ones included, each as that person sees it; a
tag is the owner's own, so someone else's tags on a shared note do not trigger theirs. Trashed notes are
skipped by the first two.

The same checks apply in a tool rather than a script. In n8n or Home Assistant, compute the HMAC-SHA256
of `<X-Manifesto-Timestamp>.<raw body>` with the secret and compare it with `X-Manifesto-Signature`
before acting; a workflow that only parses the JSON takes orders from anyone who finds its address. On
a server whose automation runs beside it on the local network, `WEBHOOKS=private` lets a webhook point
there (see below).

`packages/server/src/webhooks/exampleReceiver.test.ts` runs the file against the real dispatcher, so the
example cannot drift from what the server sends.

## Where a webhook may point

Deliveries go through the same SSRF boundary as link previews (`linkPreview/safeFetch.ts`): every address
the host resolves to is checked, and the connection is pinned to the checked one. What passes is set by
`WEBHOOKS` (see [Server Deployment](../server/deployment.md)):

| `WEBHOOKS` | Reaches |
|---|---|
| `public` (default) | Public addresses only, on any port |
| `private` | Also the local network: private ranges, carrier-grade NAT (Tailscale), loopback and IPv6 ULA, for automation running beside the server. Link-local stays out, since cloud metadata services answer there |
| `off` | Nothing; `/api/webhooks` answers 404 and the menu item is hidden |

## API

| Method | Path | |
|---|---|---|
| `GET` | `/api/webhooks` | `WebhooksResponse` |
| `POST` | `/api/webhooks` | `WebhookCreateRequest`; answers `WebhookCreatedResponse` with the secret |
| `PUT` | `/api/webhooks/:id` | `{ active }` |
| `DELETE` | `/api/webhooks/:id` | |
| `POST` | `/api/webhooks/:id/test` | Sends a `ping`; answers `{ status, error }` |
