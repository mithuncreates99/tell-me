import { useEffect, useState } from 'react';
import { IS_PREVIEW } from './lib/platform';

/**
 * Tiny hash router. Hash URLs work on GitHub Pages (no server rewrites) and inside the
 * installed app, and they are what notifications and calendar events link to.
 */
export type Route =
  | { name: 'today' }
  | { name: 'calendar' }
  | { name: 'insights' }
  | { name: 'habits' }
  | { name: 'habit-new' }
  | { name: 'habit-edit'; id: string }
  | { name: 'settings' }
  | { name: 'checkin'; habitId: string; date?: string }
  | { name: 'demo' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'calendar':
      return { name: 'calendar' };
    case 'insights':
    case 'report':
      return { name: 'insights' };
    case 'habits':
      if (parts[1] === 'new') return { name: 'habit-new' };
      if (parts[1]) return { name: 'habit-edit', id: parts[1] };
      return { name: 'habits' };
    case 'settings':
      return { name: 'settings' };
    case 'checkin':
      if (parts[1]) return { name: 'checkin', habitId: parts[1], date: parts[2] };
      return { name: 'today' };
    case 'demo':
      return { name: 'demo' };
    default:
      return { name: 'today' };
  }
}

// The preview build runs inside a sandboxed frame, so it keeps the route in memory instead of the URL.
let memoryHash = '#/';
const MEMORY_EVENT = 'tell-me:navigate';
const currentHash = () => (IS_PREVIEW ? memoryHash : location.hash);

export function navigate(path: string, replace = false): void {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (IS_PREVIEW) {
    memoryHash = hash;
    window.dispatchEvent(new Event(MEMORY_EVENT));
  } else if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

if (IS_PREVIEW && typeof document !== 'undefined') {
  // In-app links (<a href="#/...">) go through the memory router.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(currentHash()));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(currentHash()));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(IS_PREVIEW ? MEMORY_EVENT : 'hashchange', onChange);
    return () => window.removeEventListener(IS_PREVIEW ? MEMORY_EVENT : 'hashchange', onChange);
  }, []);
  return route;
}
