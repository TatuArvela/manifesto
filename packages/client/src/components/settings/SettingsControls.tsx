import { ChevronDown } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Dropdown } from "../Dropdown.js";

/** A three-way toggle's track, dark enough to read on a group's tinted panel. */
export const toggleTrackClass = "bg-neutral-200/80 dark:bg-neutral-700";

/** One labelled setting: name on the left, its control on the right. */
export function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-center justify-between gap-4 min-h-12 px-3 py-2">
      <h4 class="text-sm text-neutral-700 dark:text-neutral-200">{label}</h4>
      {children}
    </div>
  );
}

/**
 * Rows that belong together, with a line between each, under a heading when
 * the group needs a name.
 */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string | undefined;
  children: ComponentChildren;
}) {
  return (
    <section>
      {title && (
        <h3 class="px-1 pb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          {title}
        </h3>
      )}
      <div class="divide-y divide-neutral-200 dark:divide-white/10">
        {children}
      </div>
    </section>
  );
}

/**
 * One choice in a {@link SettingsSelect}. Options carry their own preview (a
 * leading element, a styled label, or neither), so the select stays
 * presentation-agnostic instead of growing a render hook per kind of setting.
 */
export type SettingsOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered ahead of the label, e.g. a colour swatch. */
  preview?: JSX.Element;
  /** Applied to the label, e.g. to show a font in the font it picks. */
  labelStyle?: JSX.CSSProperties | undefined;
};

/** The shared innards of the trigger and every menu item. */
function OptionContent<T extends string>({
  option,
}: {
  option: SettingsOption<T>;
}) {
  return (
    <>
      {option.preview}
      <span style={option.labelStyle}>{option.label}</span>
    </>
  );
}

/**
 * A select-style field for a settings row: a labelled trigger with a chevron,
 * with its menu on the shared Dropdown. That puts the panel in the top layer,
 * so the settings modal's scroll container does not clip it, and brings
 * light-dismiss and Escape with it.
 */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SettingsOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? {
    value,
    label: value,
  };
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      panelClass="py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[160px]"
      trigger={
        <button
          type="button"
          class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-white dark:bg-neutral-700 ring-1 ring-inset ring-neutral-200 dark:ring-0 hover:bg-neutral-100 dark:hover:bg-neutral-600"
          onClick={() => setOpen(!open)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <OptionContent option={current} />
          <ChevronDown
            class={`w-4 h-4 shrink-0 text-neutral-500 dark:text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      }
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          class={`flex w-full items-center gap-2 text-left px-4 py-2 text-sm cursor-pointer ${
            value === opt.value
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
          }`}
          onClick={() => {
            onChange(opt.value);
            setOpen(false);
          }}
        >
          <OptionContent option={opt} />
        </button>
      ))}
    </Dropdown>
  );
}
