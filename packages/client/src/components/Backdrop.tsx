interface BackdropProps {
  /** A press outside the dialog. Escape is the dialog's own, through `useEscapeStack`. */
  onDismiss: () => void;
  /** Fades out with the dialog's exit while true. */
  closing?: boolean;
  /** Its layer, and anything else it needs: `z-40`, `z-[60] max-sm:hidden`. */
  class: string;
  /** The darker shade, for a viewer that should hide the board. */
  deep?: boolean;
}

/** The dimmed layer behind a modal dialog, which closes it when pressed. */
export function Backdrop({
  onDismiss,
  closing,
  class: extra,
  deep,
}: BackdropProps) {
  return (
    // The keyboard route out is Escape, so the layer needs no key handler.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss
    <div
      class={`fixed inset-0 ${deep ? "bg-black/90" : "bg-black/50"} transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"} ${extra}`}
      onClick={onDismiss}
    />
  );
}
