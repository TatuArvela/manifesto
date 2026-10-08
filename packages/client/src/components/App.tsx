import { effect } from "@preact/signals";
import { Upload } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useBoardShortcuts } from "../hooks/useBoardShortcuts.js";
import { useMarqueeSelection } from "../hooks/useMarqueeSelection.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useScrollAwayBar } from "../hooks/useScrollAwayBar.js";
import { plural, t } from "../i18n/index.js";
import { startAppSocket } from "../realtime/appSocket.js";
import { revealApp } from "../splash.js";
import { startAccountLocaleReport } from "../state/accountLocale.js";
import { checkForUpdate } from "../state/admin.js";
import {
  authToken,
  consumeOidcRedirect,
  currentUser,
  fetchCapabilities,
  isServerMode,
  refreshCurrentUser,
  takeSignInLinkToken,
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
import { takeConsentPage } from "../state/oauth.js";
import { startPrefsSync } from "../state/prefsSync.js";
import { ensurePushSubscription } from "../state/pushSubscription.js";
import { initReminderScheduler } from "../state/reminderScheduler.js";
import { loadInvitations } from "../state/sharing.js";
import { restoreVersions } from "../state/versions.js";
import { welcomeIfNew } from "../state/welcome.js";
import { importFiles, isImportableFile } from "../utils/importExport.js";
import {
  decodeShareFromHash,
  type SharedNotePayload,
} from "../utils/shareLink.js";
import { AutoNotesView } from "./AutoNotesView.js";
import { AdminView } from "./admin/AdminView.js";
import { ConfirmDialogHost } from "./ConfirmDialog.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { Header } from "./Header.js";
import { InvitationList } from "./InvitationList.js";
import { LoginScreen } from "./LoginScreen.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { PublicLinksDialogHost } from "./PublicLinksDialog.js";
import { ReminderBanner } from "./ReminderBanner.js";
import { SearchView } from "./SearchView.js";
import { ShareDialogHost } from "./ShareDialog.js";
import { SharedNoteDialog } from "./SharedNoteDialog.js";
import { ShortcutsDialog } from "./ShortcutsDialog.js";
import { MobileNav, Sidebar } from "./Sidebar.js";
import { SettingsDialog } from "./settings/SettingsDialog.js";
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
  const signIn = ready && isServerMode && authToken.value === null;
  useEffect(() => {
    if (signIn) revealApp();
    // A mailed link opened where someone is signed in already has nothing to
    // do, and `LoginScreen` is not there to take its token. Left in the
    // address it would sign them back in the moment they signed out.
    else if (ready) takeSignInLinkToken();
  }, [signIn, ready]);
  if (!ready) return null;
  if (signIn) {
    return <LoginScreen />;
  }
  return <MainApp />;
}

function useOidcRedirectOnce(blockUntilDone: boolean): boolean {
  const [done, setDone] = useState(!blockUntilDone);
  useEffect(() => {
    void consumeOidcRedirect()
      .then((signedIn) => {
        // A sign-in started from an assistant's consent page comes back here,
        // where the identity provider returns everyone; send it on.
        const consent = signedIn ? takeConsentPage() : null;
        if (consent) window.location.replace(consent);
      })
      .finally(() => setDone(true));
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
    if (isServerMode) startPrefsSync();
    // The board is empty until the notes are in, so that, not this render,
    // is when the loading screen can go. A failed load is ready too: its
    // toast is what there is to see.
    void loadNotes().then(revealApp);
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
      // After the capabilities, which say whether sharing is on at all.
      void fetchCapabilities().then(() => {
        void loadInvitations();
        // A browser that already allows notifications takes up, or renews,
        // its push subscription; one that does not is asked when a reminder
        // is first saved, not here.
        void ensurePushSubscription();
      });
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
  // Where there is room for a column the tag tree is a sidebar; on a phone it
  // is a block above the notes, inside what scrolls.
  const wide = useMediaQuery("(min-width: 768px)");
  const tagsPane = isTagsView && wide;
  const tagsSurface =
    "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800";

  return (
    <>
      <div class="app-shell relative flex flex-col h-dvh overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
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
          {tagsPane && (
            // The tag tree as a sidebar of the Tags view: part of the shell
            // like the rail beside it, so the board and its notes start
            // after it and scroll without it. The outer box holds its place
            // and clips the pane as it slides in.
            <aside
              class="w-72 shrink-0 overflow-hidden z-[4]"
              aria-label={t("nav.tags")}
            >
              <div
                class={`tags-pane h-full overflow-y-auto ${tagsSurface} border-x`}
              >
                <TagsView pane />
              </div>
            </aside>
          )}
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
              <>
                {!tagsPane && (
                  // On a phone the same tree on the same surface, as a band
                  // across the top of what scrolls: out to the edges, so it
                  // reads as the shell and not as a card on the board.
                  <div
                    class={`-mx-4 -mt-2 mb-4 ${tagsSurface} border-b shadow-sm`}
                  >
                    <TagsView />
                  </div>
                )}
                {isList ? (
                  <div class="max-w-xl mx-auto">
                    <NoteGrid />
                  </div>
                ) : (
                  <NoteGrid />
                )}
              </>
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
      </div>
      {/* Outside the shell: a phone pins the shell under an open note, and
          anything inside it would be pinned under the note with it. */}
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
      <PublicLinksDialogHost />
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
    </>
  );
}
