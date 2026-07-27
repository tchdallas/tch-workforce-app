import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfWeek, addDays, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import WeekSelector from '@/components/schedule/WeekSelector';
import ScheduleGrid from '@/components/schedule/ScheduleGrid';
import ViewDropdown, { getViewConfig } from '@/components/schedule/ViewDropdown';
import DayViewSummary from '@/components/schedule/DayViewSummary';
import DayTimeline from '@/components/schedule/DayTimeline';
import { useLocations, useRoles, useTeamMembers, businessDayStartHour, scheduleRoleOrder, sortRolesByOrder } from '@/lib/useAppData';
import { isRoleAvailableAtLocation, filterRolesByLocationAccess } from '@/lib/roleLocations';

export default function ViewSchedule({ assignedLocationIds = [] }) {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [viewKey, setViewKey] = useState('role_week');
  const { groupBy: viewMode, days: spanDays } = getViewConfig(viewKey);
  const [selectedLocation, setSelectedLocation] = useState('');

  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();
  const { data: teamMembers = [] } = useTeamMembers();

  const myLocationIds = useMemo(() => assignedLocationIds || [], [assignedLocationIds]);

  const weekEnd = addDays(weekStart, spanDays - 1);

  const { data: appSettings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });

  // 24/7: window and grouping follow the business-day boundary
  const dayStartHour = businessDayStartHour(
    appSettings,
    selectedLocation && selectedLocation !== 'all' ? selectedLocation : myLocationIds[0]
  );
  const windowStart = new Date(weekStart);
  windowStart.setHours(dayStartHour, 0, 0, 0);
  const windowEnd = addDays(new Date(weekStart), spanDays);
  windowEnd.setHours(dayStartHour, 0, 0, 0);
  const startStr = format(windowStart, "yyyy-MM-dd'T'HH:mm:ss");
  const endStr = format(windowEnd, "yyyy-MM-dd'T'HH:mm:ss");

  // Default to the single assigned location, or "all" when multiple
  useEffect(() => {
    if (!selectedLocation && myLocationIds.length > 0) {
      setSelectedLocation(myLocationIds.length === 1 ? myLocationIds[0] : 'all');
    }
  }, [myLocationIds, selectedLocation]);

  const { data: shifts = [] } = useQuery({
    queryKey: ['view-schedule-shifts', startStr, endStr, selectedLocation, myLocationIds.join(','), spanDays],
    queryFn: async () => {
      const filter = {
        startDateTime: { $gte: startStr, $lt: endStr },
        status: 'published', // team members only see published shifts
        archived: { $ne: true },
      };
      if (selectedLocation && selectedLocation !== 'all') {
        filter.locationId = selectedLocation;
      } else if (myLocationIds.length > 0) {
        filter.locationId = { $in: myLocationIds };
      }
      const PAGE = 500;
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.Shift.filter(filter, 'startDateTime', PAGE, page * PAGE);
        all = all.concat(batch);
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    placeholderData: [],
  });

  const shiftRoleIds = useMemo(() => shifts.map(s => s.roleId).filter(Boolean), [shifts]);

  // Same club position order the builder uses, so what a member sees matches
  // what their scheduler built. On "all locations" fall back to their home club.
  const orderLocation = selectedLocation && selectedLocation !== 'all' ? selectedLocation : myLocationIds[0];
  const roleOrder = useMemo(() => scheduleRoleOrder(appSettings, orderLocation), [appSettings, orderLocation]);

  const visibleRoles = useMemo(() => {
    const keep = new Set(shiftRoleIds);
    const avail = roles.filter(r => {
      if (keep.has(r.id)) return true;
      if (selectedLocation && selectedLocation !== 'all') return isRoleAvailableAtLocation(r, selectedLocation);
      return filterRolesByLocationAccess([r], myLocationIds).length > 0;
    });
    return sortRolesByOrder(avail, roleOrder);
  }, [roles, selectedLocation, shiftRoleIds, myLocationIds, roleOrder]);

  return (
    <div className="max-w-full flex flex-col" style={{ height: 'calc(100dvh - 112px)', minHeight: 0 }}>
      <div className="flex-shrink-0">
        <PageHeader title="Schedule" subtitle={`${format(weekStart, 'MMM d')} – ${format(weekEnd, spanDays === 1 ? 'MMM d, yyyy' : 'MMM d, yyyy')}`}>
          <Badge variant="outline" className="text-xs">View only</Badge>
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <LocationSelector
            value={selectedLocation}
            onChange={setSelectedLocation}
            className="w-[200px]"
            showAll={myLocationIds.length > 1}
            allowedIds={myLocationIds}
          />
          <WeekSelector weekStart={weekStart} setWeekStart={setWeekStart} spanDays={spanDays} />
          <ViewDropdown value={viewKey} onChange={setViewKey} />
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{shifts.length} shifts</Badge>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 min-h-0">
        {viewMode === 'timeline' ? (
          <DayTimeline
            date={weekStart}
            shifts={shifts}
            roles={visibleRoles}
            teamMembers={teamMembers}
            dayStartHour={dayStartHour}
            readOnly
          />
        ) : viewMode === 'summary' ? (
          <DayViewSummary
            date={weekStart}
            shifts={shifts}
            roles={visibleRoles}
            teamMembers={teamMembers}
            dayStartHour={dayStartHour}
            onShiftClick={() => {}}
          />
        ) : (
          <ScheduleGrid
            weekStart={weekStart}
            shifts={shifts}
            roles={visibleRoles}
            teamMembers={teamMembers}
            locations={locations}
            viewMode={viewMode}
            spanDays={spanDays}
            selectedLocation={selectedLocation}
            dayStartHour={dayStartHour}
            hideEmptyRows
            readOnly
          />
        )}
      </div>
    </div>
  );
}