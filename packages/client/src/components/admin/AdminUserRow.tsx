import type { AdminUser } from "@manifesto/shared";
import {
  AtSign,
  KeyRound,
  MoreVertical,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { Avatar } from "#/components/Avatar.tsx";
import { buttonClass } from "#/components/buttonClasses.ts";
import { menuItemClass, menuPanelClass } from "#/components/card/NoteMenu.tsx";
import { Dropdown } from "#/components/Dropdown.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { formatDate, plural, t } from "#/i18n/index.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import {
  type AdminChange,
  deleteAccount,
  resetAccountPassword,
  setAccountAdmin,
  setAccountEmail,
} from "#/state/admin.ts";
import {
  AdminConfirmation,
  fieldClass,
  refusalIn,
} from "./AdminConfirmation.tsx";

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

export function UserRow({
  user,
  isSelf,
  passwordsHere,
}: {
  user: AdminUser;
  isSelf: boolean;
  passwordsHere: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState<
    "admin" | "reset" | "delete" | "email" | null
  >(null);
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [busy, setBusy] = useState(false);
  const canReset = passwordsHere && user.provider === "local";

  const ask = (what: "admin" | "reset" | "delete" | "email") => {
    setMenuOpen(false);
    setPassword("");
    setRefusal(null);
    setConfirming(what);
  };

  const run = async (action: () => Promise<AdminChange>) => {
    setBusy(true);
    const result = await action();
    // A deleted row is already gone from the list, and nothing here stays after
    // it. A refusal keeps the question open, with the reason under it.
    setBusy(false);
    const refused = refusalIn(result);
    setRefusal(refused);
    if (!refused) setConfirming(null);
  };

  const confirmed = (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (confirming === "admin") {
      void run(() => setAccountAdmin(user.id, !user.isAdmin, password));
    } else if (confirming === "delete") {
      void run(() => deleteAccount(user.id, password));
    } else if (confirming === "reset") {
      void run(() => resetAccountPassword(user.id, password));
    }
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
          {user.email && (
            <p class="mt-0.5 text-sm text-neutral-600 dark:text-neutral-300 truncate">
              {user.email}
            </p>
          )}
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
              onClick={() => ask("admin")}
            >
              {user.isAdmin ? (
                <ShieldOff class="w-4 h-4" />
              ) : (
                <ShieldCheck class="w-4 h-4" />
              )}
              {t(user.isAdmin ? "admin.removeAdmin" : "admin.makeAdmin")}
            </button>
            <button
              type="button"
              class={menuItemClass}
              onClick={() => ask("email")}
            >
              <AtSign class="w-4 h-4" />
              {t("admin.changeEmail")}
            </button>
            {canReset && (
              <button
                type="button"
                class={menuItemClass}
                onClick={() => ask("reset")}
              >
                <KeyRound class="w-4 h-4" />
                {t("admin.resetPassword")}
              </button>
            )}
            <button
              type="button"
              class={`${menuItemClass} text-red-600 dark:text-red-400`}
              onClick={() => ask("delete")}
            >
              <Trash2 class="w-4 h-4" />
              {t("admin.delete")}
            </button>
          </Dropdown>
        )}
      </div>

      {confirming === "email" && (
        <EmailForm user={user} onDone={() => setConfirming(null)} />
      )}

      {(confirming === "admin" ||
        confirming === "reset" ||
        confirming === "delete") && (
        <form
          onSubmit={confirmed}
          class="mt-3 ml-12 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600 flex flex-wrap items-end gap-2"
        >
          <p class="w-full text-sm text-neutral-600 dark:text-neutral-300 mb-1">
            {t(
              confirming === "delete"
                ? "admin.deleteConfirm"
                : confirming === "reset"
                  ? "admin.resetConfirm"
                  : user.isAdmin
                    ? "admin.removeAdminConfirm"
                    : "admin.makeAdminConfirm",
              { username: user.username },
            )}
          </p>
          <AdminConfirmation
            password={password}
            onPassword={setPassword}
            refusal={refusal}
          />
          <button
            type="submit"
            class={
              confirming === "delete"
                ? buttonClass("danger", "sm")
                : buttonClass("primary", "sm")
            }
            disabled={busy}
          >
            {t(
              confirming === "delete"
                ? "admin.delete"
                : confirming === "reset"
                  ? "admin.resetPassword"
                  : user.isAdmin
                    ? "admin.removeAdmin"
                    : "admin.makeAdmin",
            )}
          </button>
          <button
            type="button"
            class={buttonClass("secondary", "sm")}
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            {t("admin.cancel")}
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * An admin sets the address of a person, for an account created without one, or
 * with one that belongs to a different person. With single sign-on, the next
 * sign-in brings back the address of the identity provider.
 */
function EmailForm({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onDone);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const next = email.trim();
    // A failure was already reported. The form stays open, so that you can
    // correct it.
    const saved = await setAccountEmail(
      user.id,
      next.length > 0 ? next : null,
      password,
    );
    setBusy(false);
    setRefusal(refusalIn(saved));
    if (saved === "done") onDone();
  };

  return (
    <form
      onSubmit={submit}
      class="mt-3 ml-12 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600 flex flex-wrap items-end gap-2"
    >
      <label class="flex-1 min-w-48">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.email")}
        </span>
        <input
          type="email"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: opened by a click to type in
          autoFocus
          maxLength={254}
          value={email}
          onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
          class={fieldClass}
        />
      </label>
      <AdminConfirmation
        password={password}
        onPassword={setPassword}
        refusal={refusal}
      />
      <button
        type="submit"
        class={buttonClass("primary", "sm")}
        disabled={busy}
      >
        {t("admin.saveEmail")}
      </button>
      <button
        type="button"
        class={buttonClass("secondary", "sm")}
        onClick={onDone}
      >
        {t("admin.cancel")}
      </button>
    </form>
  );
}
