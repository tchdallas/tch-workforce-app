import React from 'react';
import { formatEndTime } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar, Users, AlertTriangle, ClipboardList, HandHelping, Radio,
  Plus, ArrowRight, Clock, User, CalendarCheck
} from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import AnnouncementBanner from '@/components/common/AnnouncementBanner';
import LocationSelector from '@/components/common/LocationSelector';
import { useLocationFilter } from '@/hooks/useLocationFilter';
import { useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format } from 'date-fns';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  const { pullDistance, refreshing } = usePullToRefresh(handleRefresh);

  const { selectedLocation, setSelectedLocation, allowedIds, isLocked, isAll, locationId, locationQuery } = useLocationFilter();
  const { data: teamMembers = [] } = useTeamMembers();
  const { member, isTeamMember } = useCurrentMember();

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd'T'00:00:00");

  const { data: shifts = [] } = useQuery({
    queryKey: ['dashboard-shifts', selectedLocation, isLocked],
    queryFn: () => base44.entities.Shift.filter({
      startDateTime: { $gte: todayStr },
      status: { $ne: 'cancelled' },
      ...locationQuery,
    }),
    placeholderData: [],
  });

  const { data: timeOff = [] } = useQuery({
    queryKey: ['dashboard-timeoff'],
    queryFn: () => base44.entities.TimeOffRequest.filter({ status: 'pending' }),
    placeholderData: [],
  });

  const { data: callouts = [] } = useQuery({
    queryKey: ['dashboard-callouts', selectedLocation, isLocked],
    queryFn: () => base44.entities.Callout.filter({ ...locationQuery }),
    placeholderData: [],
  });

  const { data: tradeRequests = [] } = useQuery({
    queryKey: ['dashboard-trades'],
    queryFn: () => base44.entities.ShiftTradeRequest.filter({ status: 'pending_manager' }),
    placeholderData: [],
  });

  const { data: giveawayRequests = [] } = useQuery({
    queryKey: ['dashboard-giveaways'],
    queryFn: () => base44.entities.ShiftGiveawayRequest.filter({ status: 'pending_manager' }),
    placeholderData: [],
  });

  const { data: openShiftClaims = [] } = useQuery({
    queryKey: ['dashboard-claims'],
    queryFn: () => base44.entities.OpenShiftClaim.filter({ status: 'pending' }),
    placeholderData: [],
  });

  // Helper: resolve location of a shift-linked request
  const shiftLocationById = (id) => shifts.find(s => s.id === id)?.locationId;

  // Location-scoped request filtering
  const filteredTimeOff = timeOff.filter(req => {
    if (isAll) return true;
    const tm = teamMembers.find(t => t.id === req.teamMemberId);
    return tm ? (tm.assignedLocationIds?.includes(locationId) || tm.homeLocationId === locationId) : false;
  });
  const filteredTrades = tradeRequests.filter(req => isAll || shiftLocationById(req.originalShiftId) === locationId);
  const filteredGiveaways = giveawayRequests.filter(req => isAll || shiftLocationById(req.shiftId) === locationId);
  const filteredClaims = openShiftClaims.filter(req => isAll || shiftLocationById(req.shiftId) === locationId);

  const todayShifts = shifts.filter(s => s.startDateTime?.startsWith(format(today, 'yyyy-MM-dd')));
  const openShifts = shifts.filter(s => s.shiftType === 'open' && s.coverageStatus !== 'covered');
  const draftShifts = shifts.filter(s => s.status === 'draft');
  const activeCallouts = callouts.filter(c => c.status !== 'covered' && c.status !== 'cancelled');
  const pendingRequests = filteredTrades.length + filteredGiveaways.length + filteredClaims.length + filteredTimeOff.length;

  // Team members get their own dashboard — no scheduling/approval widgets
  if (isTeamMember) {
    const myShiftsToday = todayShifts.filter(s => s.teamMemberId === member.id);
    const myUpcoming = shifts
      .filter(s => s.teamMemberId === member.id && s.status === 'published')
      .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime))
      .slice(0, 5);
    return (
      <div className="max-w-7xl mx-auto">
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        <PageHeader title="Dashboard" subtitle={format(today, 'EEEE, MMMM d, yyyy')} />

        <AnnouncementBanner />

        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard label="My Shifts Today" value={myShiftsToday.length} icon={Calendar} />
          <StatCard label="Open Shifts" value={openShifts.length} icon={HandHelping} variant={openShifts.length > 0 ? 'warning' : 'default'} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Link to="/my-schedule">
                <Button variant="outline" className="w-full justify-start gap-2 h-12">
                  <CalendarCheck className="w-4 h-4" /> My Schedule
                </Button>
              </Link>
              <Link to="/open-shifts">
                <Button variant="outline" className="w-full justify-start gap-2 h-12">
                  <HandHelping className="w-4 h-4" /> Open Shifts
                </Button>
              </Link>
              <Link to="/roadmap">
                <Button variant="outline" className="w-full justify-start gap-2 h-12">
                  <Radio className="w-4 h-4" /> Live Roadmap
                </Button>
              </Link>
              <Link to="/my-profile">
                <Button variant="outline" className="w-full justify-start gap-2 h-12">
                  <User className="w-4 h-4" /> My Profile
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">My Upcoming Shifts</CardTitle>
                <Link to="/my-schedule">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs">
                    View All <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {myUpcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No upcoming shifts scheduled</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {myUpcoming.map(shift => (
                    <div key={shift.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <div className="w-1.5 h-8 rounded-full bg-primary" />
                      <div>
                        <p className="text-sm font-medium">{format(new Date(shift.startDateTime), 'EEE, MMM d')}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(shift.startDateTime), 'h:mm a')} - {formatEndTime(shift.startDateTime, shift.endDateTime)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <PageHeader title="Dashboard" subtitle={format(today, 'EEEE, MMMM d, yyyy')}>
        <LocationSelector
          value={selectedLocation}
          onChange={setSelectedLocation}
          showAll={!isLocked}
          allowedIds={allowedIds}
          className="w-[180px]"
        />
        <Link to="/schedule">
          <Button size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> New Shift
          </Button>
        </Link>
      </PageHeader>

      <AnnouncementBanner />

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Today's Shifts" value={todayShifts.length} icon={Calendar} />
        <StatCard label="Open Shifts" value={openShifts.length} icon={HandHelping} variant={openShifts.length > 0 ? 'warning' : 'default'} />
        <StatCard label="Pending Requests" value={pendingRequests} icon={ClipboardList} variant={pendingRequests > 0 ? 'accent' : 'default'} />
        <StatCard label="Active Callouts" value={activeCallouts.length} icon={AlertTriangle} variant={activeCallouts.length > 0 ? 'danger' : 'default'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Link to="/schedule">
              <Button variant="outline" className="w-full justify-start gap-2 h-12">
                <Calendar className="w-4 h-4" /> Schedule
              </Button>
            </Link>
            <Link to="/roadmap">
              <Button variant="outline" className="w-full justify-start gap-2 h-12">
                <Radio className="w-4 h-4" /> Live Roadmap
              </Button>
            </Link>
            <Link to="/team-members">
              <Button variant="outline" className="w-full justify-start gap-2 h-12">
                <Users className="w-4 h-4" /> Team Members
              </Button>
            </Link>
            <Link to="/requests">
              <Button variant="outline" className="w-full justify-start gap-2 h-12">
                <ClipboardList className="w-4 h-4" /> Requests
                {pendingRequests > 0 && (
                  <Badge className="ml-auto bg-primary text-primary-foreground text-xs">{pendingRequests}</Badge>
                )}
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Unpublished Schedules */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Draft Shifts</CardTitle>
              {draftShifts.length > 0 && (
                <Badge variant="secondary">{draftShifts.length} unpublished</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {draftShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">All schedules are published</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {draftShifts.slice(0, 5).map(shift => (
                  <div key={shift.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-8 rounded-full bg-amber-400" />
                      <div>
                        <p className="text-sm font-medium">{format(new Date(shift.startDateTime), 'EEE, MMM d')}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(shift.startDateTime), 'h:mm a')} - {formatEndTime(shift.startDateTime, shift.endDateTime)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Callouts */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Active Callouts</CardTitle>
              <Link to="/callouts">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  View All <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {activeCallouts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No active callouts</p>
            ) : (
              <div className="space-y-2">
                {activeCallouts.slice(0, 4).map(callout => (
                  <div key={callout.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{callout.reason || 'Callout submitted'}</p>
                      <p className="text-xs text-muted-foreground">
                        {callout.submittedAt ? format(new Date(callout.submittedAt), 'h:mm a') : 'Pending'}
                      </p>
                    </div>
                    <Badge variant="outline" className="ml-auto text-xs shrink-0 border-red-300 text-red-600 dark:text-red-400">
                      {callout.status?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Requests */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pending Requests</CardTitle>
              <Link to="/requests">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  View All <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {pendingRequests === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No pending requests</p>
            ) : (
              <div className="space-y-2">
                {filteredTimeOff.slice(0, 2).map(req => (
                  <div key={req.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Time Off Request</p>
                      <p className="text-xs text-muted-foreground">{req.reason || 'No reason provided'}</p>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-xs">Pending</Badge>
                  </div>
                ))}
                {filteredTrades.slice(0, 2).map(req => (
                  <div key={req.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <ClipboardList className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Shift Trade Request</p>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-xs">Pending</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}