import React, { useState, useMemo } from 'react';
import { formatEndTime } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HandHelping, Clock, MapPin, Shield, UserPlus, CheckCircle2, Loader2 } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format } from 'date-fns';
import AssignOpenShiftModal from '@/components/shifts/AssignOpenShiftModal';
import { toast } from 'sonner';

export default function OpenShifts() {
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [assigningShift, setAssigningShift] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const { data: locations } = useLocations();
  const { data: roles } = useRoles();
  const { data: teamMembers = [] } = useTeamMembers();
  const { member, isManager } = useCurrentMember();
  const queryClient = useQueryClient();

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  const autoApproveClaims = settings.find(s => s.key === 'open_shift_auto_approve')?.value === 'true';

  const memberLocationIds = useMemo(() => {
    if (!member) return [];
    return Array.from(new Set([member.homeLocationId, ...(member.assignedLocationIds || [])].filter(Boolean)));
  }, [member]);

  const memberRoleIds = useMemo(() => (member?.assignedRoleIds || []).filter(Boolean), [member]);

  const { data: shifts = [] } = useQuery({
    queryKey: ['open-shifts', selectedLocation, isManager, member?.id, memberLocationIds.join(','), memberRoleIds.join(',')],
    queryFn: () => {
      const filter = { shiftType: 'open', status: { $ne: 'cancelled' } };
      if (isManager) {
        if (selectedLocation !== 'all') filter.locationId = selectedLocation;
      } else if (member) {
        // Team members only see open shifts matching BOTH their assigned roles and locations.
        // If either is empty, they qualify for nothing.
        if (!memberRoleIds.length || !memberLocationIds.length) return [];
        filter.roleId = { $in: memberRoleIds };
        filter.locationId = { $in: memberLocationIds };
      }
      return base44.entities.Shift.filter(filter);
    },
    enabled: !!member,
    placeholderData: [],
  });

  // Pending claims by this member (to show a "pending" state on the card)
  const { data: myClaims = [] } = useQuery({
    queryKey: ['my-open-claims', member?.id],
    queryFn: () => base44.entities.OpenShiftClaim.filter({ teamMemberId: member.id, status: 'pending' }),
    enabled: !isManager && !!member?.id,
    placeholderData: [],
  });
  const pendingClaimShiftIds = useMemo(() => new Set(myClaims.map(c => c.shiftId)), [myClaims]);

  const handleAssign = async (shift, teamMemberId) => {
    await base44.entities.Shift.update(shift.id, {
      teamMemberId,
      shiftType: 'assigned',
      coverageStatus: 'covered',
    });
    queryClient.invalidateQueries({ queryKey: ['open-shifts'] });
    toast.success('Team member assigned successfully');
  };

  const handleClaim = async (shift) => {
    setClaimingId(shift.id);
    try {
      if (autoApproveClaims) {
        await base44.entities.Shift.update(shift.id, {
          teamMemberId: member.id,
          shiftType: 'assigned',
          coverageStatus: 'covered',
          recentChangeFlag: true,
        });
        toast.success('Shift claimed — added to your schedule');
      } else {
        await base44.entities.OpenShiftClaim.create({
          shiftId: shift.id,
          teamMemberId: member.id,
          status: 'pending',
        });
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

  const getRoleName = (id) => roles.find(r => r.id === id)?.name || '';
  const getRoleColor = (id) => roles.find(r => r.id === id)?.color || '#6366f1';
  const getLocName = (id) => locations.find(l => l.id === id)?.name || '';

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Open Shifts" subtitle={`${shifts.length} available`} />

      {isManager && (
        <div className="flex items-center gap-3 mb-4">
          <LocationSelector value={selectedLocation} onChange={setSelectedLocation} className="w-[200px]" />
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shifts.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">No open shifts available</p>}
        {shifts.map(shift => {
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
                    <span className="text-xs text-muted-foreground">
                      {shift.startDateTime && format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {shift.endDateTime && formatEndTime(shift.startDateTime, shift.endDateTime)}
                    </span>
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

      {isManager && (
        <AssignOpenShiftModal
          open={!!assigningShift}
          onClose={() => setAssigningShift(null)}
          shift={assigningShift}
          role={roles.find(r => r.id === assigningShift?.roleId)}
          location={locations.find(l => l.id === assigningShift?.locationId)}
          teamMembers={teamMembers}
          onAssign={handleAssign}
        />
      )}
    </div>
  );
}