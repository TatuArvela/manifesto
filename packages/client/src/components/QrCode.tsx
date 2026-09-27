import { useEffect, useState } from "preact/hooks";

/** The dark modules of a QR code as one SVG path, a unit square each. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return d;
}

/**
 * `value` as a QR code, drawn dark on white whatever the theme, since that is
 * what a camera reads best. The encoder is fetched when the code is first
 * shown, so it costs nothing to anyone who never sets up two-factor sign-in.
 * Until it arrives, and if it cannot, the square is left empty: whatever the
 * code carries is on screen beside it in some other form.
 */
export function QrCode({
  value,
  label,
  size = 176,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const [modules, setModules] = useState<boolean[][] | null>(null);

  useEffect(() => {
    let live = true;
    setModules(null);
    import("uqr")
      .then(({ encode }) => {
        // M recovers a smudged or glared screen, and an otpauth link fits.
        if (live) setModules(encode(value, { ecc: "M", border: 2 }).data);
      })
      .catch(() => {
        // Offline with the chunk not cached: the key is shown as text too.
      });
    return () => {
      live = false;
    };
  }, [value]);

  const count = modules?.length ?? 1;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shape-rendering="crispEdges"
      class="rounded-lg bg-white"
    >
      {modules && <path d={qrPath(modules)} fill="#000" />}
    </svg>
  );
}
