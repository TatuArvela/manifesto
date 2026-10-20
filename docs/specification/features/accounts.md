# Account Administration

In connected mode, a server has admins. An admin can see all accounts on the server, create accounts,
reset passwords, give or remove admin rights, and delete accounts. There is no email in this
procedure. Thus, the server sends nothing to anyone. An admin gives a temporary password to its owner
personally.

Open mode has no accounts, and none of these functions.

## Who is an admin

- **With local sign-in, the server creates the first admin itself.** See
  [The initial admin](#the-initial-admin) below. A person who registers does not become an admin.
- **With single sign-on, the first person who signs in is the admin.** There is no password to give,
  and the identity provider already decides who can sign in. The same statement that inserts the
  account makes the decision. Thus, two first sign-ins cannot both see that there is no account yet.
  On Postgres, both can become admin in theory. That is the safe result of that race.
- **A server that you upgrade with existing accounts makes the oldest account an admin.** Thus, after
  the upgrade, no deployment is without an admin.
- **Admins make other admins** from the Users view.
- **A server always keeps a minimum of one admin.** The server refuses to remove the rights of the
  last admin, or to delete that account.

## The initial admin

When a server with local sign-in starts, and no admin has their own password, the server creates an
account with the name `admin` and a [temporary password](#temporary-passwords). It prints both before
it accepts a request:

```json
{"level":"warn","message":"Created the initial admin account. Sign in with this temporary password and choose your own.","username":"admin","temporaryPassword":"k7mq-2xha-p9dt-4wne"}
```

- **It prints the line whatever the value of `LOG_LEVEL`**, as a JSON line, the same as all other
  lines, on standard error. Look for it with `docker logs`, or where the output of the server goes.
- **A sign-in with it asks for a new password**, as for all temporary passwords. After that, the
  account is a usual admin.
- **Until then, each start gives a new password** to the same account and prints it. The previous
  password stops. If you lost the line, restart the server.
- **When an admin has selected a password, the start does nothing.** An upgraded server that made its
  oldest account an admin never gets an `admin` account.
- **A server whose only admins sign in through an identity provider that it does not use now** also
  gets one, because none of them can sign in. If a user already has the name `admin`, the server does
  not change their account. It calls the new account `admin-` with a short suffix.
- **`INITIAL_ADMIN_PASSWORD`** sets the temporary password, in place of a generated one. It is for
  deployments that cannot read the output of the server. The server does not print it. The user must
  still change it at the first sign-in.

It is not a fixed `admin`/`admin`, on purpose. A well-known default belongs to the first person who
tries it, and scanners try it within minutes after a server is available. A mandatory password change
then gives them the server, because they make the change. Only a person who can read the output of
the server knows a random password.

To administer as yourself, and not as `admin`, do these steps:

1. Create your own account in the Users view.
2. Make it an admin.
3. Sign in as it.
4. Delete `admin`.

The server reads from the database on each admin request whether a person is an admin. The session
does not contain this. Thus, when you remove admin rights, the change applies on the next request of
that person.

## The account menu and account settings

In connected mode, the header shows the avatar of the signed-in user, to the right of the settings
button. Its menu names the account (avatar, name, and its email address, or its username if there is
no address). It has two items: **Account settings**, which opens the Settings modal on the page of the
account, and **Sign out**. Open mode has no accounts. Thus, the button is not there.

The Settings modal lists the pages of the account above the general pages, in groups with a gap
between them:

- The user as a profile card, which opens **Account** (the email address, and
  [**Delete account**](#deleting-your-own-account) separately at its bottom).
- **Sign-in** with local sign-in (**Change password** and **Two-factor sign-in**), **Encryption keys**
  and **Activity**.
- **API tokens** and **Webhooks**, when the server enables them.

The email address and the password show as they are, with a button that opens the form to change
them. Open mode shows only the general pages.

## Email addresses

An account can have one email address. Its only purpose is to let a person who
[shares a note](sharing-with-people.md) find the account. The app uses it for nothing else. It never
sends mail to it. Thus, it does not verify the address with a mail.

- **Unique, whatever the case.** An address belongs to only one account. If you try to use an address
  of a different account, the server refuses it (`409`, `code: "email_taken"`).
- **With local sign-in**, you can give it when you register, set or remove it on the Account settings
  page, and an admin can give or change it.
- **With single sign-on**, the server stores the `email` claim of the identity provider at each
  sign-in, when the provider vouches for it with `email_verified: true` and no other account already
  has it. If not, the sign-in continues, and the server does not store the address.
  - A provider that does not send `email_verified` did not vouch for the address.
    `OIDC_UNVERIFIED_EMAIL=accept` stores its addresses also.
  - The server never stores an address marked `email_verified: false`.
  - Account settings shows the address read-only. An admin can change it, but the next sign-in puts
    back the address of the provider.

## The Users view

Admins open it from **Users**, the last item of the side menu (the top row on a phone), at `/admin`.
Other persons do not see the item. It lists all accounts, with their email address, note count, the
time of creation, and the last use of one of their sessions. Badges mark admins, the account of the
viewer, accounts that sign in with single sign-on, and accounts that still have a temporary password.

Each account other than your own has a menu:

| Action           | Local sign-in | Single sign-on | What happens                                                     |
|------------------|---------------|----------------|------------------------------------------------------------------|
| Create account   | Yes           | No             | The account gets a temporary password, shown one time, and optionally an email address |
| Make/remove admin | Yes          | Yes            | Applies on the next request of the account                       |
| Change email     | Yes           | Yes            | Sets or clears the address. With SSO, the next sign-in replaces it |
| Reset password   | Yes           | No             | All sessions of that account end. A temporary password shows one time |
| Delete account   | Yes           | Yes            | The account, its notes and its sessions are removed. It asks first. Its notes go out of the notes of all persons who shared them |

**An admin cannot change their own account from here.** The server refuses a removal of your own
admin rights, a deletion of yourself, or a reset of your own password. Each of these locks you out
during your work, and each has a safer route: a different admin, or **Change password** in the
account menu.

With single sign-on, the identity provider creates accounts (the first time that a person signs in)
and owns their passwords. Thus, the view has neither function. It tells this above the list.

## Temporary passwords

A temporary password is four groups of four lowercase letters and digits (`k7mq-2xha-p9dt-4wne`). It
does not use the characters that are easy to read incorrectly (`0`, `o`, `1`, `l`, `i`). That is
approximately 79 bits.

The server stores only its hash. Thus, you can read it only in the response that creates it. The
Users view shows it with a Copy button until the admin dismisses it or leaves the view.

A temporary password has only one use: to select a real password.

- A sign-in with it returns `403` with `code: "password_change_required"` and **no session**. There
  is no half-signed-in state that the remaining API must refuse.
- The sign-in screen then asks for a new password two times, and signs in again with it. The server
  sets the new password, clears the flag and gives a session in the same request.
- The new password must be different from the temporary password.
- A wrong password never tells that an account has a temporary password. It gets the same `401` as
  all other wrong guesses.

## Changing your own password

**Change password** on the Sign-in settings page asks for the current password, and for the new
password two times. It is available only with local sign-in. A successful change keeps the current
session, and ends all other sessions of the account, with their open sockets. A wrong current password
counts against the same budget for each account as a failed sign-in. While the account is locked, the
server sends `429`.

## Deleting your own account

**Delete account** at the bottom of the Account settings page removes the account and all of its
data, the same as a delete by an admin from the Users view: its notes, their versions and images, its
shares in both directions, public links, sessions, tokens, webhooks, passkeys, keys and preferences.

- Its notes go out of the notes of all persons who shared them.
- Notes that other persons shared with it stay theirs. A comment that it wrote on such a note stays
  there without a name ("Former participant").
- It is available with all types of sign-in. It asks two times. A first press opens the step that
  tells what goes. That step takes the password (or, with single sign-on, a recent sign-in), as for
  the other [confirmed changes](#confirming-a-change-from-a-session).

`DELETE /api/v1/auth/me` does it, only from a session. The audit log records it as
`auth.account_deleted`. The server refuses the last admin (`409`), and asks to make a different person
an admin first. Then the browser is left as a sign-out leaves it: the session, the offline copies of
notes and the push subscription go. With single sign-on and `OIDC_AUTO_REGISTER` on, a new sign-in
makes a new, empty account.

After an account is deleted, these stay until they expire: the entries of the
[audit log](#audit-log) about it, for `AUDIT_RETENTION_DAYS`, and the
[backups](../server/deployment.md) from before, for as long as the operator keeps them.

## Confirming a change from a session

A person can steal a session: a device left signed in, a token taken from a browser. `sessionOnly`
already keeps API tokens away from the security of an account, but not a session that does not
belong to its owner. Thus, these changes ask again, because they let the holder of a session keep the
account or its notes:

- To set or remove the **email address**, because a reset link goes to it.
- To make an **API token**, which stays after the session that made it.
- To add a **webhook**, which sends each note from then on to its address.
- To turn **two-factor sign-in** on or off, or to add or remove a **passkey** (these asked before).
- To show the **secret key**, to replace it or the **recovery key**, or to start the account again
  ([Encryption](encryption.md#unlocking)).
- To [delete the account](#deleting-your-own-account).

An account with a password confirms with it, typed into the same form. Wrong passwords count against
the same budget for each name as a sign-in: ten in fifteen minutes. Thus, a stolen session cannot
guess the password faster than the sign-in form can. A name that either one locks is locked for both.

An account that signs in only through an identity provider has no password to type. Its proof is a
sign-in in the last 15 minutes. After that, the form tells you to sign in again. It links to the
identity provider with `prompt=login` (`/api/v1/auth/login?reauth=1`), which asks for a real sign-in
and does not use its own session again. Then you do the action again from the new session.

A change of the password asks for the current password, as before.

## Ending sessions

When the server deletes session rows, the next HTTP request stops. But a WebSocket authenticates only
one time, when it connects. Thus, a reset, a deletion or a password change also closes the sockets of
those sessions:

- `/api/v1/ws` connections close with code `4401`. The client reads this as a sign-out.
- `/api/v1/yjs` connections have their full socket closed, not only the connection of one document.
  A closed document connection is only a request, and the peer can ignore it. The provider
  reconnects, and `onAuthenticate` refuses the ended session.

Thus, a reset is useful against a person who learned a password. That person stops to get note events
and stops to edit live documents immediately.

A session or token that only expires announces nothing. Thus, each socket checks its credential again
each five minutes. If the credential does not open the socket now, the socket closes in the same way.
A check is a use of the session, as a request is. Thus, a tab that stays open and connected does not
expire because it is idle. The absolute lifetime still ends it.

## Personal API tokens

Each account can make API tokens in Settings (**API tokens**). They are for scripts, iOS Shortcuts,
command-line capture or home automation that must not have a password.

- A token has a name. It expires after 30, 90 or 365 days, or never.
- The app shows it one time, when it is made. After that, the list shows its first characters and its
  last use.
- A revocation closes all connections that use it, immediately.
- A token can reach notes, never the security of the account or the admin API. See the API document
  for the rules.

## Two-factor sign-in

A local account can turn on two-factor sign-in in Settings (**Sign-in**, **Two-factor sign-in**).
Then a sign-in asks for a second factor after the password: an **authenticator app**, a **passkey**,
or either one when the account has both. Accounts that sign in through single sign-on get this from
their identity provider. They cannot add either one.

- **An authenticator app** (TOTP, RFC 6238: SHA-1, 30-second steps): the setup asks for the password.
  It shows a new key (as a QR code to scan, in base32 groups to type, and as an `otpauth://` link for
  an authenticator on the same device). It applies only after you enter a code from it.
- **A passkey** (WebAuthn): to add one, you give the password. Then the prompt of the browser makes it
  on the device, in a password manager, or on a security key.
  - Each passkey has a name. The list shows if it syncs between devices, and its last use. To remove
    it, you give the password.
  - A passkey belongs to the address of the page that made it (its relying party is that host).
    Thus, a passkey made on one address of a server does not work on a different address.
  - Browsers offer passkeys only on `https` pages (and `localhost`). Thus, a client on plain `http`
    shows none of this.
  - The maximum is 20.
- **A lost factor**: there are no recovery codes. A person who loses the authenticator and all
  passkeys signs in with the [recovery key](encryption.md#the-recovery-key) of the account and the
  username. This also selects a new password, and replaces the keys that unlock the account. When you
  remove the last factor, two-factor turns off.
- **Signing in**: after a correct password, the server sends `403` with
  `code: "two_factor_required"`. The answer tells which factors the account has, and contains a
  challenge for its passkeys on this address.
  - The client sends the same request again, with `otp` (an authenticator code) or `passkey` (the
    answer of the browser to the challenge). An account that has only passkeys has nothing to type.
  - The server checks the factor only after the password. Thus, a wrong guess learns nothing about
    the account.
  - A wrong code counts against the same sign-in budget for each account as a wrong password. Thus,
    nobody can try all six-digit codes.
  - The server accepts the time step of each code one time (it keeps the last one used), and each
    challenge one time.
- **Changes** to any of these ask for the password again. All of them are session-only. An API token
  cannot change them.
- **Lost everything**: the recovery key is the way back that needs no other person.
  - Without it, a temporary password from an admin (see above) also turns off two-factor, and removes
    the passkeys. The user can set it up again after the sign-in.
  - That restores the sign-in, and no key. The notes stay locked until the user enters the secret key
    or the recovery key, or [starts the account again](encryption.md#the-recovery-key).
  - A password change or a reset by mail does not change two-factor.

The server keeps the secret of the authenticator as it is in `user_totp` (this is necessary to
calculate codes), adjacent to the password hash. `passkeys` contains the public key of each passkey,
which is not a secret.

## Signing in with a passkey

On a local account, a passkey can also sign in alone. **Sign in with a passkey** on the sign-in screen
asks the browser for any passkey that it has for this address, with no name or password. The device
checks that its owner uses it (a fingerprint, a face, a PIN). That check is the second factor. Thus,
the app asks for no code after it. For this reason, passkeys made here are discoverable. A passkey
whose account now has a temporary password, or no password, signs in to nothing. All failures are the
same `401`.

## Signing in with a link

With `SMTP_URL` set and `MAGIC_LINKS` on (the default; see
[Server Deployment](../server/deployment.md)), a local account with an email address can sign in
without its password. **Email me a sign-in link** under the sign-in form asks for the address, and
sends a link to `APP_URL/#signin=<token>`. The link opens a page with a **Sign in** button. A press on
the button signs in.

- The request always gets `204`, if the address has an account or not. The server sends the mail
  after the answer, as for a [reset link](#recovery-by-mail). There is one link for each account each
  five minutes. If the mail of a link could not go out, the server does not keep the link, and it
  does not count.
- A link works one time, for 15 minutes.
  - The server stores its token as a SHA-256 hash, in its own table (`sign_in_links`). Thus, you
    cannot use a sign-in link as a reset link, or a reset link as a sign-in link.
  - The token is in the URL fragment, which a browser does not send to a server. The client removes
    it from the address bar before it uses it.
  - A browser that is already signed in also removes it, and does not use it. If the token stayed
    there, it would sign the same person in again after a sign-out.
- The press spends the link, not the page load. A mail scanner or a link preview that opens the
  address runs the page as a browser does. Without this rule, it would spend the link and get a
  session.
- The link replaces the password, and nothing else.
  - An account with two-factor sign-in must give its code or passkey after the link opens. The same
    budget of failed attempts for each account applies, as for a password sign-in. A wrong code does
    not spend the link.
  - An account without a second factor does not use that budget here. There is nothing in the link
    to guess. All persons can use up the budget with wrong passwords, and the link is then the only
    way in for its owner. Such a sign-in also does not clear the count.
- A link stops when the password of the account changes or is reset, by its owner or an admin, and
  when its email address changes. Thus, a link in a mailbox that a different person can read does not
  stay valid after these actions.
- The server sends no link to an account that has no password here (it signs in through single
  sign-on), or that has a [temporary password](#temporary-passwords), which the person who got it
  must replace. The server refuses a link sent before either condition became true.
- This sign-in ends no other session and changes nothing about the account. The audit log records it
  as a sign-in with `method: "link"`, and the request for the link as "Sign-in link sent".
- You cannot register through a link. It opens only existing accounts.

A person who reads the mail of the account can already take the account with a reset link. Thus, this
adds a shorter way in, not a new party to trust. If a host must never let a mailbox alone open an
account, set `MAGIC_LINKS=off`, and think about reset by mail in the same way.

## Admins and sign-up under single sign-on

With single sign-on, admin rights can follow a group at the identity provider (`OIDC_ADMIN_GROUP`).
Then nobody gives them manually.

- The server decides it again at each sign-in, in both directions. It never removes admin rights from
  the last admin.
- `OIDC_USER_GROUP` controls who can sign in.
- `OIDC_AUTO_REGISTER=off` stops the creation of accounts at the first sign-in.
- If the identity provider did not give the groups (the ID token does not have the claim, and the
  server cannot read userinfo), the groups are unknown, not empty. Admin rights stay as they were, and
  the server refuses a sign-in that the user group controls. Thus, an outage at the provider does not
  remove admins, and does not let a person past the control.
- A refused sign-in comes back to the client as `#error=not_in_group`, `#error=not_registered` or
  `#error=groups_unavailable`. The sign-in screen tells which.

See
[Server Deployment](../server/deployment.md#oidc-variables-when-auth_provideroidc-or-both).

## Recovery by mail

With `SMTP_URL` set (see [Server Deployment](../server/deployment.md)), a local account with an email
address can reset a forgotten password itself. **Forgot your password?** under the sign-in form asks
for the address, and sends a link to `APP_URL/#reset=<token>`. The link opens a form for the new
password.

- The request always gets `204`, if the address has an account or not. The server sends the mail after
  the answer. Thus, neither the answer nor its time tells which addresses have accounts. There is one
  link for each account each five minutes. Thus, nobody can fill the inbox of an address. If the mail
  of a link could not go out, the server does not keep the link, and it does not count.
- A link works one time, for 30 minutes. The server stores its token as a SHA-256 hash. Its use ends
  all sessions and API tokens of the account, as a password change does. Two-factor sign-in stays on,
  because the link proves control of the mailbox, not of the authenticator.
- A link does not stay valid after a change to what it is for, or to where it went. A password change,
  a temporary password from an admin, and a change of the email address of the account (by the owner
  or by an admin) cancel all open reset links of the account. They also cancel its sign-in links.
- The mail is in the language of the sign-in screen (English or Finnish). The server keeps these few
  messages in `mail/templates.ts`.

The same setting sends mail about a share invitation to a recipient who has an address. The mail is
in the language of the recipient, not of the sender. Each client reports its language
(`PUT /api/v1/auth/me/locale`) each time it is different from the value on the server. An account for
which no client reported gets English. Mail is an extra service next to an action that already
occurred. Thus, if a send fails, the server logs it, and nothing else fails. One account can send a
maximum of five invitation mails to a different account each hour. After that, the server still makes
the invitation, but sends no mail. Thus, nobody can fill the inbox of a person with shares and
unshares. Accounts from single sign-on have no password here, and do not get a reset.

## Audit log

The server records in `audit_log` who did what to which account or note, and from where. It records:

- Sign-ins, with the method, and if two-factor was used.
- Failed sign-ins, with the reason: unknown account, wrong password, wrong code, a refused passkey, or
  a refused single sign-on. It records the name of the account when the name that was tried matched
  one. It does not keep a name that matched none, because that is frequently a password typed into
  the wrong field.
- Sign-outs, and accounts that their owners deleted.
- Password changes and resets, two-factor turned on or off, passkeys added or removed.
- API tokens and webhooks created or removed.
- A browser that subscribed to push reminders, with the push service that it uses. It records this
  one time for each browser, not at each renewal.
- Shares created, changed and removed.
- Each admin action: accounts created or deleted, admin rights given or removed (also by
  `OIDC_ADMIN_GROUP`), email addresses changed, temporary passwords given.

It never records the contents of notes.

Each signed-in user reads their own lines of it, where they are the actor or the target, on the
**Activity** page of Settings (`GET /api/v1/auth/me/activity`). Thus, an action of an admin on an
account is never hidden from its owner. There, an address shows only for the actions of the user and
for failed sign-ins on their account. See [Privacy](privacy.md).

Admins read it in the **Activity** tab of the Users view, newest first, from
`GET /api/v1/admin/audit` (`limit`, `before`, `userId`, `action`).

- The address is the socket peer, or the first `X-Forwarded-For` hop with `TRUST_PROXY` on.
- The actor and the target are not foreign keys. Thus, an entry about an account stays after the
  account is deleted.
- The server keeps entries for `AUDIT_RETENTION_DAYS` (180 by default), and prunes them each hour.
- The write of an entry never makes its request fail. If the server cannot write an entry, it logs
  it.

## Lockout recovery

If no admin can sign in, the admin CLI of the server (`node dist/cli.js`, run in the container) can
list admins, give a temporary password, make an account an admin, or create a new local admin. See
[Server Deployment](../server/deployment.md#locked-out).

## Server overview

The **Overview** tab of the Users view shows an admin what the server contains and how it runs, from
`GET /api/v1/admin/overview`:

- The version and the uptime.
- The totals of accounts, notes (and how many are in the trash), shares, images and their bytes, and
  saved versions.
- The same values for each account, the largest first. Images count under the owner of their notes.
- Each background job (trash, sessions, unused images, backups when on), with its last run, its
  duration and its last error.

When the update check (`UPDATE_CHECK`, on by default) finds a newer release than the one that runs,
the overview tells this, with a link to its notes. Each admin also sees a dot on the settings button
and a line on the About page of Settings. A build after a release (`0.1.8+14.bf5a6dd`) counts as that
release. Thus, only a later release is news. The counts are plain aggregates in both drivers
(`maintenance.stats`). `startPeriodicJob` keeps the job status in memory. Thus, it describes the
running process since its start.

### Setup checks

The overview also lists **setup checks**: the settings that can be wrong without a message. Each check
is fine, worth knowing, or needs attention. It has a line that tells what it means. Where you can
change something, it has a link to the section of [Server Deployment](../server/deployment.md) that
tells how.

- **HTTPS**: if the page came over HTTPS. Plain HTTP on `localhost` is only worth knowing.
- **`APP_URL`**: if it is the address that the admin uses. If it is not set, it is worth knowing
  (email needs it). A different address needs attention, because links in email and the sign-in of an
  assistant go there.
- **The proxy and `TRUST_PROXY`**: the client sends the request with a false `X-Forwarded-For` (a
  documentation address, `PROXY_PROBE_ADDRESS`). The server reports what it received:
  - The probe as it was sent: no proxy set the header.
  - One different address: a proxy replaced it.
  - The probe with addresses after it: a proxy appended to it.
  - Nothing.

  It is correct to trust the header only when a proxy replaces it. If you trust a proxy that appends,
  or a probe that arrived unchanged, a client can select the address for its throttle. If you do not
  trust a proxy that replaces it, all clients share one bucket. The check sees only the path of the
  request of the admin. It finds a port published next to the proxy only when the admin came in
  through that port.
- **Backups** (SQLite only; Postgres has its own backups): off is worth knowing. A failed last run
  needs attention.
- **Email**: off is worth knowing. With `SMTP_URL`, it shows when mail last went or last failed since
  the server started (in memory, as for job status; the server log tells why a send failed). It has a
  button that sends a test message to the address of the admin.

The browser decides HTTPS and `APP_URL`, because only the browser knows the address that it used. The
other checks come from `GET /api/v1/admin/checks`.
