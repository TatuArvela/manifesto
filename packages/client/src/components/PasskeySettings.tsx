import type { Passkey } from "@manifesto/shared";
import { KeyRound, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { formatDateTime, type MessageKey, t } from "../i18n/index.js";
import {
  type AddPasskeyResult,
  addPasskey,
  listPasskeys,
  removePasskey,
} from "../state/passkeys.js";
import { showSuccess } from "../state/ui.js";
import { passkeysSupported } from "../utils/webauthn.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
const primaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer";

const ADD_FAILURES: Record<
  Exclude<AddPasskeyResult["kind"], "ok">,
  MessageKey
> = {
  "wrong-password": "twoFactor.wrongPassword",
  cancelled: "passkeys.cancelled",
  exists: "passkeys.exists",
  "too-many": "passkeys.tooMany",
  failed: "passkeys.failed",
};

type Form =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "remove"; passkey: Passkey };

/**
 * The account's passkeys, under the authenticator app in the two-factor tab:
 * each a second factor after the password, and a way to sign in alone. Adding
 * one asks for the password and then the browser's own prompt; the first
 * second factor of either kind brings the recovery codes, which
 * `onRecoveryCodes` shows.
 */
export function PasskeySettings({
  onChange,
  onRecoveryCodes,
}: {
  onChange: () => void;
  onRecoveryCodes: (codes: string[]) => void;
}) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [form, setForm] = useState<Form>({ kind: "none" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  const reload = async () => {
    const listed = await listPasskeys();
    setPasskeys(listed ?? []);
    if (listed === null) setError(t("passkeys.failed"));
  };

  useEffect(() => {
    void reload();
  }, []);

  const close = () => {
    setForm({ kind: "none" });
    setName("");
    setPassword("");
    setError(null);
  };

  const submitAdd = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await addPasskey(name.trim(), password);
    setBusy(false);
    if (result.kind !== "ok") {
      setError(t(ADD_FAILURES[result.kind]));
      return;
    }
    close();
    showSuccess(t("passkeys.added"));
    await reload();
    if (result.recoveryCodes) onRecoveryCodes(result.recoveryCodes);
    else onChange();
  };

  const submitRemove = (passkey: Passkey) => async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await removePasskey(passkey.id, password);
    setBusy(false);
    if (result !== "ok") {
      setError(
        t(
          result === "wrong-password"
            ? "twoFactor.wrongPassword"
            : "passkeys.failed",
        ),
      );
      return;
    }
    close();
    showSuccess(t("passkeys.removed"));
    await reload();
    onChange();
  };

  const passwordField = (
    <label class="block">
      <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
        {t("twoFactor.password")}
      </span>
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onInput={(e) =>
          setPassword((e.currentTarget as HTMLInputElement).value)
        }
        class={inputClass}
      />
    </label>
  );

  const errorLine = error && (
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {error}
    </p>
  );

  return (
    <section class="space-y-3 border-t border-neutral-200 dark:border-neutral-700 pt-4">
      <h3 class="text-sm font-semibold">{t("passkeys.title")}</h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("passkeys.hint")}
      </p>
      {passkeys === null ? (
        <p class="text-sm text-neutral-500">{t("twoFactor.loading")}</p>
      ) : passkeys.length === 0 ? (
        <p class="text-sm text-neutral-500">{t("passkeys.none")}</p>
      ) : (
        <ul class="space-y-2">
          {passkeys.map((passkey) => (
            <li key={passkey.id} class="flex items-start gap-2">
              <KeyRound class="w-4 h-4 mt-0.5 shrink-0 text-neutral-500" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">
                  {passkey.name}
                  <span class="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                    {t(passkey.synced ? "passkeys.synced" : "passkeys.device")}
                  </span>
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {passkey.lastUsedAt
                    ? t("passkeys.lastUsed", {
                        when: formatDateTime(passkey.lastUsedAt),
                      })
                    : t("passkeys.neverUsed")}
                </p>
              </div>
              <button
                type="button"
                class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                onClick={() => {
                  close();
                  setForm({ kind: "remove", passkey });
                }}
                aria-label={t("passkeys.removeNamed", { name: passkey.name })}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {form.kind === "remove" ? (
        <form onSubmit={submitRemove(form.passkey)} class="space-y-3">
          <p class="text-sm">
            {t("passkeys.removeConfirm", { name: form.passkey.name })}
          </p>
          {passwordField}
          {errorLine}
          <div class="flex justify-end gap-2">
            <button type="button" class={secondaryClass} onClick={close}>
              {t("confirm.cancel")}
            </button>
            <button type="submit" disabled={busy} class={primaryClass}>
              {t("passkeys.remove")}
            </button>
          </div>
        </form>
      ) : form.kind === "add" ? (
        <form onSubmit={submitAdd} class="space-y-3">
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("passkeys.name")}
            </span>
            <input
              maxLength={100}
              value={name}
              placeholder={t("passkeys.namePlaceholder")}
              onInput={(e) =>
                setName((e.currentTarget as HTMLInputElement).value)
              }
              class={inputClass}
            />
          </label>
          {passwordField}
          {errorLine}
          <div class="flex justify-end gap-2">
            <button type="button" class={secondaryClass} onClick={close}>
              {t("confirm.cancel")}
            </button>
            <button type="submit" disabled={busy} class={primaryClass}>
              {t("passkeys.add")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {errorLine}
          {supported ? (
            <div class="flex justify-end">
              <button
                type="button"
                class={secondaryClass}
                onClick={() => setForm({ kind: "add" })}
              >
                {t("passkeys.addStart")}
              </button>
            </div>
          ) : (
            <p class="text-sm text-neutral-500">{t("passkeys.unsupported")}</p>
          )}
        </>
      )}
    </section>
  );
}
