// Tournament-downs pay periods: a fixed 2-week cycle anchored to a real recent
// period start (Mon Jun 22, 2026 → Sun Jul 5, 2026). Any date maps to the
// period it falls in. All downs in a period share one pool → rate (Phase 2).
const ANCHOR = new Date(2026, 5, 22); // June 22, 2026, local midnight
const PERIOD_DAYS = 14;

const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function payPeriodFor(date) {
  const d = midnight(date);
  const a = midnight(ANCHOR);
  const idx = Math.floor((d - a) / 86400000 / PERIOD_DAYS);
  const start = new Date(a);
  start.setDate(a.getDate() + idx * PERIOD_DAYS);
  const end = new Date(start);
  end.setDate(start.getDate() + PERIOD_DAYS - 1);
  return { start, end };
}

const fmt = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function payPeriodLabel(date, short = false) {
  const { start, end } = payPeriodFor(date);
  return short ? `${fmtShort(start)} – ${fmtShort(end)}` : `${fmt(start)} – ${fmt(end)}`;
}

// yyyy-mm-dd (local) — for comparing card_date strings to a period range
export function isoDate(d) {
  const x = midnight(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function inSamePayPeriod(a, b) {
  return payPeriodFor(a).start.getTime() === payPeriodFor(b).start.getTime();
}
