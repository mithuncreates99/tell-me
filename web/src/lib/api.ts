/** Thin client for the reminder server (Cloudflare Worker, see /api). */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    throw new ApiError(0, "Couldn't reach the reminder server. Check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Server error (${res.status})`);
  return body as T;
}

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
