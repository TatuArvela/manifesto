import {
  type ApiTokenKind,
  SERVER_FEATURES,
  type ServerFeature,
} from "@manifesto/shared";
import type { ServerConfig } from "./config.js";

/** The features switched by a plain on/off variable; `WEBHOOKS` has modes. */
export type ToggleFeature = Exclude<ServerFeature, "webhooks">;

/** Where each on/off feature is held in `ServerConfig`, under its own name. */
export type FeatureToggles = Record<ToggleFeature, boolean>;

export interface FeatureSpec {
  /** The environment variable that switches it. */
  env: string;
  /** Its value when the variable is unset, as a host would write it. */
  default: "on" | "off" | "public";
  /** What it is, and what turning it off takes away. */
  description: string;
  /**
   * The features it cannot work without. With one of them off it is off too:
   * implied when its own variable is unset, refused at boot when it says `on`.
   */
  requires?: readonly ServerFeature[];
}

/**
 * The server's features a host can turn off, each from one environment
 * variable, and the one place to add another. What enforces a feature is:
 *
 * - its operations in `OPERATIONS` (`openapi.ts`) name it as `feature`, and
 *   `createProtection` answers those with the same 404 as a route that does
 *   not exist, before authentication, so an off feature cannot be told from
 *   an absent one;
 * - what no route decides (a credential, a socket, a background job) asks
 *   `isFeatureOn` itself;
 * - `GET /api/capabilities` reports every one, and the client hides what is
 *   off.
 *
 * Turning a feature off never takes away the way out of it: removing a share,
 * leaving a note, removing a passkey or turning two-factor off stay open, so
 * nobody is left holding something they can no longer undo, and an account
 * that already has a second factor is still asked for it.
 */
export const FEATURES: Record<ServerFeature, FeatureSpec> = {
  sharing: {
    env: "SHARING",
    default: "on",
    description:
      "Sharing a note with other accounts: invitations, finding people to share with, and changing what they may do. Off, a note already shared stays shared, and its owner can still take people off it and they can still leave.",
  },
  teams: {
    env: "TEAMS",
    default: "on",
    description:
      "Teams an admin keeps (or single sign-on groups mirrored as teams) and sharing a note with a whole team. Off, the admin's Teams page is gone and single sign-on no longer updates membership; a note already shared with a team stays shared and can still be taken off it.",
    requires: ["sharing"],
  },
  publicLinks: {
    env: "PUBLIC_LINKS",
    default: "on",
    description:
      "Publishing a note by revocable public link, readable by anyone holding it. Off, every public link route answers 404, links already made included, and the menu item is hidden.",
  },
  linkPreviews: {
    env: "LINK_PREVIEWS",
    default: "on",
    description:
      "The server fetching linked pages to fill in link previews, from public addresses only. Off, it makes no outbound request for them and cards stay plain.",
  },
  calendar: {
    env: "CALENDAR",
    default: "on",
    description:
      "The reminders calendar feed a calendar app subscribes to by a secret address. Off, feeds already subscribed to answer 404 and no new feed address can be made.",
  },
  apiTokens: {
    env: "API_TOKENS",
    default: "on",
    description:
      "Personal API tokens for scripts and bots. Off, none can be made and tokens already made are refused; MCP and calendar tokens follow their own switches.",
  },
  mcp: {
    env: "MCP",
    default: "on",
    description:
      "The MCP endpoint for AI assistants, `/api/mcp`, with its tokens and sign-in by OAuth. Off, the endpoint and the sign-in are gone and MCP tokens already made are refused.",
  },
  webhooks: {
    env: "WEBHOOKS",
    default: "public",
    description:
      "Webhooks, and where they may point: `public` addresses only, `private` to also reach the local network, or `off`, which stops deliveries and removes the routes.",
  },
  passkeys: {
    env: "PASSKEYS",
    default: "on",
    description:
      "Adding passkeys and signing in with a passkey alone. Off, nobody can add one or sign in with one alone, but a passkey already added is still asked for as a second factor and can be removed.",
  },
  magicLinks: {
    env: "MAGIC_LINKS",
    default: "on",
    description:
      "Signing in to a local account from a link sent to its address, with no password. It needs outgoing mail (`SMTP_URL`) and is absent without it. Off, no link is sent and links already sent are refused; a second factor is asked for either way.",
  },
  twoFactor: {
    env: "TWO_FACTOR",
    default: "on",
    description:
      "Turning on two-factor sign-in with an authenticator app. Off, nobody can turn it on, but an account that has it is still asked for its code, and can turn it off or replace its recovery codes.",
  },
  adminExport: {
    env: "ADMIN_EXPORT",
    default: "off",
    description:
      "An admin downloading any account's notes, for a data request or a move. Off (the default), an admin cannot read another account's notes from inside the app.",
  },
};

