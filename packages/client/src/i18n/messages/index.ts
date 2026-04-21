import { en } from "./en.js";
import { fi } from "./fi.js";

export type PluralEntry = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type MessageKey = keyof typeof en;

// Widen the narrow literal types from `as const` on the English source so
// translations can supply any string (or PluralEntry for plural keys) while
// still enforcing key parity.
export type Messages = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : PluralEntry;
};

export const messages: Record<"en" | "fi", Messages> = { en, fi };
