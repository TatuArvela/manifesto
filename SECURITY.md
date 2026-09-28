# Security Policy

## Reporting a vulnerability

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/TatuArvela/manifesto/security/advisories/new)
(the Security tab of this repository). Please do not open a public issue, discussion or pull request
for it.

A useful report says:

- what an attacker can do, and what they need first (an account, a share, a link, network position),
- how to reproduce it, against a version or commit,
- which mode it affects: open mode, connected mode, or both,
- any deployment detail it depends on (storage driver, `AUTH_PROVIDER`, `WEBHOOKS`, reverse proxy).

## What to expect

Manifesto is a side project kept by one maintainer, so there is no response-time guarantee. A report is
read before anything else in the queue, and a confirmed issue is fixed in a normal release, then
disclosed through a GitHub security advisory that credits the reporter unless they ask otherwise. Please
keep the details private until that advisory is out.

## Supported versions

Only the latest release gets security fixes; nothing is backported while Manifesto is at 0.x. Server
images are tagged per release (`ghcr.io/tatuarvela/manifesto-server:X.Y.Z`), so a self-hosted server
stays on the version it pinned until its operator moves the tag.

## Scope

In scope is anything in this repository: the client, the server, the published image and the
configuration they document. Examples of what matters most:

- signing in as someone else, or keeping access after a session, token or share has ended,
- reading or changing another account's notes, attachments or settings without a share that allows it,
- script running in the app's origin from a note, a share link, an import or a link preview,
- an auto-notes plugin reaching anything outside its sandbox,
- a token reaching anything its scopes do not name, or an MCP token (`mfm_`) anything its tools do not,
- the server fetching a private address through link previews, or reaching through a webhook an
  address its `WEBHOOKS` setting refuses (under any setting, that includes link-local addresses such as
  a cloud metadata service).

Some behaviour is deliberate, and the linked pages say why:

- **The server operator can read notes.** Notes are not end-to-end encrypted
  ([Encryption](docs/specification/features/encryption.md), [Privacy](docs/specification/features/privacy.md)).
- **Anyone holding a share link can read that note.** The note travels in the link
  ([Sharing](docs/specification/features/sharing.md)).
- **Open mode data is as private as the browser profile it is in.** It never leaves the device.
- **`WEBHOOKS=private` reaches the local network**, loopback included. That is what the setting is for
  ([Webhooks](docs/specification/features/webhooks.md)).
- **An admin can export an account's notes when the server has `ADMIN_EXPORT` on**, and the account's
  owner sees it on their Activity page ([Privacy](docs/specification/features/privacy.md)).

A deployment that departs from [Server Deployment](docs/specification/server/deployment.md), such as a
proxy that appends to `X-Forwarded-For` rather than overwriting it, is outside the software's control;
a report that the documentation leads people into such a setup is welcome, though. A vulnerability in a
dependency is in scope when Manifesto exposes it; otherwise it belongs upstream, and Dependabot brings
the fix in weekly.

The [preview](https://tatuarvela.github.io/manifesto/) is the client in open mode, with no server
behind it. Please test against your own copy rather than anything someone else runs.
