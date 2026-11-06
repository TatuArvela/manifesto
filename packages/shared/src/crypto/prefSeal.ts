import { utf8 } from "./bytes.ts";
import { type AccountSealKeys, personalData } from "./noteKey.ts";
import { seal, unsealText } from "./seal.ts";

/**
 * One preference, sealed under the personal key of the account and bound to its
 * name.
 */
export function sealPref(
  account: AccountSealKeys,
  name: string,
  value: unknown,
): Promise<string> {
  return seal(
    account.personal,
    utf8(JSON.stringify(value)),
    personalData(account, name, "pref"),
  );
}

/** The value of the preference. Undefined when it does not open. */
export async function openPref(
  account: AccountSealKeys,
  name: string,
  sealed: unknown,
): Promise<unknown> {
  if (typeof sealed !== "string") return undefined;
  const text = await unsealText(
    account.personal,
    sealed,
    personalData(account, name, "pref"),
  );
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
