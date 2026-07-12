import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatEndTime, businessDayOf } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { Badge } from '@/components/ui/badge';
import { Clock, MapPin, Shield } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { useAllAvailability, useApprovedTimeOff, restGapHours, businessDayStartHour } from '@/lib/useAppData';
import { annotateAndSort, buildLookups } from '@/lib/scheduleAvailability';

export default function AssignOpenShiftModal({ open, onClose, shift, role, location, teamMembers, onAssign }) {
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'], queryFn: () => base44.entities.AppSetting.list(), placeholderData: [],
  });
  const { data: availabilityAll = [] } = useAllAvailability();
  const { data: approvedTimeOff = [] } = useApprovedTimeOff();
  const dayKey = shift?.startDateTime ? shift.startDateTime.slice(0, 10) : null;
  const { data: conflictShifts = [] } = useQuery({
    queryKey: ['assign-conflict-shifts', dayKey],
    queryFn: () => {
      const d = new Date(dayKey + 'T00:00:00');
      return base44.entities.Shift.filter({
        startDateTime: { $gte: format(addDays(d, -1), "yyyy-MM-dd'T'00:00:00"), $lt: format(addDays(d, 2), "yyyy-MM-dd'T'00:00:00") },
        status: { $ne: 'cancelled' },
      });
    },
    enabled: !!dayKey, placeholderData: [],
  });

  const { orderedMembers, statusById } = useMemo(() => {
    if (!shift) return { orderedMembers: [], statusById: null };
    const eligible = teamMembers.filter(tm =>
      tm.status === 'active' && tm.assignedRoleIds?.includes(shift.roleId) &&
      (tm.homeLocationId === shift.locationId || tm.assignedLocationIds?.includes(shift.locationId)));
    const dayStartHour = businessDayStartHour(settings, shift.locationId);
    const dayOfWeek = new Date(businessDayOf(shift.startDateTime, dayStartHour) + 'T00:00:00').getDay();
    const lookups = buildLookups({ availability: availabilityAll, timeOff: approvedTimeOff, shifts: conflictShifts });
    const { ordered, statusById } = annotateAndSort(
      eligible,
      { start: new Date(shift.startDateTime), end: new Date(shift.endDateTime), dayOfWeek, excludeShiftId: shift.id },
      { ...lookups, restGapMs: restGapHours(settings, shift.locationId) * 3600000, locationNameById: {} }
    );
    return { orderedMembers: ordered, statusById };
  }, [shift, teamMembers, settings, availabilityAll, approvedTimeOff, conflictShifts]);

  if (!shift) return null;

  const handleAssign = async () => {
    if (!selectedMemberId) return;
    setSaving(true);
    await onAssign(shift, selectedMemberId);
    setSaving(false);
    setSelectedMemberId('');
    onClose();
  };

  const handleClose = () => {
    setSelectedMemberId('');
    onClose();
  };

  const roleColor = role?.color || '#6366f1';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Assign Open Shift</DialogTitle>
        </DialogHeader>

        {/* Shift summary */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border-l-4" style={{ borderLeftColor: roleColor }}>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-muted-foreground" />
              <span className="text-sm font-semibold">{role?.name || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{location?.name || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
              </span>
            </div>
          </div>
          <Badge className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">Open</Badge>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Assign to</Label>
          <TeamMemberCombobox
            value={selectedMemberId}
            onChange={setSelectedMemberId}
            eligibleTeamMembers={orderedMembers}
            statusFor={statusById ? (id) => statusById.get(id) : undefined}
            placeholder="Search team member…"
          />
          {orderedMembers.length === 0 && (
            <p className="text-xs text-muted-foreground">No active members match this role and location.</p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
          <Button className="flex-1" onClick={handleAssign} disabled={!selectedMemberId || saving}>
            {saving ? 'Assigning…' : 'Assign Shift'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
