interface BackdropProps {
  /**
   * A press outside the dialog. Escape belongs to the dialog, through
   * `useEscapeStack`.
   */
  onDismiss: () => void;
  /** Fades out with the exit of the dialog while true. */
  closing?: boolean;
  /**
   * Its layer, and other classes that it needs: `layer-backdrop`,
   * `layer-nested-backdrop max-sm:hidden`.
   */
  class: string;
  /** The darker shade, for a viewer that must hide the board. */
  deep?: boolean;
}

/**
 * The dimmed layer behind a modal dialog, which closes it when you press it.
 */
export function Backdrop({
  onDismiss,
  closing,
  class: extra,
  deep,
}: BackdropProps) {
  return (
    // The keyboard way out is Escape. Thus, the layer needs no key handler.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss
    <div
      class={`fixed inset-0 ${deep ? "bg-black/90" : "bg-black/50"} transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"} ${extra}`}
      onClick={onDismiss}
    />
  );
}
