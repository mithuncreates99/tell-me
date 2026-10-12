import { describe, expect, it, vi } from 'vitest';
import { CHECK_EVERY_MS, RELOAD_WINDOW_MS, UPDATE_READY_EVENT, watchForUpdates } from '../src/lib/updates';

/** A fake browser: a service worker container, a document that can go hidden, and a window with a clock. */
function fakeBrowser(opts: { controller?: boolean } = {}) {
  let time = 1_000_000;
  let timer: (() => void) | null = null;
  const sw = Object.assign(new EventTarget(), {
    controller: opts.controller === false ? null : ({} as ServiceWorker),
    registration: { update: vi.fn(async () => undefined) },
    register: vi.fn(async function (this: { registration: unknown }) {
      return sw.registration as unknown as ServiceWorkerRegistration;
    }),
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = Object.assign(new EventTarget(), {
    location: { reload: vi.fn() },
    setInterval: ((fn: () => void) => {
      timer = fn;
      return 1;
    }) as unknown as Window['setInterval'],
  });
  const updateReady = vi.fn();
  win.addEventListener(UPDATE_READY_EVENT, updateReady);
  watchForUpdates({ sw, doc, win, now: () => time, scriptUrl: '/tell-me/sw.js', scope: '/tell-me/' });
  win.dispatchEvent(new Event('load'));

  return {
    sw,
    win,
    updateReady,
    wait: (ms: number) => {
      time += ms;
    },
    /** The app leaves the screen, or comes back. */
    show: async (visible: boolean) => {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    },
    touch: () => win.dispatchEvent(new Event('pointerdown')),
    /** A new version finished downloading and took over. */
    newVersion: () => sw.dispatchEvent(new Event('controllerchange')),
    hourly: () => timer?.(),
    reloads: () => win.location.reload.mock.calls.length,
  };
}

describe('moving an open app to a new version', () => {
  it('looks for a new version every time the app comes back on screen, and hourly while open', async () => {
    const b = fakeBrowser();
    await Promise.resolve(); // registration
    expect(b.sw.register).toHaveBeenCalledWith('/tell-me/sw.js', { scope: '/tell-me/' });
    await b.show(false);
    expect(b.sw.registration.update).not.toHaveBeenCalled();
    await b.show(true);
    expect(b.sw.registration.update).toHaveBeenCalledTimes(1);
    b.hourly();
    expect(b.sw.registration.update).toHaveBeenCalledTimes(2);
    expect(CHECK_EVERY_MS).toBe(3_600_000);
  });

  it('reloads straight into a new version found when the app was just brought back', async () => {
    const b = fakeBrowser();
    b.wait(3 * 3_600_000); // left open in the background for hours
    await b.show(false);
    await b.show(true);
    b.wait(2_000);
    b.newVersion();
    expect(b.reloads()).toBe(1);
    expect(b.updateReady).not.toHaveBeenCalled();
  });

  it('offers the reload while the person is using the app, then reloads once it goes to the background', async () => {
    const b = fakeBrowser();
    await b.show(true);
    b.wait(1_000);
    b.touch(); // they started typing a habit
    b.wait(1_000);
    b.newVersion();
    expect(b.reloads()).toBe(0);
    expect(b.updateReady).toHaveBeenCalledTimes(1);
    await b.show(false);
    expect(b.reloads()).toBe(1);
  });

  it('offers the reload when the new version arrives long after the app came on screen', () => {
    const b = fakeBrowser();
    b.wait(RELOAD_WINDOW_MS + 1);
    b.newVersion();
    expect(b.reloads()).toBe(0);
    expect(b.updateReady).toHaveBeenCalledTimes(1);
  });

  it('reloads right away when the new version arrives while the app is out of sight', async () => {
    const b = fakeBrowser();
    b.touch();
    b.wait(RELOAD_WINDOW_MS + 1);
    await b.show(false);
    b.newVersion();
    expect(b.reloads()).toBe(1);
  });

  it('does nothing on the very first install, but handles a new version later in that visit', async () => {
    const b = fakeBrowser({ controller: false });
    b.newVersion(); // the first install takes over
    expect(b.reloads()).toBe(0);
    expect(b.updateReady).not.toHaveBeenCalled();
    b.wait(3_600_000);
    await b.show(false);
    await b.show(true);
    b.newVersion(); // a real update, found on coming back
    expect(b.reloads()).toBe(1);
  });
});
