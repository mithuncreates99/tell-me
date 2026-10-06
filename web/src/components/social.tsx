import { Check, Copy, Download, Share2, SmilePlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatKey } from '../lib/account';
import { REACTIONS, type Reaction, type TodayStatus } from '../lib/api';
import { addDays, weekdayName } from '../lib/dates';
import { IS_NATIVE, shareText } from '../lib/native';
import type { Weekday } from '../lib/types';
import { useStore } from '../store/useStore';
import { Button, cx } from './ui';

/** Emoji people can pick as their avatar. */
export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐧', '🦄', '🐙', '🐝', '🐨', '🐵', '🦉', '🐳', '🦋', '🌻', '🌵', '🍀', '🔥', '⚡', '🌈', '⭐', '🎧', '🏀', '🎨'];

/** Public address of the web app (the iPhone app links to the website). */
export function appUrl(): string {
  if (!IS_NATIVE && typeof location !== 'undefined' && location.protocol.startsWith('http')) return `${location.origin}${location.pathname}`;
  return (import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://mithuncreates99.github.io/tell-me/';
}

export const inviteLink = (code: string) => `${appUrl()}#/add/${code}`;
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Native share sheet when there is one, otherwise the clipboard. */
export async function shareOrCopy(title: string, text: string, url?: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const full = url ? `${text}\n${url}` : text;
  try {
    if (IS_NATIVE) {
      await shareText(title, full);
      return 'shared';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text, ...(url ? { url } : {}) });
      return 'shared';
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'cancelled';
  }
  return (await copyText(full)) ? 'copied' : 'failed';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function Avatar({ emoji, size = 40, ring = false }: { emoji: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2', ring && 'ring-2 ring-brand')}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {emoji}
    </span>
  );
}

const STATUS: Record<TodayStatus, { label: string; className: string }> = {
  yes: { label: 'Showed up', className: 'bg-yes-soft text-yes' },
  no: { label: 'Missed', className: 'bg-no-soft text-no' },
  pending: { label: 'Waiting', className: 'bg-brand-soft text-brand' },
  upcoming: { label: 'Later today', className: 'bg-surface-2 text-ink-3' },
  rest: { label: 'Rest day', className: 'bg-surface-2 text-ink-3' },
};

export function StatusPill({ status }: { status: TodayStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold', s.className)}>
      {status === 'yes' && <Check size={13} strokeWidth={3} aria-hidden />}
      {s.label}
    </span>
  );
}

const DOT: Record<string, { className: string; label: string }> = {
  Y: { className: 'bg-yes border-yes', label: 'yes' },
  N: { className: 'bg-no border-no', label: 'no' },
  M: { className: 'border-no bg-transparent', label: 'missed' },
  P: { className: 'border-brand border-dashed bg-transparent', label: 'today' },
  F: { className: 'border-[var(--axis)] bg-transparent', label: 'planned' },
  '.': { className: 'border-transparent bg-[var(--grid)] scale-50', label: 'rest' },
};

/** This week at a glance: one dot per day. */
export function WeekDots({ week, weekStart }: { week: string; weekStart: string }) {
  const days = [...week].map((ch, i) => ({ ch, date: addDays(weekStart, i) }));
  const label = days
    .filter((d) => d.ch !== '.')
    .map((d) => `${weekdayName(new Date(`${d.date}T12:00:00`).getDay() as Weekday, 'short')} ${DOT[d.ch]?.label ?? ''}`)
    .join(', ');
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`This week: ${label || 'nothing planned'}`}>
      {days.map((d) => (
        <span key={d.date} className="flex flex-col items-center gap-0.5">
          <span className={cx('h-3 w-3 rounded-full border-2', DOT[d.ch]?.className)} />
        </span>
      ))}
    </div>
  );
}

/** Pick one of five reactions; picking the same one again removes it. */
export function ReactionButton({ current, onPick, label }: { current: string | null; onPick: (e: Reaction | null) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={current ? `Your reaction: ${current}. Change reaction to ${label}` : `React to ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-[16px] transition hover:bg-surface-2',
          current && 'bg-surface-2',
        )}
      >
        {current ?? <SmilePlus size={17} className="text-ink-3" aria-hidden />}
      </button>
      {open && (
        <span className="animate-rise absolute bottom-full right-0 z-10 mb-1.5 flex gap-0.5 rounded-full border border-line bg-surface p-1 shadow-lg">
          {REACTIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-label={`React ${r}`}
              aria-pressed={current === r}
              onClick={() => {
                setOpen(false);
                onPick(current === r ? null : r);
              }}
              className={cx('flex h-9 w-9 items-center justify-center rounded-full text-[19px] transition hover:scale-110', current === r && 'bg-brand-soft')}
            >
              {r}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The account key in 8 readable groups, with copy and save buttons. */
export function KeyBox({ accountKey }: { accountKey: string }) {
  const showToast = useStore((s) => s.showToast);
  const formatted = formatKey(accountKey);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    const text = `My Tell Me account key: ${formatted}\nKeep it private. Anyone with this key can open my account.`;
    if (IS_NATIVE || typeof navigator.share === 'function') {
      const r = await shareOrCopy('Tell Me account key', text);
      if (r === 'copied') showToast('Copied. Paste it into your password manager or notes.');
      return;
    }
    const blob = new Blob([`${text}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tell-me-account-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div>
      <div
        className="grid grid-cols-4 gap-1.5 rounded-2xl bg-surface-2 p-2.5 font-mono text-[15px] font-semibold tracking-wider sm:text-[17px]"
        aria-label={`Account key: ${formatted.split('').join(' ')}`}
        data-testid="account-key"
      >
        {formatted.split('-').map((g, i) => (
          <span key={i} className="select-all rounded-lg bg-surface px-1 py-1.5 text-center">
            {g}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            if (await copyText(formatted)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } else showToast("Couldn't copy. Select the key and copy it yourself.", { tone: 'bad' });
          }}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? 'Copied' : 'Copy key'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void save()}>
          {IS_NATIVE || typeof navigator.share === 'function' ? <Share2 size={16} aria-hidden /> : <Download size={16} aria-hidden />}
          {IS_NATIVE || typeof navigator.share === 'function' ? 'Save or send' : 'Save as file'}
        </Button>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass = 'h-11 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3.5 text-[16px] outline-none focus:border-brand';

/** "active now", "2 h ago", "3 days ago" */
export function lastSeen(at: number | null, now: number): string {
  if (!at) return 'not active yet';
  const min = Math.round((now - at) / 60_000);
  if (min < 20) return 'active now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  if (min < 60 * 24) return `active ${rtf.format(-Math.max(1, Math.round(min / 60)), 'hour')}`;
  return `active ${rtf.format(-Math.round(min / 1440), 'day')}`;
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Avatar">
      {AVATARS.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          aria-label={`Avatar ${e}`}
          onClick={() => onChange(e)}
          className={cx(
            'flex aspect-square items-center justify-center rounded-xl text-[22px] transition',
            value === e ? 'bg-brand-soft ring-2 ring-brand' : 'hover:bg-surface-2',
          )}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
