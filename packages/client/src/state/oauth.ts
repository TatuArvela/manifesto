import type {
  ApiTokenScope,
  OAuthAuthorizeRequest,
  OAuthAuthorizeResponse,
  OAuthClientInfo,
} from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./confirmation.js";

/**
 * The consent page an AI assistant sends the browser to when it signs in to
 * `/api/mcp` (OAuth): what it asked for, read from the address, and the two
 * answers the user can give. The server checks the client and where it may
 * be sent back; this page only ever navigates to an address it confirmed.
 */

/** Vite's `BASE_URL` without its trailing slash, as the router has it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CONSENT_PATH = "/oauth/authorize";

/** Whether `pathname` is the consent page's. */
export function isOAuthConsentPath(pathname: string): boolean {
  const rest =
    BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return rest === CONSENT_PATH || rest === `${CONSENT_PATH}/`;
}

/** What an assistant asks for, as its address carries it. */
export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
}

/**
 * The request in a consent page's query, or null for one this server cannot
 * grant: anything but the code flow with an S256 PKCE challenge, which is all
 * OAuth 2.1 and MCP allow.
 */
export function parseAuthorizeRequest(search: string): AuthorizeRequest | null {
  const query = new URLSearchParams(search);
  const clientId = query.get("client_id");
  const redirectUri = query.get("redirect_uri");
  const codeChallenge = query.get("code_challenge");
  if (!clientId || !redirectUri || !codeChallenge) return null;
  if (query.get("response_type") !== "code") return null;
  if (query.get("code_challenge_method") !== "S256") return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return null;
  return {
    clientId,
    redirectUri,
    codeChallenge,
    state: query.get("state"),
    scope: query.get("scope"),
  };
}

/** Schemes a browser would run or read rather than hand to an app. The
 * server refuses to register them; this is the page not trusting that alone. */
const UNSAFE_SCHEMES = /^(javascript|data|vbscript|blob|file|about):/i;

function navigateTo(url: string): void {
  if (UNSAFE_SCHEMES.test(url.trim())) return;
  window.location.assign(url);
}

/** The assistant asking, as the server knows it; null when the server does
 * not know it, or it asked to be sent back somewhere it did not register. */
export async function lookUpClient(
  request: AuthorizeRequest,
): Promise<OAuthClientInfo | null> {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    ...(request.scope !== null && { scope: request.scope }),
  });
  const res = await apiFetch("GET", `/oauth/client?${query}`);
  if (!res?.ok) return null;
  return (await res.json()) as OAuthClientInfo;
}

export type AllowResult =
  | { kind: "ok" }
  | { kind: "refused"; refusal: ConfirmationRefusal }
  | { kind: "too-many" }
  | { kind: "failed" };

/** Lets the assistant in, and sends the browser back to it with the code. */
export async function allowClient(
  request: AuthorizeRequest,
  scopes: readonly ApiTokenScope[],
  expiresInDays: number | null,
  password: string,
): Promise<AllowResult> {
  const body: OAuthAuthorizeRequest = {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: [...scopes],
    ...(request.state !== null && { state: request.state }),
    ...(expiresInDays !== null && { expiresInDays }),
    ...(password && { password }),
  };
  const res = await apiFetch("POST", "/oauth/authorize", body);
  if (res?.status === 409) return { kind: "too-many" };
  const refusal = res && (await confirmationRefusal(res));
  if (refusal) return { kind: "refused", refusal };
  if (!res?.ok) return { kind: "failed" };
  navigateTo(((await res.json()) as OAuthAuthorizeResponse).redirectTo);
  return { kind: "ok" };
}

/**
 * Tells the assistant no (RFC 6749's `access_denied`). Only for a request the
 * server has confirmed the address of: an unchecked one could be anywhere.
 */
export function denyClient(client: OAuthClientInfo, state: string | null) {
  const target = new URL(client.redirectUri);
  target.searchParams.set("error", "access_denied");
  if (state !== null) target.searchParams.set("state", state);
  navigateTo(target.href);
}

/** Where the answer goes, as a person would recognise it: a web address's
 * host, or an app's own scheme. */
export function returnTarget(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.host
      : `${url.protocol}//`;
  } catch {
    return redirectUri;
  }
}

/**
 * Signing in through an identity provider comes back to the board, not here,
 * so the page leaves its address behind in this tab first. Taken once, and
 * only while fresh and still this origin's consent page.
 */
const RESUME_KEY = "manifesto:oauthConsent";
const RESUME_MS = 15 * 60 * 1000;

export function rememberConsentPage(): void {
  try {
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ href: window.location.href, at: Date.now() }),
    );
  } catch {
    // Without storage the user starts again from the assistant.
  }
}

/** Once the user has answered, there is nothing to come back to. */
export function forgetConsentPage(): void {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing was kept.
  }
}

export function takeConsentPage(): string | null {
  let saved: { href?: unknown; at?: unknown } | null = null;
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (typeof saved?.href !== "string" || typeof saved.at !== "number") {
    return null;
  }
  if (saved.at < Date.now() - RESUME_MS) return null;
  let url: URL;
  try {
    url = new URL(saved.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return isOAuthConsentPath(url.pathname) ? url.href : null;
}
