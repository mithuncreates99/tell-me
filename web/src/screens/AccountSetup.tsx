import { ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AvatarPicker, AVATARS, Field, inputClass, KeyBox } from '../components/social';
import { Button, EmptyState, IconButton } from '../components/ui';
import { generateAccountKey, parseKey } from '../lib/account';
import { navigate } from '../router';
import { SOCIAL_AVAILABLE, useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';

function Shell({ title, children, back = '/friends' }: { title: string; children: ReactNode; back?: string }) {
  return (
    <div className="mx-auto max-w-lg pb-8">
      <header className="mb-4 flex items-center gap-2 pt-1">
        <IconButton label="Back" onClick={() => navigate(back)} className="-ml-2">
          <ArrowLeft size={21} />
        </IconButton>
        <h1 className="text-[22px] font-bold">{title}</h1>
      </header>
      {children}
    </div>
  );
}

function Unavailable() {
  return (
    <EmptyState icon="🔌" title="Accounts need the Tell Me server">
      This copy of the app runs without a server, so sync and friends are off. Everything else works on this device.
    </EmptyState>
  );
}

function AlreadySignedIn() {
  const account = useSocial((s) => s.account);
  return (
    <EmptyState icon={account?.profile.emoji ?? '👋'} title={`You're signed in as ${account?.profile.name ?? ''}`}>
      <button type="button" className="font-semibold text-brand" onClick={() => navigate('/friends')}>
        Go to Friends
      </button>
    </EmptyState>
  );
}

const afterSignIn = () => {
  const code = useSocial.getState().pendingCode;
  navigate(code ? `/add/${code}` : '/friends', true);
};

export function CreateAccount() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const showToast = useStore((s) => s.showToast);
  const account = useSocial((s) => s.account);
  const createAccount = useSocial((s) => s.createAccount);
  const [step, setStep] = useState<'profile' | 'key'>('profile');
  const [name, setName] = useState(settings.name);
  const [emoji, setEmoji] = useState(AVATARS[0]!);
  const [key] = useState(generateAccountKey);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SOCIAL_AVAILABLE) return <Shell title="Create an account"><Unavailable /></Shell>;
  if (account && !busy) return <Shell title="Create an account"><AlreadySignedIn /></Shell>;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createAccount(key, name, emoji);
      if (!settings.name) await updateSettings({ name: name.trim() });
      showToast('Account created. Your habits are now synced and backed up.', { tone: 'good' });
      afterSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'profile') {
    return (
      <Shell title="Create an account">
        <section className="card p-4">
          <p className="text-[15px] text-ink-2">This is how friends will see you. No email or password needed.</p>
          <div className="mt-4">
            <Field label="Your name">
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 30))} placeholder="e.g. Mithun" className={inputClass} autoFocus />
            </Field>
          </div>
          <p className="mb-2 mt-4 text-[13px] font-medium text-ink-3">Your avatar</p>
          <AvatarPicker value={emoji} onChange={setEmoji} />
        </section>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!name.trim()} onClick={() => setStep('key')}>
          Continue
        </Button>
        <p className="mt-4 flex items-start gap-2 px-1 text-[13px] text-ink-3">
          <ShieldCheck size={16} className="mt-px shrink-0" aria-hidden />
          Your habits are end-to-end encrypted. Friends only see the habits you choose to share.{' '}
          <a href="#/privacy" className="font-semibold text-brand">
            Privacy
          </a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Save your account key">
      <section className="card p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 shrink-0 text-brand" size={22} aria-hidden />
          <p className="text-[15px] text-ink-2">
            <b className="text-ink">This key is your account.</b> Use it to add your laptop or a new phone. There's no password reset:
            if you lose the key and all your devices, nobody can recover your data, not even us.
          </p>
        </div>
        <div className="mt-4">
          <KeyBox accountKey={key} />
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 p-3 text-[15px]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
          I saved my key somewhere safe (a password manager or notes)
        </label>
      </section>
      {error && (
        <p role="alert" className="mt-3 px-1 text-[14px] text-no">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => setStep('profile')} disabled={busy}>
          Back
        </Button>
        <Button variant="primary" className="flex-[2]" disabled={!saved || busy} onClick={() => void create()}>
          <Lock size={17} aria-hidden /> {busy ? 'Creating…' : 'Create account'}
        </Button>
      </div>
    </Shell>
  );
}

export function SignIn() {
  const habits = useStore((s) => s.habits);
  const showToast = useStore((s) => s.showToast);
  const account = useSocial((s) => s.account);
  const signIn = useSocial((s) => s.signIn);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SOCIAL_AVAILABLE) return <Shell title="Sign in"><Unavailable /></Shell>;
  if (account && !busy) return <Shell title="Sign in"><AlreadySignedIn /></Shell>;

  const realHabits = habits.filter((h) => !h.id.startsWith('demo-')).length;
  const submit = async () => {
    const key = parseKey(input);
    if (!key) {
      setError("That doesn't look like an account key. It has 32 letters and digits, in 8 groups of 4.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { merged } = await signIn(key);
      showToast(merged ? 'Signed in. The habits on this device were added to your account.' : 'Signed in. Your habits are here.', { tone: 'good' });
      afterSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Use your account here">
      <form
        className="card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-[15px] text-ink-2">
          Enter the account key from your other device. On that device: <b>Settings → Account → Show account key</b>.
        </p>
        <div className="mt-4">
          <Field label="Account key">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567"
              rows={2}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[16px] uppercase outline-none focus:border-brand"
              aria-label="Account key"
            />
          </Field>
        </div>
        {realHabits > 0 && (
          <p className="mt-2 text-[13px] text-ink-3">
            The {realHabits} habit{realHabits === 1 ? '' : 's'} on this device will be added to your account.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[14px] text-no">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={busy || input.trim().length < 20}>
          <KeyRound size={18} aria-hidden /> {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 px-1 text-center text-[14px] text-ink-3">
        New here?{' '}
        <a href="#/account/new" className="font-semibold text-brand">
          Create an account
        </a>
      </p>
    </Shell>
  );
}
