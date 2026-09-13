import { describe, expect, it } from "vitest";
import {
  AuthRequestError,
  loginErrorKey,
  PasswordChangeRequiredError,
} from "./auth.js";

/**
 * The login screen used to show the server's `error` text as it came, which
 * is English whatever the locale. These pin that every refusal it can meet
 * maps to a catalogue message instead.
 */
describe("loginErrorKey", () => {
  const refused = (status: number) =>
    new AuthRequestError(status, "English text from the server");

  it("says a sign-in was refused in the catalogue's words", () => {
    expect(loginErrorKey(refused(401), "signIn")).toBe(
      "login.invalidCredentials",
    );
    expect(loginErrorKey(refused(429), "signIn")).toBe("login.tooManyAttempts");
  });

  it("tells a taken username from a server that allows no sign-ups", () => {
    expect(loginErrorKey(refused(409), "register")).toBe("login.usernameTaken");
    expect(loginErrorKey(refused(403), "register")).toBe(
      "login.registrationDisabled",
    );
  });

  it("reads a 422 on the first password change as the temporary password reused", () => {
    expect(loginErrorKey(refused(422), "changePassword")).toBe(
      "login.samePassword",
    );
    expect(loginErrorKey(refused(422), "signIn")).toBe("login.errorGeneric");
  });

  it("reports an unreachable server, and anything else generically", () => {
    expect(loginErrorKey(new TypeError("Failed to fetch"), "signIn")).toBe(
      "login.serverUnavailable",
    );
    expect(loginErrorKey(refused(500), "signIn")).toBe("login.errorGeneric");
    expect(loginErrorKey(new Error("?"), "register")).toBe(
      "login.errorGeneric",
    );
  });

  it("keeps the password-change signal an auth error with its status", () => {
    const err = new PasswordChangeRequiredError("Choose a new password");
    expect(err).toBeInstanceOf(AuthRequestError);
    expect(err.status).toBe(403);
  });
});
