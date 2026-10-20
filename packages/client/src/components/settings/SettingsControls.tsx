import { ChevronDown } from "lucide-preact";
import type { ComponentChildren, CSSProperties, JSX } from "preact";
import { useContext, useId, useState } from "preact/hooks";
import { ControlLabelId } from "#/components/controlLabel.ts";
import { Dropdown } from "#/components/Dropdown.tsx";

/**
 * The track of a three-way toggle, sufficiently dark to read on the tinted
 * panel of a group.
 */
export const toggleTrackClass = "bg-neutral-200/80 dark:bg-neutral-700";

/**
 * One setting with a label: the name on the left, its control on the right. The
 * name is centered on a control with the height of one line. On a taller
 * control (`alignTop`), it is at the top, as a heading over samples.
 */
export function SettingsRow({
  label,
  alignTop = false,
  children,
}: {
  label: string;
  alignTop?: boolean | undefined;
  children: ComponentChildren;
}) {
  const labelId = useId();
  return (
    <div
      class={`flex ${alignTop ? "items-start" : "items-center"} justify-between gap-4 min-h-12 px-3 py-2`}
      data-setting-row
    >
      <h4 id={labelId} class="text-sm text-neutral-700 dark:text-neutral-200">
        {label}
      </h4>
      <ControlLabelId.Provider value={labelId}>
        {children}
      </ControlLabelId.Provider>
    </div>
  );
}

/**
 * The name of a section within a page, the same on all pages. It is aligned
 * with the text under it. A group of rows indents it with `class`.
 */
export function SettingsHeading({
  class: className = "",
  children,
}: {
  class?: string | undefined;
  children: ComponentChildren;
}) {
  return (
    <h3
      class={`text-sm font-semibold text-neutral-800 dark:text-neutral-200 ${className}`}
    >
      {children}
    </h3>
  );
}

/**
 * Rows that belong together, with a line between each, under a heading when the
 * group needs a name.
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
      {title && <SettingsHeading class="px-1 pb-2">{title}</SettingsHeading>}
      <div class="divide-y divide-neutral-200 dark:divide-white/10">
        {children}
      </div>
    </section>
  );
}

/**
 * One choice in a {@link SettingsSelect}. Options have their own preview (an
 * element at the start, a styled label, or neither). Thus, the select does not
 * depend on the presentation, and does not need a render hook for each type of
 * setting.
 */
export type SettingsOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered before the label, for example a color swatch. */
  preview?: JSX.Element;
  /**
   * Applied to the label, for example to show a font in the font that it
   * selects.
   */
  labelStyle?: CSSProperties | undefined;
};

/** The shared contents of the trigger and of each menu item. */
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
 * A select-style field for a settings row: a trigger with a label and a
 * chevron, with its menu on the shared Dropdown. That puts the panel in the top
 * layer. Thus, the scroll container of the settings modal does not clip it, and
 * it gets light-dismiss and Escape.
 */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  compact = false,
}: {
  value: T;
  options: SettingsOption<T>[];
  onChange: (value: T) => void;
  label: string;
  /** Shown as it is, but not opened, for a setting that does not apply now. */
  disabled?: boolean | undefined;
  /**
   * The trigger shows only the preview of the choice, with its name in the menu
   * and the tooltip, for a select in a narrow column.
   */
  compact?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const labelledBy = useContext(ControlLabelId);
  const triggerId = useId();
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
          class={`inline-flex items-center gap-1.5 ${compact ? "px-2" : "pl-3 pr-2"} py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-white dark:bg-neutral-700 ring-1 ring-inset ring-neutral-200 dark:ring-0 hover:bg-neutral-100 dark:hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-neutral-700`}
          onClick={() => setOpen(!open)}
          title={compact ? current.label : undefined}
          disabled={disabled}
          id={triggerId}
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy && `${labelledBy} ${triggerId}`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {compact && current.preview ? (
            current.preview
          ) : (
            <OptionContent option={current} />
          )}
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

/** One choice in {@link SettingsTiles}: its name, and a picture of it. */
export type SettingsTile<T extends string> = {
  value: T;
  label: string;
  sample: JSX.Element;
};

/**
 * A choice by picture, as the system settings of macOS offer one: a sample of
 * each option next to each other, with a ring around the selected one and its
 * name in bold. Native radios are under them. Thus, the arrow keys move between
 * them as in all radio groups, and a settings search goes to the checked one.
 */
export function SettingsTiles<T extends string>({
  value,
  options,
  onChange,
  label,
  class: className = "flex gap-4",
}: {
  value: T;
  options: SettingsTile<T>[];
  onChange: (value: T) => void;
  label: string;
  /** The layout of the tiles, for a caller that aligns something under them. */
  class?: string | undefined;
}) {
  const labelledBy = useContext(ControlLabelId);
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      class={className}
    >
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <label
            key={option.value}
            class="group flex flex-col items-center gap-1.5 cursor-pointer"
          >
            <input
              type="radio"
              class="peer sr-only"
              name={name}
              checked={checked}
              onChange={() => onChange(option.value)}
            />
            <span
              class={`rounded-[0.6rem] p-0.5 ring-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 dark:peer-focus-visible:outline-blue-400 ${
                checked
                  ? "ring-blue-500 dark:ring-blue-400"
                  : "ring-transparent group-hover:ring-neutral-300 dark:group-hover:ring-neutral-600"
              }`}
            >
              {option.sample}
            </span>
            <span
              class={`text-xs whitespace-nowrap ${
                checked
                  ? "font-semibold text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
