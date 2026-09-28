import {
  type AuthProviderName,
  type CapabilitiesResponse,
  EDITOR_SCHEMA_VERSION,
  MAX_ACCOUNT_PREFS_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_NOTE_VERSIONS,
  MAX_NOTES_PAGE_SIZE,
  MAX_NOTES_PER_IMPORT,
  MAX_PUBLIC_LINK_VIEWS,
  NOTE_VERSION_MAX_AGE_DAYS,
} from "@manifesto/shared";
import { Hono } from "hono";
import { MAX_PASSKEYS_PER_USER } from "../auth/local/passkeys.js";
import {
  offersMcpSignIn,
  type ServerConfig,
  signsInLocally,
  signsInWithOidc,
} from "../config.js";
import { MAX_REQUEST_BYTES } from "../lib/requestLimits.js";
import { MAX_API_TOKENS_PER_USER } from "../lib/token.js";
import { VERSION } from "../version.js";
import { MAX_WEBHOOKS_PER_USER } from "./webhooks.js";

/**
 * `GET /api/capabilities`: the one place a client or a script reads what this
 * server offers, each value taken from what enforces it. Public, since the
 * sign-in screen needs it before there is anyone to ask as, and it says
 * nothing `/api/health` and the sign-in screen do not already show.
 */
export function createCapabilitiesRoutes(cfg: ServerConfig) {
  const routes = new Hono();
  routes.get("/", (c) => {
    const providers: AuthProviderName[] = [
      ...(signsInLocally(cfg) ? (["local"] as const) : []),
      ...(signsInWithOidc(cfg) ? (["oidc"] as const) : []),
    ];
    const body: CapabilitiesResponse = {
      version: VERSION,
      auth: {
        providers,
        passwordForm: cfg.authProvider === "both" ? cfg.passwordForm : "shown",
        registration: signsInLocally(cfg) && cfg.registrationEnabled,
        passwordReset: cfg.mail !== null && signsInLocally(cfg),
        passkeys: signsInLocally(cfg),
      },
      features: {
        webhooks: cfg.webhooks !== "off",
        publicLinks: cfg.publicLinks,
        linkPreviews: cfg.linkPreviews,
        mcp: cfg.mcp,
        mcpSignIn: offersMcpSignIn(cfg),
        userLookup: cfg.userLookup,
      },
      limits: {
        requestBytes: MAX_REQUEST_BYTES,
        imageBytes: MAX_IMAGE_SOURCE_BYTES,
        imagesPerNote: MAX_IMAGES_PER_NOTE,
        linkPreviewsPerNote: MAX_LINK_PREVIEWS_PER_NOTE,
        notesPerPage: MAX_NOTES_PAGE_SIZE,
        notesPerImport: MAX_NOTES_PER_IMPORT,
        noteVersions: MAX_NOTE_VERSIONS,
        noteVersionDays: NOTE_VERSION_MAX_AGE_DAYS,
        apiTokensPerUser: MAX_API_TOKENS_PER_USER,
        webhooksPerUser: MAX_WEBHOOKS_PER_USER,
        passkeysPerUser: MAX_PASSKEYS_PER_USER,
        publicLinkViews: MAX_PUBLIC_LINK_VIEWS,
        accountPrefsBytes: MAX_ACCOUNT_PREFS_BYTES,
      },
      editorSchemaVersion: EDITOR_SCHEMA_VERSION,
    };
    return c.json(body);
  });
  return routes;
}
