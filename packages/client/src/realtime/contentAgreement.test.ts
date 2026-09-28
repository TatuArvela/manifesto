import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  contentHash,
  localAgreement,
  sharedAgreement,
} from "./contentAgreement.js";

const SAVED_AT = "2026-01-01T00:00:10.000Z";
const LATER = "2026-01-01T00:00:20.000Z";
const EARLIER = "2026-01-01T00:00:05.000Z";

function recorded() {
  const records = sharedAgreement(new Y.Doc(), null);
  records.claim("Milk, eggs");
  records.confirm(SAVED_AT);
  return records;
}

describe("contentAgreement", () => {
  it("judges a newer, unclaimed row that differs from the document outside", () => {
    expect(
      recorded().isOutside(
        { content: "Milk, eggs, oat milk", updatedAt: LATER },
        "Milk, eggs",
      ),
    ).toBe(true);
  });

  it("keeps a row the document once sent, however late it arrives", () => {
    const records = recorded();
    records.claim("Milk, eggs, coffee");
    expect(
      records.isOutside(
        { content: "Milk, eggs, coffee", updatedAt: LATER },
        "Milk, eggs, coffee, rye bread",
      ),
    ).toBe(false);
  });

  it("keeps a row no newer than the last save that landed", () => {
    // Offline typing: the saves failed, so the row is the last one that did.
    expect(
      recorded().isOutside(
        { content: "Something unclaimed", updatedAt: EARLIER },
        "Milk, eggs, typed offline",
      ),
    ).toBe(false);
  });

  it("keeps a row that already says what the document says", () => {
    expect(
      recorded().isOutside(
        { content: "Milk, eggs, oat milk", updatedAt: LATER },
        "Milk, eggs, oat milk\n",
      ),
    ).toBe(false);
  });

  it("judges nothing outside for a document with no records", () => {
    // Every document from before the records: the document wins, as it did.
    expect(
      sharedAgreement(new Y.Doc(), null).isOutside(
        { content: "Milk, eggs, oat milk", updatedAt: LATER },
        "Milk, eggs",
      ),
    ).toBe(false);
  });

  it("keeps the records in the document, where other clients read them", () => {
    const one = new Y.Doc();
    const other = new Y.Doc();
    sharedAgreement(one, null).claim("Milk, eggs");
    sharedAgreement(one, null).confirm(SAVED_AT);
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one));
    const theirs = sharedAgreement(other, null);
    expect(theirs.wasClaimed("Milk, eggs\n")).toBe(true);
    expect(
      theirs.isOutside({ content: "Milk", updatedAt: EARLIER }, "Milk, eggs"),
    ).toBe(false);
  });

  it("never moves savedAt backwards", () => {
    const records = recorded();
    records.confirm(EARLIER);
    expect(
      records.isOutside({ content: "Milk", updatedAt: LATER }, "Milk, eggs"),
    ).toBe(true);
    expect(
      records.isOutside({ content: "Milk", updatedAt: SAVED_AT }, "Milk, eggs"),
    ).toBe(false);
  });

  it("keeps the newest fifty claims", () => {
    const ydoc = new Y.Doc();
    const records = sharedAgreement(ydoc, null);
    for (let i = 0; i < 60; i++) records.claim(`version ${i}`);
    expect(ydoc.getMap("manifesto:claims").size).toBe(50);
    expect(records.wasClaimed("version 59")).toBe(true);
  });

  it("leads only as the lowest client id with the document open", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    expect(sharedAgreement(ydoc, awareness).leads()).toBe(true);
    awareness.states.set(ydoc.clientID - 1, {});
    expect(sharedAgreement(ydoc, awareness).leads()).toBe(false);
  });

  it("keeps records for an editor with no shared document", () => {
    const records = localAgreement();
    records.claim("Milk");
    records.confirm(SAVED_AT);
    expect(records.leads()).toBe(true);
    expect(
      records.isOutside({ content: "Milk, eggs", updatedAt: LATER }, "Milk"),
    ).toBe(true);
  });

  it("hashes texts apart, trailing newlines aside", () => {
    expect(contentHash("Milk\n\n")).toBe(contentHash("Milk"));
    expect(contentHash("Milk")).not.toBe(contentHash("Milk."));
  });
});
