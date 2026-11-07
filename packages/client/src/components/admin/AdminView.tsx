import { Check, Copy, UserPlus } from "lucide-preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { boardCard } from "#/components/boardCard.ts";
import { buttonClass } from "#/components/buttonClasses.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { plural, t } from "#/i18n/index.ts";
import {
  authProviders,
  currentUser,
  fetchCapabilities,
} from "#/state/account/auth.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import {
  adminUsers,
  createAccount,
  type IssuedPassword,
  issuedPassword,
  loadAdminUsers,
} from "#/state/admin.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import {
  AdminConfirmation,
  fieldClass,
  refusalIn,
} from "./AdminConfirmation.tsx";
import { AdminOverview } from "./AdminOverview.tsx";
import { AdminTeams } from "./AdminTeams.tsx";
import { UserRow } from "./AdminUserRow.tsx";
import { AuditLog } from "./AuditLog.tsx";

/**
 * `/admin`: all accounts on the server, for an admin to create, reset, promote
 * and delete.
 *
 * `App` renders it only for an admin in connected mode, but the server decides.
 * It refuses a request from a person who lost admin rights after the page
 * loaded, and `state/admin.ts` takes them back to their notes.
 */
export function AdminView() {
  const users = adminUsers.value;
  const providers = authProviders.value;
  // Accounts with passwords exist only where local sign-in is on. With SSO, the
  // identity provider creates them and owns their passwords.
  const passwordsHere = providers.includes("local");
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [section, setSection] = useState<
    "users" | "teams" | "overview" | "activity"
  >("users");
  // No Teams page on a server with teams off.
  const sections = (["users", "teams", "overview", "activity"] as const).filter(
    (tab) => tab !== "teams" || serverFeature("teams"),
  );

  const load = useCallback(() => {
    setLoadFailed(false);
    void loadAdminUsers().then((ok) => setLoadFailed(!ok));
  }, []);

  useEffect(() => {
    load();
    if (authProviders.value.length === 0) void fetchCapabilities();
    // A temporary password shows one time. To leave the view dismisses it.
    return () => {
      issuedPassword.value = null;
    };
  }, [load]);

  return (
    <div
      data-marquee-ignore
      class={`w-full max-w-2xl mx-auto my-4 p-4 md:p-5 flex flex-col gap-4 ${boardCard}`}
    >
      <div
        class="flex gap-1 self-start rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1"
        role="tablist"
      >
        {sections.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={section === tab}
            class={`px-3 py-1 text-sm rounded-md cursor-pointer ${
              section === tab
                ? "bg-white dark:bg-neutral-700 shadow-sm font-medium"
                : "text-neutral-600 dark:text-neutral-300"
            }`}
            onClick={() => setSection(tab)}
          >
            {t(`admin.tab.${tab}`)}
          </button>
        ))}
      </div>

      {section === "activity" ? (
        <AuditLog />
      ) : section === "teams" && serverFeature("teams") ? (
        <AdminTeams />
      ) : section === "overview" ? (
        <AdminOverview />
      ) : (
        <>
          <div class="flex items-center justify-between gap-3 min-h-9">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {users ? plural("admin.count", users.length) : ""}
            </p>
            {passwordsHere && !creating && (
              <button
                type="button"
                class={buttonClass("primary", "sm")}
                onClick={() => setCreating(true)}
              >
                <UserPlus class="w-4 h-4" />
                {t("admin.create")}
              </button>
            )}
          </div>

          {providers.includes("oidc") && (
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
                <button
                  type="button"
                  class={buttonClass("secondary", "sm")}
                  onClick={load}
                >
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
        </>
      )}
    </div>
  );
}

function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onDone);

  const submit = async (event: Event) => {
    event.preventDefault();
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    // A failure was already reported. The form stays open, so that you can
    // correct it.
    const created = await createAccount(
      name,
      email.trim() || undefined,
      password,
    );
    setBusy(false);
    setRefusal(refusalIn(created));
    if (created === "done") onDone();
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
          class={fieldClass}
        />
      </label>
      <label class="flex-1 min-w-48">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.emailOptional")}
        </span>
        <input
          type="email"
          autoComplete="off"
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
        disabled={busy || username.trim().length === 0}
      >
        {t("admin.create.submit")}
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

function IssuedPasswordPanel({ issued }: { issued: IssuedPassword }) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);

  // Focus follows the new panel. Thus, a keyboard user goes to what they came
  // for, not to a menu that just closed.
  useEffect(() => {
    copyRef.current?.focus();
    setCopied(false);
  }, [issued]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      // No clipboard access. The password is still text that you can select.
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
          class={buttonClass("secondary", "sm")}
          onClick={copy}
        >
          {copied ? <Check class="w-4 h-4" /> : <Copy class="w-4 h-4" />}
          {copied ? t("admin.issued.copied") : t("admin.issued.copy")}
        </button>
        <button
          type="button"
          class={`${buttonClass("secondary", "sm")} ml-auto`}
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
