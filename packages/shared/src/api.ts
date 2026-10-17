/**
 * The wire types of the REST API and the sockets, one module per area in
 * `api/`, re-exported here so every importer keeps one path.
 */
export * from "./api/admin.ts";
export * from "./api/audit.ts";
export * from "./api/auth.ts";
export * from "./api/capabilities.ts";
export * from "./api/comments.ts";
export * from "./api/errors.ts";
export * from "./api/keys.ts";
export * from "./api/notes.ts";
export * from "./api/prefs.ts";
export * from "./api/publicLinks.ts";
export * from "./api/push.ts";
export * from "./api/sealed.ts";
export * from "./api/sharing.ts";
export * from "./api/sockets.ts";
export * from "./api/teams.ts";
export * from "./api/tokens.ts";
export * from "./api/twoFactor.ts";
export * from "./api/webhooks.ts";
