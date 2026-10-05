// Types for the service worker build (WebWorker lib, no DOM).
interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly BASE_URL: string;
  readonly VITE_API_URL?: string;
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
