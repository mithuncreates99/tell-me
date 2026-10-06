/** Thin client for the Tell Me server (Cloudflare Worker, see /api). */
import type { Profile } from './account';

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Server error (${res.status})`, body.code);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export interface ReminderInput {
  id: string;
  kind: 'checkin' | 'weekly';
  title: string;
  emoji: string;
  days: number[];
  time: string;
  offsetMin: number;
  skipDates: string[];
}

export interface DeviceSyncBody {
  subscription: PushSubscriptionJSON;
  timeZone: string;
  reminders: ReminderInput[];
}

export const api = {
  config: () => request<{ vapidPublicKey: string }>('/api/config'),
  putDevice: (id: string, token: string, body: DeviceSyncBody) =>
    request<{ ok: true; reminders: Array<{ id: string; nextFireAt: string | null; nextDate: string | null }> }>(
      `/api/devices/${id}`,
      { method: 'PUT', token, body: JSON.stringify(body) },
    ),
  deleteDevice: (id: string, token: string) => request<{ ok: true }>(`/api/devices/${id}`, { method: 'DELETE', token }),
  testDevice: (id: string, token: string) => request<{ ok: boolean }>(`/api/devices/${id}/test`, { method: 'POST', token }),
};

// ---------- accounts, sync and friends (authenticated with the account's auth secret) ----------

export type TodayStatus = 'yes' | 'no' | 'pending' | 'upcoming' | 'rest';

export interface SharedHabitView {
  id: string;
  name: string;
  emoji: string;
  color: string;
  days: number[];
  time: string | null;
  /** The owner's local date right now (reactions and nudges refer to it). */
  date: string;
  today: TodayStatus;
  /** 7 chars from weekStart: Y yes, N no, M missed, P due today, F later, . rest */
  week: string;
  weekStart: string;
  streak: number;
  best: number;
  updatedAt: number;
}

export interface WeekSummary {
  yes: number;
  due: number;
}

export interface FriendView {
  id: string;
  name: string;
  emoji: string;
  since: number;
  lastSeenAt: number | null;
  habits: SharedHabitView[];
  week: WeekSummary;
}

export interface ReactionView {
  from: string;
  to: string;
  habitId: string;
  date: string;
  emoji: string;
  at: number;
}

export interface NudgeView {
  from: string;
  to: string;
  habitId: string;
  date: string;
  at: number;
}

export interface FriendsFeed {
  me: Profile & { habits: SharedHabitView[]; week: WeekSummary };
  friends: FriendView[];
  reactions: ReactionView[];
  nudges: NudgeView[];
  serverTime: number;
}

export interface ChallengeMember {
  userId: string;
  name: string;
  emoji: string;
  status: 'member' | 'invited';
  habit: { id: string; name: string; emoji: string; color: string; today: TodayStatus; week: string } | null;
  yes: number;
  done: boolean;
}

export interface ChallengeView {
  id: string;
  name: string;
  emoji: string;
  target: number;
  ownerId: string;
  createdAt: number;
  me: { status: 'member' | 'invited'; habitId: string | null };
  members: ChallengeMember[];
}

export interface SyncRecord {
  k: 'h' | 'c';
  id: string;
  u: number;
  d: 0 | 1;
  x: string;
}

export interface SharedHabitInput {
  id: string;
  name: string;
  emoji: string;
  color: string;
  days: number[];
  time: string | null;
  askMin: number;
  week: string;
  streak: number;
  best: number;
}

export interface ShareBody {
  timeZone: string;
  date: string;
  weekStart: string;
  habits: SharedHabitInput[];
  event?: { habitId: string; answer: 'yes' | 'no' };
}

export const REACTIONS = ['🔥', '👏', '💪', '🎉', '❤️'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const cloud = {
  createAccount: (auth: string, body: { name: string; emoji: string; timeZone: string }) =>
    request<{ profile: Profile }>('/api/account', { ...json('POST', body), token: auth }),
  me: (auth: string) => request<{ profile: Profile }>('/api/me', { token: auth }),
  updateProfile: (auth: string, patch: Partial<Pick<Profile, 'name' | 'emoji' | 'timeZone'>>) =>
    request<{ profile: Profile }>('/api/me', { ...json('PATCH', patch), token: auth }),
  rotateFriendCode: (auth: string) => request<{ profile: Profile }>('/api/me/friend-code', { ...json('POST'), token: auth }),
  deleteAccount: (auth: string) => request<{ ok: true }>('/api/me', { ...json('DELETE'), token: auth }),
  linkDevice: (auth: string, deviceId: string, token: string) =>
    request<{ ok: true }>(`/api/me/devices/${deviceId}`, { ...json('POST', { token }), token: auth }),
  unlinkDevice: (auth: string, deviceId: string) => request<{ ok: true }>(`/api/me/devices/${deviceId}`, { ...json('DELETE'), token: auth }),

  pull: (auth: string, since: number) =>
    request<{ records: Array<SyncRecord & { s: number }>; seq: number; more: boolean }>(`/api/sync?since=${since}`, { token: auth }),
  push: (auth: string, body: { records: SyncRecord[]; answered?: Array<{ habitId: string; date: string }> }) =>
    request<{ ok: true; seq: number; applied: number }>('/api/sync', { ...json('POST', body), token: auth }),

  invite: (code: string) => request<{ name: string; emoji: string }>(`/api/invite/${encodeURIComponent(code)}`),
  friends: (auth: string) => request<FriendsFeed>('/api/friends', { token: auth }),
  lookup: (auth: string, code: string) =>
    request<{ user: { id: string; name: string; emoji: string }; isSelf: boolean; isFriend: boolean }>(
      `/api/friends/lookup/${encodeURIComponent(code)}`,
      { token: auth },
    ),
  addFriend: (auth: string, code: string) =>
    request<{ friend: { id: string; name: string; emoji: string }; added: boolean }>('/api/friends', { ...json('POST', { code }), token: auth }),
  removeFriend: (auth: string, id: string) => request<{ ok: true }>(`/api/friends/${id}`, { ...json('DELETE'), token: auth }),
  share: (auth: string, body: ShareBody) => request<{ ok: true; changed: boolean }>('/api/share', { ...json('PUT', body), token: auth }),
  nudge: (auth: string, to: string, habitId: string) => request<{ ok: true }>('/api/nudges', { ...json('POST', { to, habitId }), token: auth }),
  react: (auth: string, body: { to: string; habitId: string; date: string; emoji: Reaction | null }) =>
    request<{ ok: true }>('/api/reactions', { ...json('PUT', body), token: auth }),

  challenges: (auth: string) => request<{ challenges: ChallengeView[] }>('/api/challenges', { token: auth }),
  createChallenge: (auth: string, body: { name: string; emoji: string; target: number; habitId: string; invite: string[] }) =>
    request<{ id: string }>('/api/challenges', { ...json('POST', body), token: auth }),
  joinChallenge: (auth: string, id: string, habitId: string) =>
    request<{ ok: true }>(`/api/challenges/${id}/join`, { ...json('POST', { habitId }), token: auth }),
  inviteToChallenge: (auth: string, id: string, friendIds: string[]) =>
    request<{ ok: true; invited: number }>(`/api/challenges/${id}/invite`, { ...json('POST', { friendIds }), token: auth }),
  leaveChallenge: (auth: string, id: string) => request<{ ok: true }>(`/api/challenges/${id}/membership`, { ...json('DELETE'), token: auth }),
};

/** ws(s)://…/api/live */
export const liveUrl = () => `${API_URL.replace(/^http/, 'ws')}/api/live`;
