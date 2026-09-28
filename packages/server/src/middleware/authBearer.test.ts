import type { ApiTokenScope } from "@manifesto/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthIdentity, AuthProvider } from "../auth/types.js";
import { createAuthMiddleware } from "./authBearer.js";
import { onError } from "./error.js";

/**
 * A token reaches a route only through the scope `OPERATIONS` names for it,
 * so these run the middleware against routes the document does and does not
 * describe, with a provider that answers whatever identity the test asks for.
 */
function appFor(identity: Omit<AuthIdentity, "token">) {
  const provider: AuthProvider = {
    authenticate: async (token) => ({ ...identity, token }),
    router: () => new Hono(),
  };
  const notes = new Hono();
  notes.use("*", createAuthMiddleware(provider));
  notes.get("/", (c) => c.text("listed"));
  notes.get("/unlisted", (c) => c.text("reached"));
  const app = new Hono();
  app.onError(onError);
  app.route("/api/notes", notes);
  return app;
}

const person = {
  userId: "u",
  username: "amy",
  displayName: "Amy",
  avatarColor: "#000",
};
const get = (app: Hono, path: string) =>
  app.request(path, { headers: { Authorization: "Bearer x" } });
const tokenWith = (scopes: ApiTokenScope[]) =>
  appFor({ ...person, via: "api-token", scopes });

describe("token scopes in the auth middleware", () => {
  it("lets a token through where its scope is named", async () => {
    expect((await get(tokenWith(["notes:read"]), "/api/notes")).status).toBe(
      200,
    );
    expect((await get(tokenWith(["notes:write"]), "/api/notes")).status).toBe(
      200,
    );
  });

  it("refuses a token without the scope, and says which it lacks", async () => {
    const res = await get(tokenWith(["account:read"]), "/api/notes");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain(
      "notes:read",
    );
  });

  it("closes a route the document does not describe to every token", async () => {
    const all: ApiTokenScope[] = [
      "notes:read",
      "notes:write",
      "sharing",
      "account:read",
      "account:write",
    ];
    expect((await get(tokenWith(all), "/api/notes/unlisted")).status).toBe(403);
    const session = appFor({ ...person, via: "session" });
    expect((await get(session, "/api/notes/unlisted")).status).toBe(200);
  });
});
