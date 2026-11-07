import { NoteColor, NoteFont } from "@manifesto/shared";
import { expect } from "vitest";
import type { CreateUserInput, StorageDriver } from "#/storage/types.ts";
import { claimed, heldKey } from "./claimed.ts";

/**
 * The accounts and the note with which both sharing contracts
 * (`sharingContract.ts`, `sharedNotesContract.ts`) start: an owner, two other
 * accounts, and one note of the owner.
 */

export const T0 = "2026-04-01T00:00:00.000Z";
export const T1 = "2026-04-01T00:00:01.000Z";
export const T2 = "2026-04-01T00:00:02.000Z";
export const T3 = "2026-04-01T00:00:03.000Z";
export const PAGE = { limit: 50 };

export function userInput(
  id: string,
  username: string,
  overrides: Partial<CreateUserInput> = {},
): CreateUserInput {
  return {
    id,
    username,
    passwordHash: "h",
    displayName: "",
    avatarColor: "#123456",
    provider: "local",
    externalId: null,
    createdAt: T0,
    ...overrides,
  };
}

export const noteData = {
  title: "Groceries",
  content: "- [ ] Milk",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: true,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 5,
  tags: ["home"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

/** A driver from `boot`, with the accounts and the note above. */
export async function seededSharing(
  boot: () => Promise<StorageDriver>,
): Promise<StorageDriver> {
  const storage = await boot();
  await storage.users.create(
    userInput("owner", "olivia", { displayName: "Olivia" }),
  );
  await storage.users.create(userInput("alice", "alice"));
  await storage.users.create(userInput("bob", "bob"));
  await storage.notes.insert({
    id: "n1",
    userId: "owner",
    data: claimed(noteData),
    createdAt: T0,
    updatedAt: T0,
  });
  return storage;
}

/** Shares the note with `userId`, and accepts it unless `accept` is false. */
export async function shareNote(
  storage: StorageDriver,
  userId: string,
  role: "edit" | "view",
  accept = true,
): Promise<void> {
  expect(
    await storage.shares.create({
      noteId: "n1",
      userId,
      role,
      createdAt: T1,
    }),
  ).toBe("ok");
  if (accept) {
    expect(await storage.shares.accept("n1", userId, T2, heldKey)).toBe(true);
  }
}
