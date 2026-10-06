# Privacy

The short version: **without an account, nothing leaves your device. With an account, your data is end-to-end encrypted, and friends only see the habits you choose to share.** The same text is in the app under Settings → Privacy.

## Without an account

Your habits, Yes/No answers, reasons and notes are stored in your browser or in the iPhone app only (IndexedDB). Nothing is sent anywhere.

If you turn on push reminders, the reminder server stores each reminder's habit name, emoji and time, your time zone, and your device's push address. It never learns your answers. Turning reminders off deletes all of that.

## With an account

Your account is a random key that only your devices hold. There's no email and no password.

- Every habit and check-in is **encrypted on your device** (AES-256-GCM) before it's uploaded, with a key derived from your account key (HKDF-SHA256). The server stores ciphertext it can't read.
- Records are stored under **opaque ids** (HMAC-SHA256), so the server can't see which habit or which date a record belongs to.
- The server identifies your account by the SHA-256 hash of a secret derived from your key. It never receives the key itself.
- If you lose your key and all your devices, the data can't be recovered by anyone, including the developer.

When you answer a check-in, your other devices are told that the check-in happened (habit id and date, not the answer) so they don't remind you again.

## What friends can see

Only habits you mark as **shared**: their name and emoji, which days they're planned, today's answer, this week's Yes/No pattern and your streak. Reasons, notes and your other habits are never shared.

Friends also see your display name, avatar emoji and when you were last active. Reactions, nudges and challenges are visible to the people involved.

## What the server stores

| Data | Why | Kept |
| --- | --- | --- |
| Display name, avatar emoji, friend code, time zone | So friends recognise you and dates line up | Until you delete your account |
| Encrypted habits and check-ins | Sync between your devices | Until you delete them or your account |
| Snapshot of shared habits | What friends see | Replaced on every update |
| Friend list, challenges | Friends features | Until removed |
| Reactions and nudges | Friends features | Two weeks |
| Push reminder schedule (names, emoji, times) and push address | Sending reminders | Until you turn reminders off |

The server runs on Cloudflare Workers with a D1 database.

## Deleting your data

- **Settings → Account → Delete account** removes everything the server stores about you, immediately, in one transaction. Your other devices are signed out; the device you used keeps its local copy.
- **Settings → Reminders → Turn off** deletes your device from the reminder server.
- **Settings → Your data → Erase everything** deletes your habits and check-ins on every device signed in to your account.

## No ads, no tracking

Tell Me has no analytics, no ads and no third-party trackers. The code is open source, so all of this can be checked.
