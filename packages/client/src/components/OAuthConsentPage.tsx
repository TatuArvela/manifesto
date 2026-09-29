import type { ApiTokenScope, OAuthClientInfo } from "@manifesto/shared";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { APP_NAME } from "../config.js";
import { t } from "../i18n/index.js";
import { revealApp } from "../splash.js";
import { authToken, currentUser, isServerMode } from "../state/auth.js";
import {
  type AuthorizeRequest,
  allowClient,
  denyClient,
  forgetConsentPage,
  lookUpClient,
  parseAuthorizeRequest,
  rememberConsentPage,
  returnTarget,
} from "../state/oauth.js";
import type { ConfirmationRefusal } from "../state/passwordConfirmation.js";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "./ConfirmWithPassword.js";
import { LoginScreen } from "./LoginScreen.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Choices for how long the connection lasts; null does not end. */
const EXPIRY_DAYS = [30, 90, 365, null] as const;

/**
 * The page an AI assistant opens to sign in to this server's MCP endpoint,
 * rendered in place of the app like a public link's page. Signed out, it is
 * the sign-in screen; signed in, it names the assistant and what it would get,
 * and sends the browser back to it with the answer.
 */
export function OAuthConsentPage() {
  const request = useMemo(
    () => parseAuthorizeRequest(window.location.search),
    [],
  );
  const signedIn = authToken.value !== null;

  useEffect(() => {
    // Single sign-on returns to the board; this is how it finds its way back.
    if (request) rememberConsentPage();
    revealApp();
  }, [request]);

  if (!isServerMode || !request) return <Notice text={t("oauth.invalid")} />;
  if (!signedIn) return <LoginScreen />;
  return <Consent request={request} />;
}

function Frame({ children }: { children: ComponentChildren }) {
  return (
    <main class="min-h-dvh bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 flex items-center justify-center px-4 py-8">
      <div class="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm p-6 space-y-4">
        <p class="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          {APP_NAME}
        </p>
        {children}
      </div>
    </main>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <Frame>
      <p class="text-neutral-700 dark:text-neutral-200">{text}</p>
    </Frame>
  );
}

type Stage =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "asking"; client: OAuthClientInfo }
  | { kind: "answered"; text: string };

function Consent({ request }: { request: AuthorizeRequest }) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [readOnly, setReadOnly] = useState(false);
  const [expiry, setExpiry] = useState<number | null>(90);
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void lookUpClient(request).then((client) =>
      setStage(client ? { kind: "asking", client } : { kind: "invalid" }),
    );
  }, [request]);

  if (stage.kind === "loading") return <Notice text={t("oauth.loading")} />;
  if (stage.kind === "invalid") return <Notice text={t("oauth.invalid")} />;
  if (stage.kind === "answered") return <Notice text={stage.text} />;

  const { client } = stage;
  const canWrite = client.scopes.includes("notes:write");
  const user = currentUser.value;

  const allow = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setError(null);
    const scopes: ApiTokenScope[] =
      canWrite && !readOnly ? ["notes:read", "notes:write"] : ["notes:read"];
    const result = await allowClient(request, scopes, expiry, password);
    setBusy(false);
    if (result.kind === "ok") {
      forgetConsentPage();
      setStage({
        kind: "answered",
        text: t("oauth.done", { client: client.name }),
      });
    } else if (result.kind === "refused") {
      setRefusal(result.refusal);
    } else {
      setError(
        t(result.kind === "too-many" ? "tokens.tooMany" : "oauth.failed"),
      );
    }
  };

  const deny = () => {
    forgetConsentPage();
    denyClient(client, request.state);
    setStage({ kind: "answered", text: t("oauth.denied") });
  };

  return (
    <Frame>
      <form onSubmit={allow} class="space-y-4">
        <h1 class="text-lg font-semibold break-words">
          {t("oauth.title", { client: client.name })}
        </h1>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {client.publisher
            ? t("oauth.publisher", { host: client.publisher })
            : t("oauth.unverified")}
        </p>
        {user && (
          <p class="text-sm text-neutral-600 dark:text-neutral-300">
            {t("oauth.account", {
              name: user.displayName || user.username,
            })}
          </p>
        )}
        <fieldset class="space-y-1">
          <legend class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("oauth.access")}
          </legend>
          {canWrite && (
            <label class="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="access"
                class="mt-0.5"
                checked={!readOnly}
                onChange={() => setReadOnly(false)}
              />
              <span>{t("oauth.accessFull")}</span>
            </label>
          )}
          <label class="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="access"
              class="mt-0.5"
              checked={readOnly || !canWrite}
              onChange={() => setReadOnly(true)}
            />
            <span>{t("oauth.accessRead")}</span>
          </label>
        </fieldset>
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("oauth.expires")}
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
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {t("oauth.returnTo", { target: returnTarget(client.redirectUri) })}{" "}
          {t("oauth.revokeHint")}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            onClick={deny}
            class="px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
          >
            {t("oauth.deny")}
          </button>
          <button
            type="submit"
            disabled={busy}
            class="px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
          >
            {t("oauth.allow")}
          </button>
        </div>
      </form>
    </Frame>
  );
}
