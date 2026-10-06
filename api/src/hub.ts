import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * One LiveHub per account. Every open app (phone, laptop) of that account keeps a WebSocket
 * here; the API calls `notify()` to push an event to all of them instantly.
 *
 * Uses the WebSocket Hibernation API: idle connections cost nothing, and "ping" is answered
 * by the runtime without waking the object.
 */
export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'hello', at: Date.now() }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': 'tell-me.v1' },
    });
  }

  /** Sends an event to every connected device of this account. Returns how many got it. */
  async notify(event: Record<string, unknown>): Promise<number> {
    const text = JSON.stringify(event);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
        sent++;
      } catch {
        /* socket already closing */
      }
    }
    return sent;
  }

  /**
   * The account was deleted: tell every open app at once, then close the connections (4001 also
   * tells the app not to reconnect; the close itself can take a few seconds to arrive).
   */
  async disconnect(): Promise<number> {
    const sockets = this.ctx.getWebSockets();
    const gone = JSON.stringify({ t: 'gone' });
    for (const ws of sockets) {
      try {
        ws.send(gone);
        ws.close(4001, 'account deleted');
      } catch {
        /* already closing */
      }
    }
    return sockets.length;
  }

  override async webSocketMessage(): Promise<void> {
    // Clients only listen; "ping" is handled by the auto-response above.
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }
}
