import type { ErrorResponse } from "./errors.ts";

/** `GET /api/v1/auth/two-factor`. */
export interface TwoFactorStatusResponse {
  /**
   * If the sign-in asks for a second factor: an authenticator app, a passkey,
   * or both.
   */
  enabled: boolean;
  /**
   * If an authenticator app is set up. Absent from servers from before
   * passkeys, where it is `enabled`.
   */
  authenticator?: boolean;
}

/**
 * The options and answers of WebAuthn in their JSON form (WebAuthn Level 3),
 * with each binary value as base64url. The server builds and checks them. The
 * client only changes them into the binary shapes of the browser and back.
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

/** A passkey as Settings lists it. Never its key. */
export interface Passkey {
  id: string;
  name: string;
  /**
   * If the passkey syncs between devices (in a password manager or a platform),
   * and is not kept by one device or security key.
   */
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `GET /api/v1/auth/passkeys`. */
export interface PasskeysResponse {
  passkeys: Passkey[];
}

/** `POST /api/v1/auth/passkeys/options`, with the password. */
export interface PasskeyOptionsResponse {
  options: PasskeyCreationOptions;
}

/** `POST /api/v1/auth/passkeys`: the answer of the browser, and its name. */
export interface PasskeyAddRequest {
  name?: string;
  response: PasskeyRegistrationResponse;
}

/** The added passkey. */
export interface PasskeyAddedResponse {
  passkey: Passkey;
}

/** `POST /api/v1/auth/passkey/options`: a challenge for a passkey sign-in. */
export interface PasskeySignInOptionsResponse {
  options: PasskeyRequestOptions;
}

/**
 * The 403 `two_factor_required` answer to a sign-in: the second factors of the
 * account, and a challenge for its passkeys on this address.
 */
export interface TwoFactorRequiredResponse extends ErrorResponse {
  code: "two_factor_required";
  twoFactor?: {
    authenticator: boolean;
    passkey: PasskeyRequestOptions | null;
  };
}

/**
 * `POST /api/v1/auth/two-factor/setup`: the secret to put in an authenticator,
 * as base32. The client builds the `otpauth://` link from it, because only the
 * client knows the product name that labels it there.
 */
export interface TwoFactorSetupResponse {
  secret: string;
}
