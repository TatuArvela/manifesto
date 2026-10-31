import { ChevronDown } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";

/**
 * The look of a panel that a button of the tools opens on a phone, over the
 * rows. On a wide screen, it is a section of the rail at the right.
 */
export const phonePanel = (open: boolean) =>
  `${open ? "block" : "hidden"} absolute right-2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 md:static md:block md:w-auto md:max-w-none md:p-2 md:shadow-none md:ring-0`;

/**
 * A section of the rail at the right of the paper. On a wide screen, its
 * heading is a button that collapses the section and opens it again: the rail
 * then has room for the sections in use. On a phone, the heading does not
 * show, and the section is open while it shows.
 */
export function SidePanel({
  label,
  class: look,
  body = "",
  children,
}: {
  label: string;
  /** The classes of the section. */
  class: string;
  /** The classes of the part under the heading. */
  body?: string | undefined;
  children: ComponentChildren;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const id = useId();
  return (
    <section class={look} aria-label={label}>
      <h2 class="hidden md:block m-0">
        <button
          type="button"
          class={`flex w-full items-center justify-between gap-2 rounded-md px-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 cursor-pointer ${collapsed ? "" : "pb-2"}`}
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={id}
        >
          {label}
          <ChevronDown
            class={`w-4 h-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div id={id} class={`${body} ${collapsed ? "md:hidden" : ""}`}>
        {children}
      </div>
    </section>
  );
}
