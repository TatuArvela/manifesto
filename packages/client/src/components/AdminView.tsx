import type { AdminUser } from "@manifesto/shared";
import {
  Check,
  Copy,
  KeyRound,
  MoreVertical,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { formatDate, plural, t } from "../i18n/index.js";
import {
  adminUsers,
  createAccount,
  deleteAccount,
  type IssuedPassword,
  issuedPassword,
  loadAdminUsers,
  resetAccountPassword,
  setAccountAdmin,
} from "../state/admin.js";
import {
  authProviderName,
  currentUser,
  fetchAuthMethods,
} from "../state/auth.js";
import { Avatar } from "./Avatar.js";
import { Dropdown } from "./Dropdown.js";
import { menuItemClass, menuPanelClass } from "./NoteMenu.js";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer";
const dangerButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 cursor-pointer";

/**
 * `/admin`: every account on the server, for an admin to create, reset,
 * promote and delete.
 *
 * Only rendered for an admin in connected mode (`App` sees to that), but the
 * server decides: a request from someone who has lost admin since the page
 * loaded is refused, and `state/admin.ts` takes them back to their notes.
 */
export function AdminView() {
  const users = adminUsers.value;
  const provider = authProviderName.value;
  // Accounts with passwords exist only under local sign-in. Under SSO the
  // identity provider creates them and owns their passwords.
  const passwordsHere = provider === "local";
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoadFailed(false);
    void loadAdminUsers().then((ok) => setLoadFailed(!ok));
  };

  useEffect(() => {
    load();
    if (authProviderName.value === null) void fetchAuthMethods();
    // A temporary password is shown once; leaving the view is dismissing it.
    return () => {
      issuedPassword.value = null;
    };
  }, []);

  return (
    <div
      data-marquee-ignore
      class="w-full max-w-2xl mx-auto py-4 flex flex-col gap-4"
    >
      <div class="flex items-center justify-between gap-3 min-h-9">
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          {users ? plural("admin.count", users.length) : ""}
        </p>
        {passwordsHere && !creating && (
          <button
            type="button"
            class={primaryButtonClass}
            onClick={() => setCreating(true)}
          >
            <UserPlus class="w-4 h-4" />
            {t("admin.create")}
          </button>
        )}
      </div>

      {provider === "oidc" && (
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t("admin.ssoHint")}
        </p>
      )}

      {creating && <CreateAccountForm onDone={() => setCreating(false)} />}

      {issuedPassword.value && (
        <IssuedPasswordPanel issued={issuedPassword.value} />
      )}

      {users === null ? (
        loadFailed ? (
          <div class="py-8 flex flex-col items-center gap-3 text-sm">
            <p class="text-red-600 dark:text-red-400" role="alert">
              {t("admin.error.loadFailed")}
            </p>
            <button type="button" class={secondaryButtonClass} onClick={load}>
              {t("admin.retry")}
            </button>
          </div>
        ) : (
          <p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {t("admin.loading")}
          </p>
        )
      ) : (
        <ul class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700 bg-white dark:bg-neutral-800">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUser.value?.id}
              passwordsHere={passwordsHere}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onDone);

  const submit = async (event: Event) => {
    event.preventDefault();
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    // A failure has already been reported; the form stays open to fix it.
    const created = await createAccount(name);
    setBusy(false);
    if (created) onDone();
  };

  return (
    <form
      onSubmit={submit}
      class="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 flex flex-wrap items-end gap-2"
    >
      <label class="flex-1 min-w-48">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.username")}
        </span>
        <input
          type="text"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: opened by a click to type in
          autoFocus
          maxLength={64}
          value={username}
          onInput={(e) =>
            setUsername((e.currentTarget as HTMLInputElement).value)
          }
          class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <button
        type="submit"
        class={primaryButtonClass}
        disabled={busy || username.trim().length === 0}
      >
        {t("admin.create.submit")}
      </button>
      <button type="button" class={secondaryButtonClass} onClick={onDone}>
        {t("admin.cancel")}
      </button>
    </form>
  );
}

function IssuedPasswordPanel({ issued }: { issued: IssuedPassword }) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);

  // Focus follows the new panel, so a keyboard user lands on what they came
  // for rather than on a menu that has just closed.
  useEffect(() => {
    copyRef.current?.focus();
    setCopied(false);
  }, [issued]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      // No clipboard access; the password is selectable text all the same.
    }
  };

  return (
    <section
      aria-live="polite"
      class="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 flex flex-col gap-3"
    >
      <h3 class="text-sm font-semibold text-green-900 dark:text-green-100">
        {t(
          issued.kind === "created"
            ? "admin.issued.created"
            : "admin.issued.reset",
          { username: issued.username },
        )}
      </h3>
      <p class="text-sm text-green-900/80 dark:text-green-100/80">
        {t("admin.issued.hint")}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <code class="px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-green-300 dark:border-green-800 font-mono text-base tracking-wide select-all">
          {issued.password}
        </code>
        <button
          ref={copyRef}
          type="button"
          class={secondaryButtonClass}
          onClick={copy}
        >
          {copied ? <Check class="w-4 h-4" /> : <Copy class="w-4 h-4" />}
          {copied ? t("admin.issued.copied") : t("admin.issued.copy")}
        </button>
        <button
          type="button"
          class={`${secondaryButtonClass} ml-auto`}
          onClick={() => {
            issuedPassword.value = null;
          }}
        >
          {t("admin.issued.done")}
        </button>
      </div>
    </section>
  );
}

