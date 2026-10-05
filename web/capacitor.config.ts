import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS app (Capacitor). The same React app runs inside a native shell; on iPhone,
 * reminders are scheduled on the device as local notifications with Yes/No buttons,
 * so no server is needed. See docs/IOS.md.
 */
const config: CapacitorConfig = {
  // Change to your own reverse-domain id before publishing (e.g. com.yourname.tellme).
  appId: 'com.mithun.tellme',
  appName: 'Tell Me',
  webDir: 'dist',
  ios: {
    contentInset: 'never', // the app handles the notch and home indicator itself (safe-area CSS)
    backgroundColor: '#f6f6f9',
  },
};

export default config;
