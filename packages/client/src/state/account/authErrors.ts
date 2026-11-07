import type {
  ErrorResponse,
  PasskeyRequestOptions,
  TwoFactorRequiredResponse,
} from "@manifesto/shared";
import type { MessageKey } from "#/i18n/messages/index.ts";

/**
 * The refusals of the auth requests, and the words that the login screen shows
 * for each. `auth.ts` throws them, and exports them again. This module imports
 * nothing of the session. Thus, it is not in a cycle with `auth.ts`, which
 * tests mock.
 */

/**
 * A sign-in or registration that the server refused. It carries the status, not
 * only the `error` of the server, because that text is English and written for
 * a log. The login screen tells what went wrong in the words of the catalogue.
 */
export class AuthRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ErrorResponse["code"],
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

/**
 * The password was correct, but it is a temporary password, and the sign-in
 * must set a new one. Thrown, not returned. Thus, the single catch of
 * `LoginScreen` can tell it from a failure.
 */
export class PasswordChangeRequiredError extends AuthRequestError {
  constructor(message: string) {
    super(403, message);
    this.name = "PasswordChangeRequiredError";
  }
}

/**
 * The password was correct, and the account has two-factor sign-in on. The same
 * request must go again with a code, or with the answer of a passkey to
 * `passkey`, the challenge that this sign-in got (null when the account has no
 * passkey for this address). A server from before passkeys tells neither, and
 * has only codes.
 */
export class TwoFactorRequiredError extends AuthRequestError {
  constructor(
    message: string,
    public authenticator = true,
    public passkey: PasskeyRequestOptions | null = null,
  ) {
    super(403, message, "two_factor_required");
    this.name = "TwoFactorRequiredError";
  }
}

/** Throws for a refused auth request, and keeps its status. */
export async function throwForResponse(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`;
  let code: ErrorResponse["code"];
  let twoFactor: TwoFactorRequiredResponse["twoFactor"];
  try {
    const data = (await res.json()) as Partial<TwoFactorRequiredResponse>;
    if (typeof data.error === "string") message = data.error;
    code = data.code;
    twoFactor = data.twoFactor;
  } catch {
    // A body that is not JSON. Keep the default.
  }
  if (code === "password_change_required") {
    throw new PasswordChangeRequiredError(message);
  }
  if (code === "two_factor_required") {
    throw new TwoFactorRequiredError(
      message,
      twoFactor?.authenticator ?? true,
      twoFactor?.passkey ?? null,
    );
  }
  throw new AuthRequestError(res.status, message, code);
}

/**
 * What the login screen must say about a failed sign-in, registration or first
 * password change, by status. The own text of the server never reaches the
 * screen. Thus, each message comes from the catalogue.
 */
export function loginErrorKey(
  err: unknown,
  mode: "signIn" | "register" | "changePassword" | "twoFactor",
): MessageKey {
  if (!(err instanceof AuthRequestError)) {
    // `fetch` rejects with a TypeError when it cannot reach the server.
    return err instanceof TypeError
      ? "login.serverUnavailable"
      : "login.errorGeneric";
  }
  switch (err.status) {
    case 401:
      return mode === "twoFactor"
        ? "login.twoFactorInvalid"
        : "login.invalidCredentials";
    case 403:
      return mode === "register"
        ? "login.registrationDisabled"
        : "login.errorGeneric";
    case 409:
      return err.code === "email_taken"
        ? "login.emailTaken"
        : "login.usernameTaken";
    case 422:
      // The form checks lengths first. Thus, on the change step, this is a new
      // password that is the same as the temporary password.
      return mode === "changePassword"
        ? "login.samePassword"
        : "login.errorGeneric";
    case 429:
      return "login.tooManyAttempts";
    default:
      return "login.errorGeneric";
  }
}
