# Webhooks

Connected mode can post a user's note events to URLs they choose, which is how notes get wired into n8n,
Home Assistant, a chat bot or a script. Each user manages theirs from the account menu (**Webhooks**),
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
