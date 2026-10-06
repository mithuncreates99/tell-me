import { liveUrl } from './api';

/** Events the server pushes over the live connection (see api/src/routes). */
export type LiveEvent =
  | { t: 'hello'; at: number }
  | { t: 'sync'; seq: number }
  | { t: 'friends'; from?: string }
  | { t: 'challenges' }
  | { t: 'checkin'; from: Person; habit: HabitRef; answer: 'yes' | 'no' }
  | { t: 'nudge'; from: Person; habit: HabitRef }
  | { t: 'reaction'; from: Person; habit: HabitRef; emoji: string; date: string }
  /** The account was deleted (on another device): the server says so, then closes the connection. */
  | { t: 'gone' };

/** Close code the server uses when the account was deleted (on another device). */
export const ACCOUNT_GONE = 4001;

export interface Person {
  id: string;
  name: string;
  emoji: string;
}

export interface HabitRef {
  id: string;
  name: string;
  emoji: string;
}

export type LiveStatus = 'connecting' | 'open' | 'closed';

/**
 * Keeps one WebSocket open to the account's LiveHub while the app is in use, and reconnects
 * with backoff (1 s, 2 s, 4 s … 30 s) when the network drops. Browsers can't send headers on a
 * WebSocket, so the credentials travel as a subprotocol.
 */
export function connectLive(
  auth: string,
  onEvent: (e: LiveEvent) => void,
  onStatus: (s: LiveStatus) => void,
  WebSocketImpl: typeof WebSocket = WebSocket,
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const connect = () => {
    if (stopped) return;
    onStatus('connecting');
    ws = new WebSocketImpl(liveUrl(), ['tell-me.v1', `auth.${auth}`]);
    ws.addEventListener('open', () => {
      attempt = 0;
      onStatus('open');
      ping = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25_000);
    });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let event: LiveEvent;
      try {
        event = JSON.parse(e.data) as LiveEvent;
      } catch {
        return; // ignore malformed
      }
      if (event.t === 'gone') {
        if (stopped) return;
        stopped = true; // reconnecting can't work any more
        onStatus('closed');
      }
      onEvent(event);
    });
    ws.addEventListener('close', (e) => {
      clearInterval(ping);
      ws = null;
      if (stopped) return;
      onStatus('closed');
      if (e.code === ACCOUNT_GONE) {
        stopped = true; // reconnecting can't work any more
        onEvent({ t: 'gone' });
        return;
      }
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.8 + Math.random() * 0.4);
      retry = setTimeout(connect, delay);
    });
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(ping);
    ws?.close(1000, 'bye');
    onStatus('closed');
  };
}
