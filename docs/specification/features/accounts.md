# Account Administration

In connected mode a server has admins: people who can see every account on it, create accounts,
reset passwords, grant or revoke admin rights, and delete accounts. There is no email, so nothing is
ever sent to anyone. An admin hands a temporary password to its owner themselves.

Open mode has no accounts and none of this.

## Who is an admin

- **The first account on a server is its admin.** Whoever registers first (or, under single
  sign-on, signs in first) gets admin rights as the account is created. The decision is made in the
  same statement that inserts the account, so two sign-ups on an empty server cannot both be told
  nobody is there yet. On Postgres they can in theory both become admin, which is the harmless way
  for that race to go.
- **A server upgraded with accounts already in it promotes the oldest one**, so no deployment comes
  out of the upgrade with nobody able to administer it.
- **Admins make other admins** from the Users view.
- **A server always keeps at least one admin.** Revoking the last admin's rights, or deleting that
  account, is refused.

On a public server, registering first is a race between the operator and anyone else who finds it.
Register your own account before announcing the address, and set `REGISTRATION_ENABLED=false`
afterwards if accounts should only come from an admin.

Whether someone is an admin is read from the database on every admin request, not carried in their
session, so revoking admin takes effect on their next request.

## The Users view

Admins reach it from **Settings → Account → Manage users**, at `/admin`. It lists every account with
its note count, when it was created, and when one of its sessions was last used. Badges mark admins,
the viewer's own account, accounts that sign in with single sign-on, and accounts still holding a
temporary password.

Each account other than your own has a menu:

| Action           | Local sign-in | Single sign-on | What happens                                                     |
|------------------|---------------|----------------|------------------------------------------------------------------|
| Create account   | Yes           | No             | The account gets a temporary password, shown once                |
| Make/remove admin | Yes          | Yes            | Takes effect on the account's next request                        |
| Reset password   | Yes           | No             | Every session of that account ends; a temporary password is shown once |
| Delete account   | Yes           | Yes            | The account, its notes and its sessions are removed; asks first  |

**An admin cannot change their own account from here.** Removing your own admin rights, deleting
yourself or resetting your own password is refused, because each locks you out mid-task and each has
a safer route: another admin, or **Change password** in Settings.

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

**Settings → Account → Change password** asks for the current password and the new one twice. It is
offered only under local sign-in. A successful change keeps the current session and ends every other
session of the account, including its open sockets.

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
