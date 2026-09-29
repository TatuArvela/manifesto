import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initReminderScheduler, parseLocalISO } from "./reminderScheduler.js";

/**
 * One real fire through the scheduler, in a file of its own because
 * `initReminderScheduler` runs once per module. What it stores is what the
 * next fire steps from, so this is where the drift used to start.
 */

function note(reminder: Note["reminder"]): Note {
  return {
    id: "n1",
    title: "Rent",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("a monthly reminder on the 31st, fired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores February's last day and the 31st to come back to", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(parseLocalISO("2026-01-31T09:05:00"));
    const updateNote = vi.fn();
    initReminderScheduler({
      notes: () => [
        note({
          time: "2026-01-31T09:00:00",
          recurrence: "monthly",
          timezone: "Europe/Helsinki",
        }),
      ],
      subscribe: () => () => {},
      updateNote,
    });

    await vi.waitFor(() => expect(updateNote).toHaveBeenCalled());
    expect(updateNote).toHaveBeenCalledWith("n1", {
      reminder: {
        time: "2026-02-28T09:00:00",
        recurrence: "monthly",
        day: 31,
        timezone: "Europe/Helsinki",
        lastFiredAt: expect.any(String),
      },
    });
  });
});