function Badge({
  children,
  tone,
}: {
  children: string;
  tone: "blue" | "grey" | "amber";
}) {
  const tones = {
    blue: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200",
    grey: "bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200",
    amber:
      "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  };
  return (
    <span
      class={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function UserRow({
  user,
  isSelf,
  passwordsHere,
}: {
  user: AdminUser;
  isSelf: boolean;
  passwordsHere: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const canReset = passwordsHere && user.provider === "local";

  const run = async (action: () => Promise<boolean>) => {
    setMenuOpen(false);
    setBusy(true);
    await action();
    // A deleted row is already gone from the list, and nothing here outlives it.
    setBusy(false);
    setConfirming(null);
  };

  const meta = [
    plural("admin.notes", user.noteCount),
    t("admin.joined", { date: formatDate(user.createdAt) }),
    user.lastSeenAt
      ? t("admin.lastActive", { date: formatDate(user.lastSeenAt) })
      : t("admin.noSessions"),
  ].join(" · ");

  return (
    <li class="px-4 py-3">
      <div class="flex items-start gap-3">
        <Avatar
          name={user.displayName || user.username}
          color={user.avatarColor}
          class="mt-0.5 w-9 h-9 text-sm"
        />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium truncate">{user.displayName}</span>
            {user.displayName !== user.username && (
              <span class="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                {user.username}
              </span>
            )}
            {isSelf && <Badge tone="grey">{t("admin.badge.you")}</Badge>}
            {user.isAdmin && (
              <Badge tone="blue">{t("admin.badge.admin")}</Badge>
            )}
            {user.provider === "oidc" && (
              <Badge tone="grey">{t("admin.badge.sso")}</Badge>
            )}
            {user.mustChangePassword && (
              <Badge tone="amber">{t("admin.badge.temporaryPassword")}</Badge>
            )}
          </div>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {meta}
          </p>
        </div>
        {/* An admin manages other accounts; their own is in the account menu. */}
        {!isSelf && (
          <Dropdown
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            placement="bottom-end"
            panelClass={menuPanelClass}
            trigger={
              <button
                type="button"
                class="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-60 cursor-pointer"
                onClick={() => setMenuOpen(!menuOpen)}
                disabled={busy}
                aria-label={t("admin.actions", { username: user.username })}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreVertical class="w-5 h-5" />
              </button>
            }
          >
            <button
              type="button"
              class={menuItemClass}
              onClick={() => run(() => setAccountAdmin(user.id, !user.isAdmin))}
            >
              {user.isAdmin ? (
                <ShieldOff class="w-4 h-4" />
              ) : (
                <ShieldCheck class="w-4 h-4" />
              )}
              {t(user.isAdmin ? "admin.removeAdmin" : "admin.makeAdmin")}
            </button>
            {canReset && (
              <button
                type="button"
                class={menuItemClass}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirming("reset");
                }}
              >
                <KeyRound class="w-4 h-4" />
                {t("admin.resetPassword")}
              </button>
            )}
            <button
              type="button"
              class={`${menuItemClass} text-red-600 dark:text-red-400`}
              onClick={() => {
                setMenuOpen(false);
                setConfirming("delete");
              }}
            >
              <Trash2 class="w-4 h-4" />
              {t("admin.delete")}
            </button>
          </Dropdown>
        )}
      </div>

      {confirming && (
        <div class="mt-3 ml-12 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
          <p class="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
            {t(
              confirming === "delete"
                ? "admin.deleteConfirm"
                : "admin.resetConfirm",
              { username: user.username },
            )}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class={
                confirming === "delete" ? dangerButtonClass : primaryButtonClass
              }
              disabled={busy}
              onClick={() =>
                run(() =>
                  confirming === "delete"
                    ? deleteAccount(user.id)
                    : resetAccountPassword(user.id),
                )
              }
            >
              {t(
                confirming === "delete"
                  ? "admin.delete"
                  : "admin.resetPassword",
              )}
            </button>
            <button
              type="button"
              class={secondaryButtonClass}
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              {t("admin.cancel")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
