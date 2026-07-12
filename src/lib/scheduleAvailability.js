// Classifies a team member's fit for a given shift, combining:
//   - recurring weekly availability (advisory): preferred / unavailable
//   - approved time off (hard): the person is off
//   - conflicts: already scheduled overlapping (double-booked), or another
//     shift too close (rest gap)
//
// Everything is advisory/warn — the scheduler can still assign anyone (per the
// app's manager-override model). Lower sortKey = recommend higher in the list.

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const minOfDay = (d) => d.getHours() * 60 + d.getMinutes();

// clock-time overlap of a shift against a weekly availability window (minutes).
// null start/end on the availability row = whole day.
function timeWindowApplies(row, shiftStart, shiftEnd) {
  if (!row.startTime && !row.endTime) return true; // whole day
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const aStart = row.startTime ? toMin(row.startTime) : 0;
  const aEnd = row.endTime ? toMin(row.endTime) : 1440;
  let sStart = minOfDay(shiftStart);
  let sEnd = shiftEnd > shiftStart && shiftEnd.getDate() !== shiftStart.getDate()
    ? 1440 // crosses midnight — use the start-day portion
    : minOfDay(shiftEnd);
  if (sEnd <= sStart) sEnd = 1440;
  return aStart < sEnd && aEnd > sStart;
}

// severity ranks (higher = worse / lower in the list)
const SEV = { clean: 0, restGap: 2, unavailable: 3, doubleBooked: 4, timeOff: 5 };

// evaluate one member for a shift. Returns { severity, tone, badge, reasons, prefers, sortKey }
export function evaluateMember(memberId, shiftCtx, data) {
  const { start, end, dayOfWeek, excludeShiftId } = shiftCtx;
  const { availabilityByMember, timeOffByMember, shiftsByMember, restGapMs = 8 * 3600000, locationNameById = {} } = data;

  const reasons = [];
  let severity = SEV.clean;
  let prefers = false;

  // --- recurring availability (advisory) ---
  (availabilityByMember.get(memberId) || []).forEach(row => {
    if (row.dayOfWeek !== dayOfWeek) return;
    if (!timeWindowApplies(row, start, end)) return;
    if (row.availabilityType === 'unavailable') { severity = Math.max(severity, SEV.unavailable); reasons.push('Prefers not to work this time'); }
    else if (row.availabilityType === 'preferred') prefers = true;
  });

  // --- approved time off (hard): one-time date range, or recurring weekly ---
  const dayOnly = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
  const shiftDay = dayOnly(start);
  const offHit = (timeOffByMember.get(memberId) || []).some(t => {
    if (t.recurrence === 'weekly') {
      if (t.weekday !== dayOfWeek) return false;
      if (t.startDateTime && shiftDay < dayOnly(t.startDateTime)) return false;
      if (t.endDateTime && shiftDay > dayOnly(t.endDateTime)) return false; // null end = indefinite
      return true;
    }
    return t.endDateTime && ms(t.startDateTime) < ms(end) && ms(t.endDateTime) > ms(start);
  });
  if (offHit) { severity = Math.max(severity, SEV.timeOff); reasons.push('On approved time off'); }

  // --- scheduling conflicts from this member's other shifts ---
  const others = (shiftsByMember.get(memberId) || []).filter(s => s.id !== excludeShiftId && s.status !== 'cancelled');
  let doubleBooked = false, minGapMs = Infinity, gapLoc = null;
  others.forEach(s => {
    const a = ms(s.startDateTime), b = ms(s.endDateTime);
    if (a < ms(end) && b > ms(start)) { doubleBooked = true; return; }
    // gap between the two (non-overlapping) shifts
    const gap = a >= ms(end) ? a - ms(end) : ms(start) - b;
    if (gap >= 0 && gap < minGapMs) { minGapMs = gap; gapLoc = s.locationId; }
  });
  if (doubleBooked) { severity = Math.max(severity, SEV.doubleBooked); reasons.push('Already scheduled at this time'); }
  else if (minGapMs < restGapMs) {
    severity = Math.max(severity, SEV.restGap);
    const h = Math.floor(minGapMs / 3600000), m = Math.round((minGapMs % 3600000) / 60000);
    reasons.push(`Only ${h}h${m ? ` ${m}m` : ''} between shifts`);
  }

  const tone = severity >= SEV.doubleBooked ? 'bad' : severity >= SEV.restGap ? 'warn' : prefers ? 'good' : 'neutral';
  const badge = severity === SEV.timeOff ? 'Time off'
    : severity === SEV.doubleBooked ? 'Double-booked'
    : severity === SEV.unavailable ? 'Unavailable'
    : severity === SEV.restGap ? 'Rest gap'
    : prefers ? 'Preferred' : null;
  // clean candidates sort by preference; anything with an issue sinks by severity
  const sortKey = severity === SEV.clean ? (prefers ? -1 : 0) : severity;

  return { severity, tone, badge, reasons, prefers, sortKey };
}

// annotate + sort a candidate list. `candidates` are member objects with .id.
// Returns { ordered: [...candidates], statusById: Map }.
export function annotateAndSort(candidates, shiftCtx, data) {
  const statusById = new Map();
  candidates.forEach(c => statusById.set(c.id, evaluateMember(c.id, shiftCtx, data)));
  const nameOf = (c) => (c.display_name || `${c.preferredName || c.firstName || ''} ${c.lastName || ''}`).trim().toLowerCase();
  const ordered = [...candidates].sort((a, b) => {
    const sa = statusById.get(a.id).sortKey, sb = statusById.get(b.id).sortKey;
    if (sa !== sb) return sa - sb;
    return nameOf(a).localeCompare(nameOf(b));
  });
  return { ordered, statusById };
}

// build the per-member lookup maps from flat arrays (called once by a picker)
export function buildLookups({ availability = [], timeOff = [], shifts = [] }) {
  const availabilityByMember = new Map();
  availability.forEach(a => {
    if (!availabilityByMember.has(a.teamMemberId)) availabilityByMember.set(a.teamMemberId, []);
    availabilityByMember.get(a.teamMemberId).push(a);
  });
  const timeOffByMember = new Map();
  timeOff.forEach(t => {
    if (!timeOffByMember.has(t.teamMemberId)) timeOffByMember.set(t.teamMemberId, []);
    timeOffByMember.get(t.teamMemberId).push(t);
  });
  const shiftsByMember = new Map();
  shifts.forEach(s => {
    if (!s.teamMemberId) return;
    if (!shiftsByMember.has(s.teamMemberId)) shiftsByMember.set(s.teamMemberId, []);
    shiftsByMember.get(s.teamMemberId).push(s);
  });
  return { availabilityByMember, timeOffByMember, shiftsByMember };
}
