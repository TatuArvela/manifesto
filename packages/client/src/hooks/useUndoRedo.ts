import { useRef, useState } from "preact/hooks";

interface Snapshot {
  title: string;
  content: string;
}

export function useUndoRedo(initialTitle: string, initialContent: string) {
  const [title, setTitleState] = useState(initialTitle);
  const [content, setContentState] = useState(initialContent);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const titleRef = useRef(initialTitle);
  const contentRef = useRef(initialContent);
  const historyRef = useRef<Snapshot[]>([
    { title: initialTitle, content: initialContent },
  ]);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRedoingRef = useRef(false);

  const updateAbilities = () => {
    const snap = historyRef.current[indexRef.current];
    const hasPending =
      titleRef.current !== snap.title || contentRef.current !== snap.content;
    setCanUndo(indexRef.current > 0 || hasPending);
    setCanRedo(indexRef.current < historyRef.current.length - 1);
  };

  const pushSnapshot = () => {
    const snap = historyRef.current[indexRef.current];
    if (
      titleRef.current === snap.title &&
      contentRef.current === snap.content
    ) {
      return;
    }
    historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
    historyRef.current.push({
      title: titleRef.current,
      content: contentRef.current,
    });
    indexRef.current = historyRef.current.length - 1;
    updateAbilities();
  };

  const scheduleSnapshot = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      pushSnapshot();
      timerRef.current = null;
    }, 500);
    updateAbilities();
  };

  const setTitle = (newTitle: string) => {
    titleRef.current = newTitle;
    setTitleState(newTitle);
    if (!undoRedoingRef.current) scheduleSnapshot();
  };

  const setContent = (newContent: string) => {
    contentRef.current = newContent;
    setContentState(newContent);
    if (!undoRedoingRef.current) scheduleSnapshot();
  };

  const flushPending = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pushSnapshot();
  };

  const undo = () => {
    flushPending();
    if (indexRef.current <= 0) return;
    undoRedoingRef.current = true;
    indexRef.current--;
    const snap = historyRef.current[indexRef.current];
    titleRef.current = snap.title;
    contentRef.current = snap.content;
    setTitleState(snap.title);
    setContentState(snap.content);
    updateAbilities();
    undoRedoingRef.current = false;
  };

  const redo = () => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    undoRedoingRef.current = true;
    indexRef.current++;
    const snap = historyRef.current[indexRef.current];
    titleRef.current = snap.title;
    contentRef.current = snap.content;
    setTitleState(snap.title);
    setContentState(snap.content);
    updateAbilities();
    undoRedoingRef.current = false;
  };

  const reset = (newTitle: string, newContent: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    titleRef.current = newTitle;
    contentRef.current = newContent;
    historyRef.current = [{ title: newTitle, content: newContent }];
    indexRef.current = 0;
    setTitleState(newTitle);
    setContentState(newContent);
    setCanUndo(false);
    setCanRedo(false);
  };

  return {
    title,
    content,
    setTitle,
    setContent,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
  };
}
