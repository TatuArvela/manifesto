# Account Administration

In connected mode a server has admins: people who can see every account on it, create accounts,
reset passwords, grant or revoke admin rights, and delete accounts. There is no email, so nothing is
ever sent to anyone. An admin hands a temporary password to its owner themselves.

Open mode has no accounts and none of this.

## Who is an admin

- **Under local sign-in, the server creates the first admin itself.** See
  [The initial admin](#the-initial-admin) below. Nobody who registers becomes an admin by doing so.
- **Under single sign-on, the first person to sign in is the admin.** There is no password to issue,
  and the identity provider already decides who can sign in at all. The decision is made in the same
  statement that inserts the account, so two first sign-ins cannot both be told nobody is there yet.
  On Postgres they can in theory both become admin, which is the harmless way for that race to go.
- **A server upgraded with accounts already in it promotes the oldest one**, so no deployment comes
  out of the upgrade with nobody able to administer it.
- **Admins make other admins** from the Users view.
- **A server always keeps at least one admin.** Revoking the last admin's rights, or deleting that
  account, is refused.

## The initial admin

When a server using local sign-in starts and no admin has a password of their own, it creates an
account called `admin` with a [temporary password](#temporary-passwords) and prints both, before it
accepts a request:

```json
{"level":"warn","message":"Created the initial admin account. Sign in with this temporary password and choose your own.","username":"admin","temporaryPassword":"k7mq-2xha-p9dt-4wne"}
```

- **It is printed whatever `LOG_LEVEL` says**, as a JSON line like every other, on standard error.
  Look for it with `docker logs` or wherever the server's output goes.
- **Signing in with it asks for a new password**, like any temporary password. After that the account
  is an ordinary admin.
- **Until then, every boot issues a new password** for the same account and prints it, and the
  previous one stops working. Lost the line? Restart the server.
- **Once any admin has chosen a password, nothing happens on boot.** An upgraded server whose oldest
  account was promoted never gets an `admin` account.
- **A server whose only admins sign in through an identity provider it no longer uses** gets one too,
  since none of them can sign in. If a user already holds the name `admin`, their account is left
  alone and the new one is called `admin-` plus a short suffix.
- **`INITIAL_ADMIN_PASSWORD`** sets the temporary password instead of generating one, for deployments
  that cannot read the server's output. It is not printed, and it still has to be changed at first
  sign-in.

It is deliberately not a fixed `admin`/`admin`. A well-known default belongs to whoever tries it
first, and scanners try it within minutes of a server appearing. A forced password change would then
hand them the server, since they are the ones making the change. A random password is known only to
whoever can read the server's output.

To administer as yourself rather than as `admin`, create your own account from the Users view, make it
an admin, sign in as it, and delete `admin`.

Whether someone is an admin is read from the database on every admin request, not carried in their
session, so revoking admin takes effect on their next request.

## The account menu and account settings

In connected mode the header shows the signed-in user's avatar to the right of the settings button.
Its menu names the account (avatar, name, and its email address or else its username) and holds two
things: **Account settings**, which opens the Settings modal on the account's page, and **Sign out**.
Open mode has no accounts, so the button is not there at all.

The Settings modal lists the account's pages above the general ones, headed by the user as a profile
card: **Account** (email address and, under local sign-in, **Change password**), **Two-factor
sign-in** under local sign-in, **API tokens**, and **Webhooks** when the server enables them. Open
mode shows only the general pages.

## Email addresses

An account may have one email address. It exists so that someone [sharing a note](sharing-with-people.md)
can find the account by it, and it is used for nothing else: no mail is ever sent, so it is not
verified by sending any.

- **Unique regardless of case.** An address leads to one account. Using one another account holds is
  refused (`409`, `code: "email_taken"`).
- **Under local sign-in** it can be given when registering, set or removed on the Account settings page, and
  given or changed by an admin.
- **Under single sign-on** the identity provider's `email` claim is stored at every sign-in, unless the
  provider marks it `email_verified: false`, or another account already holds it (the sign-in goes
  ahead and the address is left off). Account settings shows it read-only. An admin can, but
  the next sign-in puts the provider's address back.

## The Users view

Admins reach it from **Users**, the last entry of the side menu (the top row on a phone), at
`/admin`; nobody else is shown the entry. It lists every account with its
email address, note count, when it was created, and when one of its sessions was last used. Badges mark admins, the
viewer's own account, accounts that sign in with single sign-on, and accounts still holding a
temporary password.

Each account other than your own has a menu:

| Action           | Local sign-in | Single sign-on | What happens                                                     |
|------------------|---------------|----------------|------------------------------------------------------------------|
| Create account   | Yes           | No             | The account gets a temporary password, shown once, and optionally an email address |
| Make/remove admin | Yes          | Yes            | Takes effect on the account's next request                        |
| Change email     | Yes           | Yes            | Sets or clears the address; under SSO the next sign-in replaces it |
| Reset password   | Yes           | No             | Every session of that account ends; a temporary password is shown once |
| Delete account   | Yes           | Yes            | The account, its notes and its sessions are removed; asks first. Its notes disappear for everyone they were shared with |

**An admin cannot change their own account from here.** Removing your own admin rights, deleting
yourself or resetting your own password is refused, because each locks you out mid-task and each has
a safer route: another admin, or **Change password** in the account menu.

Under single sign-on the identity provider creates accounts (the first time someone signs in) and
owns their passwords, so the view offers neither. It says so above the list.

## Temporary passwords

A temporary password is four groups of four lowercase letters and digits (`k7mq-2xha-p9dt-4wne`),
without the characters that are easy to misread (`0`, `o`, `1`, `l`, `i`). That is about 79 bits.

The server stores only its hash, so the response that creates it is the only place it can be read.
The Users view shows it with a Copy button until the admin dismisses it or leaves the view.

A temporary password is good for one thing: choosing a real one.

- Signing in with it returns `403` with `code: "password_change_required"` and **no session**. There
  is no half-signed-in state for the rest of the API to refuse.
- The sign-in screen then asks for a new password twice and signs in again with it. The server sets
  the new password, clears the flag and issues a session in the same request.
- The new password must differ from the temporary one.
- A wrong password never reveals that an account holds a temporary one: it gets the same `401` as
  any other wrong guess.

## Changing your own password

**Change password** on the Account settings page asks for the current password and the new
one twice. It is offered only under local sign-in. A successful change keeps the current session and
ends every other session of the account, including its open sockets.

## Confirming a change from a session

A session can be stolen: a device left signed in, a token lifted from a browser. `sessionOnly` already
keeps API tokens away from how an account is secured, but not a session that is not its owner's. So
the changes that would let whoever holds one keep the account or its notes ask again:

- setting or removing the **email address**, since a reset link goes to it,
- minting an **API token**, which outlives the session that made it,
- adding a **webhook**, which sends every note from then on to its address,
- turning **two-factor sign-in** on or off, adding or removing a **passkey**, or replacing the recovery
  codes (these asked before).

An account with a password confirms with it, typed into the same form. Wrong passwords count against
the same per-name budget as signing in, ten in fifteen minutes, so a stolen session cannot guess at
the password any faster than the sign-in form can, and a name locked by either is locked for both.

An account that signs in only through an identity provider has no password to type. Its proof is a
sign-in within the last 15 minutes. Past that, the form says to sign in again and links to the
identity provider with `prompt=login` (`/api/auth/login?reauth=1`), which asks for real rather than
reusing its own session; the action is then repeated from the fresh session.

Changing the password asks for the current one, as it always has.

## Ending sessions

Deleting session rows stops the next HTTP request, but a WebSocket is authenticated once, when it
connects. A reset, a deletion or a password change therefore also closes the sockets those sessions
opened:

- `/api/ws` connections close with code `4401`, which the client reads as being signed out.
- `/api/yjs` connections have their whole socket closed, not just one document's connection, since a
  closed document connection is only a request the peer is free to ignore. The provider reconnects,
  and `onAuthenticate` refuses the ended session.

This is what makes a reset useful against someone who has learned a password: whoever is signed in
with it stops receiving note events and stops editing live documents at once.

## Personal API tokens

Any account can mint API tokens from Settings (**API tokens**), for scripts, iOS Shortcuts,
command-line capture or home automation that should not hold a password. A token is named, expires
after 30, 90 or 365 days or never, is shown once when it is made, and is listed afterwards by its first
characters and when it was last used. Revoking it closes anything connected with it at once. A token
reaches notes, never the account's own security or the admin API; see the API doc for the rules.

## Two-factor sign-in

A local account can turn on two-factor sign-in from Settings (**Two-factor sign-in**): signing in then
asks for a second factor after the password, from an **authenticator app**, a **passkey**, or either
when the account has both. Accounts that sign in through single sign-on get this from their identity
provider instead, and can add neither.

- **An authenticator app** (TOTP, RFC 6238: SHA-1, 30-second steps): setting it up asks for the password,
  shows a new key (as a QR code to scan, in base32 grouped for typing, and as an `otpauth://` link for an
  authenticator on the same device), and takes effect only once a code from it is entered.
- **A passkey** (WebAuthn): adding one asks for the password, then the browser's own prompt makes it on
  the device, in a password manager, or on a security key. Each is named, listed with whether it is
  synced between devices and when it was last used, and removed with the password. A passkey belongs to
  the address of the page that made it (its relying party is that host), so one made on one address of
  a server does not work on another. Browsers offer passkeys only on `https` pages (and `localhost`), so
  a client served over plain `http` shows none of this. At most 20.
- **Recovery codes**: the first second factor of either kind brings ten one-time recovery codes, shown
  once and stored hashed. One set covers every factor: adding a second one keeps them, and removing a
  factor keeps them while another is left. Removing the last turns two-factor off and the codes with it.
- **Signing in** answers `403` with `code: "two_factor_required"` after a right password, saying which
  factors the account has and carrying a challenge for its passkeys on this address. The client sends the
  same request again with `otp` (an authenticator code, or a recovery code, case and separators ignored)
  or `passkey` (the browser's answer to the challenge). The factor is checked only after the password, so
  a wrong guess learns nothing about the account, and a wrong code counts against the same per-account
  sign-in budget as a wrong password, so six digits cannot be walked through. Each code's time step is
  accepted once (the server keeps the last one used), a recovery code once, and a challenge once.
- **Changes** to any of it ask for the password again, and all of it is session-only: an API token
  cannot touch it.
- **Lost everything**: an admin issuing a temporary password (see above) also turns two-factor off,
  passkeys included, since that is the recovery path; the user can set it up again after signing in.
  A password change or a reset by mail leaves it as it is.

The authenticator's secret is held as is in `user_totp` (it has to be, to compute codes), next to the
password hash; `totp_recovery_codes` holds the hashed recovery codes, and `passkeys` each passkey's
public key, which is no secret.

## Signing in with a passkey

On a local account, a passkey also signs in on its own: **Sign in with a passkey** on the sign-in screen
asks the browser for any passkey it holds for this address, with no name or password, and the device
checks that its owner is using it (a fingerprint, a face, a PIN). That check is the second factor, so no
code is asked after it. Passkeys made here are discoverable for this reason. A passkey whose account now
holds a temporary password, or has none, signs in to nothing; every failure is the same `401`.

## Signing in with a link

With `SMTP_URL` set and `MAGIC_LINKS` on (the default; see [Server Deployment](../server/deployment.md)), a
local account with an email address can sign in without typing its password: **Email me a sign-in link**
under the sign-in form asks for the address and mails a link to `APP_URL/#signin=<token>`. Opening it
shows a **Sign in** button, and pressing that signs in.

- Asking always answers `204`, whether or not the address has an account, and the mail is sent after the
  answer, as a [reset link](#recovery-by-mail) is. One link per account per five minutes; a link whose
  mail could not be sent is not kept and does not count towards that.
- A link works once, for 15 minutes; its token is stored as a SHA-256 hash, in a table of its own
  (`sign_in_links`), so a sign-in link cannot be spent as a reset link or the other way round. The token is
  in the URL fragment, which a browser does not send to any server, and the client takes it out of the
  address bar before using it. A browser that is signed in already takes it out too, and uses it for
  nothing: left there, it would sign the same person back in when they signed out.
- The link is spent by the press, not by the page loading. A mail scanner or a link preview that opens
  the address runs the page as a browser does, and would otherwise use the link up and hold a session.
- The link stands in for the password and for nothing else. An account with two-factor sign-in is asked
  for its code or passkey after opening the link, on the same per-account budget of failed attempts as a
  password sign-in, and a mistyped code does not cost the link. Nor does a link that has run out cost a
  recovery code: the link is checked before the code is.
  An account without a second factor is not held to that budget here: there is nothing in the link to
  guess at, anyone can run the budget out with wrong passwords, and the link is then the way in its
  owner has left. Such a sign-in does not clear the count either.
- A link stops working when the account's password is changed or reset, by its owner or an admin, and
  when its email address changes, so a link sitting in a mailbox someone else can read does not
  outlast what was done about it.
- No link is sent to an account that has no password here (it signs in through single sign-on) or that
  holds a [temporary password](#temporary-passwords), which has to be replaced by the person it was
  handed to. A link sent before either became true is refused.
- Signing in this way ends no other session and changes nothing about the account. It is in the audit log
  as a sign-in with `method: "link"`, and asking for the link as "Sign-in link sent".
- There is no signing up by link: it opens accounts that exist.

Whoever reads the account's mail can already take the account with a reset link, so this adds a shorter
way in rather than a new party to trust. A host for whom a mailbox alone must never open an account sets
`MAGIC_LINKS=off`, and should weigh reset by mail the same way.

## Admins and sign-up under single sign-on

With single sign-on, admin can follow a group at the identity provider (`OIDC_ADMIN_GROUP`) instead of
being granted by hand: it is decided again at every sign-in, both ways, and never takes admin from the
last admin. `OIDC_USER_GROUP` limits who may sign in at all, and `OIDC_AUTO_REGISTER=off` stops accounts
being created on first sign-in. Groups the identity provider did not give (the ID token leaves the claim
out and userinfo cannot be read) are unknown rather than empty: admin stays as it was, and a sign-in the
user group gates is refused, so an outage at the provider neither strips admins nor lets anyone past the
gate. A refused sign-in comes back to the client as `#error=not_in_group`, `#error=not_registered` or
`#error=groups_unavailable`, and the sign-in screen says which. See [Server
Deployment](../server/deployment.md#oidc-variables-when-auth_provideroidc-or-both).

## Recovery by mail

With `SMTP_URL` set (see [Server Deployment](../server/deployment.md)), a local account with an email
address can reset a forgotten password itself: **Forgot your password?** under the sign-in form asks for
the address and mails a link to `APP_URL/#reset=<token>`, which opens a form for the new password.

- Asking always answers `204`, whether or not the address has an account, and the mail is sent after
  the answer, so neither the answer nor its timing says which addresses have accounts. One link per
  account per five minutes, so an address cannot be used to flood its inbox; a link whose mail could
  not be sent is not kept and does not count towards that.
- A link works once, for 30 minutes; its token is stored as a SHA-256 hash. Using it ends every session
  and API token of the account, as a password change does. Two-factor sign-in stays on: the link proves
  control of the mailbox, not of the authenticator.
- The mail is in the language the sign-in screen was in (English or Finnish; the server keeps these few
  messages in `mail/templates.ts`).

The same setting mails a share invitation to a recipient who has an address, in the recipient's
language rather than the sharer's: each client reports the language it is set to
(`PUT /api/auth/me/locale`) whenever it differs from what the server holds, and an account no client
has reported for gets English. Mail is a convenience
beside something that already happened, so a failure to send is logged and nothing else fails.
Accounts from single sign-on have no password here and are not offered a reset.

## Audit log

The server records who did what to which account or note, and from where, in `audit_log`: sign-ins
(with the method, and whether two-factor was used), failed sign-ins (with the name tried and why:
unknown account, wrong password, wrong code, a passkey refused, or single sign-on refused), sign-outs, password changes and
resets, two-factor turned on or off, passkeys added or removed, API tokens and webhooks created or
removed, shares created, changed
and removed, and every admin action (accounts created or deleted, admin granted or taken away, including
by `OIDC_ADMIN_GROUP`, email addresses changed, temporary passwords issued). Note contents are never
recorded.

Every signed-in user reads their own lines of it, where they are the actor or the target, on the
**Activity** page of Settings (`GET /api/auth/me/activity`), so an admin's action on an account is
never hidden from its owner. There an address is shown only for what the user did and for failed
sign-ins on their account; see [Privacy](privacy.md).

Admins read it in the Users view's **Activity** tab, newest first, from `GET /api/admin/audit`
(`limit`, `before`, `userId`, `action`). The address is the socket peer, or the first `X-Forwarded-For`
hop with `TRUST_PROXY` on. Actor and target are not foreign keys, so an entry about an account outlives
the account. Entries are kept for `AUDIT_RETENTION_DAYS` (180 by default) and pruned hourly. Writing an
entry never fails the request it describes; one that cannot be written is logged.

## Lockout recovery

With no admin able to sign in, the server's admin CLI (`node dist/cli.js`, run in the container) lists
admins, issues a temporary password, makes an account an admin, or creates a new local admin. See
[Server Deployment](../server/deployment.md#locked-out).

## Server overview

The Users view's **Overview** tab shows an admin what the server holds and how it is running, from
`GET /api/admin/overview`: the version and uptime; totals of accounts, notes (and how many are in the
trash), shares, images and the bytes they take, and saved versions; the same per account, the largest
first, with images counted under the owner of the notes they belong to; and every background job (trash,
sessions, unused images, backups when on) with when it last ran, how long it took and its last error.
When the update check (`UPDATE_CHECK`, on by default) has found a newer release than the one running,
the overview says so with a link to its notes, and every admin sees a dot on the settings button and a line on
the About page of Settings. A build past a release (`0.1.8+14.bf5a6dd`) counts as that release, so only a later
release is news. The counts are plain aggregates in either driver (`maintenance.stats`); job status is kept in memory by
`startPeriodicJob`, so it describes the running process since it started.

### Setup checks

The overview also lists **setup checks**: the settings that go wrong without anything saying so. Each is
fine, worth knowing, or needs attention, with a line on what it means and, where there is something to
change, a link to the section of [Server Deployment](../server/deployment.md) that says how.

- **HTTPS**: whether the page came over HTTPS. Plain HTTP on `localhost` is only worth knowing.
- **`APP_URL`**: whether it is the address the admin is on. Unset is worth knowing (email needs it); a
  different address needs attention, since links in email and an assistant's sign-in lead there.
- **The proxy and `TRUST_PROXY`**: the client sends the request with a made-up `X-Forwarded-For` (a
  documentation address, `PROXY_PROBE_ADDRESS`), and the server reports what reached it: the probe as
  sent (no proxy set the header), a single other address (a proxy replaced it), the probe with
  addresses after it (a proxy appended), or nothing. Trusting the header is right exactly when a proxy
  replaces it. Trusting one that appends, or a probe that arrived untouched, lets a client choose the
  address it is throttled by; not trusting a proxy that replaces it puts every client in one bucket.
  The check sees only the path the admin's own request took: a port published beside the proxy is
  found only when that is the way the admin came in.
- **Backups** (SQLite only; Postgres backups are its own): off is worth knowing, a failed last run
  needs attention.
- **Email**: off is worth knowing. With `SMTP_URL`, when mail last went or last failed since the server
  started (in memory, like job status; why a send failed is in the server log), and a button that sends
  the admin a test message at their own address.

HTTPS and `APP_URL` are judged in the browser, which alone knows the address it used; the rest comes
from `GET /api/admin/checks`.
