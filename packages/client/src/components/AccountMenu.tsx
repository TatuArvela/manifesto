import {
  AtSign,
  KeyRound,
  KeySquare,
  LogOut,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import {
  authProviderName,
  changePassword,
  currentUser,
  isServerMode,
  logout,
  updateEmail,
  webhooksEnabled,
} from "../state/auth.js";
import { activeView, showSuccess } from "../state/ui.js";
import { ApiTokensDialog } from "./ApiTokensDialog.js";
import { Avatar } from "./Avatar.js";
import { Dropdown } from "./Dropdown.js";
import { menuDividerClass, menuItemClass, menuPanelClass } from "./NoteMenu.js";
import { Tooltip } from "./Tooltip.js";
import { TwoFactorDialog } from "./TwoFactorDialog.js";
import { WebhooksDialog } from "./WebhooksDialog.js";

/**
 * The signed-in user, at the right end of the header: who you are, and what
 * you can do about it. Open mode has no accounts, so there it renders nothing
 * at all rather than an empty menu.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [managingTokens, setManagingTokens] = useState(false);
  const [managingWebhooks, setManagingWebhooks] = useState(false);
  const [managingTwoFactor, setManagingTwoFactor] = useState(false);
  const user = currentUser.value;
  if (!isServerMode || !user) return null;

  const name = user.displayName || user.username;
  // Under single sign-on the identity provider owns the password, and the
  // email address too.
  // With both kinds of sign-in on, that is a question about this account;
  // a server from before it could answer says it through its provider.
  const hasPassword = user.hasPassword ?? authProviderName.value === "local";

  return (
    <>
      <Dropdown
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        panelClass={menuPanelClass}
        trigger={
          <Tooltip label={t("account.menu")}>
            <button
              type="button"
              class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              onClick={() => setOpen(!open)}
              aria-label={t("account.menu")}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <Avatar
                name={name}
                color={user.avatarColor}
                class="w-7 h-7 text-xs"
              />
            </button>
          </Tooltip>
        }
      >
        <div class="px-3 pt-1.5 pb-2 max-w-64">
          <p class="text-sm font-medium truncate">{name}</p>
          {name !== user.username && (
            <p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {user.username}
            </p>
          )}
          {user.email && (
            <p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {user.email}
            </p>
          )}
        </div>
        <div class={menuDividerClass} />
        {user.isAdmin && (
          <button
            type="button"
            class={menuItemClass}
            onClick={() => {
              setOpen(false);
              activeView.value = "admin";
            }}
          >
            <Users class="w-4 h-4" />
            {t("account.manageUsers")}
          </button>
        )}
        {hasPassword && (
          <button
            type="button"
            class={menuItemClass}
            onClick={() => {
              setOpen(false);
              setChangingEmail(true);
            }}
          >
            <AtSign class="w-4 h-4" />
            {t("account.email")}
          </button>
        )}
        {hasPassword && (
          <button
            type="button"
            class={menuItemClass}
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
          >
            <KeyRound class="w-4 h-4" />
            {t("account.changePassword")}
          </button>
        )}
        {hasPassword && (
          <button
            type="button"
            class={menuItemClass}
            onClick={() => {
              setOpen(false);
              setManagingTwoFactor(true);
            }}
          >
            <ShieldCheck class="w-4 h-4" />
            {t("twoFactor.menu")}
          </button>
        )}
        <button
          type="button"
          class={menuItemClass}
          onClick={() => {
            setOpen(false);
            setManagingTokens(true);
          }}
        >
          <KeySquare class="w-4 h-4" />
          {t("tokens.menu")}
        </button>
        {webhooksEnabled.value && (
          <button
            type="button"
            class={menuItemClass}
            onClick={() => {
              setOpen(false);
              setManagingWebhooks(true);
            }}
          >
            <Webhook class="w-4 h-4" />
            {t("webhooks.menu")}
          </button>
        )}
        <div class={menuDividerClass} />
        <button
          type="button"
          class={menuItemClass}
          onClick={() => {
            setOpen(false);
            void logout();
          }}
        >
          <LogOut class="w-4 h-4" />
          {t("login.signOut")}
        </button>
      </Dropdown>
      {changingPassword && (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      )}
      {managingTwoFactor && (
        <TwoFactorDialog onClose={() => setManagingTwoFactor(false)} />
      )}
      {managingWebhooks && (
        <WebhooksDialog onClose={() => setManagingWebhooks(false)} />
      )}
      {managingTokens && (
        <ApiTokensDialog onClose={() => setManagingTokens(false)} />
      )}
      {changingEmail && (
        <EmailDialog
          current={user.email}
          onClose={() => setChangingEmail(false)}
        />
      )}
    </>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * Change your own password. Every other session of the account ends and this
 * one carries on. The success message says so, so being signed out on another
 * device comes as no surprise.
 */
function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (current.length === 0) return setError(t("login.passwordRequired"));
    if (next.length < 8) return setError(t("login.passwordTooShort"));
    if (next !== confirm) return setError(t("login.passwordMismatch"));
    if (next === current) return setError(t("account.samePassword"));
    setError(null);
    setBusy(true);
    const result = await changePassword(current, next);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t("account.passwordChanged"));
      onClose();
      return;
    }
    setError(
      t(
        result === "wrong-password"
          ? "account.wrongPassword"
          : result === "same-password"
            ? "account.samePassword"
            : "account.changeFailed",
      ),
    );
  };

  const field = (
    label: string,
    value: string,
    set: (value: string) => void,
    autoComplete: string,
    autoFocus = false,
  ) => (
    <label class="block">
      <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
        {label}
      </span>
      <input
        type="password"
        autoComplete={autoComplete}
        // biome-ignore lint/a11y/noAutofocus: the dialog was opened to type in
        autoFocus={autoFocus}
        value={value}
        onInput={(e) => set((e.currentTarget as HTMLInputElement).value)}
        class={inputClass}
      />
    </label>
  );

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div
        class="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <form
          onSubmit={submit}
          class="pointer-events-auto w-full max-w-sm max-h-full overflow-y-auto rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4"
        >
          <h2 id="change-password-title" class="text-lg font-semibold">
            {t("account.changePassword")}
          </h2>
          {field(
            t("account.currentPassword"),
            current,
            setCurrent,
            "current-password",
            true,
          )}
          {field(t("login.newPassword"), next, setNext, "new-password")}
          {field(
            t("login.confirmPassword"),
            confirm,
            setConfirm,
            "new-password",
          )}
          {error && (
            <p class="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={onClose}
            >
              {t("account.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              class="px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
            >
              {busy ? t("login.submitting") : t("account.changePassword")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

/** Something, an `@`, something: the same shape the server checks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/**
 * Set or remove your own email address. It is not checked by sending
 * anything: it is how someone sharing a note finds you, so the dialog says
 * that rather than promising mail.
 */
function EmailDialog({
  current,
  onClose,
}: {
  current: string | null;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    const next = email.trim();
    if (next.length > 0 && !EMAIL_SHAPE.test(next)) {
      setError(t("account.email.invalid"));
      return;
    }
    setError(null);
    setBusy(true);
    const result = await updateEmail(next.length > 0 ? next : null);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t(next ? "account.email.saved" : "account.email.removed"));
      onClose();
      return;
    }
    setError(
      t(
        result === "taken"
          ? "account.email.taken"
          : result === "invalid"
            ? "account.email.invalid"
            : "account.email.failed",
      ),
    );
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div
        class="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-dialog-title"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <form
          onSubmit={submit}
          class="pointer-events-auto w-full max-w-sm max-h-full overflow-y-auto rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4"
        >
          <div>
            <h2 id="email-dialog-title" class="text-lg font-semibold">
              {t("account.email")}
            </h2>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t("account.email.hint")}
            </p>
          </div>
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("login.email")}
            </span>
            <input
              type="email"
              autoComplete="email"
              // biome-ignore lint/a11y/noAutofocus: the dialog was opened to type in
              autoFocus
              maxLength={254}
              value={email}
              onInput={(e) =>
                setEmail((e.currentTarget as HTMLInputElement).value)
              }
              class={inputClass}
            />
          </label>
          {error && (
            <p class="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={onClose}
            >
              {t("account.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              class="px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
            >
              {busy ? t("login.submitting") : t("account.email.save")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
