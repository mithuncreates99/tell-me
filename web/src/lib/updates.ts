/**
 * How an open app moves to a new version (no browser globals here, so it can be tested on its own;
 * registerSW.ts connects it to the real service worker, document and window).
 */

/** Fired when a new version took over while the app was in use (the app offers a reload). */
export const UPDATE_READY_EVENT = 'tell-me:update-ready';

/** A new version may reload the app without asking this soon after it was opened or came back on screen. */
export const RELOAD_WINDOW_MS = 15_000;
/** While the app stays on screen, look for a new version this often. */
export const CHECK_EVERY_MS = 60 * 60_000;

export interface UpdateEnv {
  sw: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'register'>;
  doc: Pick<Document, 'visibilityState' | 'addEventListener'>;
  win: Pick<Window, 'addEventListener' | 'dispatchEvent' | 'setInterval'> & { location: { reload(): void } };
  now: () => number;
  scriptUrl: string;
  scope: string;
}

/**
 * Keeps an open app on the newest version. Installed apps are usually resumed, not reopened, and a
 * resume doesn't look for a new version by itself, so the app asks every time it comes back on
 * screen (and hourly while it stays open). The service worker activates a new version as soon as
 * it's downloaded. Then:
 * - the app was just opened or brought back, and hasn't been touched since: reload straight into it;
 * - the person is using it: offer a reload, and reload by itself the next time it goes to the background.
 */
export function watchForUpdates(env: UpdateEnv): void {
  // Without a controller, the first takeover is the very first install (not an update) on this visit.
  let installed = !!env.sw.controller;
  let shownAt = env.now();
  let touchedAt = 0;
  let updateWaiting = false;
  let reloading = false;
  let registration: Pick<ServiceWorkerRegistration, 'update'> | null = null;

  const reload = () => {
    if (reloading) return;
    reloading = true;
    env.win.location.reload();
  };
  const check = () => void registration?.update().catch(() => {});

  env.sw.addEventListener('controllerchange', () => {
    if (!installed) {
      installed = true;
      return;
    }
    const untouched = touchedAt < shownAt;
    if (env.doc.visibilityState === 'hidden' || (untouched && env.now() - shownAt < RELOAD_WINDOW_MS)) return reload();
    updateWaiting = true;
    env.win.dispatchEvent(new Event(UPDATE_READY_EVENT));
  });

  env.doc.addEventListener('visibilitychange', () => {
    if (env.doc.visibilityState === 'hidden') {
      if (updateWaiting) reload(); // out of sight: nothing on screen is lost
      return;
    }
    shownAt = env.now();
    check();
  });
  const touched = () => {
    touchedAt = env.now();
  };
  env.win.addEventListener('pointerdown', touched, { capture: true, passive: true });
  env.win.addEventListener('keydown', touched, { capture: true, passive: true });
  env.win.setInterval(() => {
    if (env.doc.visibilityState === 'visible') check();
  }, CHECK_EVERY_MS);

  env.win.addEventListener('load', () => {
    env.sw
      .register(env.scriptUrl, { scope: env.scope })
      .then((r) => {
        registration = r;
      })
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}
