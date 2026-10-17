/**
 * How far a card leans on a "Messy" board, in degrees: a degree or two either
 * way, never level, and always the same for the same note, so the board does
 * not shuffle its tilts on every render or reload. Read from the note's id,
 * which is all a card has that never changes.
 */
export function noteTilt(id: string): number {
  // FNV-1a: a few lines, and spread well enough over ids that share a
  // timestamp prefix (ULIDs made in the same millisecond differ only at the end).
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unit = (hash >>> 0) / 0xffffffff;
  // 0..0.5 leans left, 0.5..1 right, each from half a degree to two.
  const lean = 0.5 + Math.abs(unit - 0.5) * 2 * 1.5;
  return Math.round((unit < 0.5 ? -lean : lean) * 100) / 100;
}
