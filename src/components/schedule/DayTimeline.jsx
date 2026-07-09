import React, { useMemo } from 'react';
import { format, addDays } from 'date-fns';
import { cn, businessDayOf, formatEndTime } from '@/lib/utils';
import { Moon } from 'lucide-react';

// Hour-axis view of one business day: columns are hours (starting at the
// business-day boundary), rows are roles, shifts are positioned bars. The
// natural way to see a 24/7 operation's coverage at a glance.
export default function DayTimeline({
  date, shifts, roles, teamMembers = [], dayStartHour = 0, onShiftClick, readOnly = false,
}) {
  const windowStart = useMemo(() => {
    const d = new Date(date);
    d.setHours(dayStartHour, 0, 0, 0);
    return d;
  }, [date, dayStartHour]);

  const hours = useMemo(
    () => Array.from({ length: 24 }, (_, i) => {
      const h = new Date(windowStart.getTime() + i * 3600000);
      return { label: format(h, 'h a'), isDayBreak: h.getHours() === 0 };
    }),
    [windowStart]
  );

  const dayStr = format(date, 'yyyy-MM-dd');
  const dayShifts = useMemo(
    () => shifts.filter(s => businessDayOf(s.startDateTime, dayStartHour) === dayStr),
    [shifts, dayStartHour, dayStr]
  );

  const getTmName = (tmId) => {
    if (!tmId) return 'Open';
    const tm = teamMembers.find(t => t.id === tmId);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName?.[0] || ''}.` : '?';
  };

  // Group by role, then pack overlapping shifts into lanes within each role
  const roleRows = useMemo(() => {
    const byRole = new Map();
    dayShifts.forEach(s => {
      const key = s.roleId || 'none';
      if (!byRole.has(key)) byRole.set(key, []);
      byRole.get(key).push(s);
    });

    const orderedRoleIds = [
      ...roles.filter(r => byRole.has(r.id)).map(r => r.id),
      ...(byRole.has('none') ? ['none'] : []),
    ];

    return orderedRoleIds.map(roleId => {
      const role = roles.find(r => r.id === roleId);
      const items = byRole.get(roleId)
        .map(s => {
          const start = (new Date(s.startDateTime) - windowStart) / 3600000;
          const end = (new Date(s.endDateTime) - windowStart) / 3600000;
          return { shift: s, start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 0.25)), runsPast: end > 24 };
        })
        .sort((a, b) => a.start - b.start);

      // lane packing: first lane whose last bar ends before this one starts
      const lanes = [];
      items.forEach(item => {
        let lane = lanes.findIndex(endAt => endAt <= item.start + 0.001);
        if (lane === -1) { lanes.push(item.end); lane = lanes.length - 1; }
        else lanes[lane] = item.end;
        item.lane = lane;
      });

      return { roleId, role, items, laneCount: Math.max(lanes.length, 1) };
    });
  }, [dayShifts, roles, windowStart]);

  // "now" line when the visible business day is the current one
  const now = new Date();
  const nowOffset = (now - windowStart) / 3600000;
  const showNow = nowOffset >= 0 && nowOffset < 24;

  const LANE_H = 34;

  if (dayShifts.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        No shifts on {format(date, 'EEEE, MMM d')}{dayStartHour > 0 ? ` (business day starts ${format(windowStart, 'h a')})` : ''}.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto h-full overflow-y-auto">
      <div style={{ minWidth: '1100px' }} className="relative">
        {/* hour header */}
        <div className="grid sticky top-0 bg-card z-10 border-b border-border" style={{ gridTemplateColumns: '140px repeat(24, 1fr)' }}>
          <div className="p-2 text-xs font-semibold text-muted-foreground">Role</div>
          {hours.map((h, i) => (
            <div key={i} className={cn('py-2 text-center text-[10px] text-muted-foreground border-l border-border/60', h.isDayBreak && 'border-l-2 border-l-indigo-300')}>
              {h.label}
              {h.isDayBreak && <span className="block text-[8px] text-indigo-400">{format(addDays(new Date(date), 1), 'MMM d')}</span>}
            </div>
          ))}
        </div>

        {roleRows.map(({ roleId, role, items, laneCount }) => (
          <div key={roleId} className="grid border-b border-border" style={{ gridTemplateColumns: '140px 1fr' }}>
            <div className="p-2 flex items-center gap-2 border-r border-border/60">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role?.color || '#a3a3a3' }} />
              <span className="text-xs font-semibold truncate">{role?.name || 'No role'}</span>
            </div>
            <div className="relative" style={{ height: `${laneCount * LANE_H + 8}px` }}>
              {/* hour gridlines */}
              {hours.map((h, i) => (
                <div
                  key={i}
                  className={cn('absolute top-0 bottom-0 border-l', h.isDayBreak ? 'border-indigo-200' : 'border-border/40')}
                  style={{ left: `${(i / 24) * 100}%` }}
                />
              ))}
              {showNow && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-10" style={{ left: `${(nowOffset / 24) * 100}%` }} />
              )}
              {items.map(({ shift, start, end, lane, runsPast }) => {
                const color = role?.color || '#6366f1';
                const isOpen = !shift.teamMemberId;
                return (
                  <button
                    key={shift.id}
                    type="button"
                    onClick={readOnly ? undefined : () => onShiftClick?.(shift)}
                    title={`${getTmName(shift.teamMemberId)} · ${format(new Date(shift.startDateTime), 'h:mm a')} – ${formatEndTime(shift.startDateTime, shift.endDateTime)}`}
                    className={cn(
                      'absolute rounded-md border text-left px-1.5 overflow-hidden whitespace-nowrap',
                      !readOnly && 'cursor-pointer hover:ring-1 hover:ring-primary/60',
                      shift.status === 'draft' && 'border-dashed opacity-80',
                      isOpen && 'ring-1 ring-amber-400'
                    )}
                    style={{
                      left: `${(start / 24) * 100}%`,
                      width: `calc(${((end - start) / 24) * 100}% - 2px)`,
                      top: `${lane * LANE_H + 4}px`,
                      height: `${LANE_H - 6}px`,
                      backgroundColor: `${color}18`,
                      borderLeftWidth: '3px',
                      borderLeftColor: color,
                    }}
                  >
                    <span className="text-[10px] font-medium">{getTmName(shift.teamMemberId)}</span>
                    <span className="text-[9px] text-muted-foreground ml-1">
                      {format(new Date(shift.startDateTime), 'h:mm a')}
                    </span>
                    {runsPast && <span className="text-[9px] text-indigo-400 ml-0.5">»</span>}
                    {new Date(shift.endDateTime).getDate() !== new Date(shift.startDateTime).getDate() && (
                      <Moon className="inline w-2.5 h-2.5 text-indigo-400 ml-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
