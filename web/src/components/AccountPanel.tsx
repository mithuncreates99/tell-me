import { CheckCircle2, Cloud, KeyRound, LogOut, Pencil, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { outboxSize } from '../lib/db';
import { navigate } from '../router';
import { SOCIAL_AVAILABLE, useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';
import { Avatar, AvatarPicker, Field, formatCode, inputClass, KeyBox } from './social';
import { Button, Sheet, cx } from './ui';

function syncedLabel(at: string | undefined): string {
  if (!at) return 'Not synced yet';
  const min = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (min < 1) return 'Synced just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return min < 60 ? `Synced ${rtf.format(-min, 'minute')}` : `Synced ${rtf.format(-Math.round(min / 60), 'hour')}`;
}

/** Settings → Account: profile, sync status, account key, sign out, delete. */
export function AccountPanel() {
  const account = useSocial((s) => s.account);
  if (!SOCIAL_AVAILABLE) {
    return <p className="text-[15px] text-ink-2">Accounts need the Tell Me server, which this copy of the app isn't connected to.</p>;
  }
  return account ? <SignedIn /> : <SignedOut />;
}

function SignedOut() {
  return (
    <div>
      <div className="flex items-start gap-3">
        <Cloud className="mt-0.5 shrink-0 text-brand" size={22} aria-hidden />
        <div>
          <p className="font-semibold">Sync and friends</p>
          <p className="mt-0.5 text-[14px] text-ink-3">
            A free account backs up your habits, puts them on your laptop too, and lets you keep each other going with friends. No
            email or password, and your data is end-to-end encrypted.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => navigate('/account/new')}>
          Create account
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/account/signin')}>
          <KeyRound size={16} aria-hidden /> I have an account key
        </Button>
      </div>
    </div>
  );
}

type Dialog = 'profile' | 'key' | 'signout' | 'delete' | null;

function SignedIn() {
  const account = useSocial((s) => s.account)!;
  const syncing = useSocial((s) => s.syncing);
  const syncState = useSocial((s) => s.syncState);
  const live = useSocial((s) => s.live);
  const syncNow = useSocial((s) => s.syncNow);
  const [dialog, setDialog] = useState<Dialog>(null);
  const { profile } = account;
  const error = syncState?.lastError;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar emoji={profile.emoji} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{profile.name}</p>
          <p className="text-[13px] text-ink-3">
            Friend code <span className="font-mono font-semibold tracking-wider text-ink-2">{formatCode(profile.friendCode)}</span>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDialog('profile')} aria-label="Edit name and avatar">
          <Pencil size={15} aria-hidden /> Edit
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
        {error ? (
          <TriangleAlert size={18} className="shrink-0 text-no" aria-hidden />
        ) : syncing ? (
          <RefreshCw size={18} className="shrink-0 animate-spin text-brand" aria-hidden />
        ) : (
          <CheckCircle2 size={18} className="shrink-0 text-yes" aria-hidden />
        )}
        <p className="min-w-0 flex-1 text-[14px]" aria-live="polite">
          {syncing ? 'Syncing…' : error ? `Sync paused: ${error}` : syncedLabel(syncState?.lastSyncAt)}
          <span className="text-ink-3"> · end-to-end encrypted</span>
        </p>
        <span className={cx('h-2 w-2 shrink-0 rounded-full', live === 'open' ? 'bg-yes' : 'bg-[var(--axis)]')} title={live === 'open' ? 'Live' : 'Not connected'} />
        <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => void syncNow()} disabled={syncing} aria-label="Sync now">
          <RefreshCw size={15} aria-hidden />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDialog('key')}>
          <KeyRound size={16} aria-hidden /> Show account key
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog('signout')}>
          <LogOut size={16} aria-hidden /> Sign out
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDialog('delete')}>
          <Trash2 size={16} aria-hidden /> Delete account
        </Button>
      </div>

      <ProfileSheet open={dialog === 'profile'} onClose={() => setDialog(null)} />
      <Sheet open={dialog === 'key'} onClose={() => setDialog(null)} title="Your account key">
        <p className="-mt-2 mb-4 text-[14px] text-ink-3">
          To use your account on another phone or computer, open Tell Me there and choose <b>Friends → I have an account key</b>. Keep
          the key private: anyone who has it can open your account.
        </p>
        <KeyBox accountKey={account.key} />
      </Sheet>
      <SignOutSheet open={dialog === 'signout'} onClose={() => setDialog(null)} />
      <DeleteSheet open={dialog === 'delete'} onClose={() => setDialog(null)} />
    </div>
  );
}

function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useSocial((s) => s.account);
  const updateProfile = useSocial((s) => s.updateProfile);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState(account?.profile.name ?? '');
  const [emoji, setEmoji] = useState(account?.profile.emoji ?? '🦊');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="How friends see you">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 30))} className={inputClass} />
      </Field>
      <p className="mb-2 mt-4 text-[13px] font-medium text-ink-3">Avatar</p>
      <AvatarPicker value={emoji} onChange={setEmoji} />
      <Button
        variant="primary"
        className="mt-5 w-full"
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await updateProfile({ name: name.trim(), emoji });
            showToast('Saved.', { tone: 'good' });
            onClose();
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Could not save.', { tone: 'bad' });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </Button>
    </Sheet>
  );
}

function SignOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const signOut = useSocial((s) => s.signOut);
  const syncNow = useSocial((s) => s.syncNow);
  const showToast = useStore((s) => s.showToast);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    await syncNow();
    setPending(await outboxSize());
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setPending(null);
        onClose();
      }}
      title="Sign out on this device?"
    >
      <p className="text-[15px] text-ink-2">
        Your habits stay safe in your account. This device's copy is removed; sign in again with your account key to get it back.
      </p>
      {pending !== null && pending > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-no-soft p-3 text-[14px] text-no">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          {pending} change{pending === 1 ? " hasn't" : "s haven't"} synced yet (are you offline?). Signing out now would lose {pending === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            if (pending === null) {
              setBusy(true);
              await check();
              setBusy(false);
              const left = await outboxSize();
              if (left > 0) return; // show the warning first; a second tap signs out
            }
            setBusy(true);
            await signOut();
            setBusy(false);
            onClose();
            showToast('Signed out.');
            navigate('/');
          }}
        >
          <LogOut size={16} aria-hidden /> {pending ? 'Sign out anyway' : 'Sign out'}
        </Button>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const deleteAccount = useSocial((s) => s.deleteAccount);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Delete your account?">
      <p className="text-[15px] text-ink-2">
        This permanently deletes your account, friend list, shared habits, challenges and the encrypted copies of your data on the server.
        Other devices will be signed out. The habits on this device stay here.
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await deleteAccount();
              onClose();
              showToast('Account deleted. Your habits are still on this device.');
            } catch (e) {
              showToast(e instanceof Error ? e.message : 'Could not delete the account.', { tone: 'bad' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={16} aria-hidden /> Delete forever
        </Button>
      </div>
    </Sheet>
  );
}
