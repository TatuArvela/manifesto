/**
 * A machine-readable reason, sent alongside `error` only where a client has to
 * do something other than show the message.
 */
export type ErrorCode =
  | "password_change_required"
  | "email_taken"
  | "two_factor_required"
  | "two_factor_invalid"
  /** An action that takes the password was sent without it. */
  | "confirmation_required"
  | "password_incorrect"
  /** An account without a password has to have signed in recently. */
  | "reauthentication_required";

export interface ErrorResponse {
  error: string;
  code?: ErrorCode;
}
