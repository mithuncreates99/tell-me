/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the reminder server, e.g. https://tell-me-api.you.workers.dev */
  readonly VITE_API_URL?: string;
  /** Link to the source code shown in Settings → About. */
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
