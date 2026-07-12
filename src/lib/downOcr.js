import { supabase } from '@/api/supabase';

// Call the serverless vision endpoint to read dealer names/badges off a down
// card photo. Assistive only — the manager confirms everything.
export async function scanDownCard(imageUrls) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/read-down-card', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ imageUrls }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Scan failed (${res.status})`);
  }
  return (await res.json()).entries || [];
}

const norm = (s) => (s || '').trim().toLowerCase();

// best-effort match of an OCR {name, badge} to a team member
export function matchEntry(entry, teamMembers) {
  const badge = (entry.badge || '').trim();
  if (badge) {
    const byBadge = teamMembers.find(m => (m.tmNumber || '').trim() === badge);
    if (byBadge) return byBadge;
  }
  const name = norm(entry.name);
  if (!name) return null;
  const full = (m) => norm(`${m.firstName} ${m.lastName}`);
  const pref = (m) => norm(`${m.preferredName || m.firstName} ${m.lastName}`);
  const exact = teamMembers.find(m => full(m) === name || pref(m) === name);
  if (exact) return exact;
  // loose: one contains the other (handles partial or reversed writing)
  return teamMembers.find(m =>
    full(m).includes(name) || name.includes(norm(m.lastName)) ||
    (norm(m.lastName) && name.includes(norm(m.lastName)) && name.includes(norm(m.firstName)))
  ) || null;
}
