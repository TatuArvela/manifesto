import {
  type ApiTokenKind,
  SERVER_FEATURES,
  type ServerFeature,
} from "@manifesto/shared";
import type { ServerConfig } from "./config.ts";

/** The features that a plain on/off variable switches. `WEBHOOKS` has modes. */
export type ToggleFeature = Exclude<ServerFeature, "webhooks">;

/** Where `ServerConfig` keeps each on/off feature, under its own name. */
export type FeatureToggles = Record<ToggleFeature, boolean>;

export interface FeatureSpec {
  /** The environment variable that switches it. */
  env: string;
  /** Its value when the variable is not set, as a host would write it. */
  default: "on" | "off" | "public";
  /** What it is, and what goes away when it is off. */
  description: string;
  /**
   * The features without which it cannot work. If one of them is off, it is
   * also off. That is implied when its own variable is not set. The server
   * refuses it at start when its variable says `on`.
   */
  requires?: readonly ServerFeature[];
}

/**
 * The features of the server that a host can turn off, each from one
 * environment variable. This is the only place to add a new one. These enforce
 * a feature:
 *
 * - Its operations in `OPERATIONS` (`openapi.ts`) name it as `feature`.
 *   `createProtection` answers those with the same 404 as a route that does not
 *   exist, before authentication. Thus, nobody can tell a feature that is off
 *   from an absent feature.
 * - Code that no route controls (a credential, a socket, a background job) asks
 *   `isFeatureOn` itself.
 * - `GET /api/v1/capabilities` reports each one, and the client hides the
 *   features that are off.
 *
 * When a feature is off, the way out of it always stays. A person can still
 * remove a share, leave a note, remove a passkey, or turn off two-factor. Thus,
 * nobody keeps something that they cannot undo. An account that already has a
 * second factor must still give it.
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
      "The MCP endpoint for AI assistants, `/api/v1/mcp`, with its tokens and sign-in by OAuth. Off, the endpoint and the sign-in are gone and MCP tokens already made are refused.",
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
  deviceSignIn: {
    env: "DEVICE_SIGN_IN",
    default: "on",
    description:
      "Signing in a new device from a QR code that it shows, which a device already signed in approves with the password. The approval also carries the secret key, encrypted to the new device. Off, no request can be made or approved, and requests already made are refused.",
  },
  pushReminders: {
    env: "WEB_PUSH",
    default: "on",
    description:
      "Sending a reminder as a push message, so an installed app gets it while closed. The server then makes outbound requests to the browsers' push services (Google's, Apple's, Mozilla's), carrying the note's title and first words encrypted to the browser. Off, it sends none, takes no new subscription, and reminders arrive only while the app is open or the browser wakes it.",
  },
  twoFactor: {
    env: "TWO_FACTOR",
    default: "on",
    description:
      "Turning on two-factor sign-in with an authenticator app. Off, nobody can turn it on, but an account that has it is still asked for its code, and can turn it off.",
  },
};

/**
 * The feature of each type of token. The server makes one only while its
 * feature is on. It refuses one that comes while its feature is off.
 */
export const TOKEN_FEATURES: Record<ApiTokenKind, ServerFeature> = {
  api: "apiTokens",
  mcp: "mcp",
  calendar: "calendar",
};

/** If the own switch of the feature is on, whatever its requirements. */
function switchedOn(
  cfg: Pick<ServerConfig, ToggleFeature | "webhooks">,
  feature: ServerFeature,
): boolean {
  return feature === "webhooks" ? cfg.webhooks !== "off" : cfg[feature];
}

/**
 * If a feature is on: its switch, and each feature that it requires. The code
 * asks the current configuration. Thus, a test that sets `teams` on with
 * `sharing` off gets the same result as a started server.
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

/** Each feature, and if it is on, as `GET /api/v1/capabilities` says. */
export function featureStates(
  cfg: Pick<ServerConfig, ToggleFeature | "webhooks">,
): Record<ServerFeature, boolean> {
  return Object.fromEntries(
    SERVER_FEATURES.map((feature) => [feature, isFeatureOn(cfg, feature)]),
  ) as Record<ServerFeature, boolean>;
}

/**
 * The on/off features from the environment. A feature whose requirement is off
 * is also off. When its own variable asks for it anyway, the settings of the
 * host contradict each other. The server then does not start. It does not guess
 * which value they meant.
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
  // Until nothing changes. Thus, a chain of requirements settles, whatever the
  // order in the registry.
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
