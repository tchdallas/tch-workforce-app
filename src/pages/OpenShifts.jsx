import React, { useState, useMemo } from 'react';
import { formatEndTime, cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  HandHelping, Clock, MapPin, Shield, UserPlus, CheckCircle2, Loader2,
  Search, Filter, LayoutGrid, List as ListIcon, ArrowUpDown, X, Check,
} from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import FilterGroup from '@/components/common/FilterGroup';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format } from 'date-fns';
import AssignOpenShiftModal from '@/components/shifts/AssignOpenShiftModal';
import { toast } from 'sonner';

const statusLabel = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export default function OpenShifts() {
  const [assigningShift, setAssigningShift] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const { data: locations } = useLocations();
  const { data: roles } = useRoles();
  const { data: teamMembers = [] } = useTeamMembers();
  const { member, isManager } = useCurrentMember();
  const queryClient = useQueryClient();

  // search + filters + view/sort (mirrors Team Members)
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState([]);
  const [roleFilter, setRoleFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('tch-openshifts-view') || 'card'; } catch { return 'card'; }
  });
  React.useEffect(() => { try { localStorage.setItem('tch-openshifts-view', viewMode); } catch { /* ignore */ } }, [viewMode]);
  const [sortBy, setSortBy] = useState('time'); // time | role | location
  const [sortDir, setSortDir] = useState('asc');

  const toggleIn = (setter) => (val) =>
    setter((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  const autoApproveClaims = settings.find((s) => s.key === 'open_shift_auto_approve')?.value === 'true';

  const memberLocationIds = useMemo(() => {
    if (!member) return [];
    return Array.from(new Set([member.homeLocationId, ...(member.assignedLocationIds || [])].filter(Boolean)));
  }, [member]);

  const memberRoleIds = useMemo(() => (member?.assignedRoleIds || []).filter(Boolean), [member]);

  const { data: shifts = [] } = useQuery({
    queryKey: ['open-shifts', isManager, member?.id, memberLocationIds.join(','), memberRoleIds.join(',')],
    queryFn: () => {
      const filter = { shiftType: 'open', status: { $ne: 'cancelled' } };
      if (!isManager && member) {
        // Team members only see open shifts matching BOTH their roles and locations.
        if (!memberRoleIds.length || !memberLocationIds.length) return [];
        filter.roleId = { $in: memberRoleIds };
        filter.locationId = { $in: memberLocationIds };
      }
      return base44.entities.Shift.filter(filter);
    },
    enabled: !!member,
    placeholderData: [],
  });

  const { data: myClaims = [] } = useQuery({
    queryKey: ['my-open-claims', member?.id],
    queryFn: () => base44.entities.OpenShiftClaim.filter({ teamMemberId: member.id, status: 'pending' }),
    enabled: !isManager && !!member?.id,
    placeholderData: [],
  });
  const pendingClaimShiftIds = useMemo(() => new Set(myClaims.map((c) => c.shiftId)), [myClaims]);

  const handleAssign = async (shift, teamMemberId) => {
    await base44.entities.Shift.update(shift.id, { teamMemberId, shiftType: 'assigned', coverageStatus: 'covered' });
    queryClient.invalidateQueries({ queryKey: ['open-shifts'] });
    toast.success('Team member assigned successfully');
  };

  const handleClaim = async (shift) => {
    setClaimingId(shift.id);
    try {
      if (autoApproveClaims) {
        await base44.entities.Shift.update(shift.id, {
          teamMemberId: member.id, shiftType: 'assigned', coverageStatus: 'covered', recentChangeFlag: true,
        });
        toast.success('Shift claimed — added to your schedule');
      } else {
        await base44.entities.OpenShiftClaim.create({ shiftId: shift.id, teamMemberId: member.id, status: 'pending' });
        toast.success('Claim submitted — awaiting manager approval');
      }
      queryClient.invalidateQueries({ queryKey: ['open-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['my-open-claims'] });
    } catch (e) {
      toast.error(e.message || 'Could not claim shift');
    } finally {
      setClaimingId(null);
    }
  };

  const getRoleName = (id) => roles.find((r) => r.id === id)?.name || '';
  const getRoleColor = (id) => roles.find((r) => r.id === id)?.color || '#6366f1';
  const getLocName = (id) => locations.find((l) => l.id === id)?.name || '';

  // Filter options built from what's actually present, so nothing dangles empty.
  const locationOptions = useMemo(() => [...new Set(shifts.map((s) => s.locationId).filter(Boolean))]
    .map((id) => ({ value: id, label: getLocName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [shifts, locations]); // eslint-disable-line
  const roleOptions = useMemo(() => [...new Set(shifts.map((s) => s.roleId).filter(Boolean))]
    .map((id) => ({ value: id, label: getRoleName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [shifts, roles]); // eslint-disable-line
  const statusOptions = useMemo(() => [...new Set(shifts.map((s) => s.status).filter(Boolean))]
    .map((s) => ({ value: s, label: statusLabel(s) })), [shifts]);

  const filtered = shifts.filter((s) => {
    if (locationFilter.length && !locationFilter.includes(s.locationId)) return false;
    if (roleFilter.length && !roleFilter.includes(s.roleId)) return false;
    if (statusFilter.length && !statusFilter.includes(s.status)) return false;
    if (search) {
      const when = s.startDateTime ? format(new Date(s.startDateTime), 'EEE MMM d h:mm a') : '';
      const hay = `${getRoleName(s.roleId)} ${getLocName(s.locationId)} ${when}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const sorted = useMemo(() => {
    const arr = [...filtered].sort((a, b) => {
      if (sortBy === 'role') return getRoleName(a.roleId).localeCompare(getRoleName(b.roleId), undefined, { sensitivity: 'base' });
      if (sortBy === 'location') return getLocName(a.locationId).localeCompare(getLocName(b.locationId), undefined, { sensitivity: 'base' });
      return (a.startDateTime || '').localeCompare(b.startDateTime || '');
    });
    return sortDir === 'asc' ? arr : arr.reverse();
  }, [filtered, sortBy, sortDir]); // eslint-disable-line

  const activeFilterCount = (locationFilter.length ? 1 : 0) + (roleFilter.length ? 1 : 0) + (statusFilter.length ? 1 : 0);
  const anyNarrowing = activeFilterCount > 0 || !!search;

  const whenLabel = (s) => (s.startDateTime
    ? `${format(new Date(s.startDateTime), 'EEE, MMM d · h:mm a')} – ${s.endDateTime ? formatEndTime(s.startDateTime, s.endDateTime) : ''}`
    : '');

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Open Shifts"
        subtitle={anyNarrowing ? `${sorted.length} of ${shifts.length} shown` : `${shifts.length} available`}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search role, location, or day…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
              <Filter className="w-4 h-4" /> Filter
              {activeFilterCount > 0 && (
                <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 leading-tight">{activeFilterCount}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
              <FilterGroup title="Role" options={roleOptions} selected={roleFilter} onToggle={toggleIn(setRoleFilter)} />
              <FilterGroup title="Location" options={locationOptions} selected={locationFilter} onToggle={toggleIn(setLocationFilter)} />
              <FilterGroup title="Status" options={statusOptions} selected={statusFilter} onToggle={toggleIn(setStatusFilter)} />
            </div>
            {activeFilterCount > 0 && (
              <div className="border-t border-border p-2">
                <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs"
                  onClick={() => { setRoleFilter([]); setLocationFilter([]); setStatusFilter([]); }}>
                  <X className="w-3.5 h-3.5" /> Clear filters
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {viewMode === 'list' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                <ArrowUpDown className="w-4 h-4" /> Sort
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              {[['time', 'Date & time'], ['role', 'Role'], ['location', 'Location']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setSortBy(v)}
                  className={cn('w-full flex items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-muted', sortBy === v && 'text-primary font-medium')}>
                  {l} {sortBy === v && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted">
                {sortDir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
              </button>
            </PopoverContent>
          </Popover>
        )}

        <div className="flex items-center rounded-md border border-input shrink-0 overflow-hidden">
          <button type="button" onClick={() => setViewMode('card')} title="Card view"
            className={cn('p-1.5', viewMode === 'card' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setViewMode('list')} title="List view"
            className={cn('p-1.5 border-l border-input', viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-10">
          {anyNarrowing ? 'No open shifts match your search or filters.' : 'No open shifts available'}
        </p>
      )}

      {/* Card view */}
      {viewMode === 'card' && sorted.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((shift) => {
            const pending = pendingClaimShiftIds.has(shift.id);
            return (
              <Card
                key={shift.id}
                className={`transition-shadow ${isManager ? 'hover:shadow-md cursor-pointer' : ''}`}
                style={{ borderLeftWidth: '3px', borderLeftColor: getRoleColor(shift.roleId) }}
                onClick={isManager ? () => setAssigningShift(shift) : undefined}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <Badge className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                      <HandHelping className="w-3 h-3 mr-1" /> Open
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{shift.status}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-muted-foreground" />
                      <span className="text-sm font-medium">{getRoleName(shift.roleId)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{getLocName(shift.locationId)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{whenLabel(shift)}</span>
                    </div>
                  </div>
                  {shift.teamFacingNotes && (
                    <p className="text-xs text-muted-foreground mt-2 p-2 bg-muted/50 rounded">{shift.teamFacingNotes}</p>
                  )}
                  <div className="mt-3 pt-2 border-t">
                    {isManager ? (
                      <div className="flex items-center justify-center gap-1.5 text-xs text-primary font-medium">
                        <UserPlus className="w-3.5 h-3.5" /> Assign Team Member
                      </div>
                    ) : pending ? (
                      <div className="flex items-center justify-center gap-1.5 text-xs text-amber-600 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Claim pending approval
                      </div>
                    ) : (
                      <Button size="sm" className="w-full" disabled={claimingId === shift.id} onClick={(e) => { e.stopPropagation(); handleClaim(shift); }}>
                        {claimingId === shift.id ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Claiming…</> : 'Claim Shift'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && sorted.length > 0 && (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => setSortBy('role')}>Role</th>
                <th className="px-3 py-2 font-semibold cursor-pointer select-none hidden sm:table-cell" onClick={() => setSortBy('location')}>Location</th>
                <th className="px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => setSortBy('time')}>Date &amp; time</th>
                <th className="px-3 py-2 font-semibold hidden md:table-cell">Status</th>
                <th className="px-3 py-2 font-semibold text-right">{isManager ? 'Assign' : 'Claim'}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((shift) => {
                const pending = pendingClaimShiftIds.has(shift.id);
                return (
                  <tr
                    key={shift.id}
                    onClick={isManager ? () => setAssigningShift(shift) : undefined}
                    className={cn('border-b border-border last:border-0 hover:bg-muted/40', isManager && 'cursor-pointer')}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getRoleColor(shift.roleId) }} />
                        <span className="font-medium">{getRoleName(shift.roleId)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{getLocName(shift.locationId)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{whenLabel(shift)}</td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <Badge variant="outline" className="text-[10px]">{shift.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {isManager ? (
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => setAssigningShift(shift)}>
                          <UserPlus className="w-3.5 h-3.5" /> Assign
                        </Button>
                      ) : pending ? (
                        <span className="text-xs text-amber-600 font-medium inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Pending
                        </span>
                      ) : (
                        <Button size="sm" className="h-7 text-xs" disabled={claimingId === shift.id} onClick={() => handleClaim(shift)}>
                          {claimingId === shift.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Claim'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isManager && (
        <AssignOpenShiftModal
          open={!!assigningShift}
          onClose={() => setAssigningShift(null)}
          shift={assigningShift}
          role={roles.find((r) => r.id === assigningShift?.roleId)}
          location={locations.find((l) => l.id === assigningShift?.locationId)}
          teamMembers={teamMembers}
          onAssign={handleAssign}
        />
      )}
    </div>
  );
}
