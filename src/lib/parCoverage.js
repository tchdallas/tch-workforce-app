// Coverage of a built schedule against a staffing plan's par windows.
//
// Par is a "required shift STARTS per time slot" model: a par of 6 at 1:00 PM
// means six shifts should *begin* at 1:00 PM (a wave of six dealers clocking in),
// NOT six people present at some moment. So each par number is an independent
// demand for that start time, and a day's total demand is the SUM of its numbers
// (e.g. 1+6+3+1+1+1+1 = 14 shifts). A shift counts toward exactly one slot — the
// window its start time falls in.
//
// Par windows use gaming-day clock times (e.g. 18:00–02:00). `date` is the gaming
// day's starting calendar date; `dayStartHour` is the business-day boundary (4 AM).

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const gdMin = (t, sh) => ((toMin(t) - sh * 60) + 1440) % 1440;
const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

function windowRange(win, date, dayStartHour) {
  const base = new Date(date); base.setHours(dayStartHour, 0, 0, 0);
  const s = gdMin(win.startTime.slice(0, 5), dayStartHour);
  let e = gdMin(win.endTime.slice(0, 5), dayStartHour); if (e === 0) e = 1440;
  return [new Date(base.getTime() + s * 60000), new Date(base.getTime() + e * 60000)];
}

// Coverage for one role's par windows on a gaming-day date.
// Returns [{ win, start, end, scheduled, min, max, required, status }] by start.
// `scheduled` = shifts whose START falls in the slot. status: 'short' | 'over' | 'met'.
export function roleDayCoverage(parWindows, shifts, roleId, date, dayStartHour, locationId) {
  const dow = date.getDay();
  const wins = parWindows.filter(w => w.roleId === roleId && w.dayOfWeek === dow);
  if (!wins.length) return [];
  const roleShifts = shifts.filter(s =>
    s.roleId === roleId && s.status !== 'cancelled' && (!locationId || s.locationId === locationId));
  return wins.map(win => {
    const [start, end] = windowRange(win, date, dayStartHour);
    // par = required shift starts: count shifts that BEGIN within this slot
    const scheduled = roleShifts.filter(s => {
      const t = ms(s.startDateTime);
      return t >= start.getTime() && t < end.getTime();
    }).length;
    const required = win.requiredCount;
    const status = scheduled < required ? 'short' : scheduled > required ? 'over' : 'met';
    return { win, start, end, scheduled, min: scheduled, max: scheduled, required, status };
  }).sort((a, b) => a.start - b.start);
}

// Roll a day's per-window coverage into one badge number. Because par counts
// shift STARTS, the day's gap is the SUM of the per-slot shortfalls — the number
// of shifts still missing (e.g. slots of 1,6,3,1,1,1,1 with nothing scheduled →
// 14 short). `shortWins`/`overWins` keep the count of slots for the tooltip.
export function dayParSummary(cov) {
  let short = 0, over = 0, shortWins = 0, overWins = 0;
  for (const c of cov) {
    const gap = c.required - c.scheduled;
    if (gap > 0) { short += gap; shortWins++; }
    else if (gap < 0) { over += -gap; overWins++; }
  }
  return { short, over, shortWins, overWins, hasPar: cov.length > 0 };
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
