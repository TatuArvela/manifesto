import {
  type AccountSealKeys,
  derivable,
  deriveBytes,
  newTokenSecret,
  type SealedNote,
  sealingKey,
  tokenHashOf,
  unwrapNoteKey,
  utf8,
  wrapFeedKey,
  wrapForReminders,
  wrapNoteKey,
  wrapTokenKeys,
} from "@manifesto/shared";

/**
 * Tokens as the app makes them: the secret chosen on this side, and the
 * account's notes key and personal key wrapped under it for the server to
 * open while the token is presented. The keys are real, unlike the values
 * the sealing test client sends for a session, because the server opens and
 * seals with them. So a note such a token reads has to have been written
 * with these keys: by a token of the account, or by a test that seals with
 * `testAccountKeys`.
 */

/** An account's notes key and personal key, the same every time for one
 * account, as a device that unlocked it would derive them. */
async function material(userId: string) {
  const account = await derivable(utf8(`test account key of ${userId}`));
  return {
    version: 1,
    notes: await deriveBytes(account, "account/notes"),
    personal: await deriveBytes(account, "account/personal"),
    reminders: await deriveBytes(account, "account/reminder"),
  };
}

/** The same keys, ready to seal and open with, for a test that plays the
 * app beside a token. */
export async function testAccountKeys(
  userId: string,
): Promise<AccountSealKeys> {
  const { version, notes, personal } = await material(userId);
  return {
    userId,
    version,
    notes: await sealingKey(notes),
    personal: await sealingKey(personal),
  };
}

/**
 * A new token's secret, and what the app sends the server of it: its hash,
 * the start of it that a list shows, and the keys it carries.
 */
export async function keyedToken(
  userId: string,
  kind: "api" | "mcp" | "calendar",
): Promise<{
  secret: string;
  fields: { tokenHash: string; prefix: string; wrappedKeys: string };
}> {
  const secret = newTokenSecret(
    kind === "mcp" ? "mfm_" : kind === "calendar" ? "mfc_" : "mfp_",
  );
  const keys = await material(userId);
  return {
    secret,
    fields: {
      tokenHash: await tokenHashOf(secret),
      prefix: secret.slice(0, 10),
      // A feed's address carries the reminder key and nothing else.
      wrappedKeys:
        kind === "calendar"
          ? await wrapFeedKey(secret, keys)
          : await wrapTokenKeys(secret, keys),
    },
  };
}

/**
 * The copy of a note's key that a calendar feed opens, as the app leaves it
 * when a reminder is set: the reader's own copy opened, and wrapped under
 * their reminder key.
 */
export async function reminderKeyOf(
  sealed: Pick<SealedNote, "id" | "key" | "keyVersion">,
  userId: string,
): Promise<string> {
  const account = await testAccountKeys(userId);
  const raw = await unwrapNoteKey(
    account,
    sealed.id,
    sealed.keyVersion,
    sealed.key,
  );
  if (!raw) throw new Error("The test keys do not open this note");
  const { reminders } = await material(userId);
  return wrapForReminders(
    await sealingKey(reminders),
    account,
    sealed.id,
    sealed.keyVersion,
    raw,
  );
}

/**
 * The key of `noteId` as `recipientId` keeps it once they have accepted: the
 * owner's own copy opened, and wrapped under the recipient's notes key. What
 * the two apps do between them with an offered key, done here in one step
 * for a test of what a token then reads.
 */
export async function heldKeyOf(
  sealed: Pick<SealedNote, "id" | "key" | "keyVersion">,
  ownerId: string,
  recipientId: string,
): Promise<{ key: string; keyVersion: number }> {
  const raw = await unwrapNoteKey(
    await testAccountKeys(ownerId),
    sealed.id,
    sealed.keyVersion,
    sealed.key,
  );
  if (!raw) throw new Error("The owner's test keys do not open this note");
  return {
    key: await wrapNoteKey(
      await testAccountKeys(recipientId),
      sealed.id,
      sealed.keyVersion,
      raw,
    ),
    keyVersion: sealed.keyVersion,
  };
}

/**
 * An account's notes key and personal key wrapped under `secret`, as the
 * consent page wraps them under the code it makes for an assistant.
 */
export async function wrapTestKeys(
  secret: string,
  userId: string,
): Promise<string> {
  return wrapTokenKeys(secret, await material(userId));
}
