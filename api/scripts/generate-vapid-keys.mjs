#!/usr/bin/env node
// Generates a VAPID key pair for Web Push (ECDSA P-256), printed in the format the worker expects.
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', pair.privateKey);
const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
const publicKey = Buffer.from(publicRaw).toString('base64url');

console.log(`
VAPID keys generated.

1) Public key  -> paste into wrangler.toml as VAPID_PUBLIC_KEY:
   ${publicKey}

2) Private key -> store as a secret (never commit it):
   npx wrangler secret put VAPID_PRIVATE_KEY
   then paste: ${jwk.d}

For local development put both in api/.dev.vars:
VAPID_PUBLIC_KEY="${publicKey}"
VAPID_PRIVATE_KEY="${jwk.d}"
`);
