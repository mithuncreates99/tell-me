import { app } from './app';
import type { Env } from './env';
import { runTick } from './tick';

export { LiveHub } from './hub';

export default {
  fetch: app.fetch,

  /** Cron trigger (every minute): send every reminder that is due. */
  async scheduled(controller, env) {
    const stats = await runTick(env);
    if (stats.due > 0) console.log('tick', JSON.stringify(stats));
    // Once an hour, forget old nudges and reactions (they only matter for a week).
    if (new Date(controller.scheduledTime).getUTCMinutes() === 0) {
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM nudges WHERE date < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM reactions WHERE date < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM rate_limits WHERE win < ?').bind(new Date().toISOString().slice(0, 10)),
      ]);
    }
  },
} satisfies ExportedHandler<Env>;
