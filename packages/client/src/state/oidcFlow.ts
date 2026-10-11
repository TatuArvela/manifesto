/**
 * The mark a tab leaves when it sends the browser to single sign-on, so the
 * session that comes back in the address (`#token=`) is taken only by a tab
 * that asked for one.
 *
 * The server ties its callback to the browser that began the flow, with a
 * cookie. The last hop is the client's: the token arrives in a fragment, and
 * a fragment can be written by anyone into a link. Taken on sight, a link
 * carrying an attacker's own session would sign whoever opened it in to the
 * attacker's account, where everything they then wrote would be the
 * attacker's to read. Nothing but this origin's own pages can leave the mark.
 *
 * In `sessionStorage`, which follows the tab to the identity provider and
 * back and is no other tab's; spent by the first return, and stale once the
 * server's own flow would be.
 */
const FLOW_KEY = "manifesto:oidcFlow";

/** A little over the ten minutes the server holds a flow open. */
export const OIDC_FLOW_MS = 15 * 60 * 1000;

type FlowStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): FlowStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Called as the browser leaves for single sign-on. */
export function markOidcFlow(
  storage: FlowStorage | null = tabStorage(),
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(FLOW_KEY, String(now));
  } catch {
    // Without storage the sign-in that returns is not taken, and the login
    // screen is there to try again.
  }
}

/** Whether this tab began a sign-in that is still open. Spends the mark. */
export function takeOidcFlow(
  storage: FlowStorage | null = tabStorage(),
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage?.getItem(FLOW_KEY) ?? null;
    storage?.removeItem(FLOW_KEY);
    if (raw === null || !/^\d{1,16}$/.test(raw)) return false;
    const began = Number(raw);
    return began <= now && now - began <= OIDC_FLOW_MS;
  } catch {
    return false;
  }
}
