/// <reference types="vite/client" />

// Branding vars (VITE_APP_NAME, VITE_APP_LOGO, VITE_INSTANCE_NAME,
// VITE_ORG_NAME, VITE_ORG_LOGO, VITE_APP_DESCRIPTION, VITE_APP_ICONS_DIR) are
// deliberately absent: they are consumed by `vite.config.ts`, which hands them
// to the bundle as `__APP_NAME__` and `__BRANDING__`. Reading them here
// instead would skip the defaults and the meta-tag overrides.
interface ImportMetaEnv {
  readonly VITE_MANIFESTO_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
