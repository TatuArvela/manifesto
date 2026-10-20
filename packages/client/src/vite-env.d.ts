/// <reference types="vite/client" />

// The branding variables (VITE_APP_NAME, VITE_APP_LOGO, VITE_INSTANCE_NAME,
// VITE_ORG_NAME, VITE_ORG_LOGO, VITE_APP_DESCRIPTION, VITE_APP_ICONS_DIR) are
// intentionally absent. `vite.config.ts` uses them, and gives them to the
// bundle as `__APP_NAME__` and `__BRANDING__`. A read of them here would skip
// the defaults and the meta-tag overrides.
interface ImportMetaEnv {
  readonly VITE_MANIFESTO_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
