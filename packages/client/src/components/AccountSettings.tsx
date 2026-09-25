import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  authProviderName,
  changePassword,
  currentUser,
  updateEmail,
} from "../state/auth.js";
import { showSuccess } from "../state/ui.js";
import { Avatar } from "./Avatar.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:bg-neutral-100 dark:read-only:bg-neutral-800 read-only:text-neutral-600 dark:read-only:text-neutral-300";
const primaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";

/** Something, an `@`, something: the same shape the server checks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/**
 * Whether this account signs in with a password of its own. Under single
 * sign-on the identity provider owns the password, and the email address too.
 * With both kinds of sign-in on, that is a question about this account; a
 * server from before it could answer says it through its provider.
 */
export function hasOwnPassword(): boolean {
  const user = currentUser.value;
  return user?.hasPassword ?? authProviderName.value === "local";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 pb-1.5 border-b border-neutral-200 dark:border-neutral-700">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the input arrives as children
    <label class="block">
      <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Who you are, and the parts of it you can change here. */
export function AccountSettings() {
  const user = currentUser.value;
  if (!user) return null;
  const name = user.displayName || user.username;
  const ownPassword = hasOwnPassword();

  return (
    <div class="space-y-8">
      <div class="flex items-center gap-4">
        <Avatar
          name={name}
          color={user.avatarColor}
          class="w-14 h-14 text-xl"
        />
        <div class="min-w-0">
          <p class="text-base font-medium truncate">{name}</p>
          {name !== user.username && (
            <p class="text-sm text-neutral-500 dark:text-neutral-400 truncate">
              {user.username}
            </p>
          )}
        </div>
      </div>

      <Section title={t("account.email")}>
        {ownPassword ? (
          <EmailForm current={user.email} />
        ) : (
          <>
            <input
              type="email"
              readOnly
              value={user.email ?? ""}
              aria-label={t("account.email")}
              class={inputClass}
            />
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {t("account.email.managed")}
            </p>
          </>
        )}
      </Section>

      {ownPassword && (
        <Section title={t("account.changePassword")}>
          <PasswordForm />
        </Section>
      )}
    </div>
  );
}

/**
 * Set or remove your own email address. It is not checked by sending
 * anything: it is how someone sharing a note finds you, so the hint says that
 * rather than promising mail.
 */
function EmailForm({ current }: { current: string | null }) {
  const [email, setEmail] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unchanged = email.trim() === (current ?? "");

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy || unchanged) return;
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
    <form onSubmit={submit} class="space-y-3">
      <Field label={t("login.email")}>
        <input
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
          class={inputClass}
        />
      </Field>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {t("account.email.hint")}
      </p>
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div class="flex justify-end">
        <button type="submit" disabled={busy || unchanged} class={primaryClass}>
          {busy ? t("login.submitting") : t("account.email.save")}
        </button>
      </div>
    </form>
  );
}

/**
 * Change your own password. Every other session of the account ends and this
 * one carries on. The success message says so, so being signed out on another
 * device comes as no surprise.
 */
function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setCurrent("");
      setNext("");
      setConfirm("");
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
  ) => (
    <Field label={label}>
      <input
        type="password"
        autoComplete={autoComplete}
        value={value}
        onInput={(e) => set((e.currentTarget as HTMLInputElement).value)}
        class={inputClass}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} class="space-y-3">
      {field(
        t("account.currentPassword"),
        current,
        setCurrent,
        "current-password",
      )}
      {field(t("login.newPassword"), next, setNext, "new-password")}
      {field(t("login.confirmPassword"), confirm, setConfirm, "new-password")}
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div class="flex justify-end">
        <button type="submit" disabled={busy} class={primaryClass}>
          {busy ? t("login.submitting") : t("account.changePassword")}
        </button>
      </div>
    </form>
  );
}
