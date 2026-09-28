import type { ErrorResponse } from "@manifesto/shared";
import type { MessageKey } from "../i18n/index.js";

/**
 * Why the server would not take an action that asks for the password again
 * (an email address, a token, a webhook): none was sent, it was wrong, the
 * account has none and its sign-in is too old, or too many wrong ones have
 * locked the name for a while. See `auth/confirmation.ts` on the server.
 */
export type ConfirmationRefusal =
  | "password-missing"
  | "password-wrong"
  | "sign-in-again"
  | "locked";

/** The refusal an answer carries, or null if it is some other failure. */
export async function confirmationRefusal(
  res: Response,
): Promise<ConfirmationRefusal | null> {
  if (res.status === 429) return "locked";
  if (res.status !== 403) return null;
  let code: ErrorResponse["code"];
  try {
    code = ((await res.clone().json()) as Partial<ErrorResponse>).code;
  } catch {
    return null;
  }
  if (code === "confirmation_required") return "password-missing";
  if (code === "password_incorrect") return "password-wrong";
  if (code === "reauthentication_required") return "sign-in-again";
  return null;
}

export const CONFIRMATION_MESSAGES = {
  "password-missing": "confirm.passwordMissing",
  "password-wrong": "confirm.passwordWrong",
  "sign-in-again": "confirm.signInAgain",
  locked: "confirm.locked",
} as const satisfies Record<ConfirmationRefusal, MessageKey>;
