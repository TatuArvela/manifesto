import type { CapabilitiesResponse } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { APP_LOGO, APP_NAME, INSTANCE_NAME } from "../config.js";
import { type MessageKey, t } from "../i18n/index.js";
import {
  fetchCapabilities,
  type OidcRefusal,
  oidcLoginUrl,
  oidcRefusal,
  SERVER_ORIGIN,
  takeResetToken,
  takeSignInLinkToken,
} from "../state/auth.js";
import { passkeysSupported } from "../utils/webauthn.js";
import { BrandLogo } from "./BrandLogo.js";
import { LocalLoginForm } from "./LocalLoginForm.js";
import { OrgCredit } from "./OrgCredit.js";
import { ForgotPasswordForm, ResetPasswordForm } from "./PasswordResetForms.js";
import { SignInLinkForm, SignInLinkLanding } from "./SignInLinkForms.js";

const OIDC_REFUSAL_MESSAGES: Record<OidcRefusal, MessageKey> = {
  not_in_group: "login.oidcNotInGroup",
  not_registered: "login.oidcNotRegistered",
  groups_unavailable: "login.oidcGroupsUnavailable",
};

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; auth: CapabilitiesResponse["auth"] }
  | { kind: "unavailable" };

export function LoginScreen() {
  const [discovery, setDiscovery] = useState<DiscoveryState>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void fetchCapabilities().then((capabilities) => {
      if (cancelled) return;
      if (!capabilities) {
        setDiscovery({ kind: "unavailable" });
        return;
      }
      setDiscovery({ kind: "ready", auth: capabilities.auth });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="min-h-dvh flex items-center justify-center px-4 py-8 bg-neutral-50 dark:bg-neutral-900">
      <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
        {/* Decorative: the name follows immediately below as real text. */}
        <BrandLogo logo={APP_LOGO} class="h-12 w-12 mx-auto mb-4" />
        {/* No "Sign in to…" beneath: the name is the heading, and the form
            under it starts with a Sign in tab. */}
        <h1
          class={`text-2xl font-semibold text-center text-neutral-900 dark:text-neutral-50 ${INSTANCE_NAME ? "mb-1" : "mb-6"}`}
        >
          {APP_NAME}
        </h1>
        {INSTANCE_NAME && (
          <p class="text-sm text-center mb-6 text-neutral-500 dark:text-neutral-400">
            {INSTANCE_NAME}
          </p>
        )}

        {discovery.kind === "loading" && (
          <p class="text-sm text-center text-neutral-500 dark:text-neutral-400 py-6">
            {t("login.loading")}
          </p>
        )}
        {discovery.kind === "unavailable" && (
          <p
            class="text-sm text-center text-red-600 dark:text-red-400 py-6"
            role="alert"
          >
            {t("login.serverUnavailable")}
          </p>
        )}
        {discovery.kind === "ready" && <SignInOptions auth={discovery.auth} />}

        <OrgCredit class="mt-6" />

        {SERVER_ORIGIN !== null && (
          <p class="mt-6 text-xs text-center text-neutral-400 dark:text-neutral-500 break-all">
            {t("login.serverLabel")}: {SERVER_ORIGIN}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Whichever ways in the server offers. With both, single sign-on comes first,
 * and the password form follows it, or waits behind a link when the server
 * keeps local accounts only as a spare key.
 */
function SignInOptions({ auth }: { auth: CapabilitiesResponse["auth"] }) {
  const { providers } = auth;
  const collapsed = auth.passwordForm === "collapsed";
  const [showPassword, setShowPassword] = useState(!collapsed);
  const [resetToken, setResetToken] = useState<string | null>(() =>
    takeResetToken(),
  );
  const [signInToken, setSignInToken] = useState<string | null>(() =>
    takeSignInLinkToken(),
  );
  const [forgot, setForgot] = useState(false);
  const [byLink, setByLink] = useState(false);
  const oidc = providers.includes("oidc");
  const local = providers.includes("local");
  if (resetToken && local) {
    return (
      <ResetPasswordForm
        token={resetToken}
        onDone={() => setResetToken(null)}
      />
    );
  }
  if (signInToken && local) {
    return (
      <SignInLinkLanding
        token={signInToken}
        onDone={() => setSignInToken(null)}
      />
    );
  }
  if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;
  if (byLink) return <SignInLinkForm onBack={() => setByLink(false)} />;
  return (
    <>
      {oidc && <OidcLoginPanel />}
      {oidc && local && (
        <div class="my-5 flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
          <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
          {t("login.or")}
          <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
        </div>
      )}
      {local &&
        (showPassword || !oidc ? (
          <LocalLoginForm
            onForgot={auth.passwordReset ? () => setForgot(true) : undefined}
            onEmailLink={auth.magicLink ? () => setByLink(true) : undefined}
            canRegister={auth.registration}
            passkeys={auth.passkeys && passkeysSupported()}
          />
        ) : (
          <button
            type="button"
            class="w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
            onClick={() => setShowPassword(true)}
          >
            {t("login.withPassword")}
          </button>
        ))}
    </>
  );
}

function OidcLoginPanel() {
  const href = oidcLoginUrl ?? "#";
  const refusal = oidcRefusal.value;
  return (
    <div class="space-y-4 py-2">
      {refusal && (
        <p
          class="text-sm text-center text-red-600 dark:text-red-400"
          role="alert"
        >
          {t(OIDC_REFUSAL_MESSAGES[refusal])}
        </p>
      )}
      <p class="text-sm text-center text-neutral-600 dark:text-neutral-300">
        {t("login.oidcHint")}
      </p>
      <a
        href={href}
        class="block w-full text-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 transition-colors"
      >
        {t("login.oidcSubmit")}
      </a>
    </div>
  );
}
