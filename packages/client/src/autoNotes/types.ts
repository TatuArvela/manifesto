import type { NoteColor, NoteFont } from "@manifesto/shared";
import type { ApproxLabels } from "./stdlib.ts";

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
   * The tags from which the user permits this plugin to read notes. A plugin
   * reads a tag only while its source still asks for it (`// @reads`) and it is
   * here. If this is absent or empty, the plugin reads nothing, as all plugins
   * did before they could read.
   */
  reads?: string[] | undefined;
}

/**
 * A note as a plugin sees it: its text and how its owner keeps it, and nothing
 * that points outside the note (no images, no link previews).
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
  /** A stable sub-id when a plugin returns many notes. */
  key?: string;
}

export interface PluginContextInput {
  today: string;
  locale: string;
  approxLabels: ApproxLabels;
  /** The tags from which the plugin reads, and the notes that have them. */
  reads?: string[];
  notes?: PluginNote[];
}
