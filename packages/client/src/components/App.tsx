import { effect } from "@preact/signals";
import { Upload } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useBoardShortcuts } from "../hooks/useBoardShortcuts.js";
import { useMarqueeSelection } from "../hooks/useMarqueeSelection.js";
import { useScrollAwayBar } from "../hooks/useScrollAwayBar.js";
import { plural, t } from "../i18n/index.js";
import { startAppSocket } from "../realtime/appSocket.js";
import { decodeShareFromHash, type SharedNotePayload } from "../sharing.js";
import { startAccountLocaleReport } from "../state/accountLocale.js";
import { checkForUpdate } from "../state/admin.js";
import {
  authToken,
  consumeOidcRedirect,
  currentUser,
  fetchAuthMethods,
  isServerMode,
  refreshCurrentUser,
} from "../state/auth.js";
import { initAutoNotes } from "../state/autoNotes.js";
import { initBoardBackground } from "../state/board.js";
import { takeIncomingShare } from "../state/incomingShare.js";
import {
  activeView,
  createNote,
  editingNoteId,
  importNotes,
  initRouter,
  loadNotes,
  notes,
  selectMode,
  showError,
  showShortcuts,
  showSuccess,
  showWelcome,
  stickyTopBar,
  updateNote,
  viewMode,
} from "../state/index.js";
import { initReminderScheduler } from "../state/reminderScheduler.js";
import { loadInvitations } from "../state/sharing.js";
import { restoreVersions } from "../state/versions.js";
import { welcomeIfNew } from "../state/welcome.js";
import { importFiles, isImportableFile } from "../utils/importExport.js";
import { AdminView } from "./AdminView.js";
import { AutoNotesView } from "./AutoNotesView.js";
import { ConfirmDialogHost } from "./ConfirmDialog.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { Header } from "./Header.js";
import { InvitationList } from "./InvitationList.js";
import { LoginScreen } from "./LoginScreen.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { ReminderBanner } from "./ReminderBanner.js";
import { SearchView } from "./SearchView.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { ShareDialogHost } from "./ShareDialog.js";
import { SharedNoteDialog } from "./SharedNoteDialog.js";
import { ShortcutsDialog } from "./ShortcutsDialog.js";
import { MobileNav, Sidebar } from "./Sidebar.js";
import { TagsView } from "./TagsView.js";
import { Toasts } from "./Toast.js";
import { WelcomeDialog } from "./WelcomeDialog.js";

// True only on the *very first render* of a page that landed with `#token=`
// in the URL. The OIDC consumer runs once (in useEffect, after this render
// commits). Without this gate, LoginScreen would flash on top of the
// callback page before `consumeOidcRedirect` resolves.
const oidcInFlight =
  typeof window !== "undefined" &&
  isServerMode &&
  window.location.hash.includes("token=");

export function App() {
  const ready = useOidcRedirectOnce(oidcInFlight);
  if (!ready) return null;
  if (isServerMode && authToken.value === null) {
    return <LoginScreen />;
  }
  return <MainApp />;
}

function useOidcRedirectOnce(blockUntilDone: boolean): boolean {
  const [done, setDone] = useState(!blockUntilDone);
  useEffect(() => {
    void consumeOidcRedirect().finally(() => setDone(true));
  }, []);
  return done;
}

