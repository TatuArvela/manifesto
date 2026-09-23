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

## The account menu

In connected mode the header shows the signed-in user's avatar to the right of the settings button.
Its menu names the account (with its email address, if it has one) and holds everything about it:
**Manage users** for admins, **Email address** and **Change password** under local sign-in, and
**Sign out**. Open mode has no accounts, so the button is not there at all, and the Settings panel
carries no account section in either mode.

## Email addresses

An account may have one email address. It exists so that someone [sharing a note](sharing-with-people.md)
can find the account by it, and it is used for nothing else: no mail is ever sent, so it is not
verified by sending any.

- **Unique regardless of case.** An address leads to one account. Using one another account holds is
  refused (`409`, `code: "email_taken"`).
- **Under local sign-in** it can be given when registering, set or removed from the account menu, and
  given or changed by an admin.
- **Under single sign-on** the identity provider's `email` claim is stored at every sign-in, unless the
  provider marks it `email_verified: false`, or another account already holds it (the sign-in goes
  ahead and the address is left off). The account menu does not offer to change it. An admin can, but
  the next sign-in puts the provider's address back.

## The Users view

Admins reach it from the account menu → **Manage users**, at `/admin`. It lists every account with its
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

**Change password** in the account menu opens a dialog that asks for the current password and the new
one twice. It is offered only under local sign-in. A successful change keeps the current session and
ends every other session of the account, including its open sockets.

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

Any account can mint API tokens from the account menu (**API tokens**), for scripts, iOS Shortcuts,
command-line capture or home automation that should not hold a password. A token is named, expires
after 30, 90 or 365 days or never, is shown once when it is made, and is listed afterwards by its first
characters and when it was last used. Revoking it closes anything connected with it at once. A token
reaches notes, never the account's own security or the admin API; see the API doc for the rules.
