// Coverage of a built schedule against a staffing plan's par windows.
//
// Par windows use gaming-day clock times (e.g. 18:00–02:00). `date` is the
// gaming day's starting calendar date; `dayStartHour` is the business-day
// boundary (default 4 AM). We map each window to a real datetime range on that
// gaming day, then measure the *minimum concurrent* headcount across it — the
// worst-covered moment is what determines whether par is actually met.

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const gdMin = (t, sh) => ((toMin(t) - sh * 60) + 1440) % 1440;
const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

function windowRange(win, date, dayStartHour) {
  const base = new Date(date); base.setHours(dayStartHour, 0, 0, 0);
  const s = gdMin(win.startTime.slice(0, 5), dayStartHour);
  let e = gdMin(win.endTime.slice(0, 5), dayStartHour); if (e === 0) e = 1440;
  return [new Date(base.getTime() + s * 60000), new Date(base.getTime() + e * 60000)];
}

// min & max people concurrently scheduled during [start, end)
function concurrency(shifts, start, end) {
  const S = start.getTime(), E = end.getTime();
  const points = new Set([S]);
  shifts.forEach(sh => {
    const a = ms(sh.startDateTime), b = ms(sh.endDateTime);
    if (a > S && a < E) points.add(a);
    if (b > S && b < E) points.add(b);
  });
  let min = Infinity, max = 0;
  points.forEach(t => {
    let c = 0;
    shifts.forEach(sh => { if (ms(sh.startDateTime) <= t && ms(sh.endDateTime) > t) c++; });
    if (c < min) min = c;
    if (c > max) max = c;
  });
  return { min: min === Infinity ? 0 : min, max };
}

// Coverage for one role's par windows on a gaming-day date.
// Returns [{ win, start, end, min, max, required, status }] sorted by start.
// status: 'short' (understaffed at some point) | 'over' (extra at some point) | 'met'.
export function roleDayCoverage(parWindows, shifts, roleId, date, dayStartHour, locationId) {
  const dow = date.getDay();
  const wins = parWindows.filter(w => w.roleId === roleId && w.dayOfWeek === dow);
  if (!wins.length) return [];
  const roleShifts = shifts.filter(s =>
    s.roleId === roleId && s.status !== 'cancelled' && (!locationId || s.locationId === locationId));
  return wins.map(win => {
    const [start, end] = windowRange(win, date, dayStartHour);
    const inWin = roleShifts.filter(s => ms(s.startDateTime) < end.getTime() && ms(s.endDateTime) > start.getTime());
    const { min, max } = concurrency(inWin, start, end);
    const required = win.requiredCount;
    const status = min < required ? 'short' : max > required ? 'over' : 'met';
    return { win, start, end, min, max, required, status };
  }).sort((a, b) => a.start - b.start);
}

// Roles (ids) that have any par window on this gaming day for the given plan.
export function rolesWithParOnDay(parWindows, date) {
  const dow = date.getDay();
  return new Set(parWindows.filter(w => w.dayOfWeek === dow).map(w => w.roleId));
}

export const coverageClasses = (status) => status === 'short'
  ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
  : status === 'over'
    ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
    : 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
