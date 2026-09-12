import { afterEach, describe, expect, it } from "vitest";
import {
  currentStorage,
  LocalStorageAdapter,
  RestApiAdapter,
  storageConnection,
} from "./index.js";

/**
 * Which backend a note goes to follows the session, but storage is the layer
 * underneath the session, not above it. It used to import the auth signals
 * directly, so anything that touched a note pulled the login screen's state in
 * with it; `state/auth.ts` pushes the connection in now.
 *
 * That inversion is only safe if the adapter still changes the moment the
 * connection does, which is what these check.
 */

const offline = { serverUrl: null, token: null };

afterEach(() => {
  storageConnection.value = offline;
});

describe("currentStorage", () => {
  it("keeps notes on this device when there is no server", () => {
    storageConnection.value = offline;
    expect(currentStorage.value).toBeInstanceOf(LocalStorageAdapter);
  });

  it("keeps them on this device when a server is configured but nobody is signed in", () => {
    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: null,
    };
    expect(currentStorage.value).toBeInstanceOf(LocalStorageAdapter);
  });

  it("switches to the server the moment a token arrives, and back on logout", () => {
    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: "t0ken",
    };
    expect(currentStorage.value).toBeInstanceOf(RestApiAdapter);

    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: null,
    };
    expect(currentStorage.value).toBeInstanceOf(LocalStorageAdapter);
  });
});
