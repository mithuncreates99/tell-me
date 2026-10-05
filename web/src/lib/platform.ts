export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = (): boolean => /Android/i.test(navigator.userAgent);

export const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** The single-file preview build (no service worker, no push). */
export const IS_PREVIEW = import.meta.env.MODE === 'preview';

export const APP_VERSION = '1.0.0';
export const REPO_URL: string = import.meta.env.VITE_REPO_URL ?? '';
