import type { ComponentType, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { SELECTIONS, SHAPES, Tool } from "./tools.ts";

export const barButton =
  "p-2 rounded-lg text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

const toolOn =
  "p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 cursor-pointer";

export function ToolButton({
  on,
  onClick,
  Icon,
  label,
  shortcut,
}: {
  on: boolean;
  onClick: () => void;
  Icon: ComponentType<{ class?: string }>;
  label: string;
  /** The key that picks the tool, shown after the name in the tooltip. */
  shortcut?: string | undefined;
}) {
  return (
    <Tooltip label={shortcut ? `${label} (${shortcut})` : label}>
      <button
        type="button"
        class={on ? toolOn : barButton}
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
      >
        <Icon class="w-5 h-5" />
      </button>
    </Tooltip>
  );
}

type ToolItem = (typeof SHAPES | typeof SELECTIONS)[number];

/**
 * A button for a group of tools, with the icon of the tool of the group in
 * use, and the menu of the group that it opens. A choice, Escape or a press
 * outside the menu closes it.
 */
export function ToolGroup({
  label,
  items,
  Fallback,
  tool,
  open,
  onToggle,
  onTool,
  onClose,
}: {
  label: string;
  items: readonly ToolItem[];
  /** The icon while no tool of the group is in use. */
  Fallback: ComponentType<{ class?: string }>;
  tool: Tool;
  open: boolean;
  onToggle: () => void;
  onTool: (tool: Tool) => void;
  onClose: () => void;
}) {
  const area = useRef<HTMLSpanElement>(null);
  const current = items.find((each) => each.tool === tool);
  const Icon = current?.Icon ?? Fallback;
  return (
    <span class="relative" ref={area}>
      <Tooltip label={label}>
        <button
          type="button"
          class={current ? toolOn : barButton}
          onClick={onToggle}
          aria-label={label}
          aria-expanded={open}
        >
          <Icon class="w-5 h-5" />
        </button>
      </Tooltip>
      {open && (
        <ToolMenu
          label={label}
          items={items}
          tool={tool}
          within={area}
          onTool={onTool}
          onClose={onClose}
        />
      )}
    </span>
  );
}

function ToolMenu({
  label,
  items,
  tool,
  within,
  onTool,
  onClose,
}: {
  label: string;
  items: readonly ToolItem[];
  tool: Tool;
  /** The menu with its button. A press anywhere else closes the menu. */
  within: RefObject<HTMLElement | null>;
  onTool: (tool: Tool) => void;
  onClose: () => void;
}) {
  useEscapeStack(true, onClose);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const area = within.current;
      if (area && !area.contains(event.target as Node)) onClose();
    };
    // Capture: the canvas takes its pointer events, and they do not bubble.
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [within, onClose]);
  return (
    <fieldset
      class="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 flex gap-1 rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 md:left-full md:top-0 md:bottom-auto md:translate-x-0 md:mb-0 md:ml-2"
      aria-label={label}
    >
      {items.map((item) => (
        <ToolButton
          key={item.tool}
          on={tool === item.tool}
          onClick={() => {
            onTool(item.tool);
            onClose();
          }}
          Icon={item.Icon}
          label={t(item.label)}
          shortcut={"key" in item ? item.key : undefined}
        />
      ))}
    </fieldset>
  );
}
