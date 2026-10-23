export interface AuthCredentials {
  username: string;
  password: string;
  /**
   * The server reads this only when the account has a temporary password. The
   * sign-in then sets this as the password, and does not answer
   * `password_change_required`.
   */
  newPassword?: string;
}

/** `POST /api/v1/auth/register`. */
export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

/**
 * `PUT /api/v1/auth/me`: the own details of the signed-in user. `null` clears.
 */
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
  /**
   * If the account signs in with a password here (and thus can change it, and
   * use two-factor), not through single sign-on. Absent from older servers.
   */
  hasPassword?: boolean;
  /**
   * The language that the client of the account reported last. The server uses
   * it for mail to the account. Null until a client reports one. Absent from
   * older servers.
   */
  locale?: string | null;
}

export interface AuthMeResponse {
  user: AuthUser;
}

/**
 * `POST /api/v1/auth/device-link`: a one-time token that signs in a second
 * device, which the client shows as a QR code until `expiresAt`.
 */
export interface DeviceLinkResponse {
  token: string;
  expiresAt: string;
}

export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}
