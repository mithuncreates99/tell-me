import { Flame, Hand, Link2, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Swords, Trophy, UserPlus, Users, Zap } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Avatar,
  copyText,
  Field,
  formatCode,
  inputClass,
  inviteLink,
  lastSeen,
  ReactionButton,
  shareOrCopy,
  StatusPill,
  WeekDots,
} from '../components/social';
import { Button, Chip, EmptyState, HabitBadge, IconButton, PageHeader, SectionTitle, Segmented, Sheet, Toggle, cx } from '../components/ui';
import { cloud, type ChallengeView, type FriendView, type FriendsFeed, type SharedHabitView } from '../lib/api';
import type { Habit, HabitColor } from '../lib/types';
import { navigate } from '../router';
import { SOCIAL_AVAILABLE, useSocial } from '../store/useSocial';
import { useStore } from '../store/useStore';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export function Friends() {
  const account = useSocial((s) => s.account);
  const loaded = useSocial((s) => s.loaded);

  if (!SOCIAL_AVAILABLE) {
    return (
      <div>
        <PageHeader eyebrow="Friends" title="Show up together" />
        <EmptyState icon="🔌" title="Friends need the Tell Me server">
          This copy of the app runs without a server. Open the app from its website to add friends.
        </EmptyState>
      </div>
    );
  }
  if (!loaded) return null;
  return account ? <FriendsHome /> : <FriendsIntro />;
}

