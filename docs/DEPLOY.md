# Deploy Tell Me (free, about 20 minutes)

You'll end up with:

- **The app** at `https://<your-username>.github.io/tell-me/` (GitHub Pages)
- **The reminder service** at `https://tell-me-api.<your-subdomain>.workers.dev` (Cloudflare Workers + D1)

Both run on free plans. You need a GitHub account, a free [Cloudflare account](https://dash.cloudflare.com/sign-up), Node.js 22 or newer, and Git.

---

## 1. Put the code on GitHub

Create an empty **public** repository called `tell-me` on GitHub (no README or license; the project already has them). Then, in the project folder:

```bash
git init
git add .
git commit -m "Tell Me v1.0"
git branch -M main
git remote add origin https://github.com/<your-username>/tell-me.git
git push -u origin main
```

## 2. Deploy the reminder service (Cloudflare)

```bash
cd api
npm ci
npx wrangler login                 # opens your browser to authorise Wrangler
npx wrangler d1 create tell-me    # creates the database and prints its database_id
```

Open `api/wrangler.toml` and replace `database_id = "00000000-…"` with the id that was printed. (If Wrangler offers to add the database to your config for you, say **no**. The binding is already there and only needs the id.)

Generate the push keys (VAPID). This runs on your machine, and the private key never leaves it except as an encrypted Cloudflare secret:

```bash
npm run vapid
```

1. Paste the **public key** into `wrangler.toml` as `VAPID_PUBLIC_KEY`.
2. Set `VAPID_SUBJECT` to a way for push services (Google, Apple, Mozilla) to reach you if something goes wrong. Users never see it. Your repo URL, e.g. `https://github.com/<your-username>/tell-me`, keeps your email out of the public repo. `mailto:you@example.com` also works.

Create the tables, deploy, then add the private key as a secret:

```bash
npm run db:migrate:remote
npx wrangler deploy                          # prints https://tell-me-api.<your-subdomain>.workers.dev
npx wrangler secret put VAPID_PRIVATE_KEY    # paste the private key when asked
```

The first deploy may ask you to pick a `workers.dev` subdomain. Check it works:

```bash
curl https://tell-me-api.<your-subdomain>.workers.dev/api/health
# {"ok":true,"service":"tell-me-api",...}
curl https://tell-me-api.<your-subdomain>.workers.dev/api/config
# {"vapidPublicKey":"B..."}
```

## 3. Deploy the app (GitHub Pages)

1. On GitHub, open your repo, then **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → Variables** and add a **repository variable**:
   - Name: `VITE_API_URL`
   - Value: your worker URL, e.g. `https://tell-me-api.<your-subdomain>.workers.dev` (no trailing slash)
3. Go to **Actions → "Deploy web app to GitHub Pages" → Run workflow**. Pushing any change to `web/` also deploys.

After a minute or two the app is live at `https://<your-username>.github.io/tell-me/`. If you forked the repo, point the links at the top of the README to your own site.

## 4. Lock the API down to your site (recommended)

In `api/wrangler.toml` set:

```toml
ALLOWED_ORIGINS = "https://<your-username>.github.io"
```

and run `npx wrangler deploy` again.

## 5. Install it on your phone

> Prefer a real App Store-style app with Yes/No buttons on iPhone notifications? See **[IOS.md](IOS.md)** for the native iPhone app.

**iPhone (iOS 16.4 or newer).** Web push only works for Home Screen apps on iPhone.

1. Open your app link in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**.
3. Open Tell Me **from the Home Screen icon**, go to **Settings → Turn on reminders**, and tap **Allow**.
4. Tap **Send a test**. A notification should arrive within seconds.

**Android.** Open the link in Chrome, choose **⋮ → Install app** (or **Add to Home screen**), open it, then go to **Settings → Turn on reminders → Allow**. On Android you can answer **Yes/No** straight from the notification.

**Laptop.** In Chrome or Edge, click the install icon in the address bar. Notifications work while the browser is running.

## 6. (Optional) Deploy the API automatically from GitHub

1. In Cloudflare: **My Profile → API Tokens → Create Token**, starting from the **"Edit Cloudflare Workers"** template, and add the **D1: Edit** permission.
2. In GitHub: add a repository **secret** `CLOUDFLARE_API_TOKEN` with that token, and a repository **variable** `DEPLOY_API` = `true`.

From then on, every push that changes `api/` is tested and deployed by `.github/workflows/deploy-api.yml`.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Settings says "No reminder server connected" | The `VITE_API_URL` variable is missing or misspelled. Fix it, then re-run the Pages workflow. |
| iPhone has no "Turn on reminders" button | Open the app from the **Home Screen icon**, not from Safari. |
| "Notifications are blocked" | Allow notifications for the site (browser site settings, or on iPhone: Settings → Notifications → Tell Me), then reload. |
| The test says "sent" but nothing appears | Check Focus / Do Not Disturb and the browser's notification permission in system settings. Run `npx wrangler tail` in `api/` to see live logs. |
| Reminders arrive a minute late | Expected. The cron runs once a minute, and the free plan sends up to 8 pushes per minute (raise `MAX_PUSHES_PER_TICK` on a paid plan). |
| You regenerated the VAPID keys | Old subscriptions stop working. In the app, turn reminders off and on again. |
| `wrangler deploy` fails with an authentication error | Run `npx wrangler login` again, or check the API token permissions. |

## What it costs

| Service | Free allowance | Tell Me's usage |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests/day, 5 cron triggers | 1,440 cron runs/day plus a few requests per user |
| Cloudflare D1 | 5M rows read and 100k rows written per day | Each cron run reads only the reminders that are due |
| GitHub Pages | Free for public repos | Static files |
