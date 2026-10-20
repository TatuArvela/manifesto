# Security Policy

## Reporting a vulnerability

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/TatuArvela/manifesto/security/advisories/new)
(the Security tab of this repository). Do not open a public issue, discussion or pull request for
it.

A good report tells:

- What an attacker can do, and what the attacker must have first (an account, a share, a link, a
  network position).
- How to reproduce it, on a specified version or commit.
- Which mode it affects: open mode, connected mode, or both.
- The deployment details that it needs (storage driver, `AUTH_PROVIDER`, `WEBHOOKS`, reverse
  proxy).

## What to expect

Manifesto is a side project with one maintainer. Thus, there is no guaranteed response time. The
maintainer reads a report before all other items in the queue. A normal release fixes a confirmed
issue. Then a GitHub security advisory discloses it. The advisory gives credit to the reporter,
unless the reporter asks for no credit. Keep the details private until the advisory is public.

## Supported versions

Only the latest release gets security fixes. While Manifesto is at 0.x, we do not backport fixes.
Each release has its own server image tag (`ghcr.io/tatuarvela/manifesto-server:X.Y.Z`). Thus, a
self-hosted server stays on its pinned version until its operator changes the tag.

## Scope

The scope is all of this repository: the client, the server, the published image and the
configuration that they document. These are examples of the most important issues:

- A person signs in as a different person, or keeps access after the end of a session, token or
  share.
- A person reads or changes the notes, attachments or settings of a different account without a
  share that permits it.
- A note, a share link, an import or a link preview runs a script in the origin of the app.
- An auto-notes plugin gets access to something outside its sandbox.
- A token gets access to something that its scopes do not name. An MCP token (`mfm_`) gets access
  to something that its tools do not name.
- The server gets a private address through link previews. Or, a webhook connects to an address that
  its `WEBHOOKS` setting refuses. All settings refuse link-local addresses, for example a cloud
  metadata service.

Some behavior is on purpose. The linked pages tell why:

- **The server operator can read notes.** Notes do not have end-to-end encryption
  ([Encryption](docs/specification/features/encryption.md), [Privacy](docs/specification/features/privacy.md)).
- **All persons with a share link can read that note.** The note is in the link
  ([Sharing](docs/specification/features/sharing.md)).
- **Open-mode data is only as private as its browser profile.** It never goes off the device.
- **`WEBHOOKS=private` can connect to the local network**, and to loopback. That is the purpose of
  the setting ([Webhooks](docs/specification/features/webhooks.md)).
- **An admin can export the notes of an account when the server has `ADMIN_EXPORT` on.** The owner
  of the account sees the export on their Activity page
  ([Privacy](docs/specification/features/privacy.md)).

The software cannot control a deployment that does not agree with
[Server Deployment](docs/specification/server/deployment.md). An example is a proxy that appends to
`X-Forwarded-For`, and does not overwrite it. But if the documentation causes people to make such a
setup, a report about it is welcome.

A vulnerability in a dependency is in scope when Manifesto exposes it. If not, report it to the
upstream project. Dependabot brings the fix each week.

The [preview](https://tatuarvela.github.io/manifesto/) is the client in open mode. It has no server.
Do your tests on your own copy. Do not test on a copy that a different person runs.
