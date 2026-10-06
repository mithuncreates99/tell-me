# Tell Me on iPhone

There are two ways to have Tell Me on an iPhone. Both come from the same code.

| | **Home Screen web app** | **Native iPhone app** (`web/ios`) |
| --- | --- | --- |
| How people install it | Open your link in Safari → Share → Add to Home Screen | From Xcode (your phone), TestFlight (friends) or the App Store |
| Reminders | Web push from your Cloudflare worker | Local notifications scheduled on the phone, **no server** |
| Yes/No on the notification | Tap the notification, then answer | **✅ Yes / ❌ No buttons** (press and hold the notification) |
| Cost to share | Free | Apple Developer Program, $99/year |
| Good for | Sharing with anyone today | Daily use, portfolio, App Store |

The web app is covered in [DEPLOY.md](DEPLOY.md). This page is about the native app.

## 1. Run it on your own iPhone (free)

You need a Mac with **Xcode** (free in the Mac App Store), an iPhone with iOS 15 or later, a cable, and your Apple ID.

```bash
cd tell-me/web
npm ci          # also downloads the native plugins Xcode builds from
npm run ios     # builds the app, copies it into the Xcode project, opens Xcode
```

In Xcode:

1. In the left sidebar click **App** (the blue project icon), then the **App** target, then **Signing & Capabilities**.
2. Under **Team**, choose **Add an Account…**, sign in with your Apple ID, and pick **"Your Name (Personal Team)"**.
3. If Xcode says the bundle identifier is unavailable, change `com.mithun.tellme` to something unique, e.g. `com.yourname.tellme` (also update `appId` in `web/capacitor.config.ts`).
4. Plug in your iPhone, choose it in the device menu at the top of the window, and press **▶ Run**.
5. The first time only:
   - iPhone: **Settings → Privacy & Security → Developer Mode** → on (the phone restarts).
   - iPhone: **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.
6. Open **Tell Me**, go to **Settings → Turn on reminders**, and tap **Allow**. Tap **Send a test**, then lock the phone. The notification arrives in 3 seconds. Press and hold it to see **✅ Yes / ❌ No**.

> With a free Apple ID, apps installed from Xcode stop opening after 7 days. Plug in and press Run again to renew. Your data stays.

## 2. Share it with friends (TestFlight)

TestFlight lets up to 10,000 people install your app from a link. It needs the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).

1. **Join the program** with your Apple ID (approval can take a day or two).
2. In Xcode → **Signing & Capabilities**, switch **Team** to your paid team.
3. In [App Store Connect](https://appstoreconnect.apple.com) go to **Apps → + → New App**:
   - Platform iOS, name **Tell Me: Habit Check-ins** (App Store names must be unique, so add a subtitle if "Tell Me" is taken; the Home Screen still says "Tell Me")
   - Bundle ID: the same one as in Xcode
4. In Xcode: set the run destination to **Any iOS Device**, then **Product → Archive**. When it finishes: **Distribute App → App Store Connect → Upload**.
5. In App Store Connect → **TestFlight**:
   - Add yourself under **Internal Testing** to try the build right away.
   - Create an **External Testing** group, add the build, and fill in the short "What to test" note. Apple runs a quick beta review, usually within a day.
   - Turn on **Public Link** and send it to your friends. They install **TestFlight** from the App Store, open your link, and tap **Install**.
6. For every new version: run `npm run ios:sync`, increase **Build** (Xcode → General → Identity), then Archive and Upload again.

### Going on the App Store (optional)

From the same App Store Connect page: add screenshots (the `docs/screenshots` set is a good start; Apple wants 6.9" iPhone sizes), a description, a support URL (your GitHub repo works), a privacy policy URL, and an age rating, then **Submit for Review**.

For the privacy questions: without an account, the native app collects **no data** (reminders are scheduled on the phone, there are no analytics). Accounts, sync and friends are optional; see [PRIVACY.md](PRIVACY.md) for exactly what the server stores. Synced habits are end-to-end encrypted.

**Connecting the iPhone app to your server.** Accounts and friends need the server URL at build time. Put it in `web/.env.production` before `npm run ios`:

```bash
VITE_API_URL=https://tell-me-api.<your-subdomain>.workers.dev
VITE_PUBLIC_URL=https://<your-username>.github.io/tell-me/
```

Friends' nudges and reactions arrive live while the app is open. (Remote push notifications on iPhone would need Apple's push service and a paid developer account; web push covers Android, desktop and Home Screen web apps.)

## 3. After you change the code

```bash
cd web
npm run ios:sync   # rebuild the web app and copy it into the iOS project
```

Then press **Run** in Xcode again.

## How the native app works

- **Same app, native shell.** [Capacitor 8](https://capacitorjs.com) runs the React app inside a native iOS shell. The Xcode project in `web/ios` uses Swift Package Manager, so there's no CocoaPods step.
- **Reminders on the phone.** `web/src/lib/localReminders.ts` plans "Did you show up?" notifications for the next 10 days (iOS allows 64 pending per app), skipping days you've already answered. `web/src/lib/native.ts` hands them to iOS with a notification category that has **Yes** and **No** buttons. Every time you open the app, the schedule is topped up, so a reminder only goes missing if you don't open the app for 10 days.
- **Answer from the notification.** Pressing **Yes** or **No** opens the app for a moment, records the answer, and shows the result. **No** goes straight to "What got in the way?".
- **Your data is safe.** iOS can clear a web view's storage when the phone is almost full, so the app keeps a second copy of everything in its native storage and restores it automatically. **Settings → Export backup** opens the share sheet (Files, AirDrop, Mail).
- **Tested.** `e2e/native.e2e.mjs` runs the app in Chromium behind a fake native shell. It checks that turning reminders on schedules the right notifications, that Yes/No buttons record answers, that answered days are removed from the schedule, and that a wiped web view is restored from the native copy.
