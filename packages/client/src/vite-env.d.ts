/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MANIFESTO_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