/** Signed out: what friends can do, and how to start. */
function FriendsIntro() {
  const pendingCode = useSocial((s) => s.pendingCode);
  const [inviter, setInviter] = useState<{ name: string; emoji: string } | null>(null);
  useEffect(() => {
    if (!pendingCode) return;
    cloud.invite(pendingCode).then(setInviter).catch(() => {});
  }, [pendingCode]);

  const features = [
    { icon: Zap, title: 'Live check-ins', text: "See the moment a friend says Yes, and cheer with a 🔥." },
    { icon: Hand, title: 'Nudges', text: 'Gentle "did you go yet?" pings when a check-in is waiting.' },
    { icon: Swords, title: 'Weekly challenges', text: '"Gym 3× this week" with a live leaderboard.' },
    { icon: ShieldCheck, title: 'Private by default', text: 'Only habits you share are visible. Everything else is end-to-end encrypted.' },
  ];
  return (
    <div>
      <PageHeader eyebrow="Friends" title="Show up together" />
      {pendingCode && (
        <section className="card mb-3 flex items-center gap-3 p-4" aria-label="Invitation">
          <Avatar emoji={inviter?.emoji ?? '💌'} size={44} />
          <p className="min-w-0 flex-1 text-[15px]">
            <b>{inviter ? `${inviter.name} invited you.` : "You've been invited."}</b>{' '}
            <span className="text-ink-2">Create an account (no email needed) and you'll be connected.</span>
          </p>
        </section>
      )}
      <section className="card p-5">
        <div className="text-[44px] leading-none" aria-hidden>
          🏋️🤝📚
        </div>
        <h2 className="mt-3 text-[20px] font-bold">Habits stick better with friends</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3.5">
          {features.map((f) => (
            <li key={f.title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <f.icon size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{f.title}</span>
                <span className="block text-[14px] text-ink-3">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="primary" size="lg" onClick={() => navigate('/account/new')}>
            <UserPlus size={18} aria-hidden /> Create free account
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/account/signin')}>
            I have an account key
          </Button>
        </div>
        <p className="mt-4 text-center text-[13px] text-ink-3">
          It also syncs your habits between your phone and laptop.{' '}
          <a href="#/privacy" className="font-semibold text-brand">
            How your data is protected
          </a>
        </p>
      </section>
    </div>
  );
}

function FriendsHome() {
  const feed = useSocial((s) => s.feed);
  const feedError = useSocial((s) => s.feedError);
  const live = useSocial((s) => s.live);
  const refreshFeed = useSocial((s) => s.refreshFeed);
  const refreshChallenges = useSocial((s) => s.refreshChallenges);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void refreshFeed();
    void refreshChallenges();
  }, [refreshFeed, refreshChallenges]);

  const liveDot = (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-3" title={live === 'open' ? 'Live updates on' : 'Connecting…'}>
      <span className={cx('h-2 w-2 rounded-full', live === 'open' ? 'bg-yes' : 'bg-[var(--axis)]')} />
      {live === 'open' ? 'Live' : 'Offline'}
    </span>
  );

  return (
    <div>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Friends {liveDot}</span>}
        title="Show up together"
        action={
          <IconButton label="Add a friend" onClick={() => setAddOpen(true)} className="bg-brand-soft text-brand hover:bg-brand-soft">
            <UserPlus size={20} />
          </IconButton>
        }
      />
      {!feed ? (
        feedError ? (
          <EmptyState icon="📡" title="Couldn't load your friends">
            <p>{feedError}</p>
            <Button className="mt-3" size="sm" onClick={() => void refreshFeed()}>
              <RefreshCw size={15} aria-hidden /> Try again
            </Button>
          </EmptyState>
        ) : (
          <div className="card animate-pulse p-6 text-center text-ink-3">Loading…</div>
        )
      ) : (
        <FeedView feed={feed} onAdd={() => setAddOpen(true)} />
      )}
      <AddFriendSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function FeedView({ feed, onAdd }: { feed: FriendsFeed; onAdd: () => void }) {
  const challenges = useSocial((s) => s.challenges);
  const invites = (challenges ?? []).filter((c) => c.me.status === 'invited');
  const active = (challenges ?? []).filter((c) => c.me.status === 'member');

  return (
    <>
      {invites.map((c) => (
        <ChallengeInvite key={c.id} challenge={c} />
      ))}

      {feed.friends.length === 0 ? (
        <InviteCard feed={feed} first onAdd={onAdd} />
      ) : (
        <>
          <SectionTitle>This week</SectionTitle>
          <Leaderboard feed={feed} />

          <SectionTitle>Today</SectionTitle>
          <div className="grid grid-cols-1 gap-2.5">
            {feed.friends.map((f) => (
              <FriendCard key={f.id} friend={f} feed={feed} />
            ))}
          </div>

          <SectionTitle action={<NewChallengeButton feed={feed} />}>Challenges</SectionTitle>
          {active.length === 0 ? (
            <div className="card flex items-center gap-3 p-4">
              <Trophy size={22} className="shrink-0 text-flame" aria-hidden />
              <p className="min-w-0 flex-1 text-[14px] text-ink-2">Challenge friends to a weekly goal, like "Gym 3× this week".</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {active.map((c) => (
                <ChallengeCard key={c.id} challenge={c} feed={feed} />
              ))}
            </div>
          )}
        </>
      )}

      <SectionTitle>What you share</SectionTitle>
      <SharingSummary feed={feed} />

      {feed.friends.length > 0 && (
        <>
          <SectionTitle>Invite more friends</SectionTitle>
          <InviteCard feed={feed} onAdd={onAdd} />
        </>
      )}
    </>
  );
}

// ---------- invite / add ----------

function InviteCard({ feed, first = false, onAdd }: { feed: FriendsFeed; first?: boolean; onAdd: () => void }) {
  const showToast = useStore((s) => s.showToast);
  const code = feed.me.friendCode;
  const share = async () => {
    const r = await shareOrCopy(
      'Join me on Tell Me',
      `Let's keep each other accountable on Tell Me. Tap to add me (${feed.me.emoji} ${feed.me.name}):`,
      inviteLink(code),
    );
    if (r === 'copied') showToast('Invite link copied. Paste it in a chat.', { tone: 'good' });
    if (r === 'failed') showToast(`Couldn't share. Your code is ${formatCode(code)}.`);
  };
  return (
    <section className="card p-4" aria-label="Invite friends">
      {first && (
        <>
          <div className="text-[40px] leading-none" aria-hidden>
            👋
          </div>
          <h2 className="mt-2 text-[18px] font-bold">Invite your first friend</h2>
        </>
      )}
      <p className={cx('text-[14px] text-ink-2', first && 'mt-1')}>
        Send your invite link. When a friend opens it, you're connected and see each other's shared habits.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void share()}>
          <Link2 size={17} aria-hidden /> Share invite link
        </Button>
        <button
          type="button"
          className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-[15px] font-semibold tracking-widest"
          aria-label={`Your friend code ${formatCode(code)}. Tap to copy.`}
          onClick={async () => (await copyText(formatCode(code))) && showToast('Code copied.')}
        >
          {formatCode(code)}
        </button>
      </div>
      <button type="button" onClick={onAdd} className="mt-3 text-[14px] font-semibold text-brand">
        Got a friend's code? Add them
      </button>
    </section>
  );
}

function AddFriendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addFriend = useSocial((s) => s.addFriend);
  const showToast = useStore((s) => s.showToast);
  const feed = useSocial((s) => s.feed);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const friend = await addFriend(code.match(/add\/([A-Za-z0-9-]+)/)?.[1] ?? code);
      showToast(friend.added ? `You and ${friend.emoji} ${friend.name} are now friends!` : `You're already friends with ${friend.name}.`, { tone: 'good' });
      setCode('');
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a friend">
      <form onSubmit={(e) => void submit(e)}>
        <Field label="Their friend code or invite link">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7P2-9XQM" autoCapitalize="characters" className={`${inputClass} font-mono uppercase`} autoFocus />
        </Field>
        {error && (
          <p role="alert" className="mt-2 text-[14px] text-no">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || code.trim().length < 8}>
          <UserPlus size={17} aria-hidden /> {busy ? 'Adding…' : 'Add friend'}
        </Button>
      </form>
      {feed && (
        <p className="mt-4 text-center text-[13px] text-ink-3">
          Your code is <b className="font-mono tracking-wider text-ink">{formatCode(feed.me.friendCode)}</b>
        </p>
      )}
    </Sheet>
  );
}

// ---------- leaderboard ----------

function Leaderboard({ feed }: { feed: FriendsFeed }) {
  const rows = useMemo(() => {
    const all = [
      { id: feed.me.id, name: 'You', emoji: feed.me.emoji, ...feed.me.week, me: true },
      ...feed.friends.map((f) => ({ id: f.id, name: f.name, emoji: f.emoji, ...f.week, me: false })),
    ];
    return all
      .map((r) => ({ ...r, rate: r.due > 0 ? r.yes / r.due : null }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.yes - a.yes || a.name.localeCompare(b.name));
  }, [feed]);
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <ol className="card divide-y divide-line px-4 py-1" aria-label="This week's leaderboard">
      {rows.map((r, i) => (
        <li key={r.id} className={cx('flex items-center gap-3 py-2.5', r.me && 'font-semibold')}>
          <span className="w-6 shrink-0 text-center text-[15px]" aria-label={`Rank ${i + 1}`}>
            {r.rate !== null && i < 3 ? medals[i] : <span className="text-[13px] text-ink-3">{i + 1}</span>}
          </span>
          <Avatar emoji={r.emoji} size={30} ring={r.me} />
          <span className="min-w-0 flex-1 truncate text-[15px]">{r.name}</span>
          <span className="hidden h-2 w-20 overflow-hidden rounded-full bg-surface-2 min-[380px]:block" aria-hidden>
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.rate ?? 0) * 100}%` }} />
          </span>
          <span className="w-[72px] shrink-0 text-right text-[13px] tabular-nums text-ink-2">
            {r.rate === null ? 'nothing yet' : `${r.yes}/${r.due} · ${Math.round(r.rate * 100)}%`}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------- a friend ----------

function FriendCard({ friend, feed }: { friend: FriendView; feed: FriendsFeed }) {
  const [menu, setMenu] = useState(false);
  return (
    <article className="card min-w-0 p-4" aria-label={friend.name}>
      <div className="flex items-center gap-3">
        <Avatar emoji={friend.emoji} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold">{friend.name}</h3>
          <p className="truncate text-[13px] text-ink-3">
            {lastSeen(friend.lastSeenAt, feed.serverTime)}
            {friend.week.due > 0 && ` · ${friend.week.yes} of ${friend.week.due} this week`}
          </p>
        </div>
        <IconButton label={`Options for ${friend.name}`} onClick={() => setMenu(true)} className="-mr-2">
          <MoreHorizontal size={20} />
        </IconButton>
      </div>
      {friend.habits.length === 0 ? (
        <p className="mt-3 text-[14px] text-ink-3">{friend.name} isn't sharing any habits yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {friend.habits.map((h) => (
            <FriendHabit key={h.id} friend={friend} habit={h} feed={feed} />
          ))}
        </ul>
      )}
      <FriendMenu friend={friend} open={menu} onClose={() => setMenu(false)} />
    </article>
  );
}

function FriendHabit({ friend, habit: h, feed }: { friend: FriendView; habit: SharedHabitView; feed: FriendsFeed }) {
  const nudge = useSocial((s) => s.nudge);
  const react = useSocial((s) => s.react);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const mine = feed.reactions.find((r) => r.from === feed.me.id && r.to === friend.id && r.habitId === h.id && r.date === h.date);
  const nudged = feed.nudges.some((n) => n.from === feed.me.id && n.to === friend.id && n.habitId === h.id && n.date === h.date);
  const canNudge = h.today === 'pending' || h.today === 'upcoming';

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <HabitBadge emoji={h.emoji} color={h.color as HabitColor} size={36} />
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {h.name}
          {h.streak >= 2 && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[13px] font-semibold text-flame" title={`${h.streak} in a row`}>
              <Flame size={13} aria-hidden /> {h.streak}
            </span>
          )}
        </p>
        <StatusPill status={h.today} />
      </div>
      <div className="mt-1.5 flex min-h-8 items-center gap-2 pl-12">
        <WeekDots week={h.week} weekStart={h.weekStart} />
        <span className="flex-1" />
        {(h.today === 'yes' || h.today === 'no') && (
          <ReactionButton
            current={mine?.emoji ?? null}
            label={`${friend.name}'s ${h.name}`}
            onPick={(emoji) => void react(friend.id, h.id, h.date, emoji).catch((e) => showToast(errorText(e), { tone: 'bad' }))}
          />
        )}
        {canNudge && (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-3 text-[13px]"
            disabled={busy || nudged}
            aria-label={nudged ? `You nudged ${friend.name} about ${h.name}` : `Nudge ${friend.name} about ${h.name}`}
            onClick={async () => {
              setBusy(true);
              try {
                await nudge(friend.id, h.id);
                showToast(`Nudged ${friend.name} 👋`, { tone: 'good' });
              } catch (e) {
                showToast(errorText(e), { tone: 'bad' });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Hand size={14} aria-hidden /> {nudged ? 'Nudged' : 'Nudge'}
          </Button>
        )}
      </div>
    </li>
  );
}

function FriendMenu({ friend, open, onClose }: { friend: FriendView; open: boolean; onClose: () => void }) {
  const removeFriend = useSocial((s) => s.removeFriend);
  const showToast = useStore((s) => s.showToast);
  return (
    <Sheet open={open} onClose={onClose} title={`${friend.emoji} ${friend.name}`}>
      <p className="text-[15px] text-ink-2">
        Friends since {new Date(friend.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
      </p>
      <Button
        variant="danger"
        className="mt-5 w-full"
        onClick={async () => {
          await removeFriend(friend.id).catch((e) => showToast(errorText(e), { tone: 'bad' }));
          onClose();
          showToast(`Removed ${friend.name}.`);
        }}
      >
        Remove friend
      </Button>
      <p className="mt-2 text-center text-[13px] text-ink-3">You'll stop seeing each other's habits. They won't be notified.</p>
    </Sheet>
  );
}

// ---------- sharing ----------

function SharingSummary({ feed }: { feed: FriendsFeed }) {
  const habits = useStore((s) => s.habits);
  const [open, setOpen] = useState(false);
  const shared = habits.filter((h) => h.shared && !h.archivedAt);
  return (
    <section className="card flex items-center gap-3 p-4">
      <Users size={22} className="shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 flex-1 text-[14px] text-ink-2">
        {shared.length === 0 ? (
          <>
            <b className="text-ink">You're not sharing any habits yet,</b> so friends can't see your progress.
          </>
        ) : (
          <>
            Friends see <b className="text-ink">{shared.map((h) => `${h.emoji} ${h.name}`).join(', ')}</b>
            {feed.me.week.due > 0 && ` · ${feed.me.week.yes} of ${feed.me.week.due} this week`}.
          </>
        )}
      </p>
      <Button size="sm" variant={shared.length ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
        {shared.length ? 'Change' : 'Choose'}
      </Button>
      <ShareSheet open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const habits = useStore((s) => s.habits);
  const saveHabit = useStore((s) => s.saveHabit);
  const active = habits.filter((h) => !h.archivedAt && !h.id.startsWith('demo-'));
  return (
    <Sheet open={open} onClose={onClose} title="What friends can see">
      <p className="-mt-2 mb-2 text-[14px] text-ink-3">
        Friends see a shared habit's name, today's answer and this week's Yes/No. Reasons and notes stay private.
      </p>
      {active.length === 0 ? (
        <p className="py-4 text-[15px] text-ink-2">Add a habit first.</p>
      ) : (
        <div className="divide-y divide-line">
          {active.map((h) => (
            <Toggle
              key={h.id}
              checked={!!h.shared}
              onChange={(v) => void saveHabit({ ...h, shared: v })}
              label={
                <span className="flex items-center gap-2">
                  <span aria-hidden>{h.emoji}</span> {h.name}
                </span>
              }
            />
          ))}
        </div>
      )}
      <Button variant="primary" className="mt-4 w-full" onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

/** Makes sure a habit is shared (and published) before it can count in a challenge. */
async function ensureShared(habit: Habit): Promise<void> {
  if (habit.shared) return;
  await useStore.getState().saveHabit({ ...habit, shared: true });
  await useSocial.getState().syncNow();
}

// ---------- challenges ----------

function NewChallengeButton({ feed }: { feed: FriendsFeed }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-[13px] font-semibold text-brand">
        <Plus size={15} aria-hidden /> New
      </button>
      <NewChallengeSheet open={open} onClose={() => setOpen(false)} feed={feed} />
    </>
  );
}

function NewChallengeSheet({ open, onClose, feed }: { open: boolean; onClose: () => void; feed: FriendsFeed }) {
  const habits = useStore((s) => s.habits);
  const showToast = useStore((s) => s.showToast);
  const createChallenge = useSocial((s) => s.createChallenge);
  const active = habits.filter((h) => !h.archivedAt && !h.id.startsWith('demo-'));
  const [habitId, setHabitId] = useState(active.find((h) => h.shared)?.id ?? active[0]?.id ?? '');
  const habit = active.find((h) => h.id === habitId);
  const [target, setTarget] = useState(3);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<string[]>(() => feed.friends.map((f) => f.id));
  const [busy, setBusy] = useState(false);
  const title = name.trim() || (habit ? `${habit.name} ${target}×` : '');

  const create = async () => {
    if (!habit) return;
    setBusy(true);
    try {
      await ensureShared(habit);
      await createChallenge({ name: title, emoji: habit.emoji, target, habitId: habit.id, invite });
      showToast(`Challenge started: ${habit.emoji} ${title} this week.`, { tone: 'good' });
      onClose();
    } catch (e) {
      showToast(errorText(e), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New weekly challenge">
      {active.length === 0 ? (
        <p className="text-[15px] text-ink-2">Add a habit first, then challenge your friends.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <Field label="Your habit that counts">
            <select value={habitId} onChange={(e) => setHabitId(e.target.value)} className={inputClass}>
              {active.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.emoji} {h.name}
                  {h.shared ? '' : ' (will be shared)'}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-3">Goal: Yes answers per week</p>
            <Segmented label="Times per week" value={target} onChange={setTarget} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} />
          </div>
          <Field label="Name (optional)">
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder={habit ? `${habit.name} ${target}×` : ''} className={inputClass} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-3">Invite</p>
            <div className="flex flex-wrap gap-1.5">
              {feed.friends.map((f) => (
                <Chip key={f.id} active={invite.includes(f.id)} onClick={() => setInvite((xs) => (xs.includes(f.id) ? xs.filter((x) => x !== f.id) : [...xs, f.id]))}>
                  {f.emoji} {f.name}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-ink-3">Each friend picks one of their own habits to count. Progress resets every week.</p>
          </div>
          <Button variant="primary" size="lg" className="w-full" disabled={busy || !habit} onClick={() => void create()}>
            <Trophy size={18} aria-hidden /> {busy ? 'Starting…' : 'Start challenge'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function ChallengeCard({ challenge: c, feed }: { challenge: ChallengeView; feed: FriendsFeed }) {
  const [menu, setMenu] = useState(false);
  const members = c.members.filter((m) => m.status === 'member');
  const invited = c.members.filter((m) => m.status === 'invited');
  return (
    <article className="card p-4" aria-label={`Challenge ${c.name}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-[22px]" aria-hidden>
          {c.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold">{c.name}</h3>
          <p className="text-[13px] text-ink-3">
            {c.target}× this week · {members.length} {members.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <IconButton label={`Options for ${c.name}`} onClick={() => setMenu(true)} className="-mr-2">
          <MoreHorizontal size={20} />
        </IconButton>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2.5">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2.5">
            <Avatar emoji={m.emoji} size={28} ring={m.userId === feed.me.id} />
            <span className={cx('w-[84px] shrink-0 truncate text-[14px]', m.userId === feed.me.id && 'font-semibold')}>
              {m.userId === feed.me.id ? 'You' : m.name}
            </span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${m.yes} of ${c.target}`}>
              <span className={cx('block h-full rounded-full transition-all', m.done ? 'bg-yes' : 'bg-brand')} style={{ width: `${Math.min(1, m.yes / c.target) * 100}%` }} />
            </span>
            <span className="w-11 shrink-0 text-right text-[13px] tabular-nums text-ink-2">
              {m.yes}/{c.target}
            </span>
            <span className="w-5 shrink-0 text-center" aria-label={m.done ? 'Goal reached' : undefined}>
              {m.done ? '🏆' : ''}
            </span>
          </li>
        ))}
      </ul>
      {invited.length > 0 && <p className="mt-2.5 text-[13px] text-ink-3">Invited: {invited.map((m) => `${m.emoji} ${m.name}`).join(', ')}</p>}
      <ChallengeMenu challenge={c} feed={feed} open={menu} onClose={() => setMenu(false)} />
    </article>
  );
}

function ChallengeMenu({ challenge: c, feed, open, onClose }: { challenge: ChallengeView; feed: FriendsFeed; open: boolean; onClose: () => void }) {
  const leaveChallenge = useSocial((s) => s.leaveChallenge);
  const inviteToChallenge = useSocial((s) => s.inviteToChallenge);
  const showToast = useStore((s) => s.showToast);
  const inChallenge = new Set(c.members.map((m) => m.userId));
  // Only the organiser invites: members agreed to share their habit with the people they picked.
  const candidates = c.ownerId === feed.me.id ? feed.friends.filter((f) => !inChallenge.has(f.id)) : [];
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Sheet open={open} onClose={onClose} title={`${c.emoji} ${c.name}`}>
      {candidates.length > 0 && (
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-3">Invite more friends</p>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((f) => (
              <Chip key={f.id} active={picked.includes(f.id)} onClick={() => setPicked((xs) => (xs.includes(f.id) ? xs.filter((x) => x !== f.id) : [...xs, f.id]))}>
                {f.emoji} {f.name}
              </Chip>
            ))}
          </div>
          <Button
            variant="primary"
            className="mt-3 w-full"
            disabled={picked.length === 0}
            onClick={async () => {
              try {
                await inviteToChallenge(c.id, picked);
                showToast('Invites sent.', { tone: 'good' });
                setPicked([]);
                onClose();
              } catch (e) {
                showToast(errorText(e), { tone: 'bad' });
              }
            }}
          >
            Send invites
          </Button>
        </div>
      )}
      <Button
        variant="danger"
        className="mt-4 w-full"
        onClick={async () => {
          await leaveChallenge(c.id).catch((e) => showToast(errorText(e), { tone: 'bad' }));
          onClose();
          showToast('You left the challenge.');
        }}
      >
        Leave challenge
      </Button>
    </Sheet>
  );
}

function ChallengeInvite({ challenge: c }: { challenge: ChallengeView }) {
  const habits = useStore((s) => s.habits);
  const showToast = useStore((s) => s.showToast);
  const joinChallenge = useSocial((s) => s.joinChallenge);
  const leaveChallenge = useSocial((s) => s.leaveChallenge);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const host = c.members.find((m) => m.userId === c.ownerId) ?? c.members[0];
  const others = c.members.filter((m) => m.status === 'member' && m.userId !== host?.userId);
  const active = habits.filter((h) => !h.archivedAt && !h.id.startsWith('demo-'));

  const join = async (habit: Habit) => {
    setBusy(true);
    try {
      await ensureShared(habit);
      await joinChallenge(c.id, habit.id);
      showToast(`You joined ${c.emoji} ${c.name}. Good luck!`, { tone: 'good' });
      setPicking(false);
    } catch (e) {
      showToast(errorText(e), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mb-3 border-2 border-brand/30 p-4" aria-label={`Invitation to ${c.name}`}>
      <div className="flex items-center gap-3">
        <span className="text-[30px]" aria-hidden>
          {c.emoji}
        </span>
        <p className="min-w-0 flex-1 text-[15px]">
          <b>{host ? `${host.emoji} ${host.name}` : 'A friend'}</b> invited you to <b>{c.name}</b>: {c.target}× this week.
        </p>
      </div>
      <p className="mt-2 text-[13px] text-ink-3">
        {others.length > 0 ? `Also in it: ${others.map((m) => `${m.emoji} ${m.name}`).join(', ')}. ` : ''}
        Everyone in the challenge sees your progress on the habit you pick.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => void leaveChallenge(c.id)}>
          Not now
        </Button>
        <Button variant="primary" className="flex-1" onClick={() => setPicking(true)}>
          Join
        </Button>
      </div>
      <Sheet open={picking} onClose={() => setPicking(false)} title="Which habit counts for you?">
        {active.length === 0 ? (
          <p className="text-[15px] text-ink-2">Add a habit first.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {active.map((h) => (
              <button
                key={h.id}
                type="button"
                disabled={busy}
                onClick={() => void join(h)}
                className="flex items-center gap-3 rounded-2xl border border-line p-3 text-left transition hover:bg-surface-2"
              >
                <HabitBadge emoji={h.emoji} color={h.color} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.name}</span>
                  {!h.shared && <span className="block text-[13px] text-ink-3">Will be shared with your friends</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </section>
  );
}
