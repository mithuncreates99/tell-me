/**
 * Only real browser push services are accepted as subscription endpoints.
 * Without this check the worker could be abused to POST to arbitrary URLs.
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Android), Samsung Internet, Opera
  'android.googleapis.com',
  'updates.push.services.mozilla.com', // Firefox
  'push.services.mozilla.com',
  'web.push.apple.com', // Safari on macOS / iOS Home Screen apps
];
const PUSH_SERVICE_SUFFIXES = ['.push.apple.com', '.notify.windows.com']; // Edge on Windows uses WNS

export function isAllowedPushEndpoint(endpoint: string, allowAny = false): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (allowAny) return url.protocol === 'https:' || url.protocol === 'http:';
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s));
}
