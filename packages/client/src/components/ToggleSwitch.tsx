import type { ComponentChildren } from "preact";
import { useContext, useId } from "preact/hooks";
import { ControlLabelId } from "./controlLabel.js";
import { Tooltip } from "./Tooltip.js";

/**
 * Plain on/off switch for a boolean setting, with no icon per state. Use this
 * wherever the setting really is just on or off; `ThreeWayToggle` is for the
 * cases where the states are genuinely different choices worth naming.
 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const labelledBy = useContext(ControlLabelId);
  const trackW = 44;
  const knob = 20;
  const gap = 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      class={`relative inline-flex shrink-0 items-center rounded-full cursor-pointer transition-colors duration-200 ${
        checked ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-600"
      }`}
      style={{ width: `${trackW}px`, height: `${knob + gap * 2}px` }}
      onClick={() => onChange(!checked)}
    >
      <span
        class="absolute rounded-full bg-white shadow transition-transform duration-200"
        style={{
          width: `${knob}px`,
          height: `${knob}px`,
          transform: `translateX(${checked ? trackW - knob - gap : gap}px)`,
        }}
      />
    </button>
  );
}

/**
 * A choice between a few named options, drawn as a track with a sliding knob.
 * Each option is a real radio button, hidden under its icon, so the group is
 * one tab stop and the arrow keys move the choice. It is named by `label`, or
 * by the settings row it sits in.
 */
export function ThreeWayToggle({
  value,
  onChange,
  options,
  trackClass,
  label,
}: {
  value: number;
  onChange: (index: number) => void;
  options: { icon: ComponentChildren; label: string }[];
  trackClass?: string;
  label?: string | undefined;
}) {
  const labelledBy = useContext(ControlLabelId);
  const name = useId();
  const count = options.length;
  const slotW = 32;
  const gap = 2;
  const totalW = slotW * count + gap * 2;
  const knobOffset = gap + value * slotW;

  return (
    <div
      class={`relative inline-flex items-center rounded-full ${trackClass ?? "bg-neutral-100 dark:bg-neutral-700"}`}
      style={{ width: `${totalW}px`, height: "32px" }}
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
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
          <label
            class={`relative z-10 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 dark:has-[:focus-visible]:outline-blue-400 ${
              value === i
                ? "text-neutral-800 dark:text-neutral-900"
                : "text-black dark:text-white opacity-40"
            }`}
            style={{ width: `${slotW}px`, height: "32px" }}
          >
            <input
              type="radio"
              class="sr-only"
              name={name}
              checked={value === i}
              onChange={() => onChange(i)}
              aria-label={opt.label}
            />
            {opt.icon}
          </label>
        </Tooltip>
      ))}
    </div>
  );
}
