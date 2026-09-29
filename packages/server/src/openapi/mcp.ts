import {
  oauthAuthorizeSchema,
  oauthRegisterSchema,
} from "../validation/schemas.js";
import { type Operation, ok } from "./operation.js";

/** The MCP endpoint and the OAuth flow that lets an assistant sign in to it. */
export const MCP_OPERATIONS: Operation[] = [
  {
    method: "post",
    path: "/api/mcp",
    tag: "MCP",
    summary:
      "Model Context Protocol for AI assistants: JSON-RPC over Streamable HTTP, stateless",
    auth: "mcp",
    feature: "mcp",
    limits: ["user"],
    scope: "notes:read",
    responses: {
      "200": { description: "The JSON-RPC answer" },
      "202": { description: "A notification, accepted" },
    },
  },
  {
    method: "post",
    path: "/api/oauth/register",
    tag: "MCP",
    summary:
      "Register an assistant as an OAuth client (RFC 7591); a public client, answered with client_id",
    auth: "none",
    feature: "mcp",
    limits: ["oauth-register"],
    body: oauthRegisterSchema,
    responses: {
      "201": { description: "The registered client metadata" },
      "400": { description: "invalid_redirect_uri or invalid_client_metadata" },
    },
  },
  {
    method: "post",
    path: "/api/oauth/token",
    tag: "MCP",
    summary:
      "Trade a code (with its PKCE verifier) or a refresh token for an hour's MCP token and the next refresh token; a form, as RFC 6749 has it",
    auth: "none",
    feature: "mcp",
    limits: ["oauth-token"],
    responses: {
      "200": { description: "access_token, refresh_token, expires_in, scope" },
      "400": { description: "An OAuth error: invalid_grant and the like" },
    },
  },
  {
    method: "get",
    path: "/api/oauth/client",
    tag: "MCP",
    summary: "The assistant a consent is about, for the consent page",
    auth: "session",
    feature: "mcp",
    limits: ["user"],
    query: {
      client_id: "Its client id",
      redirect_uri: "Where it asked to be sent back",
      scope: "What it asked for, space-separated",
    },
    responses: {
      ...ok("OAuthClientInfo"),
      "400": {
        description: "Unknown client, or an address it did not register",
        schema: "Error",
      },
    },
  },
  {
    method: "post",
    path: "/api/oauth/authorize",
    tag: "MCP",
    summary:
      "Let an assistant in: a code on its redirect address, to trade at the token endpoint",
    auth: "session",
    feature: "mcp",
    limits: ["user"],
    body: oauthAuthorizeSchema,
    responses: ok("OAuthAuthorizeResponse"),
  },
];
