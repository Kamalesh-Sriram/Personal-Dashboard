/* ══════════════════════════════════════════════════════════════════════
   QUEUE DRAINER

   Deliberately simple. It knows nothing about missions, XP or habits. It
   takes notifications that have come due and sends each one to the
   devices of the person who queued it.

   All the judgement stays in the app, which plans its own day ahead of
   time (see app/js/notify.js). Rebuilding that logic here would mean
   keeping two copies in step for ever.
   ══════════════════════════════════════════════════════════════════════ */
import { sendPush, checkVapid } from './webpush.mjs';
import { env, db, pushConfigured } from './auth.mjs';

const BATCH = 50;

export function elapsedLabel(startedAt, now = Date.now()) {
  const mins = Math.floor((now - startedAt) / 60000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} minute${m === 1 ? '' : 's'}`;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h} hour${h === 1 ? '' : 's'}`;
}
/** A timer row carries a template: the elapsed time is only true at send
 *  time. The title is the task, or the activity when there is no task; the
 *  body says how long it has run, led by the activity when the title is a task. */
export function render(row, now = Date.now()) {
  if (row.kind !== 'timer') return { title: row.title, body: row.body };
  const data = row.data || {}, started = Number(data.started_at) || now;
  const sub = typeof data.sub === 'string' ? data.sub.slice(0, 80) : '';
  const ran = elapsedLabel(started, now);
  return { title: row.title, body: sub ? `${sub} · running for ${ran}` : `Running for ${ran}`, started };
}

export async function drain() {
  const cfg = env();
  if (!pushConfigured(cfg)) return { skipped: 'push is not configured' };

  // Fail fast and legibly: a mis-pasted key otherwise fails once per device
  // per notification and retires the whole queue as undeliverable.
  const vapid = checkVapid(cfg.vapidPublic, cfg.vapidPrivate);
  if (!vapid.ok) throw new Error('VAPID misconfigured: ' + vapid.detail);

  const sql = db(cfg), nowIso = new Date().toISOString();
  const due = await sql.select(`push_queue?sent_at=is.null&send_at=lte.${encodeURIComponent(nowIso)}&order=send_at.asc&limit=${BATCH}`);
  const result = { due: due.length, sent: 0, expired: 0, failed: 0, pruned: 0 };
  if (!due.length) return result;
  // A queue table left over from version 4 has no owner column. Do nothing
  // until supabase/schema.sql has been run.
  if (due.some(r => !r.user_id)) return { ...result, skipped: 'the queue table is from an older version: run supabase/schema.sql' };

  const users = [...new Set(due.map(r => r.user_id))];
  const subs = await sql.select(`push_subscriptions?select=*&user_id=in.(${users.join(',')})`);
  const byUser = new Map();
  subs.forEach(s => { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); });

  for (const row of due) {
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      await sql.patch(`push_queue?id=eq.${row.id}`, { sent_at: nowIso, last_error: 'expired' });
      result.expired++;
      continue;
    }
    const { title, body, started } = render(row);
    const payload = JSON.stringify({ title, body, tag: row.tag, kind: row.kind, ongoing: row.ongoing, silent: row.silent, ...(started ? { started } : {}) });
    const mine = byUser.get(row.user_id) || [];
    let anyOk = false, lastError = null;

    for (const sub of mine) {
      try {
        const r = await sendPush(sub, payload, {
          publicKey: cfg.vapidPublic, privateKey: cfg.vapidPrivate, subject: cfg.vapidSubject,
          // a refreshed timer notice is worthless if it arrives late; a nudge is still worth having
          ttl: row.kind === 'timer' ? 120 : 3600, urgency: row.kind === 'timer' ? 'low' : 'normal'
        });
        if (r.ok) { anyOk = true; continue; }
        if (r.gone) { await sql.remove(`push_subscriptions?device_id=eq.${encodeURIComponent(sub.device_id)}`); result.pruned++; continue; }
        lastError = `HTTP ${r.status}`;
      } catch (e) { lastError = String(e.message).slice(0, 200); }
    }

    if (row.repeat_sec && anyOk) {
      // the running-timer row rolls forward instead of retiring
      await sql.patch(`push_queue?id=eq.${row.id}`, { send_at: new Date(Date.now() + row.repeat_sec * 1000).toISOString(), attempts: row.attempts + 1 });
    } else if (anyOk || row.attempts >= 2 || !mine.length) {
      await sql.patch(`push_queue?id=eq.${row.id}`, { sent_at: nowIso, attempts: row.attempts + 1, last_error: anyOk ? null : (lastError || 'no devices') });
    } else {
      await sql.patch(`push_queue?id=eq.${row.id}`, { send_at: new Date(Date.now() + 60000).toISOString(), attempts: row.attempts + 1, last_error: lastError });
    }
    anyOk ? result.sent++ : result.failed++;
  }

  // history older than three days earns nothing
  try { await sql.remove(`push_queue?sent_at=lt.${encodeURIComponent(new Date(Date.now() - 3 * 86400000).toISOString())}`); } catch { /* not worth failing over */ }
  return result;
}