function MainApp() {
  const [sharedNote, setSharedNote] = useState<SharedNotePayload | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const marquee = useMarqueeSelection(mainRef);
  const topBarRef = useRef<HTMLDivElement>(null);
  const scrollAway = !stickyTopBar.value;
  const topBarHeight = useScrollAwayBar(
    mainRef,
    topBarRef,
    scrollAway,
    selectMode.value,
  );
  useBoardShortcuts();
  // Whether the saved user has been checked against the server. Admin rights
  // can change while signed out, so the `/admin` route waits for the answer
  // before deciding someone does not belong on it.
  const [userChecked, setUserChecked] = useState(!isServerMode);

  useEffect(() => {
    initRouter();
    startAppSocket();
    loadNotes();
    const stopAutoNotes = initAutoNotes();
    const stopBoardBackground = initBoardBackground();
    initReminderScheduler({
      notes: () => notes.value,
      subscribe: (listener) => effect(() => listener(notes.value)),
      updateNote: (id, changes) => {
        void updateNote(id, changes);
      },
    });
    const openHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId: string }>).detail;
      if (detail?.noteId) editingNoteId.value = detail.noteId;
    };
    window.addEventListener("reminder:open-note", openHandler);
    // A notification tapped with no window open starts the app on
    // `?note=<id>` (sw.ts). Taken once and removed, so a reload does not open
    // the note again.
    const launchUrl = new URL(window.location.href);
    const launchNoteId = launchUrl.searchParams.get("note");
    if (launchNoteId) {
      editingNoteId.value = launchNoteId;
      launchUrl.searchParams.delete("note");
      history.replaceState(history.state, "", launchUrl.href);
    }
    void takeIncomingShare();
    const payload = decodeShareFromHash(window.location.hash);
    if (payload) setSharedNote(payload);
    welcomeIfNew();
    if (isServerMode) {
      void refreshCurrentUser().finally(() => setUserChecked(true));
      void fetchAuthMethods();
      void loadInvitations();
    }
    const stopLocaleReport = startAccountLocaleReport();
    return () => {
      stopLocaleReport();
      window.removeEventListener("reminder:open-note", openHandler);
      stopAutoNotes();
      stopBoardBackground();
    };
  }, []);

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImportableFile);
      if (files.length === 0) {
        showError(t("settings.data.importFailed"));
        return;
      }
      const summary = await importFiles(files, {
        createNote: (input) => createNote(input),
        importBulk: (n) => importNotes(n),
        importVersions: (versions) => restoreVersions(versions),
      });
      if (summary.bulkCount > 0) {
        showSuccess(plural("settings.data.importedCount", summary.bulkCount));
      } else if (summary.singleCount === 1) {
        showSuccess(t("settings.data.importedSingle"));
      } else if (summary.singleCount > 1) {
        showSuccess(plural("settings.data.importedCount", summary.singleCount));
      }
      if (
        summary.failedCount > 0 &&
        summary.bulkCount + summary.singleCount === 0
      ) {
        showError(t("settings.data.importFailed"));
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const isAdmin = isServerMode && currentUser.value?.isAdmin === true;
  const isAdminView = activeView.value === "admin";

  useEffect(() => {
    if (isAdminView && userChecked && !isAdmin) activeView.value = "active";
  }, [isAdminView, userChecked, isAdmin]);

  // An admin hears about a newer release in the account menu.
  useEffect(() => {
    if (userChecked && isAdmin) void checkForUpdate();
  }, [userChecked, isAdmin]);

  const isTagsView = activeView.value === "tags";
  const isSearchView = activeView.value === "search";
  const isAutoNotesView = activeView.value === "autoNotes";
  const isActive = activeView.value === "active";
  const isList = viewMode.value === "list";

  return (
    <div class="relative flex flex-col h-dvh overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* On a phone with the top bar set to scroll away, it lies over the
          board and `useScrollAwayBar` moves it up as the board scrolls. */}
      <div
        ref={topBarRef}
        class={
          scrollAway
            ? "relative z-20 shrink-0 max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:[transform:translateY(calc(-1*var(--bar-shift,0px)))]"
            : "contents"
        }
      >
        <Header />
        <MobileNav />
      </div>
      <div class="flex flex-1 overflow-hidden relative z-0">
        <Sidebar />
        <main
          ref={mainRef}
          class={`board flex-1 overflow-y-auto px-4 md:px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))] ${isActive ? "pt-4 md:pt-0 md:-mt-4" : "pt-2"}`}
        >
          {topBarHeight > 0 && (
            <div
              aria-hidden="true"
              class="md:hidden"
              style={{ height: `${topBarHeight}px` }}
            />
          )}
          {isAdminView ? (
            isAdmin && <AdminView />
          ) : isSearchView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <SearchView />
                <NoteGrid />
              </div>
            ) : (
              <>
                <SearchView />
                <NoteGrid />
              </>
            )
          ) : isTagsView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <TagsView />
                <NoteGrid />
              </div>
            ) : (
              <>
                <TagsView />
                <NoteGrid />
              </>
            )
          ) : isAutoNotesView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <AutoNotesView />
              </div>
            ) : (
              <AutoNotesView />
            )
          ) : isList ? (
            <div class="max-w-xl mx-auto">
              <NoteInput />
              {isActive && <InvitationList />}
              <NoteGrid />
            </div>
          ) : (
            <>
              <NoteInput />
              {isActive && <InvitationList />}
              <NoteGrid />
            </>
          )}
        </main>
      </div>
      {marquee && (
        <div
          aria-hidden="true"
          class="fixed z-30 pointer-events-none rounded-sm border border-blue-500 bg-blue-500/10"
          style={{
            left: `${marquee.left}px`,
            top: `${marquee.top}px`,
            width: `${Math.max(0, marquee.right - marquee.left)}px`,
            height: `${Math.max(0, marquee.bottom - marquee.top)}px`,
          }}
        />
      )}
      <SettingsDialog />
      <ShareDialogHost />
      <ConfirmDialogHost />
      <ReminderBanner />
      <ConnectionStatus />
      <Toasts />
      {sharedNote && (
        <SharedNoteDialog
          payload={sharedNote}
          onDone={() => setSharedNote(null)}
        />
      )}
      {/* After a shared note, not on top of it: the link is why they came. */}
      {showWelcome.value && !sharedNote && <WelcomeDialog />}
      {showShortcuts.value && <ShortcutsDialog />}
      {dragActive && (
        <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-blue-500/10 backdrop-blur-[2px]">
          <div class="m-6 px-8 py-6 rounded-2xl border-2 border-dashed border-blue-500 bg-white/90 dark:bg-neutral-800/90 shadow-xl flex flex-col items-center gap-2 text-center">
            <Upload class="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <p class="text-lg font-semibold">{t("dropZone.title")}</p>
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("dropZone.hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
