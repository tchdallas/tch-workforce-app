import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Clock, UserX, Trash2, ArrowLeftRight, FileText } from 'lucide-react';
import { cn, formatEndTime } from '@/lib/utils';

export default function RoadmapShiftActionModal({
  open, onClose, shift, teamMember, role, teamMembers, allShifts = [], availabilities = [],
  onMarkCallout, onMarkLate, onReplaceTeamMember, onDeleteShift, onUpdateNotes,
}) {
  const [view, setView] = useState('main'); // main | callout | late | replace | notes
  const [lateTime, setLateTime] = useState('');
  const [replaceMemberId, setReplaceMemberId] = useState('');
  const [teamNote, setTeamNote] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const roleColor = role?.color || '#6366f1';
  const displayName = teamMember
    ? `${teamMember.preferredName || teamMember.firstName} ${teamMember.lastName}`
    : 'Open Shift';

  const handleClose = () => {
    setView('main');
    setLateTime('');
    setReplaceMemberId('');
    setTeamNote('');
    setInternalNote('');
    onClose();
  };

  const handleOpenNotes = () => {
    setTeamNote(shift?.teamFacingNotes || '');
    setInternalNote(shift?.internalNotes || '');
    setView('notes');
  };

  const handleSaveNotes = async () => {
    await onUpdateNotes(shift, { teamFacingNotes: teamNote, internalNotes: internalNote });
    handleClose();
  };

  const handleCallout = async () => {
    await onMarkCallout(shift);
    handleClose();
  };

  const handleLate = async () => {
    if (!lateTime) return;
    await onMarkLate(shift, lateTime);
    handleClose();
  };

  const handleReplace = async () => {
    if (!replaceMemberId) return;
    await onReplaceTeamMember(shift, replaceMemberId);
    handleClose();
  };

  const handleDelete = async () => {
    await onDeleteShift(shift);
    handleClose();
  };

  if (!shift) return null;

  // Eligible replacements: same location + role, excluding current member, no overlapping shifts
  const shiftStart = shift ? new Date(shift.startDateTime) : null;
  const shiftEnd = shift ? new Date(shift.endDateTime) : null;

  const shiftDayOfWeek = shiftStart ? shiftStart.getDay() : null; // 0=Sun, 6=Sat

  const eligible = teamMembers.filter(tm => {
    if (tm.status !== 'active') return false;
    if (tm.id === shift.teamMemberId) return false;

    // Must have the role assigned
    if (!tm.assignedRoleIds?.includes(shift.roleId)) return false;

    // Must have the location assigned (home or assigned)
    const hasLocation =
      tm.homeLocationId === shift.locationId ||
      tm.assignedLocationIds?.includes(shift.locationId);
    if (!hasLocation) return false;

    // Check availability — if marked 'unavailable' for this day/time, exclude
    if (shiftDayOfWeek !== null) {
      const dayAvailabilities = availabilities.filter(
        a => a.teamMemberId === tm.id && a.dayOfWeek === shiftDayOfWeek
      );
      const isUnavailable = dayAvailabilities.some(a => {
        if (a.availabilityType !== 'unavailable') return false;
        // If no time range specified, entire day is unavailable
        if (!a.startTime || !a.endTime) return true;
        // Check time overlap: convert HH:MM to minutes for comparison
        const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const avStart = toMin(a.startTime);
        const avEnd = toMin(a.endTime);
        const sStart = shiftStart.getHours() * 60 + shiftStart.getMinutes();
        const sEnd = shiftEnd.getHours() * 60 + shiftEnd.getMinutes();
        return sStart < avEnd && sEnd > avStart;
      });
      if (isUnavailable) return false;
    }

    // Check for conflicting active shifts
    const hasConflict = allShifts.some(s => {
      if (s.id === shift.id) return false;
      if (s.teamMemberId !== tm.id) return false;
      if (s.status === 'cancelled') return false;
      if (
        s.coverageStatus === 'callout' ||
        s.coverageStatus === 'coverage_needed' ||
        s.coverageStatus === 'open' ||
        s.shiftType === 'open'
      ) return false;
      const sStart = new Date(s.startDateTime);
      const sEnd = new Date(s.endDateTime);
      return shiftStart < sEnd && shiftEnd > sStart;
    });
    return !hasConflict;
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Shift Actions</DialogTitle>
        </DialogHeader>

        {/* Shift summary */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border-l-4" style={{ borderLeftColor: roleColor }}>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground">{role?.name}</p>
            <div className="flex items-center gap-1 mt-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {format(new Date(shift.startDateTime), 'h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
              </span>
            </div>
          </div>
          {shift.coverageStatus === 'callout' && (
            <Badge className="bg-red-500 text-white border-0 text-[10px]">Callout</Badge>
          )}
        </div>

        {/* Views */}
        {view === 'main' && (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm"
              onClick={() => setView('replace')}
            >
              <ArrowLeftRight className="w-4 h-4 text-blue-500" /> Replace Team Member
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm"
              onClick={() => setView('late')}
            >
              <Clock className="w-4 h-4 text-amber-500" /> Mark as Late
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm text-red-600 hover:text-red-600"
              onClick={() => setView('callout')}
            >
              <UserX className="w-4 h-4" /> Mark as Callout
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm"
              onClick={handleOpenNotes}
            >
              <FileText className="w-4 h-4 text-violet-500" /> Edit Notes
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm text-destructive hover:text-destructive"
              onClick={() => setView('delete')}
            >
              <Trash2 className="w-4 h-4" /> Delete Shift
            </Button>
          </div>
        )}

        {view === 'callout' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will mark the shift as a callout and flag it as coverage needed.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>Back</Button>
              <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" onClick={handleCallout}>
                Confirm Callout
              </Button>
            </div>
          </div>
        )}

        {view === 'late' && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Actual arrival time</Label>
              <Input type="time" value={lateTime} onChange={e => setLateTime(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>Back</Button>
              <Button className="flex-1" onClick={handleLate} disabled={!lateTime}>
                Submit
              </Button>
            </div>
          </div>
        )}

        {view === 'replace' && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Replace with</Label>
              <Select value={replaceMemberId} onValueChange={setReplaceMemberId}>
                <SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger>
                <SelectContent>
                  {eligible.length === 0 && (
                    <SelectItem value="none" disabled>No eligible members</SelectItem>
                  )}
                  {eligible.map(tm => (
                    <SelectItem key={tm.id} value={tm.id}>
                      {tm.preferredName || tm.firstName} {tm.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>Back</Button>
              <Button className="flex-1" onClick={handleReplace} disabled={!replaceMemberId}>
                Replace
              </Button>
            </div>
          </div>
        )}

        {view === 'delete' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this shift? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={handleDelete}>
                Delete Shift
              </Button>
            </div>
          </div>
        )}

        {view === 'notes' && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Team-Facing Note</Label>
              <Textarea
                className="mt-1 text-sm resize-none"
                rows={3}
                placeholder="Visible to team members on their schedule…"
                value={teamNote}
                onChange={e => setTeamNote(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Internal / Manager Note</Label>
              <Textarea
                className="mt-1 text-sm resize-none"
                rows={3}
                placeholder="Only visible to managers…"
                value={internalNote}
                onChange={e => setInternalNote(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setView('main')}>Back</Button>
              <Button className="flex-1" onClick={handleSaveNotes}>Save Notes</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}