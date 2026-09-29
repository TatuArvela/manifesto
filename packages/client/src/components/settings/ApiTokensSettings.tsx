import {
  API_TOKEN_SCOPES,
  type ApiToken,
  type ApiTokenKind,
  type ApiTokenScope,
  hasScope,
} from "@manifesto/shared";
import { Copy, Trash2 } from "lucide-preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { APP_FILE_SLUG } from "../../config.js";
import { formatDateTime, type MessageKey, t } from "../../i18n/index.js";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../../state/apiTokens.js";
import { SERVER_ORIGIN } from "../../state/auth.js";
import { askConfirmation } from "../../state/confirm.js";
import type { ConfirmationRefusal } from "../../state/passwordConfirmation.js";
import {
  offeredTokenKinds,
  serverFeature,
} from "../../state/serverFeatures.js";
import { showError, showSuccess } from "../../state/ui.js";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "../ConfirmWithPassword.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

const KIND_LABELS: Record<ApiTokenKind, MessageKey> = {
  api: "tokens.kindApi",
  mcp: "tokens.kindMcp",
  calendar: "tokens.kindCalendar",
};

/** Choices for how long a new token lasts; null does not expire. */
const EXPIRY_DAYS = [30, 90, 365, null] as const;

const SCOPE_LABELS = {
  "notes:read": "tokens.scopeNotesRead",
  "notes:write": "tokens.scopeNotesWrite",
  sharing: "tokens.scopeSharing",
  "account:read": "tokens.scopeAccountRead",
  "account:write": "tokens.scopeAccountWrite",
} as const satisfies Record<ApiTokenScope, MessageKey>;

/** Everything a script's token can be given, or only what reads. */
const READ_ONLY: readonly ApiTokenScope[] = ["notes:read", "account:read"];
type Access = "full" | "read" | "custom";

const sameScopes = (a: readonly ApiTokenScope[], b: readonly ApiTokenScope[]) =>
  a.length === b.length && a.every((scope) => b.includes(scope));

