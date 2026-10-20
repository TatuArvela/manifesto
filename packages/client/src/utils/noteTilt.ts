/**
 * How far a card tilts on a "Messy" board, in degrees: one or two degrees in
 * either direction, never level, and always the same for the same note. Thus,
 * the board does not change its tilts on each render or reload. Read from the
 * id of the note, which is the only thing of a card that never changes.
 */
export function noteTilt(id: string): number {
  // FNV-1a: a few lines, and spread sufficiently well over ids that share a
  // timestamp prefix (ULIDs made in the same millisecond are different only at
  // the end).
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unit = (hash >>> 0) / 0xffffffff;
  // 0..0.5 tilts to the left, 0.5..1 to the right, each from half a degree to
  // two degrees.
  const lean = 0.5 + Math.abs(unit - 0.5) * 2 * 1.5;
  return Math.round((unit < 0.5 ? -lean : lean) * 100) / 100;
}
