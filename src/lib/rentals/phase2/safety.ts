/**
 * Kill switch + alerts (review MH10).
 * Vercel side: rentals are OFF if ANY of: env RENTALS_KILL=1, the Supabase
 * flag rental_settings.rentals_enabled is not true, or the flag can't be
 * read (fail closed). The node side has its own local file
 * state/DIRECT-RENTALS-DISABLED which always wins there (job schema §5).
 * Alerts: Vercel can't reach the operator's private alert relay, so alerts are rows in
 * rental_alerts that the node polls outbound and forwards to its ntfy
 * topic (authenticated). Staging uses MockAlerter.
 */
export type Alert = { kind: string; orderRef: string; at: number };
export interface Alerter { send(a: Alert): Promise<void> }
/** ntfy publisher (topic gm-alerts). Used only when RENTALS_NTFY_URL is set; the rental_alerts outbox is always written too. */
export class NtfyAlerter implements Alerter {
  constructor(private base: string, private topic = "gm-alerts", private token?: string, private fetchImpl: typeof fetch = fetch) {}
  async send(a: Alert) {
    try {
      await this.fetchImpl(`${this.base.replace(/\/$/, "")}/${this.topic}`, { method: "POST", body: `rental ${a.kind} ${a.orderRef}`, headers: { title: "Galaxy Mind rentals", tags: "warning", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) } });
    } catch { /* outbox still has it */ }
  }
}
export class MockAlerter implements Alerter { sent: Alert[] = []; async send(a: Alert) { this.sent.push(a); } }

export function killSwitchFrom(env: Record<string, string | undefined>, readFlag: () => Promise<boolean | null>) {
  return async (): Promise<boolean> => {
    if (env.RENTALS_KILL === "1") return true;
    try { const enabled = await readFlag(); return enabled !== true; } catch { return true; }
  };
}

/**
 * Supabase flag reader. Uses the SERVER-ONLY key RENTALS_PHASE2_SUPABASE_SERVICE_KEY
 * (Vercel Sensitive env, never NEXT_PUBLIC). The public anon key cannot read
 * rental_settings, so it is never used here. null = unreadable = killed.
 */
export function supabaseFlagReader(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  return async (): Promise<boolean | null> => {
    const url = (env.RENTALS_PHASE2_SUPABASE_URL ?? "").replace(/\/$/, ""), key = env.RENTALS_PHASE2_SUPABASE_SERVICE_KEY ?? "";
    if (!/^https:\/\//.test(url) || !key) return null;
    const r = await fetchImpl(`${url}/rest/v1/rental_settings?select=rentals_enabled&id=eq.1`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!r.ok) return null;
    const row = ((await r.json()) as { rentals_enabled?: unknown }[])[0];
    return row?.rentals_enabled === true ? true : row ? false : null;
  };
}

/** Fixed-window limiter (per instance). Real deploy: the KV limiter in rate-limit.ts. */
export class Limiter {
  private m = new Map<string, { start: number; n: number }>();
  constructor(private limit: number, private windowMs: number) {}
  ok(key: string, now: number): boolean {
    let b = this.m.get(key);
    if (!b || now - b.start >= this.windowMs) { b = { start: now, n: 0 }; if (this.m.size > 10_000) this.m.clear(); this.m.set(key, b); }
    b.n += 1;
    return b.n <= this.limit;
  }
}
