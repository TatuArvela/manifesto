import { useEffect, useState } from "preact/hooks";

/** The dark modules of a QR code as one SVG path, each a unit square. */
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
 * `value` as a QR code, drawn dark on white whatever the theme, because a
 * camera reads that best. The app gets the encoder when the code shows the
 * first time. Thus, it costs nothing to a person who never sets up two-factor
 * sign-in. Until it arrives, and if it cannot arrive, the square stays empty.
 * The content of the code is on the screen next to it in a different form.
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
        // M recovers a dirty screen or a screen with glare, and an otpauth link
        // fits.
        if (live) setModules(encode(value, { ecc: "M", border: 2 }).data);
      })
      .catch(() => {
        // Offline, and the chunk is not cached. The key also shows as text.
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
