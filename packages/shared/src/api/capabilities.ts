import type { AuthProviderName } from "./auth.js";

/**
 * How a note's owner finds the person to share it with. `search` offers
 * matches as they type; `exact` finds an account only by its full username or
 * email address, so nobody can list who else is on the server.
 */
export type UserLookupMode = "search" | "exact";

/**
 * The features a host can turn off, each with an environment variable. The
 * server's registry (`features.ts`) says which variable and what each covers;
 * `GET /api/capabilities` reports them, so a client hides what is off.
 */
export const SERVER_FEATURES = [
  "sharing",
  "teams",
  "publicLinks",
  "linkPreviews",
  "calendar",
  "apiTokens",
  "mcp",
  "webhooks",
  "passkeys",
  "magicLinks",
  "twoFactor",
  "adminExport",
] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];

/**
 * `GET /api/capabilities`: what this server is and offers, for a client to
 * decide what to show before anyone signs in, and for a script to learn its
 * limits rather than find them. Public, and covered by the compatibility
 * policy, so fields are only ever added.
 */
export interface CapabilitiesResponse {
  /** The running version, as `/api/health` gives it. */
  version: string;
  auth: {
    /** Every way in: `local` (a password), `oidc` (single sign-on). */
    providers: AuthProviderName[];
    /** With both on, whether the password form is shown or folded behind a
     * link under the single sign-on button. */
    passwordForm: "shown" | "collapsed";
    /** Whether anyone can create an account with a password. */
    registration: boolean;
    /** Whether a forgotten password can be reset by a link sent by mail. */
    passwordReset: boolean;
    /** Whether a local account can sign in from a link sent to its address.
     * Absent from a server older than the feature. */
    magicLink?: boolean;
    /** Whether a local account can sign in with a passkey alone. */
    passkeys: boolean;
  };
  /**
   * Which of the features a host can turn off are on (`SERVER_FEATURES`), and
   * two answers derived from them. An operation of a feature that is off
   * answers 404, as a route that does not exist would.
   */
  features: Record<ServerFeature, boolean> & {
    /** Whether an assistant can connect to `/api/mcp` by signing in (OAuth). */
    mcpSignIn: boolean;
    /** How someone sharing a note finds the person to share it with. */
    userLookup: UserLookupMode;
  };
  /** The limits a caller would otherwise meet as a 413, 409 or 422. */
  limits: {
    /** Bytes in a request body, attachments aside. */
    requestBytes: number;
    /** Bytes in one uploaded image. */
    imageBytes: number;
    imagesPerNote: number;
    linkPreviewsPerNote: number;
    /** Notes in one page of `/api/notes` or `/api/search`. */
    notesPerPage: number;
    notesPerImport: number;
    /** Versions kept per note, and for how many days. */
    noteVersions: number;
    noteVersionDays: number;
    apiTokensPerUser: number;
    webhooksPerUser: number;
    passkeysPerUser: number;
    publicLinkViews: number;
    accountPrefsBytes: number;
  };
  /** The editor's schema version; `/api/yjs` refuses an editor older than
   * it (`EDITOR_SCHEMA_VERSION`). */
  editorSchemaVersion: number;
}
