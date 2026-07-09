import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Trash2, AlertTriangle, History } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ShiftAuditTrail from '@/components/shifts/ShiftAuditTrail';
import { isRoleAvailableAtLocation } from '@/lib/roleLocations';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';

const defaultShift = {
  locationId: '', roleId: '', teamMemberId: '', startDateTime: '', endDateTime: '',
  breakMinutes: 0, breakNote: '', status: 'draft', shiftType: 'assigned',
  teamFacingNotes: '', internalNotes: '', tags: [],
};

export default function ShiftModal({ open, onClose, shift, locations, roles, teamMembers, onSave, onDelete }) {
  const [form, setForm] = useState(defaultShift);
  const isEdit = !!shift?.id;

  // Convert a UTC ISO string to "YYYY-MM-DDTHH:mm" in local time for datetime-local input
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => {
    if (shift) {
      setForm({
        ...defaultShift,
        ...shift,
        startDateTime: toLocalInput(shift.startDateTime),
        endDateTime: toLocalInput(shift.endDateTime),
      });
    } else {
      setForm(defaultShift);
    }
  }, [shift, open]);

  const eligibleTeamMembers = teamMembers.filter(tm => {
    if (!form.locationId || !form.roleId) return true;
    const hasLocation = tm.assignedLocationIds?.includes(form.locationId) || tm.homeLocationId === form.locationId;
    const hasRole = tm.assignedRoleIds?.includes(form.roleId);
    return hasLocation && hasRole;
  });

  // Default shift length: role override → location setting → company setting → 8h
  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  const durationFor = (roleId) => {
    const role = roles.find(r => r.id === roleId);
    const locVal = parseFloat(settings.find(s => s.key === 'default_shift_hours' && s.scope === 'location' && s.locationId === form.locationId)?.value);
    const companyVal = parseFloat(settings.find(s => s.key === 'default_shift_hours' && s.scope === 'company')?.value);
    return Number(role?.defaultShiftHours) || locVal || companyVal || 8;
  };

  // Changing the start keeps the shift's length (or applies the default when
  // no valid end is set) — the end time follows automatically
  const handleStartChange = (v) => {
    setForm(f => {
      if (!v) return { ...f, startDateTime: v };
      const newStart = new Date(v);
      const prevStart = f.startDateTime ? new Date(f.startDateTime) : null;
      const prevEnd = f.endDateTime ? new Date(f.endDateTime) : null;
      const durMs = (prevStart && prevEnd && prevEnd > prevStart)
        ? prevEnd - prevStart
        : durationFor(f.roleId) * 3600000;
      return { ...f, startDateTime: v, endDateTime: toLocalInput(new Date(newStart.getTime() + durMs)) };
    });
  };

  // Changing the role re-applies the default length — but only when the
  // current length still IS a default (a hand-tuned end time is preserved)
  const handleRoleChange = (v) => {
    setForm(f => {
      let end = f.endDateTime;
      if (f.startDateTime && f.endDateTime) {
        const hours = (new Date(f.endDateTime) - new Date(f.startDateTime)) / 3600000;
        if (Math.abs(hours - durationFor(f.roleId)) < 0.01) {
          end = toLocalInput(new Date(new Date(f.startDateTime).getTime() + durationFor(v) * 3600000));
        }
      }
      return { ...f, roleId: v, endDateTime: end };
    });
  };

  const handleSave = () => {
    const data = { ...form };
    if (data.startDateTime) data.startDateTime = new Date(data.startDateTime).toISOString();
    if (data.endDateTime) data.endDateTime = new Date(data.endDateTime).toISOString();
    if (!data.teamMemberId) {
      data.shiftType = 'open';
      data.teamMemberId = '';
    }
    onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom,0px)] sm:pb-0">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Shift' : 'New Shift'}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details">
          {isEdit && (
            <TabsList className="w-full mb-3">
              <TabsTrigger value="details" className="flex-1 text-xs">Details</TabsTrigger>
              <TabsTrigger value="history" className="flex-1 text-xs gap-1">
                <History className="w-3 h-3" /> History
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="history">
            <ShiftAuditTrail shiftId={shift?.id} />
          </TabsContent>

          <TabsContent value="details">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Location</Label>
              <div className="flex items-center h-9 px-3 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">
                {locations.find(l => l.id === form.locationId)?.name || '—'}
              </div>
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={form.roleId} onValueChange={handleRoleChange}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {roles.filter(r => r.status === 'active' && (!form.locationId || isRoleAvailableAtLocation(r, form.locationId) || r.id === form.roleId)).map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color || '#6366f1' }} />
                        {r.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Team Member</Label>
            <TeamMemberCombobox
              value={form.teamMemberId || 'open'}
              onChange={v => setForm(f => ({ ...f, teamMemberId: v === 'open' ? '' : v }))}
              eligibleTeamMembers={eligibleTeamMembers}
            />
            {eligibleTeamMembers.filter(tm => tm.status === 'active').length === 0 && form.locationId && form.roleId && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> No eligible team members for this location/role
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start</Label>
              <Input
                type="datetime-local"
                value={form.startDateTime}
                onChange={e => handleStartChange(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input
                type="datetime-local"
                value={form.endDateTime}
                onChange={e => setForm(f => ({ ...f, endDateTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Break (minutes)</Label>
              <Input
                type="number"
                value={form.breakMinutes}
                onChange={e => setForm(f => ({ ...f, breakMinutes: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <Label className="text-xs">Break Note</Label>
              <Input
                value={form.breakNote || ''}
                onChange={e => setForm(f => ({ ...f, breakNote: e.target.value }))}
                placeholder="e.g., 30 min paid"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Team-Facing Notes</Label>
            <Textarea
              value={form.teamFacingNotes || ''}
              onChange={e => setForm(f => ({ ...f, teamFacingNotes: e.target.value }))}
              placeholder="Visible to team members"
              rows={2}
            />
          </div>

          <div>
            <Label className="text-xs">Internal Notes (Managers Only)</Label>
            <Textarea
              value={form.internalNotes || ''}
              onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))}
              placeholder="Only visible to managers/admins"
              rows={2}
            />
          </div>
        </div>

          <DialogFooter className="flex justify-between items-center gap-2 mt-4">
            {isEdit && (
              <Button variant="destructive" size="sm" onClick={() => onDelete(shift.id)} className="mr-auto gap-1">
                <Trash2 className="w-3 h-3" /> Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave}>{isEdit ? 'Update Shift' : 'Create Shift'}</Button>
            </div>
          </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}