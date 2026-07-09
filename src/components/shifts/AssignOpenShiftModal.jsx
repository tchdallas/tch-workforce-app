import React, { useState } from 'react';
import { formatEndTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { Badge } from '@/components/ui/badge';
import { Clock, MapPin, Shield } from 'lucide-react';
import { format } from 'date-fns';

export default function AssignOpenShiftModal({ open, onClose, shift, role, location, teamMembers, onAssign }) {
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [saving, setSaving] = useState(false);

  if (!shift) return null;

  // Filter: active members who have this role and location assigned
  const eligible = teamMembers.filter(tm => {
    if (tm.status !== 'active') return false;
    if (!tm.assignedRoleIds?.includes(shift.roleId)) return false;
    const hasLoc =
      tm.homeLocationId === shift.locationId ||
      tm.assignedLocationIds?.includes(shift.locationId);
    return hasLoc;
  });

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
            eligibleTeamMembers={eligible}
            placeholder="Search team member…"
          />
          {eligible.length === 0 && (
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