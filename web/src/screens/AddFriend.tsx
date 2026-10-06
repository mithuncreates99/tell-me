import { ArrowLeft, Copy, Share, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, copyText, formatCode } from '../components/social';
import { Button, EmptyState, IconButton } from '../components/ui';
import { cloud } from '../lib/api';
import { IS_NATIVE } from '../lib/native';
import { isIOS, isStandalone } from '../lib/platform';
import { navigate } from '../router';
import { SOCIAL_AVAILABLE, useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';

/** Opened from an invite link: #/add/K7P29XQM */
export function AddFriend({ code: raw }: { code: string }) {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const account = useSocial((s) => s.account);
  const loaded = useSocial((s) => s.loaded);
  const addFriend = useSocial((s) => s.addFriend);
  const setPendingCode = useSocial((s) => s.setPendingCode);
  const showToast = useStore((s) => s.showToast);
  const [inviter, setInviter] = useState<{ name: string; emoji: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!SOCIAL_AVAILABLE) return;
    cloud
      .invite(code)
      .then(setInviter)
      .catch((e: Error) => setError(e.message));
  }, [code]);

  useEffect(() => {
    if (loaded && !account && !error) setPendingCode(code);
  }, [loaded, account, code, error, setPendingCode]);

  const header = (
    <header className="mb-4 flex items-center gap-2 pt-1">
      <IconButton label="Back" onClick={() => navigate('/friends')} className="-ml-2">
        <ArrowLeft size={21} />
      </IconButton>
      <h1 className="text-[22px] font-bold">Friend invite</h1>
    </header>
  );

  if (!SOCIAL_AVAILABLE) {
    return (
      <div className="mx-auto max-w-lg">
        {header}
        <EmptyState icon="🔌" title="Invites need the Tell Me server">
          Open this link on the Tell Me website instead.
        </EmptyState>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-lg">
        {header}
        <EmptyState icon="🔗" title="This invite doesn't work">
          {error} Ask your friend to send their link again.
        </EmptyState>
      </div>
    );
  }

  const own = account?.profile.friendCode === code;
  const who = inviter?.name ?? 'Your friend';

  return (
    <div className="mx-auto max-w-lg pb-8">
      {header}
      <section className="card flex flex-col items-center p-6 text-center">
        <Avatar emoji={inviter?.emoji ?? '💌'} size={72} />
        {own ? (
          <>
            <h2 className="mt-3 text-[20px] font-bold">This is your own invite link</h2>
            <p className="mt-1 text-[15px] text-ink-2">Send it to a friend: when they open it, you'll be connected.</p>
            <Button className="mt-5" onClick={() => navigate('/friends')}>
              Back to Friends
            </Button>
          </>
        ) : account ? (
          <>
            <h2 className="mt-3 text-[20px] font-bold">Add {inviter?.name ?? 'this friend'}?</h2>
            <p className="mt-1 text-[15px] text-ink-2">You'll see each other's shared habits, cheer, nudge and run challenges together.</p>
            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              disabled={busy || !inviter}
              onClick={async () => {
                setBusy(true);
                try {
                  const friend = await addFriend(code);
                  showToast(friend.added ? `You and ${friend.emoji} ${friend.name} are now friends!` : `You're already friends with ${friend.name}.`, {
                    tone: 'good',
                  });
                  navigate('/friends', true);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'Could not add this friend.', { tone: 'bad' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <UserPlus size={18} aria-hidden /> Add friend
            </Button>
          </>
        ) : (
          <>
            <h2 className="mt-3 text-[20px] font-bold">{who} invited you to Tell Me</h2>
            <p className="mt-1 text-[15px] text-ink-2">
              A habit tracker that asks one question: did you show up? Keep each other going with live check-ins, nudges and weekly
              challenges.
            </p>
            {isIOS() && !isStandalone() && !IS_NATIVE ? (
              <div className="mt-5 w-full rounded-2xl bg-surface-2 p-4 text-left text-[14px] text-ink-2">
                <p className="font-semibold text-ink">On iPhone, install it first so reminders work:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>
                    Tap <Share size={14} className="inline -translate-y-0.5" aria-label="Share" /> Share, then <b>Add to Home Screen</b>.
                  </li>
                  <li>Open Tell Me from your Home Screen and create your account.</li>
                  <li>
                    In <b>Friends → Add a friend</b>, enter <b className="font-mono">{formatCode(code)}</b>.
                  </li>
                </ol>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={async () => (await copyText(formatCode(code))) && showToast('Code copied.')}
                >
                  <Copy size={15} aria-hidden /> Copy code
                </Button>
              </div>
            ) : null}
            <div className="mt-5 grid w-full grid-cols-1 gap-2">
              <Button variant="primary" size="lg" onClick={() => navigate('/account/new')}>
                Create free account
              </Button>
              <Button variant="secondary" onClick={() => navigate('/account/signin')}>
                I already have an account
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
