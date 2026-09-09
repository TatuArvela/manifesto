/// <reference types="vite/client" />

// Branding vars (VITE_APP_NAME, VITE_APP_DESCRIPTION, VITE_APP_ICONS_DIR) are
// deliberately absent: they are consumed by `vite.config.ts`, which hands the
// name to the bundle as `__APP_NAME__`. Reading them here instead would skip
// the default and the meta-tag override.
interface ImportMetaEnv {
  readonly VITE_MANIFESTO_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
