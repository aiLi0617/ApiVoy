/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APIVOY_AGENT_URL?: string;
  readonly VITE_APIVOY_AGENT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
