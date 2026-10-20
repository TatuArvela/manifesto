import type {
  PasskeyAuthenticationResponse,
  PasskeyCreationOptions,
  PasskeyCredentialDescriptor,
  PasskeyRegistrationResponse,
  PasskeyRequestOptions,
} from "@manifesto/shared";

/**
 * The browser end of a passkey. The options of the server arrive as JSON, with
 * base64url where WebAuthn needs bytes, and the credential goes back in the
 * same way. Written manually, not left to `PublicKeyCredential.toJSON()` and
 * `parseCreationOptionsFromJSON()`, which not each browser with passkeys has
 * yet.
 */

export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64url(
  buffer: ArrayBuffer | ArrayBufferView,
): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** If this browser can use passkeys. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

const descriptor = (
  credential: PasskeyCredentialDescriptor,
): PublicKeyCredentialDescriptor => ({
  type: "public-key",
  id: base64urlToBytes(credential.id),
  ...(credential.transports && {
    transports: credential.transports as AuthenticatorTransport[],
  }),
});

export function creationOptionsFromJSON(
  options: PasskeyCreationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    user: { ...options.user, id: base64urlToBytes(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map(descriptor),
  } as PublicKeyCredentialCreationOptions;
}

export function requestOptionsFromJSON(
  options: PasskeyRequestOptions,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    allowCredentials: options.allowCredentials?.map(descriptor),
  } as PublicKeyCredentialRequestOptions;
}

/**
 * Why a ceremony gave nothing back. `cancelled` covers a dismissed prompt and
 * also a timeout, which browsers intentionally do not tell apart.
 */
export type PasskeyFailure = "cancelled" | "exists" | "failed";

function failureOf(err: unknown): PasskeyFailure {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "AbortError") {
      return "cancelled";
    }
    // One of `excludeCredentials` is already on this device.
    if (err.name === "InvalidStateError") return "exists";
  }
  return "failed";
}

/** Makes a passkey with the options of the server. */
export async function createPasskey(
  options: PasskeyCreationOptions,
): Promise<PasskeyRegistrationResponse | PasskeyFailure> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: creationOptionsFromJSON(options),
    });
  } catch (err) {
    return failureOf(err);
  }
  if (!(credential instanceof PublicKeyCredential)) return "failed";
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
      attestationObject: bytesToBase64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    ...(credential.authenticatorAttachment && {
      authenticatorAttachment: credential.authenticatorAttachment,
    }),
    clientExtensionResults: {},
  };
}

/** Signs the challenge of the server with a passkey that the user selects. */
export async function getPasskey(
  options: PasskeyRequestOptions,
): Promise<PasskeyAuthenticationResponse | PasskeyFailure> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: requestOptionsFromJSON(options),
    });
  } catch (err) {
    return failureOf(err);
  }
  if (!(credential instanceof PublicKeyCredential)) return "failed";
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
      authenticatorData: bytesToBase64url(response.authenticatorData),
      signature: bytesToBase64url(response.signature),
      ...(response.userHandle && {
        userHandle: bytesToBase64url(response.userHandle),
      }),
    },
    ...(credential.authenticatorAttachment && {
      authenticatorAttachment: credential.authenticatorAttachment,
    }),
    clientExtensionResults: {},
  };
}
