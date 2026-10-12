import { IS_NATIVE } from './lib/native';
import { IS_PREVIEW } from './lib/platform';
import { watchForUpdates } from './lib/updates';

export { UPDATE_READY_EVENT } from './lib/updates';

export function registerServiceWorker(): void {
  // The iPhone app ships its files inside the app and schedules reminders natively.
  if (IS_PREVIEW || IS_NATIVE || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  watchForUpdates({
    sw: navigator.serviceWorker,
    doc: document,
    win: window,
    now: Date.now,
    scriptUrl: `${import.meta.env.BASE_URL}sw.js`,
    scope: import.meta.env.BASE_URL,
  });
}
