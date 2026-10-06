import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../components/ui';
import { REPO_URL } from '../lib/platform';
import { navigate } from '../router';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <div className="mt-1.5 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export function Privacy() {
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <header className="mb-4 flex items-center gap-2 pt-1">
        <IconButton label="Back" onClick={() => history.length > 1 ? history.back() : navigate('/settings')} className="-ml-2">
          <ArrowLeft size={21} />
        </IconButton>
        <h1 className="text-[22px] font-bold">Privacy</h1>
      </header>
      <div className="grid grid-cols-1 gap-3">
        <Block title="Without an account, everything stays on your device">
          <p>Your habits, answers, reasons and notes are stored in this browser or app only. Nothing is sent anywhere.</p>
          <p>
            If you turn on push reminders, the reminder server stores each reminder's habit name, emoji and time, plus your device's push
            address. It never learns your answers.
          </p>
        </Block>
        <Block title="With an account, your data is end-to-end encrypted">
          <p>
            Your account is a random key that only your devices hold. Every habit and check-in is encrypted on your device (AES-256-GCM)
            before it's uploaded, with a key derived from your account key. The server stores ciphertext it can't read, under ids that
            hide even the dates.
          </p>
          <p>There's no email and no password. If you lose your key and all your devices, the data can't be recovered by anyone.</p>
        </Block>
        <Block title="What friends can see">
          <p>
            Only habits you mark as shared: their name and emoji, when they're planned, today's answer, this week's Yes/No pattern and your
            current streak. Reasons, notes, past weeks and your other habits are never shared.
          </p>
          <p>
            Friends also see your display name, avatar and roughly when you were last active (to 15 minutes). They're only told about an
            update when something they can see changed, so they can't tell when you open the app.
          </p>
          <p>A reaction or a nudge is seen only by the two people involved, not even by a friend you have in common.</p>
        </Block>
        <Block title="Challenges, friend codes and removing friends">
          <p>
            In a challenge, members see each other's progress on the one habit each picked, nothing else. Until you join, you see who's in
            it but not how they're doing, and invites nobody answered yet are shown only to the organiser.
          </p>
          <p>
            Anyone with your friend code can add you, so it works like a key: you can change it any time (old invite links stop working),
            and guessing codes is limited.
          </p>
          <p>
            Removing a friend works both ways at once: you stop seeing each other's habits, reactions and nudges, and each of you leaves the
            challenges the other started. They aren't notified.
          </p>
        </Block>
        <Block title="What the server stores">
          <p>
            Your display name and avatar, your friend code, your time zone, the snapshot of your shared habits, your friend list, reactions
            and nudges (kept for two weeks), challenges, and the encrypted copies of your data. It runs on Cloudflare Workers with a D1
            database.
          </p>
        </Block>
        <Block title="Deleting your data">
          <p>
            Settings → Account → Delete account removes everything the server stores about you, immediately, and disconnects your other
            devices. Turning reminders off deletes your device from the reminder server. Erasing data in the app deletes it on every device
            signed in to your account.
          </p>
          <p>
            Signing out removes the account's habits, answers and key from that device (on the iPhone, its backup and scheduled reminders
            too) and stops friends' notifications reaching it, without deleting anything from your account.
          </p>
        </Block>
        <Block title="No ads, no tracking">
          <p>Tell Me has no analytics, no ads and no third-party trackers.</p>
          {REPO_URL && (
            <p>
              The code is open source:{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold text-brand">
                {REPO_URL.replace(/^https:\/\//, '')}
              </a>
            </p>
          )}
        </Block>
      </div>
    </div>
  );
}
