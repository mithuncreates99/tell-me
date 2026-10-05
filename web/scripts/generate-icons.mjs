#!/usr/bin/env node
// Renders the app icons, notification badge, iOS assets and social preview image from SVG.
// Usage: npm i --no-save sharp && npm run icons   (the PNGs are committed, so this is only needed after a redesign)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = (await import(process.env.SHARP_PATH ?? 'sharp')).default;
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(webRoot, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });

const gradient = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b66f0"/><stop offset="1" stop-color="#4d2fc0"/></linearGradient>`;
// The mark: a speech bubble ("tell me") holding a check ("yes"), with a notification dot.
const BUBBLE = 'M176 124H336A72 72 0 0 1 408 196V280A72 72 0 0 1 336 352H244L150 418L178 352H176A72 72 0 0 1 104 280V196A72 72 0 0 1 176 124Z';
const CHECK = 'M184 238L234 286L328 188';
const mark = (scale = 1) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <path d="${BUBBLE}" fill="#fff"/>
  <path d="${CHECK}" fill="none" stroke="#5534c5" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="396" cy="132" r="42" fill="#ffd34d" stroke="#6650e2" stroke-width="16"/>
</g>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${gradient}</defs><rect width="512" height="512" rx="120" fill="url(#g)"/>${mark()}</svg>`;
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${gradient}</defs><rect width="512" height="512" fill="url(#g)"/>${mark(scale)}</svg>`;
// Monochrome badge (Android uses only the alpha channel): the bubble with the check cut out.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><mask id="m"><rect width="512" height="512" fill="#fff"/><path d="${CHECK}" fill="none" stroke="#000" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>
  <g transform="translate(256 256) scale(1.15) translate(-256 -270)"><path d="${BUBBLE}" fill="#fff" mask="url(#m)"/></g>
</svg>`;
const splash = (bg, size = 2732) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${gradient}</defs>
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${size / 2 - 256} ${size / 2 - 256})"><rect width="512" height="512" rx="120" fill="url(#g)"/>${mark()}</g></svg>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>${gradient}<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6f6f9"/><stop offset="1" stop-color="#e9e6fb"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g transform="translate(90 120) scale(0.25)"><rect width="512" height="512" rx="120" fill="url(#g)"/>${mark()}</g>
  <text x="90" y="330" font-family="Inter" font-weight="800" font-size="84" fill="#12111a" letter-spacing="-2">Tell Me</text>
  <text x="90" y="398" font-family="Inter" font-weight="600" font-size="40" fill="#514f63">Did you show up today?</text>
  <text x="90" y="448" font-family="Inter" font-weight="500" font-size="30" fill="#7c7a8f">Answer Yes or No. See your week.</text>
  <text x="90" y="520" font-family="Inter" font-weight="600" font-size="22" fill="#634cd4" letter-spacing="1">CHECK-INS · REMINDERS · INSIGHTS</text>
  <g transform="translate(700 150)">
    <rect width="420" height="170" rx="28" fill="#ffffff" stroke="rgba(20,18,40,0.08)"/>
    <g transform="translate(28 28) scale(0.086)"><rect width="512" height="512" rx="120" fill="url(#g)"/>${mark()}</g>
    <text x="88" y="46" font-family="Inter" font-weight="600" font-size="20" fill="#7c7a8f">Tell Me · now</text>
    <text x="88" y="74" font-family="Inter" font-weight="700" font-size="24" fill="#12111a">Gym: did you show up?</text>
    <rect x="28" y="102" width="174" height="44" rx="22" fill="#e3f7e7"/>
    <text x="115" y="131" text-anchor="middle" font-family="Inter" font-weight="700" font-size="20" fill="#078c38">✓ Yes</text>
    <rect x="218" y="102" width="174" height="44" rx="22" fill="#f0eff5"/>
    <text x="305" y="131" text-anchor="middle" font-family="Inter" font-weight="700" font-size="20" fill="#514f63">✕ No</text>
  </g>
  <g transform="translate(700 350)">
    <rect width="420" height="150" rx="28" fill="#ffffff" stroke="rgba(20,18,40,0.08)"/>
    <text x="28" y="48" font-family="Inter" font-weight="600" font-size="18" fill="#7c7a8f">THIS WEEK</text>
    <text x="28" y="112" font-family="Inter" font-weight="800" font-size="64" fill="#12111a">82%</text>
    ${[0.6, 0.72, 0.55, 0.8, 0.68, 0.76, 0.82]
      .map((v, i) => `<rect x="${200 + i * 28}" y="${118 - v * 80}" width="16" height="${v * 80}" rx="4" fill="${i === 6 ? '#634cd4' : '#9d98f2'}"/>`)
      .join('')}
  </g>
</svg>`;

const out = (path, buf) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
};
const png = (svg, w, h = w) => sharp(Buffer.from(svg)).resize(w, h).png().toBuffer();

out(join(pub, 'favicon.svg'), rounded);
out(join(pub, 'icons/icon-192.png'), await png(rounded, 192));
out(join(pub, 'icons/icon-512.png'), await png(rounded, 512));
out(join(pub, 'icons/maskable-512.png'), await png(fullBleed(0.72), 512));
out(join(pub, 'icons/apple-touch-icon.png'), await sharp(Buffer.from(fullBleed(0.8))).resize(180, 180).flatten({ background: '#5b40cc' }).png().toBuffer());
out(join(pub, 'icons/badge-96.png'), await png(badge, 96));
out(join(pub, 'icons/og-image.png'), await sharp(Buffer.from(og)).png().toBuffer());

// iOS app (Capacitor): App Store icons must be square and opaque; iOS rounds the corners itself.
const iosAssets = join(webRoot, 'ios/App/App/Assets.xcassets');
if (existsSync(iosAssets)) {
  out(
    join(iosAssets, 'AppIcon.appiconset/AppIcon-512@2x.png'),
    await sharp(Buffer.from(fullBleed(0.78))).resize(1024, 1024).flatten({ background: '#5b40cc' }).png().toBuffer(),
  );
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    out(join(iosAssets, 'Splash.imageset', name), await sharp(Buffer.from(splash('#f6f6f9'))).png().toBuffer());
  }
}
console.log('Icons written.');
