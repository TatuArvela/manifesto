import { beforeEach, describe, expect, it } from "vitest";
import {
  answerConfirmation,
  askConfirmation,
  confirmDeletion,
  confirmRequest,
} from "./confirm.js";
import { confirmBeforeDelete } from "./prefs.js";

const question = {
  title: "Delete this note?",
  confirmLabel: "Delete",
};

beforeEach(() => {
  confirmRequest.value = null;
  confirmBeforeDelete.value = false;
});

describe("askConfirmation", () => {
  it("resolves to what was answered", async () => {
    const yes = askConfirmation(question);
    answerConfirmation(true);
    expect(await yes).toBe(true);

    const no = askConfirmation(question);
    answerConfirmation(false);
    expect(await no).toBe(false);
  });

  it("puts the question on screen and takes it down again", async () => {
    const answer = askConfirmation(question);
    expect(confirmRequest.value?.title).toBe("Delete this note?");
    answerConfirmation(true);
    expect(confirmRequest.value).toBeNull();
    await answer;
  });

  it("settles a question it replaces, rather than stranding its caller", async () => {
    // Nothing else would ever answer the first one: its dialog is gone.
    const first = askConfirmation(question);
    const second = askConfirmation({ ...question, title: "Delete 3 notes?" });
    expect(await first).toBe(false);

    answerConfirmation(true);
    expect(await second).toBe(true);
  });

  it("ignores an answer when nothing was asked", () => {
    expect(() => answerConfirmation(true)).not.toThrow();
    expect(confirmRequest.value).toBeNull();
  });
});

describe("confirmDeletion", () => {
  it("does not ask while the preference is off", async () => {
    expect(await confirmDeletion(question)).toBe(true);
    expect(confirmRequest.value).toBeNull();
  });

  it("asks while the preference is on", async () => {
    confirmBeforeDelete.value = true;
    const answer = confirmDeletion(question);
    // The deletion is held until the reader has answered.
    await Promise.resolve();
    expect(confirmRequest.value?.confirmLabel).toBe("Delete");
    answerConfirmation(false);
    expect(await answer).toBe(false);
  });
});
