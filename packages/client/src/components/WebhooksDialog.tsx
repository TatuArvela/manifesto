import type { Webhook } from "@manifesto/shared";
import { Copy, Send, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { formatDateTime, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import { showError, showSuccess } from "../state/ui.js";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  setWebhookActive,
  testWebhook,
} from "../state/webhooks.js";
import { Switch } from "./ToggleSwitch.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

function statusLine(webhook: Webhook): string {
  if (!webhook.lastDeliveryAt) return t("webhooks.neverDelivered");
  const when = formatDateTime(webhook.lastDeliveryAt);
  return webhook.lastError
    ? t("webhooks.lastFailed", { when, error: webhook.lastError })
    : t("webhooks.lastDelivered", {
        when,
        status: String(webhook.lastStatus ?? ""),
      });
}

/**
 * Webhooks: URLs this server posts the user's note events to, for n8n, Home
 * Assistant or a chat bot. Each delivery is signed with the webhook's secret,
 * shown once when it is added.
 */
export function WebhooksDialog({ onClose }: { onClose: () => void }) {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const reload = async () => {
    const listed = await listWebhooks();
    setFailed(listed === null);
    setWebhooks(listed ?? []);
  };

  useEffect(() => {
    void reload();
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await createWebhook(url.trim());
    setBusy(false);
    if (result.kind !== "ok") {
      setError(
        t(
          result.kind === "invalid"
            ? "webhooks.invalidUrl"
            : result.kind === "too-many"
              ? "webhooks.tooMany"
              : "webhooks.failed",
        ),
      );
      return;
    }
    setSecret(result.created.secret);
    setUrl("");
    await reload();
  };

  const remove = async (webhook: Webhook) => {
    const ok = await askConfirmation({
      title: t("webhooks.removeTitle"),
      body: t("webhooks.removeBody", { url: webhook.url }),
      confirmLabel: t("webhooks.remove"),
    });
    if (!ok) return;
    if (await deleteWebhook(webhook.id)) await reload();
    else showError(t("webhooks.failed"));
  };

  const toggle = async (webhook: Webhook, active: boolean) => {
    if (await setWebhookActive(webhook.id, active)) await reload();
    else showError(t("webhooks.failed"));
  };

  const test = async (webhook: Webhook) => {
    const result = await testWebhook(webhook.id);
    if (!result) showError(t("webhooks.failed"));
    else if (result.error) {
      showError(t("webhooks.testFailed", { error: result.error }));
    } else {
      showSuccess(
        t("webhooks.testOk", { status: String(result.status ?? "") }),
      );
    }
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
        aria-labelledby="webhooks-title"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <div class="pointer-events-auto w-full max-w-md max-h-full overflow-y-auto rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4">
          <div>
            <h2 id="webhooks-title" class="text-lg font-semibold">
              {t("webhooks.title")}
            </h2>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t("webhooks.hint")}
            </p>
          </div>

          {secret && (
            <div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 space-y-2">
              <p class="text-sm">{t("webhooks.showOnce")}</p>
              <div class="flex gap-2">
                <input
                  readOnly
                  value={secret}
                  aria-label={t("webhooks.secret")}
                  class={`${inputClass} font-mono text-xs`}
                  onFocus={(e) =>
                    (e.currentTarget as HTMLInputElement).select()
                  }
                />
                <button
                  type="button"
                  class="shrink-0 px-3 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(secret)
                      .then(() => showSuccess(t("webhooks.copied")))
                      .catch(() => {});
                  }}
                  aria-label={t("webhooks.copy")}
                >
                  <Copy class="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <form onSubmit={submit} class="space-y-3">
            <label class="block">
              <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
                {t("webhooks.url")}
              </span>
              <input
                type="url"
                // biome-ignore lint/a11y/noAutofocus: the dialog was opened to type in
                autoFocus
                required
                maxLength={2048}
                placeholder="https://"
                value={url}
                onInput={(e) =>
                  setUrl((e.currentTarget as HTMLInputElement).value)
                }
                class={inputClass}
              />
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
                {t("webhooks.add")}
              </button>
            </div>
          </form>

          <div class="border-t border-neutral-200 dark:border-neutral-700 pt-3">
            {webhooks === null ? (
              <p class="text-sm text-neutral-500">{t("webhooks.loading")}</p>
            ) : failed ? (
              <p class="text-sm text-red-600 dark:text-red-400">
                {t("webhooks.failed")}
              </p>
            ) : webhooks.length === 0 ? (
              <p class="text-sm text-neutral-500">{t("webhooks.none")}</p>
            ) : (
              <ul class="space-y-3">
                {webhooks.map((webhook) => (
                  <li key={webhook.id} class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-mono truncate" title={webhook.url}>
                        {webhook.url}
                      </p>
                      <p class="text-xs text-neutral-500 dark:text-neutral-400 break-words">
                        {webhook.active
                          ? statusLine(webhook)
                          : t("webhooks.off")}
                      </p>
                    </div>
                    <Switch
                      checked={webhook.active}
                      onChange={(active) => void toggle(webhook, active)}
                      label={t("webhooks.active")}
                    />
                    <button
                      type="button"
                      class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                      onClick={() => void test(webhook)}
                      aria-label={t("webhooks.test")}
                    >
                      <Send class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
                      onClick={() => void remove(webhook)}
                      aria-label={t("webhooks.remove")}
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={onClose}
            >
              {t("webhooks.close")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
