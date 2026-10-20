import { afterEach, describe, expect, it } from "vitest";
import {
  currentStorage,
  LocalStorageAdapter,
  RestApiAdapter,
  storageConnection,
} from "./index.ts";

/**
 * The session decides to which backend a note goes, but storage is the layer
 * under the session, not above it. If it imported the auth signals, all code
 * that touched a note would bring in the state of the login screen with it.
 * Thus, `state/account/auth.ts` pushes the connection in.
 *
 * That inversion is only safe if the adapter still changes at the moment when
 * the connection does. These tests check that.
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

  it("treats a same-origin base as a server, not as no server at all", () => {
    // A single-origin deployment configures `/`, which resolves to the empty
    // string. When read as falsy, that sent each note to this device while the
    // user was signed in and thought differently.
    storageConnection.value = { serverUrl: "", token: "t" };
    expect(currentStorage.value).toBeInstanceOf(RestApiAdapter);
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
