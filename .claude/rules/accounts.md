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
  - "packages/client/src/state/account/auth.ts"
  - "packages/client/src/state/admin.ts"
  - "packages/client/src/components/settings/**"
  - "packages/client/src/components/AccountMenu.tsx"
  - "docs/specification/features/accounts.md"
---

# Accounts and Admins

Connected mode has admins (spec: `docs/specification/features/accounts.md`). Three rules live in the
`users` repository rather than in routes, so both drivers enforce them and
`storage/contracts/adminContract.ts` tests each: the first account is the admin unless `isAdmin` says otherwise
(decided inside the `INSERT`), and `setAdmin` / `delete` never remove the last admin (a locked count,
not a read-then-write). Under local sign-in that first-account rule never fires in production:
`ensureInitialAdmin` (`auth/initialAdmin.ts`) creates `admin` with a printed temporary password before
the server listens. Never replace that with a fixed default; see the spec for why.

Anything that ends a user's sessions must go through `endUserSessions` (`auth/session.ts`), never
`sessions.deleteByUser` alone. A credential that only runs out announces nothing, so both sockets
also ask again every `SOCKET_RECHECK_MS` (`ws/recheck.ts`). Sockets authenticate once, at connect, so deleting rows leaves them
live; the helper also announces on `auth/revocations.ts`, and `ws/appSocket.ts` / `ws/yjsSocket.ts`
close what it covers. The Yjs side closes the raw socket, since closing one document's connection is
only a message the peer may ignore.

There are no two-factor recovery codes: the account's recovery key (`encryption.md`) signs in past a
lost factor, through `auth/accountKeys.ts`, on the same `loginAttempts` budget as a password.
`endUserSessions` takes `keepApiTokens` for the one caller that ends sessions without the
password being in doubt, a new secret key.

Personal API tokens (`mfp_`, `/api/tokens`) authenticate through the same `authenticateBySession`,
and `AuthIdentity.via` says which credential it was. Anything that changes how an account is secured
(tokens, password, email, the admin API) is declared `auth: "session"` (or `"admin"`), so a token
handed to a script cannot take over its account. `endUserSessions` ends a user's tokens too;
revoking one token goes through `revokeApiToken`, which closes its sockets by the token's hash.
A token reaches only what its scopes name (`API_TOKEN_SCOPES` in shared). Each operation's scope is
declared once, as `scope` in `OPERATIONS` (`openapi.ts`), and `createAuthMiddleware` looks it up from
the route Hono matched (`c.req.matchedRoutes`), so a new token-reachable route needs a scope there or
tokens are refused it; `openapi.test.ts` holds every `auth: "any"` operation to having one. The two
sockets check theirs by hand (`/api/ws` `notes:read`, `/api/yjs` `notes:write`).
An MCP token (`mfm_`, `kind: "mcp"`) is narrower again: `createAuthMiddleware` takes it only on
`/api/mcp` (`mcpOnly`) and on the REST requests that endpoint's tools make in-process, whose `env`
carries `MCP_FORWARDED`, a symbol no request from the network can set. It holds only note scopes,
its tools are offered by the scope each names, and both sockets refuse it.

What would let whoever holds a stolen session keep the account or its notes (an email address, a
token, a webhook, the two-factor changes, showing or replacing a key) also calls `requireConfirmation` (`auth/confirmation.ts`):
the password, counted against the sign-in budget in the shared `loginAttempts`, or for an account
without one a sign-in within 15 minutes. A new action of that kind calls it too, and its client form
uses `ConfirmPasswordField` and `ConfirmationError`.

An account is deleted through `deleteAccount` (`sharing/deleteAccount.ts`), whoever asks: the admin's
`DELETE /api/admin/users/:id` and the owner's own `DELETE /api/auth/me` (session only, with
`requireConfirmation`). It reads the account's shares before the cascade takes them, so the people on
the other end hear of it, and closes its sockets. A new table that holds something of an account's
references `users(id) ON DELETE CASCADE` (or `SET NULL` where the row is someone else's, like a
comment's author), or deleting the account leaves it behind. On the client `deleteOwnAccount`
(`state/account/signOut.ts`) leaves the browser as a sign-out does, and only once the server said yes.

Security-relevant actions write an audit entry with `audit(storage, c, {...})` (`audit/audit.ts`),
fire-and-forget; a new one needs its action in `AUDIT_ACTIONS` (shared) and a message in both
catalogues, which `AuditLog.test.ts` checks. An entry's `detail` holds only what the server
already knows about an account: a failed sign-in names the account it matched, never a name that
matched none, since that is often a password typed into the wrong field. The request's address is keyed on `c.req`, never
`c.req.raw`: `bodyLimit` replaces the raw request whenever there is a body. Each user reads their
own lines on the Activity page of Settings (`/api/auth/me/activity`, built by the same `auditPage`
as the admin's log), so an admin action that reaches into an account must be audited with that
account as its target, or its owner never hears of it. An admin reads no account's notes: the
server holds them sealed and has no export of them (spec: `docs/specification/features/privacy.md`).

A mailed sign-in link (`auth/local/signInLink.ts`, `MAGIC_LINKS`) stands in for the password and nothing
else: it goes through the same `secondFactor` check and `loginAttempts` budget as `/login` (both built in
`router.ts`), is refused for an account with no password or a temporary one, and is looked up with
`signInLinks.find` so that asking for the second factor costs nothing. A request that answers the factor
spends the link with `consume` first and hands it back with `release` when the answer is wrong: checked
the other way round, a link that ran out in between would spend a code's time step for nothing. Any new way
in does the same, or it is a way around two-factor: `secondFactor` counts, audits and throws a wrong
answer itself, so a caller only has to send back the challenge. Asking for a link is `mailedLinks`
(`auth/local/mailedLink.ts`), which reset by mail uses too, and both tables are one repository
(`mailedLinksRepo.ts` in each driver). A link whose mail could not be sent is deleted, so it neither
stays live unaudited nor starts the cooldown. The budget is checked only where a second factor is asked for or
answered, since it guards guesses and an account without one has none to make here; `succeed` is called
only when a factor held. `endUserSessions` voids the account's links, sign-in and reset alike, and a route that changes an
email address calls `signInLinks.deleteByUser` and `passwordResets.deleteByUser` itself: a link of
either kind left in the old mailbox is the account, for whoever reads it. On the client the landing step spends the link
on a press, never on mount (a mail scanner loads the page too), and `App` takes the token out of the
address when someone is signed in already.

Anything that checks a password from a session counts a wrong one in `loginAttempts`, the change of
password (`/api/auth/password`) included: the address bucket alone refills for a stolen session that
moves. Under single sign-on an address is stored only when the provider sends `email_verified: true`
(`pickEmail`), unless `OIDC_UNVERIFIED_EMAIL=accept`.

A temporary password yields no session: login answers `403 password_change_required` until the same
request carries `newPassword`. The client never shows a server's `error` text, which is English:
`loginErrorKey` (`state/account/auth.ts`), `changePassword` and the admin actions (`state/admin.ts`) map
failures to catalogue messages by status. `AccountMenu` in the header only names the account, opens
Settings on its page (`openSettings("account")`) and signs out; the account's pages (`AccountSettings`,
`TwoFactorSettings`, `KeysSettings`, `ApiTokensSettings`, `WebhooksSettings`) are tabs of `SettingsDialog`, which lives in
`components/settings/` with one file per tab and the rows and selects they share; they are shown only
when signed in, and a tab that disappears falls back to Appearance.
