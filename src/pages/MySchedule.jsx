import React, { useState } from 'react';
import { formatEndTime, businessDayOf } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfWeek, endOfWeek, addDays, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import WeekSelector from '@/components/schedule/WeekSelector';
import { useRoles, useLocations, businessDayStartHour } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { Clock, Share2, AlertTriangle } from 'lucide-react';
import GiveShiftModal from '@/components/shifts/GiveShiftModal';
import CalloutModal from '@/components/shifts/CalloutModal';
import IncomingShiftOffers from '@/components/shifts/IncomingShiftOffers';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MySchedule() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [givingShift, setGivingShift] = useState(null);
  const [callingOutShift, setCallingOutShift] = useState(null);
  const { member } = useCurrentMember();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });

  // 24/7: the week window and day grouping follow the business-day boundary
  const dayStartHour = businessDayStartHour(settings, member?.homeLocationId);
  const windowStart = new Date(weekStart);
  windowStart.setHours(dayStartHour, 0, 0, 0);
  const windowEnd = addDays(new Date(weekStart), 7);
  windowEnd.setHours(dayStartHour, 0, 0, 0);
  const startStr = format(windowStart, "yyyy-MM-dd'T'HH:mm:ss");
  const endStr = format(windowEnd, "yyyy-MM-dd'T'HH:mm:ss");

  const { data: shifts = [] } = useQuery({
    queryKey: ['my-shifts', member?.id, startStr, endStr],
    queryFn: () => base44.entities.Shift.filter({
      teamMemberId: member.id,
      startDateTime: { $gte: startStr, $lt: endStr },
      status: 'published',
    }),
    enabled: !!member?.id,
    placeholderData: [],
  });

  const getRoleName = (id) => roles.find(r => r.id === id)?.name || '';
  const getRoleColor = (id) => roles.find(r => r.id === id)?.color || '#6366f1';
  const getLocationName = (id) => locations.find(l => l.id === id)?.name || '';

  // Group shifts by day index (0=Sun)
  const shiftsByDay = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    const dayStr = format(day, 'yyyy-MM-dd');
    return {
      date: day,
      label: DAYS[i],
      dateLabel: format(day, 'MMM d'),
      shifts: shifts.filter(s => businessDayOf(s.startDateTime, dayStartHour) === dayStr),
    };
  });

  const totalHours = shifts.reduce((acc, s) => {
    const hrs = (new Date(s.endDateTime) - new Date(s.startDateTime)) / 3600000;
    return acc + hrs;
  }, 0);

  const canOfferShift = !member?.noShiftSwapGive; // DB enforces this too

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="My Schedule"
        subtitle={`${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`}
      >
        {shifts.length > 0 && (
          <Badge variant="outline" className="gap-1 text-xs">
            <Clock className="w-3 h-3" />
            {totalHours.toFixed(1)} hrs this week
          </Badge>
        )}
      </PageHeader>

      <div className="mb-4">
        <WeekSelector weekStart={weekStart} setWeekStart={setWeekStart} />
      </div>

      <IncomingShiftOffers currentMemberId={member?.id} />

      <div className="space-y-2">
        {shiftsByDay.map(({ date, label, dateLabel, shifts: dayShifts }) => {
          const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
          return (
            <div
              key={label}
              className={`rounded-lg border p-3 ${isToday ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>
                  {label}
                </span>
                <span className="text-xs text-muted-foreground">{dateLabel}</span>
                {isToday && <Badge className="text-[9px] px-1.5 py-0 bg-primary text-primary-foreground">Today</Badge>}
              </div>
              {dayShifts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Off</p>
              ) : (
                <div className="space-y-1.5">
                  {dayShifts.map(shift => (
                    <div
                      key={shift.id}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm"
                      style={{ backgroundColor: `${getRoleColor(shift.roleId)}18`, borderLeft: `3px solid ${getRoleColor(shift.roleId)}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-xs" style={{ color: getRoleColor(shift.roleId) }}>
                          {getRoleName(shift.roleId)}
                        </span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {format(new Date(shift.startDateTime), 'h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">{getLocationName(shift.locationId)}</span>
                      {canOfferShift && (
                       <Button
                         size="icon"
                         variant="ghost"
                         className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                         title="Offer shift to someone"
                         onClick={() => setGivingShift(shift)}
                       >
                         <Share2 className="w-3.5 h-3.5" />
                       </Button>
                      )}
                      {new Date(shift.endDateTime) > new Date() && (
                       <Button
                         size="icon"
                         variant="ghost"
                         className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                         title="Call out of this shift"
                         onClick={() => setCallingOutShift(shift)}
                       >
                         <AlertTriangle className="w-3.5 h-3.5" />
                       </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <GiveShiftModal
        open={!!givingShift}
        onClose={() => setGivingShift(null)}
        shift={givingShift}
        role={roles.find(r => r.id === givingShift?.roleId)}
        location={locations.find(l => l.id === givingShift?.locationId)}
        currentMemberId={member?.id}
      />
      <CalloutModal
        open={!!callingOutShift}
        onClose={() => setCallingOutShift(null)}
        shift={callingOutShift}
        role={roles.find(r => r.id === callingOutShift?.roleId)}
        location={locations.find(l => l.id === callingOutShift?.locationId)}
        currentMemberId={member?.id}
      />
    </div>
  );
}