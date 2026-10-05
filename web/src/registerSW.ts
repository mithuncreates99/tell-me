import { IS_NATIVE } from './lib/native';
import { IS_PREVIEW } from './lib/platform';

export function registerServiceWorker(): void {
  // The iPhone app ships its files inside the app and schedules reminders natively.
  if (IS_PREVIEW || IS_NATIVE || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}
