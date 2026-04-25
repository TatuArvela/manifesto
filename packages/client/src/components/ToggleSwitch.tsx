import type { ComponentChildren } from "preact";
import { Tooltip } from "./Tooltip.js";

/** Two-state toggle switch with icon slots and tooltips */
export function ToggleSwitch({
  checked,
  onChange,
  iconOff,
  iconOn,
  labelOff,
  labelOn,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  iconOff: ComponentChildren;
  iconOn: ComponentChildren;
  labelOff: string;
  labelOn: string;
}) {
  const slotW = 32;
  const gap = 2;
  const totalW = slotW * 2 + gap * 2;
  const knobOffset = gap + (checked ? slotW : 0);

  return (
    <div
      class="relative inline-flex items-center rounded-full bg-neutral-200 dark:bg-neutral-700"
      style={{ width: `${totalW}px`, height: "32px" }}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        // Only handle activation when the container itself has focus. The
        // inner buttons handle their own Space/Enter via the browser's button
        // default click — bubbling here would double-toggle and produce the
        // wrong value when focus is on a button.
        if (e.target !== e.currentTarget) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span
        class="absolute top-0.5 rounded-full bg-white dark:bg-neutral-300 shadow transition-all duration-200"
        style={{
          width: `${slotW - gap}px`,
          height: "28px",
          transform: `translateX(${knobOffset}px)`,
        }}
      />
      <Tooltip label={labelOff}>
        <button
          type="button"
          class={`relative z-10 flex items-center justify-center cursor-pointer transition-colors duration-200 ${
            !checked
              ? "text-neutral-800 dark:text-neutral-900"
              : "text-neutral-400 dark:text-neutral-500"
          }`}
          style={{ width: `${slotW}px`, height: "32px" }}
          onClick={() => onChange(false)}
          aria-label={labelOff}
        >
          {iconOff}
        </button>
      </Tooltip>
      <Tooltip label={labelOn}>
        <button
          type="button"
          class={`relative z-10 flex items-center justify-center cursor-pointer transition-colors duration-200 ${
            checked
              ? "text-neutral-800 dark:text-neutral-900"
              : "text-neutral-400 dark:text-neutral-500"
          }`}
          style={{ width: `${slotW}px`, height: "32px" }}
          onClick={() => onChange(true)}
          aria-label={labelOn}
        >
          {iconOn}
        </button>
      </Tooltip>
    </div>
  );
}

/** Three-state toggle switch with icon slots and tooltips */
export function ThreeWayToggle({
  value,
  onChange,
  options,
  trackClass,
}: {
  value: number;
  onChange: (index: number) => void;
  options: { icon: ComponentChildren; label: string }[];
  trackClass?: string;
}) {
  const count = options.length;
  const slotW = 32;
  const gap = 2;
  const totalW = slotW * count + gap * 2;
  const knobOffset = gap + value * slotW;

  return (
    <div
      class={`relative inline-flex items-center rounded-full ${trackClass ?? "bg-neutral-100 dark:bg-neutral-700"}`}
      style={{ width: `${totalW}px`, height: "32px" }}
    >
      <span
        class="absolute top-0.5 rounded-full bg-white dark:bg-neutral-300 shadow transition-all duration-200"
        style={{
          width: `${slotW - gap}px`,
          height: "28px",
          transform: `translateX(${knobOffset}px)`,
        }}
      />
      {options.map((opt, i) => (
        <Tooltip key={i} label={opt.label}>
          <button
            type="button"
            class={`relative z-10 flex items-center justify-center cursor-pointer transition-all duration-200 ${
              value === i
                ? "text-neutral-800 dark:text-neutral-900"
                : "text-black dark:text-white opacity-40"
            }`}
            style={{ width: `${slotW}px`, height: "32px" }}
            onClick={() => onChange(i)}
            aria-label={opt.label}
          >
            {opt.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
