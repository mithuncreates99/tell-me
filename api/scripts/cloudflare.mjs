// Minimal Cloudflare API client for the deploy scripts (uses CLOUDFLARE_API_TOKEN).
const API = 'https://api.cloudflare.com/client/v4';

export function token() {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) throw new Error('CLOUDFLARE_API_TOKEN is not set. Add it as a repository secret (see docs/DEPLOY.md).');
  return t;
}

export async function cf(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, status: res.status, result: json.result, errors: json.errors ?? [] };
}

export const describe = (r) => r.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;

/** The account to deploy to: CLOUDFLARE_ACCOUNT_ID, or the only account the token can see. */
export async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const r = await cf('/accounts?per_page=50');
  if (!r.ok) throw new Error(`Could not list Cloudflare accounts (${describe(r)}). Check the token's "Account Settings: Read" permission.`);
  if (r.result.length !== 1) {
    throw new Error(`The token can see ${r.result.length} accounts. Set CLOUDFLARE_ACCOUNT_ID to choose one.`);
  }
  return r.result[0].id;
}

/** The account's workers.dev subdomain (e.g. "mithun"), or null if none is registered yet. */
export async function workersSubdomain(account) {
  const r = await cf(`/accounts/${account}/workers/subdomain`);
  return r.ok && r.result?.subdomain ? r.result.subdomain : null;
}
