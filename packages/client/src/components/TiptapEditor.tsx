import { type Editor, Extension } from "@tiptap/core";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "preact/hooks";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { TaskItemDraggable } from "../extensions/TaskItemDraggable.js";
import { TaskListMarkdown } from "../extensions/TaskListMarkdown.js";
import { useTiptapEditor } from "../hooks/useTiptapEditor.js";

export function getMarkdown(editor: Editor): string {
  // tiptap-markdown stores its API in editor.storage.markdown
  const md =
    // biome-ignore lint/suspicious/noExplicitAny: tiptap storage is loosely typed
    ((editor.storage as any).markdown as MarkdownStorage).getMarkdown();
  // prosemirror-markdown escapes [ ] as \[ \] per CommonMark spec, but our
  // content uses literal brackets (e.g. "Post [ ] Maa") so we unescape them.
  return md.replace(/\\([[\]])/g, "$1");
}

/**
 * tiptap-markdown's tight-lists extension only covers bulletList and orderedList.
 * This extension adds the tight attribute to taskList so task items don't get
 * extra blank lines between them.
 */
const TaskListTight = Extension.create({
  name: "taskListTight",
  addGlobalAttributes() {
    return [
      {
        types: ["taskList"],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element) =>
              element.getAttribute("data-tight") === "true" ||
              !element.querySelector("p"),
            renderHTML: (attributes) => ({
              "data-tight": attributes.tight ? "true" : null,
            }),
          },
        },
      },
    ];
  },
});

export const tiptapExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    link: { openOnClick: false },
  }),
  Subscript,
  Superscript,
  TaskListMarkdown,
  TaskItemDraggable.configure({
    nested: true,
    onReadOnlyChecked: () => true,
  }),
  TaskListTight,
  Markdown.configure({
    html: true,
    transformPastedText: true,
  }),
];

interface TiptapEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  contentLocked?: boolean;
  rawMode?: boolean;
  autoFocus?: boolean;
  onEditorReady?: (editor: Editor) => void;
}

export function TiptapEditor({
  content,
  onChange,
  disabled,
  contentLocked,
  rawMode,
  autoFocus,
  onEditorReady,
}: TiptapEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const initialContentRef = useRef(content);

  // Track raw mode textarea state
  const [rawContent, setRawContent] = useState(content);

  const { editor, mountRef } = useTiptapEditor(
    {
      extensions: tiptapExtensions,
      content: initialContentRef.current,
      editable: !disabled && !contentLocked,
      autofocus: autoFocus ? "end" : false,
      onUpdate: ({ editor: ed }) => {
        onChangeRef.current(getMarkdown(ed));
      },
    },
    [],
  );

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor) {
      onEditorReadyRef.current?.(editor);
    }
  }, [editor]);

  // Sync editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled && !contentLocked);
    }
  }, [editor, disabled, contentLocked]);

  // Handle raw mode transitions
  useEffect(() => {
    if (!editor) return;
    if (rawMode) {
      // Entering raw mode: serialize current content
      setRawContent(getMarkdown(editor));
    } else {
      // Exiting raw mode: load raw content back into editor
      editor.commands.setContent(rawContent);
      onChangeRef.current(rawContent);
    }
  }, [rawMode]);

  const rawRows = Math.max(5, rawContent.split("\n").length);

  return (
    <>
      <textarea
        class="w-full p-2 bg-transparent outline-none resize-none font-mono text-sm"
        style={{ display: rawMode ? "" : "none" }}
        rows={rawRows}
        value={rawContent}
        onInput={(e) => {
          const val = (e.target as HTMLTextAreaElement).value;
          setRawContent(val);
          onChangeRef.current(val);
        }}
        disabled={disabled}
      />
      <div
        ref={mountRef}
        class="tiptap-editor w-full outline-none text-sm"
        style={{ display: rawMode ? "none" : "" }}
      />
    </>
  );
}
