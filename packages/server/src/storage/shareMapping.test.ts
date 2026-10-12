import {
  PERSONAL_NOTE_FIELDS,
  SEALED_SHARED_NOTE_FIELDS,
  type SealedNoteUpdate,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { ct } from "./contracts/claimed.js";
import {
  attachSharing,
  forbiddenFields,
  type MemberRow,
  mergePages,
  parseRole,
  rowToViewNote,
  splitChanges,
  type ViewRow,
} from "./shareMapping.js";

/**
 * Where a recipient's write of each field lands. Keyed on every field of
 * `SealedNoteUpdate`, so a field added to a note fails the typecheck here until
 * someone decides whether recipients may write it; without that decision it
 * falls to the owner alone and every recipient's write of it is refused.
 */
const WHERE: Record<
  keyof Required<SealedNoteUpdate>,
  "shared" | "personal" | "owner"
> = {
  title: "shared",
  content: "shared",
  excerpt: "shared",
  font: "shared",
  images: "shared",
  imageRefs: "shared",
  linkPreviews: "shared",
  previewRefs: "shared",
  color: "personal",
  pinned: "personal",
  archived: "personal",
  trashed: "personal",
  trashedAt: "personal",
  position: "personal",
  tags: "personal",
  reminder: "personal",
  // Auto-note markers, the stamp the server writes itself, and the note
  // key, which only its owner replaces.
  readonly: "owner",
  source: "owner",
  updatedAt: "owner",
  key: "owner",
  keyVersion: "owner",
};

const sample: Required<SealedNoteUpdate> = {
  key: ct("key"),
  keyVersion: 2,
  title: ct("t"),
  content: ct("c"),
  excerpt: ct("c"),
  font: ct("default"),
  images: ct("[]"),
  imageRefs: [],
  linkPreviews: ct("[]"),
  previewRefs: [],
  color: ct("blue"),
  pinned: true,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 5,
  tags: ct('["x"]'),
  reminder: null,
  readonly: true,
  source: { kind: "auto-note", pluginId: "p", noteKey: "k" },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("splitChanges", () => {
  it("files every field of an update where the shared lists say", () => {
    const split = splitChanges(sample);
    for (const [field, where] of Object.entries(WHERE)) {
      if (where === "shared") expect(split.shared, field).toHaveProperty(field);
      if (where === "personal") {
        expect(split.personal, field).toHaveProperty(field);
      }
      if (where === "owner") expect(split.ownerOnly, field).toContain(field);
    }
  });

  it("agrees with the lists in shared, which the client reads too", () => {
    expect(
      Object.keys(WHERE).filter(
        (f) => WHERE[f as keyof SealedNoteUpdate] === "shared",
      ),
    ).toEqual([...SEALED_SHARED_NOTE_FIELDS]);
    expect(
      Object.keys(WHERE)
        .filter((f) => WHERE[f as keyof SealedNoteUpdate] === "personal")
        .sort(),
    ).toEqual([...PERSONAL_NOTE_FIELDS].sort());
  });

  it("skips a field whose value is undefined, and keeps null and false", () => {
    // Past the types, which no longer let a key hold `undefined`: the check
    // is for a caller that builds its changes some other way.
    const split = splitChanges({
      title: undefined,
      reminder: null,
      pinned: false,
      readonly: undefined,
    } as unknown as SealedNoteUpdate);
    expect(split).toEqual({
      shared: {},
      personal: { reminder: null, pinned: false },
      ownerOnly: [],
    });
  });

  it("treats a field it has never heard of as the owner's", () => {
    const split = splitChanges({ sharing: {} } as unknown as SealedNoteUpdate);
    expect(split.ownerOnly).toEqual(["sharing"]);
  });
});

describe("forbiddenFields", () => {
  it("lets an editor write shared and personal fields", () => {
    expect(
      forbiddenFields("edit", splitChanges({ title: ct("a"), pinned: true })),
    ).toEqual([]);
  });

  it("keeps a viewer to their own copy", () => {
    expect(
      forbiddenFields(
        "view",
        splitChanges({ pinned: true, tags: ct('["a"]') }),
      ),
    ).toEqual([]);
    expect(
      forbiddenFields(
        "view",
        splitChanges({ pinned: true, content: ct("x"), imageRefs: [] }),
      ).sort(),
    ).toEqual(["content", "imageRefs"]);
  });

  it("keeps the note key to its owner", () => {
    expect(
      forbiddenFields("edit", splitChanges({ key: ct("k"), keyVersion: 2 })),
    ).toEqual(["key", "keyVersion"]);
  });

  it("refuses the owner's fields to every role", () => {
    for (const role of ["edit", "view"] as const) {
      expect(
        forbiddenFields(
          role,
          splitChanges({
            readonly: true,
            source: undefined,
          } as unknown as SealedNoteUpdate),
        ),
      ).toEqual(["readonly"]);
    }
  });
});

describe("parseRole", () => {
  it("reads anything but edit as the lesser role", () => {
    expect(parseRole("edit")).toBe("edit");
    for (const raw of ["view", "EDIT", "owner", "", null, undefined]) {
      expect(parseRole(raw), String(raw)).toBe("view");
    }
  });
});

function row(overrides: Partial<ViewRow> = {}): ViewRow {
  return {
    id: "n1",
    user_id: "owner",
    title: ct("Title"),
    content: ct("Body"),
    color: ct("blue"),
    font: ct("default"),
    wrapped_key: ct("owner's key"),
    pinned: 1,
    archived: 0,
    trashed: 0,
    trashed_at: null,
    position: 10,
    tags: ct('["owner-tag"]'),
    images: "[]",
    link_previews: ct("[]"),
    reminder: null,
    readonly: 0,
    source: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowToViewNote", () => {
  it("shows the owner their own row", () => {
    const note = rowToViewNote(row());
    expect(note).toMatchObject({
      key: ct("owner's key"),
      color: ct("blue"),
      pinned: true,
      tags: ct('["owner-tag"]'),
      position: 10,
    });
  });

  it("lays a recipient's own fields over the owner's, and nothing of the owner's shows through", () => {
    const note = rowToViewNote(
      row({
        s_role: "view",
        s_pinned: 0,
        s_archived: 1,
        s_trashed: 0,
        s_position: "3.5",
        // The columns' defaults, for a colour and tags never set.
        s_color: "default",
        s_tags: "[]",
        s_reminder: null,
        s_wrapped_key: ct("recipient's key"),
      }),
    );
    expect(note).toMatchObject({
      title: ct("Title"),
      content: ct("Body"),
      // Their own copy of the key, and nothing of the owner's colour or tags.
      key: ct("recipient's key"),
      color: "",
      pinned: false,
      archived: true,
      trashed: false,
      trashedAt: null,
      position: 3.5,
      tags: "",
      reminder: null,
    });
  });

  it("gives a recipient their own trash, whatever the owner's row says", () => {
    const note = rowToViewNote(
      row({
        s_role: "edit",
        s_trashed: true,
        s_trashed_at: "2026-02-01T00:00:00.000Z",
        trashed: 0,
      }),
    );
    expect(note.trashed).toBe(true);
    expect(note.trashedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});

function member(overrides: Partial<MemberRow>): MemberRow {
  return {
    note_id: "n1",
    user_id: "u",
    role: "edit",
    created_at: "2026-01-01T00:00:00.000Z",
    accepted_at: "2026-01-01T00:00:00.000Z",
    username: "u",
    display_name: "",
    avatar_color: "red",
    ...overrides,
  };
}

describe("attachSharing", () => {
  const users = [
    {
      id: "owner",
      username: "olga",
      display_name: "Olga",
      avatar_color: "red",
    },
  ];
  const members = [
    member({
      user_id: "b",
      username: "bob",
      created_at: "2026-01-03T00:00:00.000Z",
    }),
    member({
      user_id: "p",
      username: "pat",
      role: "view",
      accepted_at: null,
      created_at: "2026-01-02T00:00:00.000Z",
    }),
    member({
      user_id: "t",
      username: "tim",
      via_team: "team1",
      team_name: "Crew",
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  ];

  it("tells the owner of every invitation, the pending ones included, oldest first", () => {
    const r = row();
    const [note] = attachSharing(
      [r],
      [rowToViewNote(r)],
      "owner",
      members,
      users,
    );
    expect(note?.sharing?.role).toBe("owner");
    expect(note?.sharing?.members.map((m) => [m.username, m.accepted])).toEqual(
      [
        ["tim", true],
        ["pat", false],
        ["bob", true],
      ],
    );
    expect(note?.sharing?.members[0]?.team).toEqual({
      id: "team1",
      name: "Crew",
    });
    // A member with no display name goes by their username.
    expect(note?.sharing?.members[2]?.displayName).toBe("bob");
  });

  it("shows a recipient only the people who accepted", () => {
    const r = row({ s_role: "edit" });
    const [note] = attachSharing([r], [rowToViewNote(r)], "b", members, users);
    expect(note?.sharing?.role).toBe("edit");
    expect(note?.sharing?.owner.displayName).toBe("Olga");
    expect(note?.sharing?.members.map((m) => m.username)).toEqual([
      "tim",
      "bob",
    ]);
  });

  it("leaves a note nobody else has without sharing", () => {
    const r = row({ id: "lonely" });
    const [note] = attachSharing(
      [r],
      [rowToViewNote(r)],
      "owner",
      members,
      users,
    );
    expect(note).not.toHaveProperty("sharing");
  });
});

describe("mergePages", () => {
  const at = (id: string, updated: string) =>
    row({ id, updated_at: `2026-01-0${updated}T00:00:00.000Z` });

  it("merges two pages newest first, ties broken by id, one row over the limit", () => {
    const own = [at("a", "5"), at("c", "3"), at("e", "1")];
    const shared = [at("b", "5"), at("d", "2")];
    expect(mergePages(own, shared, 3).map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
});
