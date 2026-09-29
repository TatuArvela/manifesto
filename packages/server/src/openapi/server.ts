import { type Operation, ok } from "./operation.js";

/** The server itself: liveness, this document, and what it offers. */
export const SERVER_OPERATIONS: Operation[] = [
  {
    method: "get",
    path: "/api/health",
    tag: "Server",
    summary: "Liveness, and the running version",
    auth: "none",
    limits: [],
    responses: ok("Health"),
  },
  {
    method: "get",
    path: "/api/openapi.json",
    tag: "Server",
    summary: "This document",
    auth: "none",
    limits: [],
    responses: ok(),
  },
  {
    method: "get",
    path: "/api/capabilities",
    tag: "Server",
    summary:
      "What this server offers: its version, how to sign in, which features are on, and its limits",
    auth: "none",
    limits: [],
    responses: ok("CapabilitiesResponse"),
  },
];
