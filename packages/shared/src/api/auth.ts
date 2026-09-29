export interface AuthCredentials {
  username: string;
  password: string;
  /**
   * Read only when the account holds a temporary password: the sign-in then
   * sets this as the password instead of answering `password_change_required`.
   */
  newPassword?: string;
}

/** `POST /api/auth/register`. */
export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

/** `PUT /api/auth/me`: the signed-in user's own details. `null` clears. */
export interface AuthMeUpdateRequest {
  email: string | null;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export type AuthProviderName = "local" | "oidc";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** Whether the account signs in with a password here (and so can change
   * it, and use two-factor), rather than through single sign-on. Absent from
   * older servers. */
  hasPassword?: boolean;
  /** The language the account's client last reported, used for mail sent to
   * it; null until one has. Absent from older servers. */
  locale?: string | null;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}
