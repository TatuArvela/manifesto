/**
 * The mark that a tab leaves when it sends the browser to single sign-on. Thus,
 * only a tab that asked for a session takes the session that comes back in the
 * address (`#token=`).
 *
 * The server binds its callback to the browser that started the flow, with a
 * cookie. The last step belongs to the client. The token arrives in a fragment,
 * and any person can write a fragment into a link. If the client took it
 * immediately, a link that carries the own session of an attacker would sign
 * the person who opened it in to the account of the attacker. The attacker
 * could then read all that the person wrote. Only the own pages of this origin
 * can leave the mark.
 *
 * In `sessionStorage`, which follows the tab to the identity provider and back,
 * and belongs to no other tab. The first return uses it. It becomes stale when
 * the own flow of the server does.
 */
const FLOW_KEY = "manifesto:oidcFlow";

/**
 * A little more than the ten minutes for which the server keeps a flow open.
 */
export const OIDC_FLOW_MS = 15 * 60 * 1000;

type FlowStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): FlowStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Called when the browser goes to single sign-on. */
export function markOidcFlow(
  storage: FlowStorage | null = tabStorage(),
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(FLOW_KEY, String(now));
  } catch {
    // Without storage, the client does not take the sign-in that comes back,
    // and the login screen is there to try again.
  }
}

/** If this tab started a sign-in that is still open. Uses the mark. */
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
