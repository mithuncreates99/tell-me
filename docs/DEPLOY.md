# Deploy Tell Me (free, about 10 minutes)

You'll end up with:

- **The app** at `https://<your-username>.github.io/tell-me/` (GitHub Pages)
- **The server** at `https://tell-me-api.<your-subdomain>.workers.dev` (Cloudflare Workers + D1 + Durable Objects): push reminders, accounts, end-to-end encrypted sync, friends and live updates

Both run on free plans. You need a GitHub account and a free [Cloudflare account](https://dash.cloudflare.com/sign-up). Nothing has to be installed on your computer: GitHub Actions does the deploying.

---

## 1. Put the code on GitHub

Fork this repository, or push your copy to a new **public** repository called `tell-me`:

```bash
git remote add origin https://github.com/<your-username>/tell-me.git
git push -u origin main
```

## 2. Give GitHub permission to deploy to Cloudflare (one secret)

1. Open this link while signed in to Cloudflare. It pre-fills a token with exactly the permissions the deploy needs (Workers Scripts: Edit, D1: Edit, Account Settings: Read):

   <https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=tell-me%20deploy>

   Scroll down, click **Continue to summary**, then **Create Token**, and copy it.
2. In your GitHub repo, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `CLOUDFLARE_API_TOKEN` and paste the token.

If your Cloudflare login has access to more than one account, also add a secret `CLOUDFLARE_ACCOUNT_ID` (the long id in the dashboard's address bar).

## 3. Deploy the server

Go to **Actions → "Deploy server to Cloudflare" → Run workflow**. In about a minute, [`api/scripts/deploy.mjs`](../api/scripts/deploy.mjs):

1. registers a `workers.dev` subdomain if your account doesn't have one yet
2. creates the D1 database `tell-me` and applies the migrations
3. deploys the worker, with its every-minute cron trigger and the `LiveHub` Durable Object
4. creates the VAPID key pair for Web Push **once** and stores both halves as worker secrets
5. checks `/api/health` and `/api/config` and prints the server URL in the run summary

It's safe to re-run, and it runs automatically whenever `api/` changes.

## 4. Deploy the app

1. In the repo, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Go to **Actions → "Deploy web app to GitHub Pages" → Run workflow**.

The workflow looks up your server's URL with the same token and builds the app against it, so there's nothing to copy. After a minute or two the app is live at `https://<your-username>.github.io/tell-me/`. Pushing changes to `web/` redeploys it. If you forked the repo, point the links at the top of the README to your own site.

For **iPhone app builds on your Mac**, put the server URL in `web/.env.production`:

```bash
VITE_API_URL=https://tell-me-api.<your-subdomain>.workers.dev
VITE_PUBLIC_URL=https://<your-username>.github.io/tell-me/
```

## 5. Install it on your phone

> Prefer an App Store-style app with Yes/No buttons on iPhone notifications? See **[IOS.md](IOS.md)** for the native iPhone app.

**iPhone (iOS 16.4 or newer).** Web push only works for Home Screen apps on iPhone.

1. Open your app link in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**.
3. Open Tell Me **from the Home Screen icon**, go to **Settings → Turn on reminders**, and tap **Allow**.
4. Tap **Send a test**. A notification should arrive within seconds.

**Android.** Open the link in Chrome, choose **⋮ → Install app** (or **Add to Home screen**), open it, then go to **Settings → Turn on reminders → Allow**. On Android you can answer **Yes/No** straight from the notification.

**Laptop.** In Chrome or Edge, click the install icon in the address bar. Notifications work while the browser is running.

**Friends.** Open **Friends → Create free account**, then **Share invite link** and send it in any chat. When a friend opens the link and signs up, you're connected.

## 6. (Optional) Lock the API down to your site

In `api/wrangler.toml` set `ALLOWED_ORIGINS = "https://<your-username>.github.io,capacitor://localhost"` (the second origin is the iPhone app) and push. Account requests are authenticated with bearer tokens, so this is defence in depth rather than a requirement.

---

## Deploying from your own computer instead

Everything above also works locally (Node 22+):

```bash
cd api && npm ci
export CLOUDFLARE_API_TOKEN=…        # the token from step 2
node scripts/deploy.mjs
```

Or fully by hand with Wrangler: `npx wrangler login`, `npx wrangler d1 create tell-me` (put the id in `wrangler.toml`), `npm run db:migrate:remote`, `npx wrangler deploy`, then `npm run vapid` and `npx wrangler secret put VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Deploy server" was skipped | The `CLOUDFLARE_API_TOKEN` secret is missing or misspelled. |
| The deploy says it can't list D1 databases or accounts | The token is missing a permission. Create it again from the link in step 2. |
| Settings says "No reminder server connected" | Re-run "Deploy web app" after the server deploy has succeeded once. |
| Friends says "Friends need the Tell Me server" | Same as above: the app was built without a server URL. |
| iPhone has no "Turn on reminders" button | Open the app from the **Home Screen icon**, not from Safari. |
| "Notifications are blocked" | Allow notifications for the site (browser site settings, or on iPhone: Settings → Notifications → Tell Me), then reload. |
| The test says "sent" but nothing appears | Check Focus / Do Not Disturb and the browser's notification permission in system settings. Run `npx wrangler tail` in `api/` to see live logs. |
| Reminders arrive a minute late | Expected. The cron runs once a minute, and the free plan sends up to 8 pushes per minute (raise `MAX_PUSHES_PER_TICK` on a paid plan). |
| The server URL doesn't answer right after the first deploy | A brand-new `workers.dev` subdomain can take a few minutes to come online. |

## What it costs

| Service | Free allowance | Tell Me's usage |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU per request | 1,440 cron runs/day plus a few requests per user and sync |
| Cloudflare D1 | 5M rows read and 100k rows written per day | Each cron run reads only the reminders that are due; sync reads only new records |
| Durable Objects | Included on Workers Free (SQLite-backed) | One per account, hibernating while idle |
| GitHub Pages | Free for public repos | Static files |
