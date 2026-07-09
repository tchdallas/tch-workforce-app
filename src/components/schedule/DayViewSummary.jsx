import React, { useMemo, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { cn, businessDayOf, formatEndTime } from '@/lib/utils';
import { ChevronDown, ChevronRight, User, Clock, Edit2 } from 'lucide-react';

export default function DayViewSummary({ date, shifts, roles, teamMembers = [], onShiftClick, dayStartHour = 0 }) {
  const [collapsedRoles, setCollapsedRoles] = useState(new Set());
  // drilldown: Set of "roleId|time" keys that are expanded
  const [expandedSlots, setExpandedSlots] = useState(new Set());

  const toggleRole = (roleId) => {
    setCollapsedRoles(prev => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const toggleSlot = (key) => {
    setExpandedSlots(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activeRoles = useMemo(() => roles.filter(r => r.status === 'active'), [roles]);

  const dayShifts = useMemo(
    () => shifts.filter(s => businessDayOf(s.startDateTime, dayStartHour) === format(date, 'yyyy-MM-dd')),
    [shifts, date, dayStartHour]
  );

  // Build per-role data: { roleId: { time: Shift[] } }
  const roleData = useMemo(() => {
    const map = {};
    dayShifts.forEach(shift => {
      const roleId = shift.roleId;
      if (!roleId) return;
      const time = format(new Date(shift.startDateTime), 'h:mm a');
      if (!map[roleId]) map[roleId] = {};
      if (!map[roleId][time]) map[roleId][time] = [];
      map[roleId][time].push(shift);
    });
    return map;
  }, [dayShifts]);

  // All unique start times across all roles, sorted chronologically
  const allTimes = useMemo(() => {
    const timesSet = new Set();
    dayShifts.forEach(s => timesSet.add(format(new Date(s.startDateTime), 'h:mm a')));
    return [...timesSet].sort((a, b) => {
      const toMin = t => {
        const [hm, period] = t.split(' ');
        let [h, m] = hm.split(':').map(Number);
        if (period === 'PM' && h !== 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      };
      return toMin(a) - toMin(b);
    });
  }, [dayShifts]);

  const rolesWithShifts = activeRoles.filter(r => roleData[r.id]);
  const totalShifts = dayShifts.length;

  const getTmName = (tmId) => {
    if (!tmId) return 'Open Shift';
    const tm = teamMembers.find(t => t.id === tmId);
    if (!tm) return 'Unknown';
    return `${tm.preferredName || tm.firstName} ${tm.lastName}`;
  };

  const getShiftDuration = (shift) => {
    const start = new Date(shift.startDateTime);
    const end = new Date(shift.endDateTime);
    const mins = (end - start) / 60000;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 sticky top-0 z-10">
          <div>
            <h2 className="text-sm font-semibold">{format(date, 'EEEE, MMMM d, yyyy')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{totalShifts} shift{totalShifts !== 1 ? 's' : ''} scheduled</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {rolesWithShifts.map(r => {
              const roleTotal = Object.values(roleData[r.id] || {}).reduce((a, b) => a + b.length, 0);
              return (
                <div key={r.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color || '#6366f1' }} />
                  <span className="text-xs text-muted-foreground">{r.name}: {roleTotal}</span>
                </div>
              );
            })}
          </div>
        </div>

        {rolesWithShifts.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No shifts scheduled for this day.
          </div>
        ) : (
          rolesWithShifts.map(role => {
            const timeslots = roleData[role.id] || {};
            const isCollapsed = collapsedRoles.has(role.id);
            const roleTotal = Object.values(timeslots).reduce((a, b) => a + b.length, 0);

            return (
              <div key={role.id} className="border-b border-border">
                {/* Role header row */}
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/50 hover:bg-muted/70 transition-colors text-left"
                  onClick={() => toggleRole(role.id)}
                >
                  {isCollapsed
                    ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  }
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role.color || '#6366f1' }} />
                  <span className="text-xs font-semibold flex-1">{role.name}</span>
                  <span className="text-xs text-muted-foreground">{roleTotal} total</span>
                </button>

                {/* Timeslot rows */}
                {!isCollapsed && allTimes.map(time => {
                  const slotShifts = timeslots[time];
                  if (!slotShifts || slotShifts.length === 0) return null;
                  const slotKey = `${role.id}|${time}`;
                  const isExpanded = expandedSlots.has(slotKey);

                  return (
                    <div key={time} className="border-t border-border/50">
                      {/* Count bubble row — click to drill down */}
                      <div
                        className="flex items-center hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => toggleSlot(slotKey)}
                      >
                        {/* Time column */}
                        <div className="w-28 flex-shrink-0 px-4 py-2.5">
                          <span className="text-xs font-mono text-muted-foreground">{time}</span>
                        </div>

                        {/* Count pill */}
                        <div className="flex-1 px-3 py-2.5 flex items-center gap-2">
                          <div
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                              isExpanded && "ring-2 ring-offset-1"
                            )}
                            style={{
                              backgroundColor: (role.color || '#6366f1') + '22',
                              color: role.color || '#6366f1',
                              border: `1px solid ${(role.color || '#6366f1')}50`,
                              ringColor: role.color || '#6366f1',
                            }}
                          >
                            <span>{slotShifts.length} scheduled</span>
                          </div>
                        </div>

                        {/* Expand chevron */}
                        <div className="pr-4 flex-shrink-0">
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                          }
                        </div>
                      </div>

                      {/* Drilldown — individual team members */}
                      {isExpanded && (
                        <div className="border-t border-border/30 bg-muted/10">
                          {slotShifts.map(shift => {
                            const tmName = getTmName(shift.teamMemberId);
                            const duration = getShiftDuration(shift);
                            const endTime = formatEndTime(shift.startDateTime, shift.endDateTime);

                            return (
                              <div
                                key={shift.id}
                                className="flex items-center gap-3 px-4 py-2 border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors group cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShiftClick?.(shift);
                                }}
                              >
                                {/* Avatar / icon */}
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                                  style={{
                                    backgroundColor: (role.color || '#6366f1') + '30',
                                    color: role.color || '#6366f1',
                                  }}
                                >
                                  {shift.teamMemberId
                                    ? tmName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                                    : <User className="w-3 h-3" />
                                  }
                                </div>

                                {/* Name */}
                                <span className="text-xs font-medium flex-1 truncate">{tmName}</span>

                                {/* Time range + duration */}
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-shrink-0">
                                  <Clock className="w-3 h-3" />
                                  <span>{time} – {endTime}</span>
                                  <span className="text-muted-foreground/60">({duration})</span>
                                </div>

                                {/* Status badge */}
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0",
                                  shift.status === 'published'
                                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                )}>
                                  {shift.status === 'published' ? 'Published' : 'Draft'}
                                </span>

                                {/* Edit icon */}
                                <Edit2 className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}