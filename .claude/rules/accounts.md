---
paths:
  - "packages/server/src/auth/**"
  - "packages/server/src/audit/**"
  - "packages/server/src/oauth/**"
  - "packages/server/src/routes/admin*.ts"
  - "packages/server/src/routes/tokens*.ts"
  - "packages/server/src/storage/contracts/adminContract.ts"
  - "packages/server/src/sharing/deleteAccount.ts"
  - "packages/client/src/state/account/signOut.ts"
  - "packages/client/src/state/account/deviceLinks.ts"
  - "packages/client/src/state/account/auth.ts"
  - "packages/client/src/state/admin.ts"
  - "packages/client/src/components/settings/**"
  - "packages/client/src/components/AccountMenu.tsx"
  - "docs/specification/features/accounts.md"
---

# Accounts and Admins

## Admins

Connected mode has admins (the specification is `docs/specification/features/accounts.md`). Three
rules are in the `users` repository, not in the routes. Thus, both drivers enforce them, and
`storage/contracts/adminContract.ts` tests each one:

- The first account is the admin, unless `isAdmin` gives a different value. The `INSERT` decides
  this.
- `setAdmin` never removes the last admin.
- `delete` never removes the last admin. Both use a locked count, not a read and then a write.

With local sign-in, the first-account rule never applies in production. `ensureInitialAdmin`
(`auth/initialAdmin.ts`) makes `admin` with a printed temporary password before the server listens.
Never replace that with a fixed default. The specification tells why.

## Ending sessions

All code that ends the sessions of a user must go through `endUserSessions` (`auth/session.ts`).
Never use only `sessions.deleteByUser`.

- A credential that only expires announces nothing. Thus, both sockets also check again each
  `SOCKET_RECHECK_MS` (`ws/recheck.ts`).
- Sockets authenticate one time, when they connect. Thus, when you delete rows, the sockets stay
  live. The helper also announces on `auth/revocations.ts`, and `ws/appSocket.ts` and
  `ws/yjsSocket.ts` close the sockets that it covers.
- The Yjs side closes the raw socket. If it closes only the connection of one document, that is
  only a message, and the peer can ignore it.

There are no two-factor recovery codes. The recovery key of the account (`encryption.md`) signs in
when a factor is lost, through `auth/accountKeys.ts`. It uses the same `loginAttempts` budget as a
password. `endUserSessions` takes `keepApiTokens` for the one caller that ends sessions when the
password is not in doubt: a new secret key.

## Tokens

Personal API tokens (`mfp_`, `/api/v1/tokens`) authenticate through the same
`authenticateBySession`. `AuthIdentity.via` tells which credential it was.

- All operations that change the security of an account (tokens, password, email, the admin API)
  have `auth: "session"` (or `"admin"`). Thus, a token that a script has cannot take control of its
  account.
- `endUserSessions` also ends the tokens of a user. To revoke one token, use `revokeApiToken`. It
  closes the sockets of the token by its hash.
- A token can only reach what its scopes name (`API_TOKEN_SCOPES` in shared). The scope of each
  operation is declared one time, as `scope` in `OPERATIONS` (`openapi.ts`). `createAuthMiddleware`
  finds it from the route that Hono matched (`c.req.matchedRoutes`). Thus, a new route that tokens
  can reach needs a scope there. If not, the route refuses tokens. `openapi.test.ts` makes sure that
  each `auth: "any"` operation has one.
- The two sockets check their scopes in their own code (`/api/v1/ws` `notes:read`, `/api/v1/yjs`
  `notes:write`).

An MCP token (`mfm_`, `kind: "mcp"`) has fewer rights again:

- `createAuthMiddleware` accepts it only on `/api/v1/mcp` (`mcpOnly`), and on the REST requests that
  the tools of that endpoint make inside the process.
- The `env` of those requests has `MCP_FORWARDED`. This is a symbol that no request from the network
  can set.
- It has only note scopes. The tools that it gets are the tools whose scope it has. Both sockets
  refuse it.

## Confirmation

Some actions let a person with a stolen session keep the account or its notes: an email address, a
token, a webhook, the two-factor changes, showing or replacing a key. These actions also call
`requireConfirmation` (`auth/confirmation.ts`). The confirmation is one of these:

- The password, counted against the sign-in budget in the shared `loginAttempts`.
- For an account without a password, a sign-in in the last 15 minutes.

A new action of that type calls it too. Its client form uses `ConfirmPasswordField` and
`ConfirmationError`.

## Deleting an account

An account is deleted through `deleteAccount` (`sharing/deleteAccount.ts`), whoever asks. The
callers are the `DELETE /api/v1/admin/users/:id` of the admin, and the `DELETE /api/v1/auth/me` of
the owner (session only, with `requireConfirmation`).

- It reads the shares of the account before the cascade removes them. Thus, the persons at the other
  end get the news.
- It closes the sockets of the account.
- A new table that contains data of an account references `users(id) ON DELETE CASCADE`. Use
  `SET NULL` where the row belongs to a different person, for example the author of a comment. If
  you do not, the deletion of the account leaves the data behind.