/** How the list names what a token may reach. */
function accessLabel(token: ApiToken): string {
  if (token.kind === "calendar") return t("tokens.calendarBadge");
  if (token.kind === "mcp") {
    return t(
      hasScope(token.scopes, "notes:write")
        ? "tokens.mcpBadge"
        : "tokens.mcpReadOnlyBadge",
    );
  }
  if (sameScopes(token.scopes, API_TOKEN_SCOPES)) return t("tokens.accessFull");
  if (sameScopes(token.scopes, READ_ONLY)) return t("tokens.accessRead");
  return token.scopes.map((scope) => t(SCOPE_LABELS[scope])).join(", ");
}

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
  // Only the kinds the server's features allow; the page itself stays for
  // the tokens already made, which can always be revoked.
  const kinds = offeredTokenKinds();
  const [kind, setKind] = useState<ApiTokenKind>(kinds[0] ?? "api");
  const [readOnly, setReadOnly] = useState(false);
  const [access, setAccess] = useState<Access>("full");
  const [custom, setCustom] = useState<ApiTokenScope[]>([...API_TOKEN_SCOPES]);
  const [secret, setSecret] = useState<string | null>(null);
  const [secretKind, setSecretKind] = useState<ApiTokenKind>("api");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const listed = await listApiTokens();
    setFailed(listed === null);
    setTokens(listed ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim().length === 0) {
      setError(t("tokens.nameRequired"));
      return;
    }
    // A calendar token reaches its feed and no scope; the server keeps none.
    const scopes: readonly ApiTokenScope[] =
      kind === "calendar"
        ? ["notes:read"]
        : kind === "mcp"
          ? readOnly
            ? ["notes:read"]
            : ["notes:read", "notes:write"]
          : access === "full"
            ? API_TOKEN_SCOPES
            : access === "read"
              ? READ_ONLY
              : custom;
    if (scopes.length === 0) {
      setError(t("tokens.scopesRequired"));
      return;
    }
    setError(null);
    setRefusal(null);
    setBusy(true);
    const result = await createApiToken(
      name.trim(),
      expiry,
      kind,
      scopes,
      password,
    );
    setBusy(false);
    if (result.kind === "refused") {
      setRefusal(result.refusal);
      return;
    }
    if (result.kind !== "ok") {
      setError(
        t(result.kind === "too-many" ? "tokens.tooMany" : "tokens.failed"),
      );
      return;
    }
    setSecret(result.created.secret);
    setSecretKind(kind);
    setName("");
    setPassword("");
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
  const calendarUrl = (token: string) =>
    `${SERVER_ORIGIN ?? ""}/api/calendar/${token}.ics`;
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
          {secretKind === "calendar" && (
            <>
              <p class="text-sm">{t("tokens.calendarSetup")}</p>
              <div class="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={calendarUrl(secret)}
                  aria-label={t("tokens.calendarUrl")}
                  class={`${inputClass} font-mono text-xs`}
                  onFocus={(e) =>
                    (e.currentTarget as HTMLInputElement).select()
                  }
                />
                <button
                  type="button"
                  class="shrink-0 px-3 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={() => copy(calendarUrl(secret))}
                  aria-label={t("tokens.calendarCopy")}
                >
                  <Copy class="w-4 h-4" />
                </button>
              </div>
              <a
                class="text-sm text-blue-600 dark:text-blue-400 underline"
                href={calendarUrl(secret).replace(/^https?:/, "webcal:")}
              >
                {t("tokens.calendarSubscribe")}
              </a>
            </>
          )}
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
            {kinds.map((offered) => (
              <option key={offered} value={offered}>
                {t(KIND_LABELS[offered])}
              </option>
            ))}
          </select>
        </label>
        {kind === "calendar" && (
          <p class="text-sm text-neutral-600 dark:text-neutral-300">
            {t("tokens.calendarHint")}
          </p>
        )}
        {kind === "mcp" && (
          <div class="space-y-2">
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("tokens.mcpHint")}
            </p>
            {serverFeature("mcpSignIn") && (
              <p class="text-sm text-neutral-600 dark:text-neutral-300">
                {t("tokens.mcpSignInHint", { url: mcpUrl })}
              </p>
            )}
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
        {kind === "api" && (
          <div class="space-y-2">
            <label class="block">
              <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
                {t("tokens.access")}
              </span>
              <select
                class={inputClass}
                value={access}
                onChange={(e) =>
                  setAccess(
                    (e.currentTarget as HTMLSelectElement).value as Access,
                  )
                }
              >
                <option value="full">{t("tokens.accessFull")}</option>
                <option value="read">{t("tokens.accessRead")}</option>
                <option value="custom">{t("tokens.accessCustom")}</option>
              </select>
            </label>
            {access === "custom" && (
              <fieldset class="space-y-1">
                <legend class="sr-only">{t("tokens.access")}</legend>
                {API_TOKEN_SCOPES.map((scope) => (
                  <label key={scope} class="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      checked={custom.includes(scope)}
                      onChange={(e) => {
                        const on = (e.currentTarget as HTMLInputElement)
                          .checked;
                        setCustom((current) =>
                          API_TOKEN_SCOPES.filter((s) =>
                            s === scope ? on : current.includes(s),
                          ),
                        );
                      }}
                    />
                    <span>{t(SCOPE_LABELS[scope])}</span>
                  </label>
                ))}
              </fieldset>
            )}
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
        <ConfirmPasswordField value={password} onInput={setPassword} />
        {refusal && <ConfirmationError refusal={refusal} />}
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
                    <span class="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                      {accessLabel(token)}
                    </span>
                  </p>
                  <p class="text-xs text-neutral-500 dark:text-neutral-400">
                    {token.oauthClientId ? (
                      t("tokens.signedIn")
                    ) : (
                      <span class="font-mono">{token.prefix}...</span>
                    )}
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
