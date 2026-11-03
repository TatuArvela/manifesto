import { type BoardTexture, boardTextureMoves } from "#/state/prefs.ts";
import { SHEET_COUNTS } from "#/utils/boardTextures.ts";

/**
 * The pattern in its sheets, each its own layer with its own motion
 * (`SHEET_COUNTS` in utils/boardTextures.ts). They exist only while the pattern
 * moves (`boardTextureMoves`), and each moves with `translate`, `transform` and
 * `opacity` alone, which the compositor plays with no paint (preferences.css).
 * While they show, the still pattern under them is hidden. The rolling gradient
 * needs no element: it is the `::after` of the frame.
 */
export function BoardSheets({ texture }: { texture: BoardTexture }) {
  if (!boardTextureMoves.value || texture === "none") return null;
  return (
    <div class="board-sheets" data-texture={texture} aria-hidden="true">
      {Array.from({ length: SHEET_COUNTS[texture] }, (_, k) => (
        <span
          key={k}
          style={{
            maskImage: `var(--board-sheet-${texture}-${k})`,
            "--k": String(k),
          }}
        />
      ))}
    </div>
  );
}
