/* Answers "why is nothing arriving?" without guesswork. Open
   /.netlify/functions/push-health in a browser.

   Reports only yes/no facts about the setup: never a key, never an
   endpoint, never anyone's data. */
import { env, json, db } from '../lib/auth.mjs';
import { checkVapid } from '../lib/webpush.mjs';

export default async () => {
  const cfg = env();
  const out = {
    checkedAt: new Date().toISOString(),
    env: {
      SUPABASE_URL: !!cfg.url, SUPABASE_ANON_KEY: !!cfg.anonKey, SUPABASE_SERVICE_ROLE_KEY: !!cfg.serviceKey,
      VAPID_PUBLIC_KEY: !!cfg.vapidPublic, VAPID_PRIVATE_KEY: !!cfg.vapidPrivate
    },
    vapid: (() => { const v = checkVapid(cfg.vapidPublic, cfg.vapidPrivate); return { ok: v.ok, detail: v.detail }; })(),
    database: { reachable: false, tables: false },
    ok: false
  };
  if (cfg.url && cfg.serviceKey) {
    try {
      const sql = db(cfg);
      await sql.select('push_queue?select=id&limit=1');
      await sql.select('push_subscriptions?select=device_id&limit=1');
      await sql.select('dashboards?select=user_id&limit=1');
      out.database = { reachable: true, tables: true };
    } catch (e) {
      out.database = { reachable: /returned (40[0-9])/.test(e.message), tables: false, hint: 'Run supabase/schema.sql in the SQL editor.' };
    }
  }
  out.ok = out.vapid.ok && out.database.tables && Object.values(out.env).every(Boolean);
  return json(out, out.ok ? 200 : 503);
};
