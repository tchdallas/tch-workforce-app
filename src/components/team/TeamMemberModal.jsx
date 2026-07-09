import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const defaultMember = {
  tmNumber: '', firstName: '', lastName: '', preferredName: '', email: '', phone: '',
  dateOfBirth: '', address: '', city: '', state: '', zip: '',
  homeLocationId: '', assignedLocationIds: [], assignedRoleIds: [],
  status: 'active', emergencyContactName: '', emergencyContactPhone: '',
  startDate: '', notes: '', permissionLevel: 'team_member',
};

export default function TeamMemberModal({ open, onClose, member, locations, roles, onSave, existingMembers = [] }) {
  const [form, setForm] = useState(defaultMember);
  const [tmNumberError, setTmNumberError] = useState('');
  const isEdit = !!member?.id;

  useEffect(() => {
    if (member) setForm({ ...defaultMember, ...member });
    else setForm(defaultMember);
    setTmNumberError('');
  }, [member, open]);

  const handleSave = () => {
    if (form.tmNumber?.trim()) {
      const duplicate = existingMembers.find(
        m => m.tmNumber?.trim().toLowerCase() === form.tmNumber.trim().toLowerCase() && m.id !== member?.id
      );
      if (duplicate) {
        setTmNumberError(`TM# "${form.tmNumber}" is already used by ${duplicate.firstName} ${duplicate.lastName}.`);
        return;
      }
    }
    setTmNumberError('');
    onSave(form);
  };

  const toggleArrayItem = (key, value) => {
    setForm(f => ({
      ...f,
      [key]: f[key]?.includes(value) ? f[key].filter(v => v !== value) : [...(f[key] || []), value],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom,0px)] sm:pb-0">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Team Member' : 'Add Team Member'}</DialogTitle>
          {isEdit && (
            <p className="text-sm text-muted-foreground">
              {form.preferredName ? `${form.preferredName} ${form.lastName}` : `${form.firstName} ${form.lastName}`}
              {form.tmNumber ? ` · #${form.tmNumber}` : ''}
            </p>
          )}
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden">
          <TabsList className="mb-3">
            <TabsTrigger value="basic" className="text-xs">Basic Info</TabsTrigger>
            <TabsTrigger value="assignments" className="text-xs">Assignments</TabsTrigger>
            <TabsTrigger value="contact" className="text-xs">Contact</TabsTrigger>
            <TabsTrigger value="admin" className="text-xs">Admin</TabsTrigger>
          </TabsList>

          {/* native overflow, not Radix ScrollArea: Safari can't scroll a
              ScrollArea whose root is only max-height-bounded */}
          <div className="flex-1 pr-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 200px)', WebkitOverflowScrolling: 'touch' }}>
            <TabsContent value="basic" className="space-y-3 mt-0">
              <div>
                <Label className="text-xs">TM # (Team Member ID)</Label>
                <Input
                  value={form.tmNumber || ''}
                  onChange={e => { setForm(f => ({ ...f, tmNumber: e.target.value })); setTmNumberError(''); }}
                  placeholder="e.g. TM-001"
                  className={tmNumberError ? 'border-destructive focus-visible:ring-destructive' : ''}
                />
                {tmNumberError && <p className="text-xs text-destructive mt-1">{tmNumberError}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">First Name *</Label>
                  <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Last Name *</Label>
                  <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Preferred Name</Label>
                <Input value={form.preferredName || ''} onChange={e => setForm(f => ({ ...f, preferredName: e.target.value }))} placeholder="Nickname or preferred name" />
              </div>
              <div>
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Date of Birth</Label>
                  <Input type="date" value={form.dateOfBirth || ''} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" value={form.startDate || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="invited">Invited</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="assignments" className="space-y-4 mt-0">
              <div>
                <Label className="text-xs mb-2 block">Home Location</Label>
                <select
                  value={form.homeLocationId || ''}
                  onChange={e => setForm(f => ({ ...f, homeLocationId: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">No home location</option>
                  {locations.filter(l => l.status === 'active').map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Additional Locations</Label>
                <div className="space-y-1.5">
                  {locations.filter(l => l.status === 'active').map(l => (
                    <label key={l.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.assignedLocationIds?.includes(l.id) || false}
                        onChange={() => toggleArrayItem('assignedLocationIds', l.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{l.name}</span>
                    </label>
                  ))}
                  {locations.filter(l => l.status === 'active').length === 0 && (
                    <p className="text-xs text-muted-foreground">No locations available.</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs mb-2 block">Assigned Roles</Label>
                <div className="space-y-1.5">
                  {roles.filter(r => r.status === 'active').map(r => (
                    <label key={r.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.assignedRoleIds?.includes(r.id) || false}
                        onChange={() => toggleArrayItem('assignedRoleIds', r.id)}
                        className="h-4 w-4"
                      />
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color || '#6366f1' }} />
                        <span className="text-sm">{r.name}</span>
                      </div>
                    </label>
                  ))}
                  {roles.filter(r => r.status === 'active').length === 0 && (
                    <p className="text-xs text-muted-foreground">No roles available.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contact" className="space-y-3 mt-0">
              <div>
                <Label className="text-xs">Address</Label>
                <Input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">City</Label>
                  <Input value={form.city || ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">State</Label>
                  <Input value={form.state || ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Zip</Label>
                  <Input value={form.zip || ''} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Emergency Contact Name</Label>
                <Input value={form.emergencyContactName || ''} onChange={e => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Emergency Contact Phone</Label>
                <Input value={form.emergencyContactPhone || ''} onChange={e => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))} />
              </div>
            </TabsContent>

            <TabsContent value="admin" className="space-y-3 mt-0">
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Block Giving Shifts Away</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Cannot offer their shifts for trade or giveaway</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!form.noShiftSwapGive}
                    onChange={e => setForm(f => ({ ...f, noShiftSwapGive: e.target.checked }))}
                    className="h-4 w-4 accent-destructive cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Block Accepting Shifts</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Cannot accept trades or giveaways from others</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!form.noShiftSwapReceive}
                    onChange={e => setForm(f => ({ ...f, noShiftSwapReceive: e.target.checked }))}
                    className="h-4 w-4 accent-destructive cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
                <div>
                  <Label className="text-xs font-medium">Kiosk Device Account</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">This login runs a time-clock kiosk (/kiosk) and can punch anyone by badge #</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!form.isKiosk}
                  onChange={e => setForm(f => ({ ...f, isKiosk: e.target.checked }))}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
              </div>
              <div>
                <Label className="text-xs">Permission Level</Label>
                <Select value={form.permissionLevel} onValueChange={v => setForm(f => ({ ...f, permissionLevel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="corporate_admin">Corporate Admin</SelectItem>
                    <SelectItem value="location_admin">Location Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="scheduler">Scheduler</SelectItem>
                    <SelectItem value="team_member">Team Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Internal Notes (Admin Only)</Label>
                <Textarea
                  value={form.notes || ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Private notes about this team member"
                  rows={4}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.firstName || !form.lastName || !form.email}>
            {isEdit ? 'Update' : 'Add Team Member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}