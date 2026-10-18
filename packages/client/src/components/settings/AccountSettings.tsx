import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Avatar } from "#/components/Avatar.tsx";
import { buttonClass } from "#/components/buttonClasses.ts";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "#/components/ConfirmWithPassword.tsx";
import { t } from "#/i18n/index.ts";
import {
  authProviderName,
  currentUser,
  updateEmail,
} from "#/state/account/auth.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import { deleteOwnAccount } from "#/state/account/signOut.ts";
import { showSuccess } from "#/state/ui.ts";
import { SettingsHeading } from "./SettingsControls.tsx";

export const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm max-sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:bg-neutral-100 dark:read-only:bg-neutral-800 read-only:text-neutral-600 dark:read-only:text-neutral-300";

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

export function Section({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="space-y-3">
      <SettingsHeading>{title}</SettingsHeading>
      {children}
    </section>
  );
}

export function Field({
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

/**
 * Who you are, and the parts of it you can change here. The password is on
 * the Sign-in page with the other ways in, and deleting the account sits
 * apart at the foot, where nobody reaches it on the way to something else.
 */
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

      <EmailSection current={user.email} editable={ownPassword} />

      <section class="space-y-3 pt-6 border-t border-neutral-200 dark:border-neutral-700">
        <h3 class="text-sm font-semibold text-red-700 dark:text-red-400">
          {t("account.delete.title")}
        </h3>
        <DeleteAccountForm />
      </section>
    </div>
  );
}

/**
 * Delete your own account, and every note it owns. Two steps, the second
 * with the password, so neither a stray click nor a stolen session does it.
 * Once it is gone this browser is left as a sign-out leaves it.
 */
function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setOpen(false);
    setPassword("");
    setRefusal(null);
    setError(null);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setRefusal(null);
    setError(null);
    setBusy(true);
    const result = await deleteOwnAccount(password);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t("account.delete.done"));
      return;
    }
    if (result === "last-admin") {
      setError(t("account.delete.lastAdmin"));
    } else if (result === "failed") {
      setError(t("account.delete.failed"));
    } else {
      setRefusal(result);
    }
  };

  if (!open) {
    return (
      <div class="flex flex-col sm:flex-row sm:items-start gap-3">
        <p class="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t("account.delete.hint")}
        </p>
        <button
          type="button"
          class={`${buttonClass("secondary", "sm")} self-end sm:self-auto shrink-0`}
          onClick={() => setOpen(true)}
        >
          {t("account.delete.start")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} class="space-y-3">
      <p class="text-sm text-neutral-700 dark:text-neutral-200">
        {t("account.delete.warning")}
      </p>
      <ConfirmPasswordField value={password} onInput={setPassword} />
      {refusal && <ConfirmationError refusal={refusal} />}
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div class="flex justify-end gap-2">
        <button type="button" class={buttonClass("secondary")} onClick={cancel}>
          {t("confirm.cancel")}
        </button>
        <button type="submit" disabled={busy} class={buttonClass("danger")}>
          {busy ? t("login.submitting") : t("account.delete.confirm")}
        </button>
      </div>
    </form>
  );
}

/**
 * The address as it is, with a button to change it under local sign-in.
 * Under single sign-on the provider owns it, so it is only shown.
 */
function EmailSection({
  current,
  editable,
}: {
  current: string | null;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Section title={t("account.email")}>
      {editing ? (
        <EmailForm current={current} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div class="flex items-center justify-between gap-3">
            <p
              class={`min-w-0 truncate text-sm ${current ? "" : "text-neutral-500 dark:text-neutral-400"}`}
            >
              {current ?? t("account.email.none")}
            </p>
            {editable && (
              <button
                type="button"
                class={`${buttonClass("secondary", "sm")} shrink-0`}
                onClick={() => setEditing(true)}
              >
                {t(current ? "account.email.change" : "account.email.add")}
              </button>
            )}
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            {t(editable ? "account.email.hint" : "account.email.managed")}
          </p>
        </>
      )}
    </Section>
  );
}

/**
 * Set or remove your own email address. It is not checked by sending
 * anything: it is how someone sharing a note finds you, so the hint says that
 * rather than promising mail.
 */
function EmailForm({
  current,
  onDone,
}: {
  current: string | null;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
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
    setRefusal(null);
    setBusy(true);
    const result = await updateEmail(next.length > 0 ? next : null, password);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t(next ? "account.email.saved" : "account.email.removed"));
      onDone();
      return;
    }
    if (
      result === "password-missing" ||
      result === "password-wrong" ||
      result === "sign-in-again" ||
      result === "locked"
    ) {
      setRefusal(result);
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
          // biome-ignore lint/a11y/noAutofocus: opened by the button for this
          autoFocus
          value={email}
          onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
          class={inputClass}
        />
      </Field>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {t("account.email.hint")}
      </p>
      {!unchanged && (
        <ConfirmPasswordField value={password} onInput={setPassword} />
      )}
      {refusal && <ConfirmationError refusal={refusal} />}
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div class="flex justify-end gap-2">
        <button type="button" class={buttonClass("secondary")} onClick={onDone}>
          {t("confirm.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || unchanged}
          class={buttonClass("primary")}
        >
          {busy ? t("login.submitting") : t("account.email.save")}
        </button>
      </div>
    </form>
  );
}
