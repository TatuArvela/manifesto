import type { ApiToken, ApiTokenKind } from "@manifesto/shared";
import { Copy, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { APP_FILE_SLUG } from "../config.js";
import { formatDateTime, t } from "../i18n/index.js";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../state/apiTokens.js";
import { mcpEnabled, SERVER_ORIGIN } from "../state/auth.js";
import { askConfirmation } from "../state/confirm.js";
import { showError, showSuccess } from "../state/ui.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Choices for how long a new token lasts; null does not expire. */
const EXPIRY_DAYS = [30, 90, 365, null] as const;

/**
 * Personal API tokens: long-lived keys for scripts, shortcuts and bots, so
 * they need no password. A new token's secret is shown once, here, and never
 * again; the list names each by its first characters and when it was last
 * used, so a forgotten one can be found and revoked.
 *
 * A token for an AI assistant is another kind (`mfm_`): it works only at the
 * server's MCP endpoint, so the tab hands over the command that connects an
 * assistant along with the secret.
 */
export function ApiTokensSettings() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<number | null>(90);
  const [kind, setKind] = useState<ApiTokenKind>("api");
  const [readOnly, setReadOnly] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [secretKind, setSecretKind] = useState<ApiTokenKind>("api");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const listed = await listApiTokens();
    setFailed(listed === null);
    setTokens(listed ?? []);
  };

  useEffect(() => {
    void reload();
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim().length === 0) {
      setError(t("tokens.nameRequired"));
      return;
    }
    setError(null);
    setBusy(true);
    const result = await createApiToken(name.trim(), expiry, kind, readOnly);
    setBusy(false);
    if (result.kind !== "ok") {
      setError(
        t(result.kind === "too-many" ? "tokens.tooMany" : "tokens.failed"),
      );
      return;
    }
    setSecret(result.created.secret);
    setSecretKind(kind);
    setName("");
    await reload();
  };

  const revoke = async (token: ApiToken) => {
    const ok = await askConfirmation({
      title: t("tokens.revokeTitle"),
      body: t("tokens.revokeBody", { name: token.name }),
      confirmLabel: t("tokens.revoke"),
    });
    if (!ok) return;
    if (await revokeApiToken(token.id)) {
      showSuccess(t("tokens.revoked"));
      await reload();
    } else {
      showError(t("tokens.failed"));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(t("tokens.copied"));
    } catch {
      // The field is selectable; copying by hand still works.
    }
  };

  const mcpUrl = `${SERVER_ORIGIN ?? ""}/api/mcp`;
  const mcpCommand =
    secret &&
    `claude mcp add --transport http ${APP_FILE_SLUG} ${mcpUrl} --header "Authorization: Bearer ${secret}"`;

  return (
    <div class="space-y-4">
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("tokens.hint", { server: SERVER_ORIGIN ?? "" })}
      </p>

      {secret && (
        <div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 space-y-2">
          <p class="text-sm">{t("tokens.showOnce")}</p>
          <div class="flex gap-2">
            <input
              readOnly
              value={secret}
              aria-label={t("tokens.secret")}
              class={`${inputClass} font-mono text-xs`}
              onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            />
            <button
              type="button"
              class="shrink-0 px-3 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={() => copy(secret)}
              aria-label={t("tokens.copy")}
            >
              <Copy class="w-4 h-4" />
            </button>
          </div>
          {secretKind === "mcp" && mcpCommand && (
            <>
              <p class="text-sm">{t("tokens.mcpSetup")}</p>
              <div class="flex gap-2">
                <textarea
                  readOnly
                  rows={3}
                  value={mcpCommand}
                  aria-label={t("tokens.mcpCommand")}
                  class={`${inputClass} font-mono text-xs resize-none`}
                  onFocus={(e) =>
                    (e.currentTarget as HTMLTextAreaElement).select()
                  }
                />
                <button
                  type="button"
                  class="shrink-0 px-3 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={() => copy(mcpCommand)}
                  aria-label={t("tokens.mcpCopyCommand")}
                >
                  <Copy class="w-4 h-4" />
                </button>
              </div>
              <p class="text-xs text-neutral-600 dark:text-neutral-300">
                {t("tokens.mcpOther", { url: mcpUrl })}
              </p>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} class="space-y-3">
        {mcpEnabled.value && (
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("tokens.kind")}
            </span>
            <select
              class={inputClass}
              value={kind}
              onChange={(e) =>
                setKind(
                  (e.currentTarget as HTMLSelectElement).value as ApiTokenKind,
                )
              }
            >
              <option value="api">{t("tokens.kindApi")}</option>
              <option value="mcp">{t("tokens.kindMcp")}</option>
            </select>
          </label>
        )}
        {kind === "mcp" && (
          <div class="space-y-2">
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("tokens.mcpHint")}
            </p>
            <label class="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={readOnly}
                onChange={(e) =>
                  setReadOnly((e.currentTarget as HTMLInputElement).checked)
                }
              />
              <span>{t("tokens.readOnly")}</span>
            </label>
          </div>
        )}
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("tokens.name")}
          </span>
          <input
            maxLength={100}
            value={name}
            placeholder={t("tokens.namePlaceholder")}
            onInput={(e) =>
              setName((e.currentTarget as HTMLInputElement).value)
            }
            class={inputClass}
          />
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("tokens.expires")}
          </span>
          <select
            class={inputClass}
            value={expiry === null ? "never" : String(expiry)}
            onChange={(e) => {
              const value = (e.currentTarget as HTMLSelectElement).value;
              setExpiry(value === "never" ? null : Number(value));
            }}
          >
            {EXPIRY_DAYS.map((days) => (
              <option key={String(days)} value={days ?? "never"}>
                {days === null
                  ? t("tokens.never")
                  : t("tokens.days", { count: days })}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p class="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <div class="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            class="px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
          >
            {t("tokens.create")}
          </button>
        </div>
      </form>

      <div class="border-t border-neutral-200 dark:border-neutral-700 pt-3">
        {tokens === null ? (
          <p class="text-sm text-neutral-500">{t("tokens.loading")}</p>
        ) : failed ? (
          <p class="text-sm text-red-600 dark:text-red-400">
            {t("tokens.failed")}
          </p>
        ) : tokens.length === 0 ? (
          <p class="text-sm text-neutral-500">{t("tokens.none")}</p>
        ) : (
          <ul class="space-y-2">
            {tokens.map((token) => (
              <li key={token.id} class="flex items-start gap-2">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">
                    {token.name}
                    {token.kind === "mcp" && (
                      <span class="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                        {token.readOnly
                          ? t("tokens.mcpReadOnlyBadge")
                          : t("tokens.mcpBadge")}
                      </span>
                    )}
                  </p>
                  <p class="text-xs text-neutral-500 dark:text-neutral-400">
                    <span class="font-mono">{token.prefix}...</span>
                    {" · "}
                    {token.lastUsedAt
                      ? t("tokens.lastUsed", {
                          when: formatDateTime(token.lastUsedAt),
                        })
                      : t("tokens.neverUsed")}
                    {token.expiresAt &&
                      ` · ${t("tokens.expiresOn", {
                        when: formatDateTime(token.expiresAt),
                      })}`}
                  </p>
                </div>
                <button
                  type="button"
                  class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                  onClick={() => revoke(token)}
                  aria-label={t("tokens.revokeNamed", { name: token.name })}
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
