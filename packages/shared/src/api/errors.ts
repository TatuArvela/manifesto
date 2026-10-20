/**
 * A reason that a machine can read. The server sends it with `error` only where
 * a client must do something other than show the message.
 */
export type ErrorCode =
  | "password_change_required"
  | "email_taken"
  | "two_factor_required"
  | "two_factor_invalid"
  /** An action that needs the password was sent without it. */
  | "confirmation_required"
  | "password_incorrect"
  /** An account without a password must have a recent sign-in. */
  | "reauthentication_required"
  /** The recovery key that was sent is not that of the account. */
  | "recovery_key_invalid"
  /**
   * The words of a note were sent in an older format than the stored format of
   * the note. The app that sent them is older than the app that wrote the note.
   * It must reload before it writes them.
   */
  | "note_format_newer"
  /**
   * A write that moves a note to a newer format must contain all of its words,
   * because a note keeps one format for all of them.
   */
  | "note_format_incomplete";

export interface ErrorResponse {
  error: string;
  code?: ErrorCode;
}
