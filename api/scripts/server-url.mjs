#!/usr/bin/env node
// Prints the deployed server's URL (https://tell-me-api.<subdomain>.workers.dev), or nothing if
// there's no token or no subdomain yet. Used by the web deploy to point the app at its server.
import { accountId, workersSubdomain } from './cloudflare.mjs';

try {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    const subdomain = await workersSubdomain(await accountId());
    if (subdomain) process.stdout.write(`https://tell-me-api.${subdomain}.workers.dev`);
  }
} catch (err) {
  console.error(`(could not look up the server URL: ${err.message})`);
}
