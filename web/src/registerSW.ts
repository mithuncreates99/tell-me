import { IS_NATIVE } from './lib/native';
import { IS_PREVIEW } from './lib/platform';

/** Fired when a new version took over while the app was in use (the app offers a reload). */
export const UPDATE_READY_EVENT = 'tell-me:update-ready';

export function registerServiceWorker(): void {
  // The iPhone app ships its files inside the app and schedules reminders natively.
  if (IS_PREVIEW || IS_NATIVE || import.meta.env.DEV || !('serviceWorker' in navigator)) return;

  // A new version activates as soon as it's downloaded. Reload into it right away if the app was
  // just opened (or isn't on screen); otherwise let the app offer a reload, so nothing typed is lost.
  const hadController = !!navigator.serviceWorker.controller;
  const openedAt = Date.now();
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (Date.now() - openedAt < 15_000 || document.visibilityState === 'hidden') {
      reloading = true;
      window.location.reload();
    } else {
      window.dispatchEvent(new Event(UPDATE_READY_EVENT));
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}
