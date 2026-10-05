export interface Env {
  DB: D1Database;
  /** Public VAPID key (base64url, uncompressed P-256 point). Safe to share with browsers. */
  VAPID_PUBLIC_KEY: string;
  /** Private VAPID key (base64url "d" value). Set with `wrangler secret put VAPID_PRIVATE_KEY`. */
  VAPID_PRIVATE_KEY: string;
  /** Contact for push services: "mailto:you@example.com" or an https URL. */
  VAPID_SUBJECT: string;
  /** Comma-separated origins allowed by CORS, or "*". */
  ALLOWED_ORIGINS?: string;
  /** Pushes sent per cron run (default 8, fits the Workers Free CPU budget). */
  MAX_PUSHES_PER_TICK?: string;
  /** "true" only for local testing against a mock push server. Never set in production. */
  ALLOW_ANY_PUSH_ENDPOINT?: string;
}
