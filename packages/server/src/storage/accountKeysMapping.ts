import type { StoredAccountKeys } from "./types.ts";

export const ACCOUNT_KEYS_COLUMNS = `user_id, version, wrapped_by_secret,
  wrapped_by_recovery, recovery_verifier_hash, exchange_public_key,
  signing_public_key, wrapped_exchange_private_key,
  wrapped_signing_private_key, created_at, updated_at`;

export interface AccountKeysRow {
  user_id: string;
  version: number | string;
  wrapped_by_secret: string;
  wrapped_by_recovery: string;
  recovery_verifier_hash: string;
  exchange_public_key: string;
  signing_public_key: string;
  wrapped_exchange_private_key: string;
  wrapped_signing_private_key: string;
  created_at: string;
  updated_at: string;
}

export function rowToAccountKeys(row: AccountKeysRow): StoredAccountKeys {
  return {
    userId: row.user_id,
    version: Number(row.version),
    wrappedBySecret: row.wrapped_by_secret,
    wrappedByRecovery: row.wrapped_by_recovery,
    recoveryVerifierHash: row.recovery_verifier_hash,
    exchangePublicKey: row.exchange_public_key,
    signingPublicKey: row.signing_public_key,
    wrappedExchangePrivateKey: row.wrapped_exchange_private_key,
    wrappedSigningPrivateKey: row.wrapped_signing_private_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The values of `ACCOUNT_KEYS_COLUMNS`, in its order. */
export function accountKeysValues(keys: StoredAccountKeys): unknown[] {
  return [
    keys.userId,
    keys.version,
    keys.wrappedBySecret,
    keys.wrappedByRecovery,
    keys.recoveryVerifierHash,
    keys.exchangePublicKey,
    keys.signingPublicKey,
    keys.wrappedExchangePrivateKey,
    keys.wrappedSigningPrivateKey,
    keys.createdAt,
    keys.updatedAt,
  ];
}
