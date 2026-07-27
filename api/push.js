import webpush from 'web-push';

// Signs and delivers Web Push. Called by a Postgres trigger (pg_net) whenever a
// notification row is written — see 20260725000004_web_push.sql.
//
// The VAPID private key lives only in Vercel's environment. The database holds
// the endpoint and a shared secret, never the signing key, so a database leak
// can't be used to send push to staff.

// Trimmed at the point of use. Setting these through a shell pipe appends a
// trailing newline, and web-push rejects a VAPID key with one as "not URL safe
// Base 64" — a confusing error for a value that looks correct everywhere you
// inspect it.
const env = (name, fallback = '') => String(process.env[name] ?? fallback).trim();

const VAPID_PUBLIC_KEY = env('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = env('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = env('VAPID_SUBJECT', 'mailto:victor@texascardhouse.com');
const PUSH_SECRET = env('PUSH_SECRET');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SECRET) {
    return res.status(500).json({ error: 'push is not configured' });
  }
  // Shared secret — without this the endpoint is an open relay for sending
  // notifications to staff phones. Trimmed on both sides because setting an env
  // var through a shell pipe picks up a trailing newline, and a secret that
  // differs only by invisible whitespace is a miserable thing to debug.
  const provided = String(req.headers['x-push-secret'] || '').trim();
  if (!provided || provided !== PUSH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { title, body, url, tag, subscriptions } = req.body || {};
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return res.status(200).json({ sent: 0, gone: [] });
  }

  const payload = JSON.stringify({ title, body, url, tag });

  const results = await Promise.allSettled(
    subscriptions.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 } // an hour: a shift reminder is worthless the next day
      )
    )
  );

  // 404/410 mean the browser threw the subscription away (permission revoked,
  // app uninstalled). Report them so they can be pruned rather than retried
  // forever on every future notification.
  const gone = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { sent += 1; return; }
    const code = r.reason?.statusCode;
    if (code === 404 || code === 410) gone.push(subscriptions[i].endpoint);
  });

  return res.status(200).json({ sent, gone });
}
