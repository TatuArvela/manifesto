export enum NoteColor {
  Default = "default",
  Red = "red",
  Orange = "orange",
  Yellow = "yellow",
  Green = "green",
  Teal = "teal",
  Blue = "blue",
  Purple = "purple",
  Pink = "pink",
  Brown = "brown",
  Gray = "gray",
}

export enum LockLevel {
  Unlocked = "unlocked",
  ContentLocked = "content-locked",
  FullyLocked = "fully-locked",
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  lock: LockLevel;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt: string | null;
  position: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a note (server assigns id and timestamps). */
export type NoteCreate = Omit<Note, "id" | "createdAt" | "updatedAt">;

/** Partial update — only the fields being changed. */
export type NoteUpdate = Partial<Omit<Note, "id" | "createdAt">>;