- On the client, `deleteOwnAccount` (`state/account/signOut.ts`) leaves the browser in the same way
  as a sign-out, and only after the server agrees.

## Audit

Security-relevant actions write an audit entry with `audit(storage, c, {...})` (`audit/audit.ts`).
The call does not wait for the result.

- A new entry needs its action in `AUDIT_ACTIONS` (shared), and a message in both catalogues.
  `AuditLog.test.ts` checks this.
- The `detail` of an entry contains only data that the server already knows about an account. A
  failed sign-in names the account that it matched. It never names a name that matched no account,
  because that is frequently a password typed into the wrong field.
- The address of the request comes from `c.req`, never from `c.req.raw`. `bodyLimit` replaces the
  raw request each time there is a body.
- Each user reads their own lines on the Activity page of Settings (`/api/v1/auth/me/activity`, built
  by the same `auditPage` as the log of the admin). Thus, an admin action on an account must have that
  account as its target. If not, the owner never knows about it.
- An admin cannot read the notes of an account. The server keeps them sealed, and has no export of
  them (the specification is `docs/specification/features/privacy.md`).

## Mailed sign-in links

A mailed sign-in link (`auth/local/signInLink.ts`, `MAGIC_LINKS`) replaces the password, and only the
password.

- It goes through the same `secondFactor` check and `loginAttempts` budget as `/login` (both built in
  `router.ts`).
- The server refuses it for an account without a password, or with a temporary password.
- The server finds it with `signInLinks.find`. Thus, a request for the second factor costs nothing.
- A request that answers the factor first spends the link with `consume`. If the answer is wrong, it
  gives the link back with `release`. In the opposite order, a link that expired in between spends
  the time step of a code for nothing.
- All new ways to sign in must do the same. If not, they go around two-factor. `secondFactor`
  counts, audits and throws a wrong answer itself. Thus, a caller only has to send back the
  challenge.
- `mailedLinks` (`auth/local/mailedLink.ts`) sends a link. Reset by mail uses it too. Both tables are
  in one repository (`mailedLinksRepo.ts` in each driver).
- If the mail of a link could not go out, the server deletes the link. Thus, the link does not stay
  live without an audit entry, and it does not start the cooldown.
- The server checks the budget only where it asks for a second factor, or where a second factor is
  answered. The budget is against guesses, and an account without a second factor has no guesses to
  make here. `succeed` is called only when a factor was correct.
- `endUserSessions` cancels the links of the account, sign-in links and reset links. A route that
  changes an email address calls `signInLinks.deleteByUser` and `passwordResets.deleteByUser` itself.
  A link of either type in the old mailbox gives the account to the person who reads it.
- On the client (`state/account/mailedLinks.ts`), the landing step spends the link on a press, never
  on mount (a mail scanner also loads the page). `App` removes the token from the address when a
  user is already signed in.

## Device links

A QR code in Settings (`auth/local/deviceLink.ts`, `DEVICE_LINKS`) signs in a second device.

- The session asks for it with `requireConfirmation`. The token goes into its own `device_links`
  table, which has the same repository shape as the mailed links (`deviceLinks`).
- The second device spends it through `signInWithLink` (`signInLink.ts`), the same function as a
  mailed link. Thus, the second factor and its budget apply in the same way. A new type of one-time
  link uses that function too.
- `endUserSessions` cancels the device links of the account with the other links.
- On the client (`state/account/deviceLinks.ts`), the address is `#device=<token>&key=<secret key>`.
  The client adds the key only after `revealSecretKey` passed. The landing is `SignInLinkLanding`
  with `signInWithDeviceLink`, and it also waits for a press. `holdScannedSecretKey`
  (`accountKeys.ts`) keeps the key in memory until the sign-in asks for it.

## Passwords

All code that checks a password from a session counts a wrong password in `loginAttempts`. This
includes the change of password (`/api/v1/auth/password`). The bucket for the address alone fills
again for a stolen session that moves. With single sign-on, the server stores an address only when
the provider sends `email_verified: true` (`pickEmail`), unless `OIDC_UNVERIFIED_EMAIL=accept`.

A temporary password gives no session. Login sends `403 password_change_required` until the same
request contains `newPassword`.

## Client

The client never shows the `error` text of a server, because that text is English.
`loginErrorKey` (`state/account/auth.ts`), `changePassword` and the admin actions (`state/admin.ts`)
change failures into catalogue messages by status.

`AccountMenu` in the header only names the account, opens Settings on its page
(`openSettings("account")`), and signs out. The pages of the account are tabs of `SettingsDialog`:

- `AccountSettings`
- `SignInSettings` (the password and `TwoFactorSettings`)
- `KeysSettings`
- `ActivitySettings`
- `ApiTokensSettings`
- `WebhooksSettings`

`accountGroups` in `SettingsNav.tsx` groups them. `SettingsNav.tsx` is in `components/settings/`,
with one file for each tab, and the rows and selects that the tabs share. The tabs show only when a
user is signed in. If a tab goes away, the dialog goes back to Appearance.
