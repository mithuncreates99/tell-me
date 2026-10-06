# Privacy

The short version: **without an account, nothing leaves your device. With an account, your data is end-to-end encrypted, and friends only see the habits you choose to share.** The app has the same information under Settings → Privacy.

## Without an account

Your habits, Yes/No answers, reasons and notes are stored in your browser or in the iPhone app only (IndexedDB). Nothing is sent anywhere.

If you turn on push reminders, the reminder server stores each reminder's habit name, emoji and time, your time zone, and your device's push address. It never learns your answers. Turning reminders off deletes all of that.

## With an account

Your account is a random key that only your devices hold. There's no email and no password.

- Every habit and check-in is **encrypted on your device** (AES-256-GCM) before it's uploaded, with a key derived from your account key (HKDF-SHA256). The server stores ciphertext it can't read.
- Records are stored under **opaque ids** (HMAC-SHA256), so the server can't see which habit or which date a record belongs to.
- The server identifies your account by the SHA-256 hash of a secret derived from your key. It never receives the key itself.
- If you lose your key and all your devices, the data can't be recovered by anyone, including the developer.

If one of your devices has push reminders on, the device you answer on tells the server which check-in you answered (habit id and date, not the answer) so the reminder isn't sent. Without push reminders, this is never sent.

## What friends can see

Only habits you mark as **shared**: their name and emoji, which days and at what time they're planned, today's answer, this week's Yes/No pattern and your current streak. Reasons, notes, past weeks and your other habits are never shared.

Friends also see your display name, avatar emoji and roughly when you were last active (to the nearest 15 minutes). Friends are only told about an update when something they can see has changed, so they can't tell when you open the app.

A reaction or a nudge is seen only by the two people involved. Not even a friend you have in common sees it.

**Challenges** are made up of the organiser's friends. Members see each other's progress on the one habit each of them picked for the challenge, and nothing else. When you're invited, you see who's in it, but not how they're doing, until you join and share your own progress. Invites that haven't been answered are only shown to the organiser.

**Friend codes** work like a key to your shared habits, because anyone with your code can add you. Looking a code up shows only a name and an avatar. You can change your code at any time, and old invite links stop working. Guessing codes is limited, per account and per network.

**Removing a friend** applies to both of you at once. You stop seeing each other's habits, reactions and nudges, and each of you leaves the challenges the other started. You both stay in challenges that someone else started until you leave them. They aren't notified.

**Notifications** from friends (nudges, reactions, invites) are encrypted end to end to your device by Web Push. The push services (Apple, Google, Mozilla, Microsoft) can't read them, and no header shows who sent them. They only reach devices signed in to your account. A phone you sign out of stops getting them, even if you were offline when you signed out.

## What the server stores

| Data | Why | Kept |
| --- | --- | --- |
| Display name, avatar emoji, friend code, time zone | So friends recognise you and dates line up | Until you delete your account |
| Encrypted habits and check-ins | Sync between your devices | Until you delete them or your account |
| Snapshot of shared habits | What friends see | Replaced on every update |
| Friend list, challenges | Friends features | Until removed |
| Reactions and nudges | Friends features | Two weeks |
| Push reminder schedule (names, emoji, times) and push address | Sending reminders | Until you turn reminders off |
| Counters of sign-ups, friend-code tries and invite links opened (per network or account) | Stopping abuse, such as guessing friend codes | One hour |

The server runs on Cloudflare Workers with a D1 database.

## Deleting your data

- **Settings → Account → Delete account** removes everything the server stores about you, immediately, in one transaction. Afterwards your account's id doesn't appear anywhere in the database. Invites you sent that nobody answered are removed, and challenges others joined carry on without you. Your other devices are disconnected and signed out. The device you used keeps its local copy.
- **Signing out** removes the account's habits, answers and key from that device without deleting anything from your account. On the iPhone, its backup and scheduled reminders are removed too.
- **Settings → Reminders → Turn off** deletes your device from the reminder server.
- **Settings → Your data → Erase everything** deletes your habits and check-ins on every device signed in to your account.

## How this is tested

Every statement above is checked automatically on every push (see `.github/workflows/ci.yml`):

| What's promised | Where it's tested |
| --- | --- |
| Friends get only shared habits, and only the fields listed above | [`api/scripts/privacy-test.mjs`](../api/scripts/privacy-test.mjs) §3, [`web/test/privacy.test.ts`](../web/test/privacy.test.ts), [`e2e/privacy.e2e.mjs`](../e2e/privacy.e2e.mjs) |
| Private habits, notes, reasons and the account key never leave the device in a readable form | `web/test/privacy.test.ts`, `e2e/privacy.e2e.mjs` |
| Strangers see nothing, can't tell whether an account exists, can't poke anyone, can't read synced data | `privacy-test.mjs` §5–6 |
| Live updates reach only friends, and only when something they can see changed | `privacy-test.mjs` §4 and §12 |
| Reactions and nudges are visible only to the two people involved | `privacy-test.mjs` §5 |
| Notifications contain only what the recipient can see, have no revealing headers, and reach only signed-in devices | `privacy-test.mjs` §5 and §9, [`api/test/privacy.test.ts`](../api/test/privacy.test.ts) |
| Invite links and codes show a name and an avatar only, can be changed, and can't be guessed | `privacy-test.mjs` §2 and §11 |
| Challenge visibility, invites and leaving | `privacy-test.mjs` §7 |
| Removing a friend, both ways, challenges included | `privacy-test.mjs` §8, `e2e/privacy.e2e.mjs` |
| Deleting an account leaves no trace and disconnects its devices | `privacy-test.mjs` §10 |
| Signing out leaves nothing of the account on the device | `web/test/privacy.test.ts`, `e2e/privacy.e2e.mjs` |

`privacy-test.mjs` runs the real worker locally with a database, live connections and a mock push service that decrypts every notification. The last section of that test checks every response, live message and notification that each test user received, looking for anything they shouldn't have seen. Before these protections were added, 20 of its 54 checks failed on the server code, one for each problem the test was written to catch.

```sh
npm run test:privacy                 # server: 54 checks against the real worker
npm --prefix web test -- privacy     # app: what leaves the device
node e2e/privacy.e2e.mjs             # three real browsers
```

## No ads, no tracking

Tell Me has no analytics, no ads and no third-party trackers. The code is open source, so all of this can be checked.