/**
 * The feature each kind of token belongs to. One is minted only while its
 * feature is on, and presented while it is off, it is refused.
 */
export const TOKEN_FEATURES: Record<ApiTokenKind, ServerFeature> = {
  api: "apiTokens",
  mcp: "mcp",
  calendar: "calendar",
};

/** Whether the feature's own switch is on, whatever it depends on. */
function switchedOn(
  cfg: Pick<ServerConfig, ToggleFeature | "webhooks">,
  feature: ServerFeature,
): boolean {
  return feature === "webhooks" ? cfg.webhooks !== "off" : cfg[feature];
}

/**
 * Whether a feature is on: its switch, and every feature it requires. Asked
 * of the configuration as it stands, so a test that sets `teams` on with
 * `sharing` off gets what a booted server would.
 */
export function isFeatureOn(
  cfg: Pick<ServerConfig, ToggleFeature | "webhooks">,
  feature: ServerFeature,
): boolean {
  return (
    switchedOn(cfg, feature) &&
    (FEATURES[feature].requires ?? []).every((other) => isFeatureOn(cfg, other))
  );
}

/** Every feature and whether it is on, as `GET /api/capabilities` says. */
export function featureStates(
  cfg: Pick<ServerConfig, ToggleFeature | "webhooks">,
): Record<ServerFeature, boolean> {
  return Object.fromEntries(
    SERVER_FEATURES.map((feature) => [feature, isFeatureOn(cfg, feature)]),
  ) as Record<ServerFeature, boolean>;
}

/**
 * The on/off features from the environment. A feature whose requirement is
 * off is off too; when its own variable asks for it anyway, that is a
 * contradiction in the host's settings and the server refuses to start rather
 * than guess which one they meant.
 */
export function loadFeatureToggles(
  env: NodeJS.ProcessEnv,
  parseBool: (name: string, fallback: boolean) => boolean,
  webhooksOn: boolean,
): FeatureToggles {
  const toggles = Object.fromEntries(
    SERVER_FEATURES.filter((f) => f !== "webhooks").map((feature) => {
      const spec = FEATURES[feature];
      return [feature, parseBool(spec.env, spec.default === "on")];
    }),
  ) as FeatureToggles;
  const on = (feature: ServerFeature) =>
    feature === "webhooks" ? webhooksOn : toggles[feature];
  // Until nothing changes, so a chain of requirements settles whatever order
  // the registry lists it in.
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of SERVER_FEATURES) {
      if (feature === "webhooks" || !toggles[feature]) continue;
      const missing = (FEATURES[feature].requires ?? []).find((r) => !on(r));
      if (!missing) continue;
      const spec = FEATURES[feature];
      if (env[spec.env] !== undefined && env[spec.env] !== "") {
        throw new Error(
          `${spec.env} is on, but it needs ${FEATURES[missing].env}, which is off`,
        );
      }
      toggles[feature] = false;
      changed = true;
    }
  }
  return toggles;
}
