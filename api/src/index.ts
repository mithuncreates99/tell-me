import { app } from './app';
import type { Env } from './env';
import { runTick } from './tick';

export default {
  fetch: app.fetch,

  /** Cron trigger (every minute): send every reminder that is due. */
  async scheduled(_controller, env) {
    const stats = await runTick(env);
    if (stats.due > 0) console.log('tick', JSON.stringify(stats));
  },
} satisfies ExportedHandler<Env>;
