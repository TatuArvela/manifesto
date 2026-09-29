import type { MiddlewareHandler } from "hono";
import { type Context, Hono } from "hono";
import type { ServerConfig } from "../config.js";
import { publicOrigin } from "../lib/origin.js";
import { GRANT_TYPES, MCP_OAUTH_SCOPES } from "./grants.js";

type WellKnownConfig = Pick<ServerConfig, "appUrl" | "trustProxy">;

/**
 * `/.well-known/`: how an assistant that was given only `/api/mcp` finds out
 * how to sign in there (RFC 9728, then RFC 8414). The consent page is the
 * client's, so the authorization endpoint is on its address, not this one.
 */
export function createWellKnownRoutes(cfg: WellKnownConfig) {
  const routes = new Hono();
  const protectedResource = (c: Context) => {
    const origin = publicOrigin(c, cfg.trustProxy);
    return c.json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: MCP_OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
    });
  };
  routes.get("/oauth-protected-resource", protectedResource);
  routes.get("/oauth-protected-resource/api/mcp", protectedResource);
  routes.get("/oauth-authorization-server", (c) => {
    const origin = publicOrigin(c, cfg.trustProxy);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${cfg.appUrl ?? origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: MCP_OAUTH_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
  });
  return routes;
}

/**
 * On `/api/mcp`: a 401 says where the metadata is, which is how an assistant
 * given only the address learns it can sign in (RFC 9728, section 5.1).
 */
export function resourceMetadataChallenge(
  trustProxy: boolean,
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status !== 401) return;
    const origin = publicOrigin(c, trustProxy);
    c.res.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  };
}
