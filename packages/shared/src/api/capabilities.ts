import type { AuthProviderName } from "./auth.ts";
import type { AccountPrefs } from "./prefs.ts";

/**
 * How the owner of a note finds the person for a share. `search` shows matches
 * while the owner types. `exact` finds an account only by its full username or
 * email address. Thus, nobody can list the other persons on the server.
 */
export type UserLookupMode = "search" | "exact";

/**
 * The features that a host can turn off, each with an environment variable. The
 * registry of the server (`features.ts`) tells which variable, and what each
 * one includes. `GET /api/v1/capabilities` reports them. Thus, a client hides
 * the features that are off.
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
  "deviceLinks",
  "pushReminders",
  "twoFactor",
] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];

/**
 * `GET /api/v1/capabilities`: what this server is and offers. A client uses it
 * to decide what to show before a person signs in. A script uses it to learn
 * its limits, and does not have to find them by failure. It is public, and the
 * compatibility policy applies to it. Thus, we only add fields.
 */
export interface CapabilitiesResponse {
  /** The running version, as `/api/v1/health` gives it. */
  version: string;
  auth: {
    /** All ways to sign in: `local` (a password), `oidc` (single sign-on). */
    providers: AuthProviderName[];
    /**
     * With both on, if the password form shows, or is folded behind a link
     * under the single sign-on button.
     */
    passwordForm: "shown" | "collapsed";
    /** If all persons can create an account with a password. */
    registration: boolean;
    /** If a link sent by mail can reset a forgotten password. */
    passwordReset: boolean;
    /**
     * If a local account can sign in from a link sent to its address. Absent
     * from a server older than the feature.
     */
    magicLink?: boolean;
    /**
     * If a signed-in local account can show a QR code that signs in a second
     * device. Absent from a server older than the feature.
     */
    deviceLink?: boolean;
    /** If a local account can sign in with only a passkey. */
    passkeys: boolean;
  };
  /**
   * Which of the features that a host can turn off are on (`SERVER_FEATURES`),
   * and two answers derived from them. An operation of a feature that is off
   * answers 404, as a route that does not exist.
   */
  features: Record<ServerFeature, boolean> & {
    /**
     * If an assistant can connect to `/api/v1/mcp` through a sign-in (OAuth).
     */
    mcpSignIn: boolean;
    /** How a person who shares a note finds the other person. */
    userLookup: UserLookupMode;
  };
  /** The limits that a caller would otherwise meet as a 413, 409 or 422. */
  limits: {
    /** Bytes in a request body, other than attachments. */
    requestBytes: number;
    /** Bytes in one uploaded image. */
    imageBytes: number;
    imagesPerNote: number;
    linkPreviewsPerNote: number;
    /** Notes in one page of `/api/v1/notes` or `/api/v1/search`. */
    notesPerPage: number;
    notesPerImport: number;
    /** The number of versions kept for each note, and for how many days. */
    noteVersions: number;
    noteVersionDays: number;
    apiTokensPerUser: number;
    webhooksPerUser: number;
    passkeysPerUser: number;
    publicLinkViews: number;
    accountPrefsBytes: number;
  };
  /**
   * The schema version of the editor. `/api/v1/yjs` refuses an editor that is
   * older (`EDITOR_SCHEMA_VERSION`).
   */
  editorSchemaVersion: number;
  /**
   * The preferences that the host set as the defaults of this server
   * (`DEFAULT_PREFS`), with the same keys as `AccountPrefs`, or empty. A client
   * uses each one for a key that the account never stored. Absent from a server
   * older than the feature.
   */
  defaultPrefs?: AccountPrefs;
}
