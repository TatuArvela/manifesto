import type { ErrorResponse } from "./errors.js";

/** `GET /api/auth/two-factor`. */
export interface TwoFactorStatusResponse {
  /** Whether sign-in asks for a second factor: an authenticator app, a
   * passkey, or both. */
  enabled: boolean;
  /** Whether an authenticator app is set up. Absent from servers from before
   * passkeys, where it is `enabled`. */
  authenticator?: boolean;
  /** Unused recovery codes left; 0 when two-factor is off. */
  recoveryCodesRemaining: number;
}

/**
 * WebAuthn's options and answers in their JSON form (WebAuthn Level 3), with
 * every binary value as base64url. The server builds and checks them; the
 * client only turns them into the browser's binary shapes and back.
 */
export interface PasskeyCredentialDescriptor {
  id: string;
  type: "public-key";
  transports?: string[];
}

export interface PasskeyCreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { alg: number; type: "public-key" }[];
  timeout?: number;
  excludeCredentials?: PasskeyCredentialDescriptor[];
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
  hints?: string[];
  attestation?: string;
  extensions?: Record<string, unknown>;
}

export interface PasskeyRequestOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: PasskeyCredentialDescriptor[];
  userVerification?: string;
  hints?: string[];
  extensions?: Record<string, unknown>;
}

export interface PasskeyRegistrationResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

export interface PasskeyAuthenticationResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

/** A passkey as listed in Settings: never its key. */
export interface Passkey {
  id: string;
  name: string;
  /** Whether the passkey is synced between devices (a password manager's or
   * a platform's), rather than held by one device or security key. */
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `GET /api/auth/passkeys`. */
export interface PasskeysResponse {
  passkeys: Passkey[];
}

/** `POST /api/auth/passkeys/options`, with the password. */
export interface PasskeyOptionsResponse {
  options: PasskeyCreationOptions;
}

/** `POST /api/auth/passkeys`: the browser's answer, and what to call it. */
export interface PasskeyAddRequest {
  name?: string;
  response: PasskeyRegistrationResponse;
}

/**
 * The passkey added, and the recovery codes when it is the account's first
 * second factor (shown once, as when an authenticator is set up first).
 */
export interface PasskeyAddedResponse {
  passkey: Passkey;
  recoveryCodes: string[] | null;
}

/** `POST /api/auth/passkey/options`: a challenge to sign in with a passkey. */
export interface PasskeySignInOptionsResponse {
  options: PasskeyRequestOptions;
}

/**
 * The 403 `two_factor_required` answer to a sign-in: which second factors
 * the account has, and a challenge for its passkeys on this address.
 */
export interface TwoFactorRequiredResponse extends ErrorResponse {
  code: "two_factor_required";
  twoFactor?: {
    authenticator: boolean;
    passkey: PasskeyRequestOptions | null;
  };
}

/**
 * `POST /api/auth/two-factor/setup`: the secret to put in an authenticator,
 * as base32. The client builds the `otpauth://` link from it, since the
 * product name that labels it there is the client's to know.
 */
export interface TwoFactorSetupResponse {
  secret: string;
}

/** Shown once, when two-factor is turned on or the codes are replaced.
 * Empty when an authenticator is added to an account whose passkeys
 * already have codes, which it shares. */
export interface TwoFactorRecoveryCodesResponse {
  recoveryCodes: string[];
}
