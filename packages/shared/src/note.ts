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

export enum NoteFont {
  Default = "default",
  PermanentMarker = "permanent-marker",
  ComicRelief = "comic-relief",
}

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  favicon?: string;
  domain: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt: string | null;
  position: number;
  tags: string[];
  images: string[];
  linkPreviews: LinkPreview[];
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a note (server assigns id and timestamps). */
export type NoteCreate = Omit<Note, "id" | "createdAt" | "updatedAt">;

/** Partial update — only the fields being changed. */
export type NoteUpdate = Partial<Omit<Note, "id" | "createdAt">>;

/** A snapshot of a note's title and content at a point in time. */
export interface NoteVersion {
  noteId: string;
  timestamp: string;
  title: string;
  content: string;
}
