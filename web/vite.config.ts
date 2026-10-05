import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // "preview" mode builds a single self-contained page with no service worker (used for demos).
  const preview = mode === 'preview';
  // Link previews (LinkedIn, WhatsApp…) need absolute URLs; CI passes the site's public URL.
  const siteUrl = process.env.SITE_URL?.replace(/\/?$/, '/');
  return {
    // Relative base: works at https://you.github.io/<repo>/ and on any custom domain.
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      siteUrl
        ? {
            name: 'absolute-social-links',
            transformIndexHtml: (html: string) =>
              html
                .replace('content="./icons/og-image.png"', `content="${siteUrl}icons/og-image.png"`)
                .replace('<meta property="og:type"', `<meta property="og:url" content="${siteUrl}" />\n    <meta property="og:type"`),
          }
        : null,
      !preview &&
        VitePWA({
          strategies: 'injectManifest',
          srcDir: 'src',
          filename: 'sw.ts',
          injectRegister: false,
          manifest: {
            name: 'Tell Me: habit check-ins',
            short_name: 'Tell Me',
            description: 'One question for every habit: did you show up? Yes/No check-ins, reminders and weekly insights.',
            start_url: './',
            scope: './',
            display: 'standalone',
            background_color: '#f6f6f9',
            theme_color: '#634cd4',
            categories: ['health', 'lifestyle', 'productivity'],
            icons: [
              { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
            shortcuts: [
              { name: 'Today', url: './#/', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
              { name: 'Weekly report', url: './#/insights', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
            ],
          },
          injectManifest: {
            globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
            globIgnores: ['**/og-image.png', '**/assets/web-*.js'], // Capacitor's web fallbacks are never loaded on the web
            rollupFormat: 'iife',
          },
          devOptions: { enabled: false },
        }),
    ],
    build: preview
      ? { assetsInlineLimit: 100_000_000, cssCodeSplit: false, outDir: 'dist-preview', modulePreload: false }
      : { sourcemap: false },
  };
});
