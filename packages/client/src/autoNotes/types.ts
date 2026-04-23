import type { NoteColor, NoteFont } from "@manifesto/shared";
import type { ApproxLabels } from "./stdlib.js";

export type PluginOrigin =
  | { kind: "inline"; source: string }
  | { kind: "url"; url: string; fetchedAt: string; source: string };

export interface PluginSource {
  id: string;
  name: string;
  enabled: boolean;
  origin: PluginOrigin;
  lastError?: string;
}

export interface AutoNoteResult {
  title: string;
  content: string;
  color?: NoteColor;
  font?: NoteFont;
  pinned?: boolean;
  tags?: string[];
  position?: number;
  /** Stable sub-id when a plugin returns multiple notes. */
  key?: string;
}

export interface PluginContextInput {
  today: string;
  locale: string;
  approxLabels: ApproxLabels;
}
