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
  lastError?: string | undefined;
  /**
   * The tags the user has allowed this plugin to read notes from. A plugin
   * reads a tag only while its source still asks for it (`// @reads`) and it
   * is here; absent or empty, the plugin reads nothing, as every plugin did
   * before there was anything to read.
   */
  reads?: string[] | undefined;
}

/**
 * A note as a plugin is shown it: its text and how its owner has filed it,
 * and nothing that points outside the note (no images, no link previews).
 */
export interface PluginNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
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
  /** The tags the plugin is reading from, and the notes that carry them. */
  reads?: string[];
  notes?: PluginNote[];
}
