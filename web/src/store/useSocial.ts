import { create } from 'zustand';
import { deriveKeys, forgetAccount, loadAccount, saveAccount, type AccountRecord, type Profile } from '../lib/account';
import { API_URL, ApiError, cloud, type ChallengeView, type FriendsFeed, type Reaction } from '../lib/api';
import * as db from '../lib/db';
import { connectLive, type LiveEvent, type LiveStatus } from '../lib/live';
import { IS_NATIVE, loadNativeAccount, saveNativeAccount } from '../lib/native';
import { IS_PREVIEW } from '../lib/platform';
import { loadSyncState, syncNow as runSync, type SyncState } from '../lib/sync';
import { useStore } from './useStore';

/** Accounts, sync and friends need the server (not available in the offline preview build). */
export const SOCIAL_AVAILABLE = !IS_PREVIEW && !!API_URL;

const PENDING_CODE = 'tell-me:pending-friend-code';

interface State {
  loaded: boolean;
  account: AccountRecord | null;
  syncing: boolean;
  syncState: SyncState | null;
  feed: FriendsFeed | null;
  feedError: string | null;
  challenges: ChallengeView[] | null;
  live: LiveStatus;
  /** A friend code from an invite link, kept until the account exists. */
  pendingCode: string | null;
}

interface Actions {
  load(): Promise<void>;
  createAccount(key: string, name: string, emoji: string): Promise<void>;
  signIn(key: string): Promise<{ merged: number }>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  updateProfile(patch: Partial<Pick<Profile, 'name' | 'emoji'>>): Promise<void>;
  rotateFriendCode(): Promise<void>;
  scheduleSync(delayMs?: number): void;
  syncNow(): Promise<void>;
  startLive(): Promise<void>;
  stopLive(): void;
  refreshFeed(): Promise<void>;
  refreshChallenges(): Promise<void>;
  addFriend(code: string): Promise<{ name: string; emoji: string; added: boolean }>;
  removeFriend(id: string): Promise<void>;
  nudge(friendId: string, habitId: string): Promise<void>;
  react(friendId: string, habitId: string, date: string, emoji: Reaction | null): Promise<void>;
  createChallenge(input: { name: string; emoji: string; target: number; habitId: string; invite: string[] }): Promise<void>;
  joinChallenge(id: string, habitId: string): Promise<void>;
  leaveChallenge(id: string): Promise<void>;
  inviteToChallenge(id: string, friendIds: string[]): Promise<void>;
  linkPushDevice(): Promise<void>;
  setPendingCode(code: string | null): void;
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let feedTimer: ReturnType<typeof setTimeout> | undefined;
let challengeTimer: ReturnType<typeof setTimeout> | undefined;
let stopLiveSocket: (() => void) | null = null;

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');
const toast = (text: string, tone?: 'good' | 'bad') => useStore.getState().showToast(text, tone ? { tone } : undefined);

function readPendingCode(): string | null {
  try {
    return sessionStorage.getItem(PENDING_CODE);
  } catch {
    return null;
  }
}

export const useSocial = create<State & Actions>()((set, get) => {
  const auth = async () => {
    const account = get().account;
    if (!account) throw new Error('Sign in first.');
    return (await deriveKeys(account.key)).auth;
  };

  const persist = async (account: AccountRecord | null) => {
    if (account) await saveAccount(account);
    if (IS_NATIVE) await saveNativeAccount(account).catch(() => {});
    set({ account });
  };

  /** Sample data is never synced: clear it before joining an account. */
  const dropDemo = async () => {
    const { habits, resetAll } = useStore.getState();
    if (habits.some((h) => db.isDemoHabitId(h.id))) await resetAll();
  };

  /** Signed out here, or the account no longer exists: keep the data, forget the key. */
  const forgetLocally = async () => {
    get().stopLive();
    await forgetAccount();
    await db.clearOutbox();
    if (IS_NATIVE) await saveNativeAccount(null).catch(() => {});
    set({ account: null, feed: null, challenges: null, syncState: null });
  };

  const refreshFeedSoon = () => {
    clearTimeout(feedTimer);
    feedTimer = setTimeout(() => void get().refreshFeed(), 250);
  };
  const refreshChallengesSoon = () => {
    clearTimeout(challengeTimer);
    challengeTimer = setTimeout(() => void get().refreshChallenges(), 250);
  };

  const onLive = (e: LiveEvent) => {
    switch (e.t) {
      case 'hello': // (re)connected: catch up on anything missed while offline
        get().scheduleSync(50);
        refreshFeedSoon();
        if (get().challenges) refreshChallengesSoon();
        break;
      case 'sync':
        if (e.seq > (get().syncState?.lastSeq ?? 0)) get().scheduleSync(50);
        break;
      case 'friends':
        refreshFeedSoon();
        break;
      case 'challenges':
        refreshChallengesSoon();
        break;
      case 'checkin':
        if (e.answer === 'yes') toast(`${e.from.emoji} ${e.from.name} just checked in: ${e.habit.emoji} ${e.habit.name} ✅`);
        refreshFeedSoon();
        if (get().challenges) refreshChallengesSoon();
        break;
      case 'nudge':
        toast(`${e.from.emoji} ${e.from.name} nudged you: ${e.habit.emoji} ${e.habit.name}. Did you show up?`);
        refreshFeedSoon();
        break;
      case 'reaction':
        toast(`${e.from.emoji} ${e.from.name} reacted ${e.emoji} to ${e.habit.emoji} ${e.habit.name}`, 'good');
        refreshFeedSoon();
        break;
    }
  };

  return {
    loaded: false,
    account: null,
    syncing: false,
    syncState: null,
    feed: null,
    feedError: null,
    challenges: null,
    live: 'closed',
    pendingCode: readPendingCode(),

    async load() {
      let account = (await loadAccount().catch(() => undefined)) ?? null;
      if (!account && IS_NATIVE) {
        // iOS may have cleared the web view's storage: the key is mirrored natively.
        const saved = await loadNativeAccount<AccountRecord>().catch(() => null);
        if (saved?.key && saved.profile) {
          await saveAccount(saved);
          await db.setKV('sync', { lastSeq: 0 });
          await db.queueEverything();
          account = saved;
        }
      }
      set({ account, loaded: true, syncState: account ? await loadSyncState() : null });
      if (account && SOCIAL_AVAILABLE) {
        await get().syncNow();
        void get().refreshFeed();
      }
    },

    async createAccount(key, name, emoji) {
      const keys = await deriveKeys(key);
      const { profile } = await cloud.createAccount(keys.auth, {
        name: name.trim(),
        emoji,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await dropDemo();
      await persist({ key, profile });
      await db.setKV('sync', { lastSeq: 0 });
      await db.queueEverything();
      await get().syncNow();
      void get().startLive();
      void get().refreshFeed();
    },

    async signIn(key) {
      const keys = await deriveKeys(key);
      let profile: Profile;
      try {
        profile = (await cloud.me(keys.auth)).profile;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new Error('No account found for that key. Check it and try again.');
        throw err;
      }
      await dropDemo();
      await persist({ key, profile });
      await db.setKV('sync', { lastSeq: 0 });
      const merged = await db.queueEverything();
      await get().syncNow();
      void get().startLive();
      void get().refreshFeed();
      return { merged };
    },

    async signOut() {
      const account = get().account;
      if (account?.linkedDeviceId) await cloud.unlinkDevice(await auth(), account.linkedDeviceId).catch(() => {});
      await forgetLocally();
      // The habits belong to the account: remove this device's copy.
      const { settings } = useStore.getState();
      await db.replaceAll({ habits: [], checkins: [], settings: { ...settings, onboarded: false } });
      await useStore.getState().reloadFromDisk();
    },

    async deleteAccount() {
      await cloud.deleteAccount(await auth());
      await forgetLocally(); // this device keeps its habits, now stored only here
    },

    async updateProfile(patch) {
      const { profile } = await cloud.updateProfile(await auth(), patch);
      await persist({ ...get().account!, profile });
      void get().refreshFeed();
    },

    async rotateFriendCode() {
      const { profile } = await cloud.rotateFriendCode(await auth());
      await persist({ ...get().account!, profile });
    },

    scheduleSync(delayMs = 800) {
      if (!get().account || !SOCIAL_AVAILABLE) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => void get().syncNow(), delayMs);
    },

    async syncNow() {
      if (!get().account || !SOCIAL_AVAILABLE) return;
      set({ syncing: true });
      const result = await runSync();
      set({ syncing: false, syncState: await loadSyncState() });
      if (result.accountGone) {
        await forgetLocally();
        toast('Your account was deleted on another device. Your habits stay here.', 'bad');
        return;
      }
      if (result.applied > 0) await useStore.getState().reloadFromDisk();
      if (result.ok) void get().linkPushDevice();
    },

    async startLive() {
      if (stopLiveSocket || !get().account || !SOCIAL_AVAILABLE) return;
      const token = await auth();
      if (stopLiveSocket || !get().account) return;
      stopLiveSocket = connectLive(token, onLive, (live) => set({ live }));
    },

    stopLive() {
      stopLiveSocket?.();
      stopLiveSocket = null;
    },

    async refreshFeed() {
      if (!get().account || !SOCIAL_AVAILABLE) return;
      try {
        set({ feed: await cloud.friends(await auth()), feedError: null });
      } catch (err) {
        set({ feedError: message(err) });
      }
    },

    async refreshChallenges() {
      if (!get().account || !SOCIAL_AVAILABLE) return;
      try {
        set({ challenges: (await cloud.challenges(await auth())).challenges });
      } catch (err) {
        console.warn('challenges', err);
      }
    },

    async addFriend(code) {
      const { friend, added } = await cloud.addFriend(await auth(), code);
      get().setPendingCode(null);
      await get().refreshFeed();
      return { name: friend.name, emoji: friend.emoji, added };
    },

    async removeFriend(id) {
      await cloud.removeFriend(await auth(), id);
      await get().refreshFeed();
    },

    async nudge(friendId, habitId) {
      await cloud.nudge(await auth(), friendId, habitId);
      await get().refreshFeed();
    },

    async react(friendId, habitId, date, emoji) {
      await cloud.react(await auth(), { to: friendId, habitId, date, emoji });
      await get().refreshFeed();
    },

    async createChallenge(input) {
      await cloud.createChallenge(await auth(), input);
      await get().refreshChallenges();
    },

    async joinChallenge(id, habitId) {
      await cloud.joinChallenge(await auth(), id, habitId);
      await get().refreshChallenges();
    },

    async leaveChallenge(id) {
      await cloud.leaveChallenge(await auth(), id);
      await get().refreshChallenges();
    },

    async inviteToChallenge(id, friendIds) {
      await cloud.inviteToChallenge(await auth(), id, friendIds);
      await get().refreshChallenges();
    },

    /** Devices with web push on get friends' nudges and reactions as notifications too. */
    async linkPushDevice() {
      const account = get().account;
      const push = useStore.getState().settings.push;
      if (!account) return;
      try {
        if (push.enabled && push.deviceId && push.token && account.linkedDeviceId !== push.deviceId) {
          await cloud.linkDevice(await auth(), push.deviceId, push.token);
          await persist({ ...account, linkedDeviceId: push.deviceId });
        } else if (!push.enabled && account.linkedDeviceId) {
          await persist({ ...account, linkedDeviceId: undefined });
        }
      } catch {
        /* the device isn't registered yet; retried after the next sync */
      }
    },

    setPendingCode(code) {
      try {
        if (code) sessionStorage.setItem(PENDING_CODE, code);
        else sessionStorage.removeItem(PENDING_CODE);
      } catch {
        /* storage blocked */
      }
      set({ pendingCode: code });
    },
  };
});
