import TaskList from "@tiptap/extension-task-list";

// markdown-it is a transitive dep (via tiptap-markdown); we keep its types
// opaque here to avoid taking a direct dependency on it.
// biome-ignore lint/suspicious/noExplicitAny: intentionally loose
type MdToken = any;
// biome-ignore lint/suspicious/noExplicitAny: intentionally loose
type MdState = any;
// biome-ignore lint/suspicious/noExplicitAny: intentionally loose
type MdInstance = any;
// biome-ignore lint/suspicious/noExplicitAny: intentionally loose
type TokenCtor = any;

function attrSet(token: MdToken, name: string, value: string): void {
  const idx = token.attrIndex(name);
  if (idx < 0) token.attrPush([name, value]);
  else token.attrs[idx] = [name, value];
}

function parentIndex(tokens: MdToken[], index: number): number {
  const target = tokens[index].level - 1;
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].level === target) return i;
  }
  return -1;
}

function checkboxMarkerLength(content: string): number | null {
  if (content === "[ ]" || content === "[x]" || content === "[X]") return 3;
  if (
    content.startsWith("[ ] ") ||
    content.startsWith("[x] ") ||
    content.startsWith("[X] ")
  ) {
    return 4;
  }
  return null;
}

function isTaskItem(tokens: MdToken[], i: number): number | null {
  if (tokens[i]?.type !== "inline") return null;
  if (tokens[i - 1]?.type !== "paragraph_open") return null;
  if (tokens[i - 2]?.type !== "list_item_open") return null;
  return checkboxMarkerLength(tokens[i].content);
}

function makeCheckboxToken(content: string, Token: TokenCtor): MdToken {
  const checkbox = new Token("html_inline", "", 0);
  const checked = content.startsWith("[x]") || content.startsWith("[X]");
  checkbox.content = checked
    ? '<input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">'
    : '<input class="task-list-item-checkbox" disabled="" type="checkbox">';
  return checkbox;
}

function lenientTaskListsPlugin(md: MdInstance): void {
  md.core.ruler.after("inline", "manifesto-task-lists", (state: MdState) => {
    const tokens: MdToken[] = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const markerLen = isTaskItem(tokens, i);
      if (markerLen === null) continue;

      const inline = tokens[i];
      const checkbox = makeCheckboxToken(inline.content, state.Token);
      inline.children.unshift(checkbox);
      if (inline.children[1]) {
        inline.children[1].content =
          inline.children[1].content.slice(markerLen);
      }
      inline.content = inline.content.slice(markerLen);

      attrSet(tokens[i - 2], "class", "task-list-item");
      const parent = parentIndex(tokens, i - 2);
      if (parent >= 0) attrSet(tokens[parent], "class", "contains-task-list");
    }
  });
}

/**
 * CommonMark parses blank lines between list items as a single "loose" list
 * with each item wrapped in <p>. Users expect blank lines between task-list
 * items to separate them into distinct lists (matching renderers like VS Code).
 * Split loose task lists into tight single-item lists joined by empty
 * paragraphs.
 */
function splitLooseTaskLists(root: Element): void {
  const lists = Array.from(
    root.querySelectorAll<HTMLElement>(".contains-task-list"),
  );
  for (const list of lists) {
    const items = Array.from(list.children).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.classList.contains("task-list-item"),
    );
    const loose = items.some((item) =>
      Array.from(item.children).some((c) => c.tagName === "P"),
    );
    if (!loose || items.length <= 1) continue;

    for (const item of items) {
      const p = Array.from(item.children).find((c) => c.tagName === "P");
      if (p) {
        while (p.firstChild) item.insertBefore(p.firstChild, p);
        p.remove();
      }
    }

    const parent = list.parentNode;
    if (!parent) continue;
    const pieces: Node[] = [];
    items.forEach((item, idx) => {
      if (idx > 0) pieces.push(document.createElement("p"));
      const wrapper = document.createElement(list.tagName);
      for (const attr of Array.from(list.attributes)) {
        wrapper.setAttribute(attr.name, attr.value);
      }
      wrapper.appendChild(item);
      pieces.push(wrapper);
    });
    for (const piece of pieces) parent.insertBefore(piece, list);
    parent.removeChild(list);
  }
}

export const TaskListMarkdown = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MdInstance) {
            md.use(lenientTaskListsPlugin);
          },
          updateDOM(element: Element) {
            for (const list of element.querySelectorAll(
              ".contains-task-list",
            )) {
              list.setAttribute("data-type", "taskList");
            }
            splitLooseTaskLists(element);
          },
        },
      },
    };
  },
});
