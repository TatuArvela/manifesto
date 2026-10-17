import { AUDIT_ACTIONS } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { en } from "#/i18n/messages/en.ts";
import { fi } from "#/i18n/messages/fi.ts";

describe("audit log messages", () => {
  it("name every action the server records, in every catalogue", () => {
    for (const catalogue of [en, fi]) {
      const missing = AUDIT_ACTIONS.filter(
        (action) => !(`audit.action.${action}` in catalogue),
      );
      expect(missing).toEqual([]);
    }
  });
});
