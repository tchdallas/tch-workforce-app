import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import WeekSelector from '@/components/schedule/WeekSelector';
import { useLocationFilter } from '@/hooks/useLocationFilter';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { startOfWeek, endOfWeek, format, differenceInHours } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Reports() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const { selectedLocation, setSelectedLocation, allowedIds, isLocked, isAll, locationQuery } = useLocationFilter();
  const { data: locations } = useLocations();
  const { data: roles } = useRoles();
  const { data: teamMembers } = useTeamMembers();

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const startStr = format(weekStart, "yyyy-MM-dd'T'00:00:00");
  const endStr = format(weekEnd, "yyyy-MM-dd'T'23:59:59");

  const { data: shifts = [] } = useQuery({
    queryKey: ['report-shifts', startStr, endStr, selectedLocation, isLocked],
    queryFn: () => base44.entities.Shift.filter({
      startDateTime: { $gte: startStr, $lte: endStr },
      status: { $ne: 'cancelled' },
      ...locationQuery,
    }),
    placeholderData: [],
  });

  // actual punches for the same week (RLS scopes these to the viewer's reach)
  const { data: timeEntries = [] } = useQuery({
    queryKey: ['report-time-entries', startStr, endStr],
    queryFn: () => base44.entities.TimeEntry.filter({
      clockIn: { $gte: startStr, $lte: endStr },
    }),
    placeholderData: [],
  });

  const filteredShifts = isAll ? shifts : shifts.filter(s => s.locationId === selectedLocation);
  const filteredEntries = isAll ? timeEntries : timeEntries.filter(e => e.locationId === selectedLocation);

  const entryHours = (e) => {
    if (!e.clockOut) return 0; // still on the clock
    return (new Date(e.clockOut) - new Date(e.clockIn)) / 3600000;
  };
  const clockedTotal = filteredEntries.reduce((acc, e) => acc + entryHours(e), 0);
  const autoClosedCount = filteredEntries.filter(e => e.autoClosed).length;

  // actual clocked hours per member, to sit beside their scheduled hours
  const clockedByMember = useMemo(() => {
    const map = {};
    timeEntries.forEach(e => {
      map[e.teamMemberId] = (map[e.teamMemberId] || 0) + entryHours(e);
    });
    return map;
  }, [timeEntries]);

  const hoursByLocation = useMemo(() => {
    const map = {};
    filteredShifts.forEach(s => {
      const loc = locations.find(l => l.id === s.locationId);
      const name = loc?.name || 'Unknown';
      const hours = differenceInHours(new Date(s.endDateTime), new Date(s.startDateTime));
      map[name] = (map[name] || 0) + hours;
    });
    return Object.entries(map).map(([name, hours]) => ({ name: name.length > 15 ? name.slice(0, 15) + '…' : name, hours }));
  }, [filteredShifts, locations]);

  const hoursByRole = useMemo(() => {
    const map = {};
    filteredShifts.forEach(s => {
      const role = roles.find(r => r.id === s.roleId);
      const name = role?.name || 'Unknown';
      const hours = differenceInHours(new Date(s.endDateTime), new Date(s.startDateTime));
      map[name] = (map[name] || 0) + hours;
    });
    return Object.entries(map).map(([name, hours]) => ({ name, hours }));
  }, [filteredShifts, roles]);

  const teamMemberHours = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      if (!s.teamMemberId) return;
      const tm = teamMembers.find(t => t.id === s.teamMemberId);
      const name = tm ? `${tm.preferredName || tm.firstName} ${tm.lastName?.[0] || ''}.` : 'Unknown';
      const hours = differenceInHours(new Date(s.endDateTime), new Date(s.startDateTime));
      if (!map[s.teamMemberId]) map[s.teamMemberId] = { name, totalHours: 0, clockedHours: clockedByMember[s.teamMemberId] || 0, locations: {} };
      map[s.teamMemberId].totalHours += hours;
      const locName = locations.find(l => l.id === s.locationId)?.name || 'Unknown';
      map[s.teamMemberId].locations[locName] = (map[s.teamMemberId].locations[locName] || 0) + hours;
    });
    // members with punches but no scheduled shifts still belong in the list
    Object.entries(clockedByMember).forEach(([tmId, hrs]) => {
      if (map[tmId] || hrs === 0) return;
      const tm = teamMembers.find(t => t.id === tmId);
      map[tmId] = {
        name: tm ? `${tm.preferredName || tm.firstName} ${tm.lastName?.[0] || ''}.` : 'Unknown',
        totalHours: 0,
        clockedHours: hrs,
        locations: {},
      };
    });
    return Object.values(map).sort((a, b) => b.totalHours - a.totalHours);
  }, [shifts, teamMembers, locations, clockedByMember]);

  const overtimeMembers = teamMemberHours.filter(tm => tm.totalHours > 40);
  const totalHours = filteredShifts.reduce((acc, s) => acc + differenceInHours(new Date(s.endDateTime), new Date(s.startDateTime)), 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Reports" subtitle="Schedule analytics and insights" />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <LocationSelector
          value={selectedLocation}
          onChange={setSelectedLocation}
          showAll={!isLocked}
          allowedIds={allowedIds}
        />
        <WeekSelector weekStart={weekStart} setWeekStart={setWeekStart} />
      </div>

      {autoClosedCount > 0 && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800/40 text-sm">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span>
            <span className="font-semibold">{autoClosedCount} punch{autoClosedCount > 1 ? 'es were' : ' was'} auto-closed</span>
            {' '}this week (no clock-out recorded) — verify the end times in Timesheets before exporting payroll.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total Shifts', value: filteredShifts.length },
          { label: 'Scheduled Hours', value: totalHours },
          { label: 'Clocked Hours', value: Math.round(clockedTotal * 10) / 10 },
          { label: 'Open Shifts', value: filteredShifts.filter(s => s.shiftType === 'open').length },
          { label: 'OT Warnings', value: overtimeMembers.length, warn: true },
        ].map(stat => (
          <Card key={stat.label} className={`p-4 ${stat.warn && stat.value > 0 ? 'border-amber-300 dark:border-amber-700' : ''}`}>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.warn && stat.value > 0 ? 'text-amber-600' : ''}`}>{stat.value}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="hours">
        <TabsList className="mb-4">
          <TabsTrigger value="hours" className="text-xs">By Location</TabsTrigger>
          <TabsTrigger value="roles" className="text-xs">By Role</TabsTrigger>
          <TabsTrigger value="crosslocation" className="text-xs">Cross-Location</TabsTrigger>
        </TabsList>

        <TabsContent value="hours">
          <Card>
            <CardHeader><CardTitle className="text-sm">Hours by Location</CardTitle></CardHeader>
            <CardContent>
              {hoursByLocation.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hoursByLocation}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="hours" fill="hsl(215,70%,14%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No data for this period</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardHeader><CardTitle className="text-sm">Hours by Role</CardTitle></CardHeader>
            <CardContent>
              {hoursByRole.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hoursByRole}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="hours" fill="hsl(43,76%,52%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No data for this period</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crosslocation">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                Cross-Location Weekly Hours
                {overtimeMembers.length > 0 && (
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[10px]">
                    <AlertTriangle className="w-3 h-3 mr-1" />{overtimeMembers.length} OT warning{overtimeMembers.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {teamMemberHours.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No scheduled hours</p>}
                {teamMemberHours.map((tm, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                    <div>
                      <p className="font-medium text-sm">{tm.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(tm.locations).map(([loc, hrs]) => (
                          <Badge key={loc} variant="outline" className="text-[9px] px-1.5">{loc}: {hrs}h</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${tm.totalHours > 40 ? 'text-amber-600' : ''}`}>{tm.totalHours}h</p>
                      <p className="text-[11px] text-muted-foreground">clocked {Math.round((tm.clockedHours || 0) * 10) / 10}h</p>
                      {tm.totalHours > 40 && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[9px]">OT</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}