import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { format, isWithinInterval, addHours, subHours, isBefore, isAfter } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Users, Clock, AlertTriangle, ArrowRight, MessageSquarePlus, HandHelping } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import RoadmapCard from '@/components/roadmap/RoadmapCard';
import RoadmapShiftActionModal from '@/components/roadmap/RoadmapShiftActionModal';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { useMessagingDirectory } from '@/lib/messaging';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useMutation } from '@tanstack/react-query';
import { format as formatDate } from 'date-fns';
import { toast } from 'sonner';

export default function LiveRoadmap() {
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [actionShift, setActionShift] = useState(null);
  const now = new Date();
  const queryClient = useQueryClient();
  const invalidateRoadmap = () => {
    queryClient.invalidateQueries({ queryKey: ['roadmap-shifts'] });
    queryClient.invalidateQueries({ queryKey: ['roadmap-callouts'] });
    queryClient.invalidateQueries({ queryKey: ['roadmap-clocked-in'] });
    queryClient.invalidateQueries({ queryKey: ['roadmap-notes'] });
  };
  const handleRefresh = () => invalidateRoadmap();
  const { pullDistance, refreshing } = usePullToRefresh(handleRefresh);
  const { isManager, member } = useCurrentMember();

  const handleMarkCallout = async (shift) => {
    await base44.entities.Shift.update(shift.id, { coverageStatus: 'callout', recentChangeFlag: true });
    await base44.entities.Callout.create({
      shiftId: shift.id,
      teamMemberId: shift.teamMemberId,
      locationId: shift.locationId,
      roleId: shift.roleId,
      status: 'coverage_needed',
      submittedAt: new Date().toISOString(),
    });
    invalidateRoadmap();
    toast.success('Shift marked as callout');
  };

  const handleMarkLate = async (shift, lateTime) => {
    // Build the late arrival ISO from today's date + the entered time
    const [hours, minutes] = lateTime.split(':').map(Number);
    const arrival = new Date(shift.startDateTime);
    arrival.setHours(hours, minutes, 0, 0);
    const note = `Late arrival: ${formatDate(arrival, 'h:mm a')} (scheduled ${formatDate(new Date(shift.startDateTime), 'h:mm a')})`;
    await base44.entities.Shift.update(shift.id, {
      internalNotes: shift.internalNotes ? `${shift.internalNotes}\n${note}` : note,
      recentChangeFlag: true,
    });
    invalidateRoadmap();
    toast.success(`Marked as late — arrived ${formatDate(arrival, 'h:mm a')}`);
  };

  const handleReplaceTeamMember = async (shift, newMemberId) => {
    await base44.entities.Shift.update(shift.id, {
      teamMemberId: newMemberId,
      recentChangeFlag: true,
      shiftType: 'assigned',
    });
    await queryClient.invalidateQueries({ queryKey: ['roadmap-shifts'] });
    await queryClient.refetchQueries({ queryKey: ['roadmap-shifts'] });
    toast.success('Team member replaced');
  };

  const handleDeleteShift = async (shift) => {
    await base44.entities.Shift.delete(shift.id);
    invalidateRoadmap();
    toast.success('Shift deleted');
  };

  const handleUpdateNotes = async (shift, { teamFacingNotes, internalNotes }) => {
    await base44.entities.Shift.update(shift.id, { teamFacingNotes, internalNotes });
    invalidateRoadmap();
    toast.success('Notes saved');
  };

  const { data: locations } = useLocations();
  const { data: roles } = useRoles();
  const { data: teamMembers } = useTeamMembers();
  // Team members can't read coworkers' rows under RLS, so useTeamMembers only
  // returns themselves + anyone they manage. Without this, every coworker's
  // scheduled shift fell through to the "Open Shift" label. The messaging
  // directory RPC resolves names for coworkers who share a location (same feed
  // the clocked-in list already trusts).
  const { data: directory = [] } = useMessagingDirectory(member?.id);

  const { data: availabilities = [] } = useQuery({
    queryKey: ['availabilities'],
    queryFn: () => base44.entities.Availability.list(),
    placeholderData: [],
  });

  // 24/7 window: ±16h around now so overnight shifts (still running from
  // yesterday, or starting after midnight) are never cut off by calendar days
  const windowStart = format(subHours(now, 16), "yyyy-MM-dd'T'HH:00:00");
  const windowEnd = format(addHours(now, 16), "yyyy-MM-dd'T'HH:00:00");

  const { data: shifts = [] } = useQuery({
    queryKey: ['roadmap-shifts', windowStart],
    queryFn: () => {
      const filter = { startDateTime: { $gte: windowStart, $lte: windowEnd }, status: 'published' };
      return base44.entities.Shift.filter(filter);
    },
    placeholderData: [],
    refetchInterval: 60000,
  });

  // who is actually on the clock right now (kiosk/mobile punches) — polled
  // fast since punches happen on other devices and should show up promptly
  const { data: clockedIn = [] } = useQuery({
    queryKey: ['roadmap-clocked-in'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('roadmap_clocked_in');
      if (error) throw error;
      return data || [];
    },
    placeholderData: [],
    refetchInterval: 15000,
    staleTime: 0,
  });

  const { data: callouts = [] } = useQuery({
    queryKey: ['roadmap-callouts'],
    queryFn: () => base44.entities.Callout.filter({ status: { $ne: 'cancelled' } }),
    placeholderData: [],
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['roadmap-notes', format(now, 'yyyy-MM-dd')],
    queryFn: () => base44.entities.LiveRoadmapNote.filter({ date: format(now, 'yyyy-MM-dd') }),
    placeholderData: [],
  });

  const calloutShiftIds = new Set(callouts.filter(c => c.status !== 'covered' && c.status !== 'cancelled').map(c => c.shiftId));

  const filteredShifts = useMemo(() => {
    return shifts.filter(s => {
      if (selectedLocation !== 'all' && s.locationId !== selectedLocation) return false;
      if (roleFilter !== 'all' && s.roleId !== roleFilter) return false;
      return true;
    });
  }, [shifts, selectedLocation, roleFilter]);

  // punches, honoring the same location/role filters
  const filteredClockedIn = useMemo(() => {
    return clockedIn.filter(e => {
      if (selectedLocation !== 'all' && e.location_id !== selectedLocation) return false;
      if (roleFilter !== 'all' && e.role_id !== roleFilter) return false;
      return true;
    });
  }, [clockedIn, selectedLocation, roleFilter]);

  const clockedInMemberIds = useMemo(() => new Set(clockedIn.map(e => e.team_member_id)), [clockedIn]);

  // On Shift / Leaving Soon come from real punches; the schedule feeds the rest
  const onShiftEntries = useMemo(
    () => filteredClockedIn.filter(e => !e.shift_end || isAfter(new Date(e.shift_end), addHours(now, 2))),
    [filteredClockedIn] // eslint-disable-line
  );
  const leavingSoonEntries = useMemo(
    () => filteredClockedIn.filter(e => e.shift_end && !isAfter(new Date(e.shift_end), addHours(now, 2))),
    [filteredClockedIn] // eslint-disable-line
  );

  const grouped = useMemo(() => {
    const groups = { not_clocked_in: [], coming_soon: [], callout: [], coverage_needed: [], open: [] };
    filteredShifts.forEach(shift => {
      const start = new Date(shift.startDateTime);
      const end = new Date(shift.endDateTime);
      if (!isAfter(end, now)) return; // already over
      if (calloutShiftIds.has(shift.id)) groups.callout.push(shift);
      else if (shift.coverageStatus === 'coverage_needed' || shift.coverageStatus === 'callout') groups.coverage_needed.push(shift);
      else if (shift.shiftType === 'open') groups.open.push(shift);
      else if (shift.teamMemberId && clockedInMemberIds.has(shift.teamMemberId)) return; // they're on the clock — shown above
      else if (isWithinInterval(now, { start, end })) groups.not_clocked_in.push(shift);
      else if (isAfter(start, now) && isBefore(start, addHours(now, 4))) groups.coming_soon.push(shift);
    });
    return groups;
  }, [filteredShifts, calloutShiftIds, clockedInMemberIds]); // eslint-disable-line

  // full teamMembers rows (managers) win over directory entries (coworker names
  // for team-member viewers); directory fills the gaps RLS leaves behind
  const memberById = useMemo(() => {
    const map = new Map();
    (directory || []).forEach(m => map.set(m.id, m));
    (teamMembers || []).forEach(m => map.set(m.id, m));
    return map;
  }, [teamMembers, directory]);
  const getTeamMember = (id) => (id ? memberById.get(id) : undefined);
  const getRole = (id) => roles.find(r => r.id === id);

  // rows backed by a punch rather than a shift record
  const renderClockEntry = (e) => {
    const linkedShift = e.shift_id ? shifts.find(s => s.id === e.shift_id) : null;
    const clickable = isManager && linkedShift;
    return (
      <div
        key={`punch-${e.team_member_id}-${e.clock_in}`}
        onClick={clickable ? () => setActionShift(linkedShift) : undefined}
        className={`p-2.5 rounded-lg border border-border bg-muted/40 ${clickable ? 'cursor-pointer hover:bg-muted/70' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate">{e.name}</p>
          {e.unscheduled
            ? <Badge className="text-[9px] px-1.5 py-0 shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">Unscheduled</Badge>
            : <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">Scheduled</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {e.role || '—'} · in since {format(new Date(e.clock_in), 'h:mm a')}
          {e.shift_end && <> · until {format(new Date(e.shift_end), 'h:mm a')}</>}
        </p>
        {e.location && <p className="text-[11px] text-muted-foreground">{e.location}</p>}
      </div>
    );
  };

  const sections = [
    { key: 'on_shift', title: 'Currently On Shift', icon: Users, entries: onShiftEntries },
    { key: 'not_clocked_in', title: 'Scheduled — Not Clocked In', icon: AlertTriangle, shifts: grouped.not_clocked_in, danger: true },
    { key: 'coming_soon', title: 'Coming In Next', icon: ArrowRight, shifts: grouped.coming_soon },
    { key: 'leaving_soon', title: 'Leaving Soon', icon: Clock, entries: leavingSoonEntries },
    { key: 'callout', title: 'Callouts', icon: AlertTriangle, shifts: grouped.callout },
    { key: 'coverage_needed', title: 'Coverage Needed', icon: AlertTriangle, shifts: grouped.coverage_needed },
    { key: 'open', title: 'Open Shifts', icon: HandHelping, shifts: grouped.open },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <PageHeader title="Live Roadmap" subtitle={format(now, 'EEEE, MMMM d · h:mm a')}>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={invalidateRoadmap}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <LocationSelector value={selectedLocation} onChange={setSelectedLocation} className="w-[200px]" />
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roles.filter(r => r.status === 'active').map(r => (
              <SelectItem key={r.id} value={r.id}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color || '#6366f1' }} />
                  {r.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">
          {filteredClockedIn.length} clocked in · {filteredShifts.length} shifts in window
        </Badge>
      </div>

      {/* Sections Grid */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {sections.map(section => {
          const count = section.entries ? section.entries.length : section.shifts.length;
          return (
          <Card key={section.key} className={count === 0 ? 'opacity-60' : section.danger ? 'border-red-500/40' : ''}>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${section.danger && count > 0 ? 'text-red-500' : ''}`}>
                  <section.icon className="w-4 h-4" />
                  {section.title}
                </CardTitle>
                <Badge variant="outline" className="text-xs">{count}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[400px] overflow-y-auto">
              {count === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">None</p>
              ) : section.entries ? (
                section.entries.map(renderClockEntry)
              ) : (
                section.shifts
                  .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime))
                  .map(shift => (
                    <RoadmapCard
                      key={shift.id}
                      shift={shift}
                      teamMember={getTeamMember(shift.teamMemberId)}
                      role={getRole(shift.roleId)}
                      status={section.key}
                      onClick={isManager ? (s) => setActionShift(s) : undefined}
                    />
                  ))
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>

      {/* Shift Action Modal */}
      {isManager && (
        <RoadmapShiftActionModal
          open={!!actionShift}
          onClose={() => setActionShift(null)}
          shift={actionShift}
          teamMember={actionShift ? getTeamMember(actionShift.teamMemberId) : null}
          role={actionShift ? getRole(actionShift.roleId) : null}
          teamMembers={teamMembers}
          allShifts={shifts}
          availabilities={availabilities}
          onMarkCallout={handleMarkCallout}
          onMarkLate={handleMarkLate}
          onReplaceTeamMember={handleReplaceTeamMember}
          onDeleteShift={handleDeleteShift}
          onUpdateNotes={handleUpdateNotes}
        />
      )}

      {/* Daily Notes */}
      {notes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquarePlus className="w-4 h-4" /> Daily Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notes.map(note => (
              <div key={note.id} className="p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px]">{note.noteType}</Badge>
                  <span className="text-[10px] text-muted-foreground">{note.created_date && format(new Date(note.created_date), 'h:mm a')}</span>
                </div>
                <p className="text-sm">{note.note}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}