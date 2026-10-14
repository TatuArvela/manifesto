// Sealing lives in `@manifesto/shared`, where the server uses it too for a
// token that carries a key. Re-exported so the client keeps one path.
export {
  associatedData,
  cryptoAvailable,
  derivable,
  deriveBytes,
  deriveKey,
  seal,
  unseal,
} from "@manifesto/shared";
