import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import PageHeader from '@/components/common/PageHeader';
import { Checkbox } from '@/components/ui/checkbox';
import { useRoles, useLocations } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { filterRolesByLocationAccess } from '@/lib/roleLocations';
import { toast } from 'sonner';

const roleGroups = ['Floor', 'Cage', 'Kitchen', 'Bar', 'Management', 'Other'];
const defaultColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];
const defaultForm = { name: '', roleGroup: 'Floor', color: '#3B82F6', displayOrder: 0, assignedLocationIds: [], status: 'active', defaultShiftHours: '' };

export default function Roles() {
  const queryClient = useQueryClient();
  const { data: roles, isLoading } = useRoles();
  const { data: locations = [] } = useLocations();
  const { assignedLocationIds } = useCurrentMember();
  const [modalOpen, setModalOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [form, setForm] = useState(defaultForm);

  // Locations the current user can manage (empty = all locations)
  const manageableLocations = locations.filter(l => l.status === 'active' &&
    (assignedLocationIds.length === 0 || assignedLocationIds.includes(l.id)));

  const resetForm = (r) => {
    setForm(r ? { ...defaultForm, ...r, assignedLocationIds: r.assignedLocationIds || [] } : defaultForm);
  };

  const toggleArrayItem = (key, value) => {
    setForm(f => ({
      ...f,
      [key]: f[key]?.includes(value) ? f[key].filter(v => v !== value) : [...(f[key] || []), value],
    }));
  };

  const locationName = (id) => locations.find(l => l.id === id)?.abbreviation ||
    locations.find(l => l.id === id)?.name || '?';

  // Hide roles the current user can't access by location
  const visibleRoles = filterRolesByLocationAccess(roles, assignedLocationIds);

  const saveMutation = useMutation({
    mutationFn: (data) => editRole?.id
      ? base44.entities.Role.update(editRole.id, data)
      : base44.entities.Role.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setModalOpen(false);
      toast.success(editRole ? 'Role updated' : 'Role created');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Role.update(id, { status: 'archived' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setModalOpen(false);
      toast.success('Role archived');
    },
  });

  const grouped = visibleRoles.reduce((acc, role) => {
    const g = role.roleGroup || 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(role);
    return acc;
  }, {});
  const groupOrder = [...roleGroups, ...Object.keys(grouped).filter(g => !roleGroups.includes(g))];
  const activeGroups = groupOrder.filter(g => grouped[g]?.length > 0);

  // Group choices for the edit modal: the standard six plus any custom groups
  // already in use (groups are free text — pick one or type a new one)
  const customGroups = [...new Set(
    (roles || []).map(r => (r.roleGroup || '').trim()).filter(g => g && !roleGroups.includes(g))
  )].sort();
  const roleGroupOptions = [...roleGroups, ...customGroups];

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Roles" subtitle={isLoading ? 'Loading…' : `${visibleRoles.length} roles configured`}>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditRole(null); resetForm(); setModalOpen(true); }}>
          <Plus className="w-4 h-4" /> Add Role
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && visibleRoles.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-sm">No roles yet. Click "Add Role" to get started.</p>
        </div>
      )}

      {!isLoading && activeGroups.map(group => (
        <div key={group} className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">{group}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {grouped[group].map(role => (
              <Card
                key={role.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => { setEditRole(role); resetForm(role); setModalOpen(true); }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: role.color || '#6366f1' }} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{role.name}</h3>
                      <p className="text-xs text-muted-foreground">{role.roleGroup || 'Other'}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {!role.assignedLocationIds?.length
                          ? 'All locations'
                          : role.assignedLocationIds.map(locationName).join(', ')}
                      </p>
                    </div>
                    <Badge variant={role.status === 'active' ? 'default' : 'secondary'} className="text-[10px] flex-shrink-0">
                      {role.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRole ? 'Edit Role' : 'New Role'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Role Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Dealer" />
            </div>
            <div>
              <Label className="text-xs">Role Group</Label>
              <Select
                value={roleGroupOptions.includes(form.roleGroup) ? form.roleGroup : '__custom__'}
                onValueChange={v => {
                  if (v === '__custom__') setForm(f => ({ ...f, roleGroup: '' }));
                  else setForm(f => ({ ...f, roleGroup: v }));
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleGroupOptions.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  <SelectItem value="__custom__">+ New group…</SelectItem>
                </SelectContent>
              </Select>
              {!roleGroupOptions.includes(form.roleGroup) && (
                <Input
                  className="mt-2"
                  autoFocus
                  value={form.roleGroup || ''}
                  onChange={e => setForm(f => ({ ...f, roleGroup: e.target.value }))}
                  placeholder="Type a new group name, e.g. Poker Room"
                />
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label className="text-xs font-medium">Allow Mobile Clock-In</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Members with this role can clock in/out from their phone</p>
              </div>
              <input
                type="checkbox"
                checked={!!form.mobileClockIn}
                onChange={e => setForm(f => ({ ...f, mobileClockIn: e.target.checked }))}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
            </div>
            <div>
              <Label className="text-xs">Default Shift Length (hours)</Label>
              <Input
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                value={form.defaultShiftHours ?? ''}
                onChange={e => setForm(f => ({ ...f, defaultShiftHours: e.target.value === '' ? null : Number(e.target.value) }))}
                placeholder="Blank = company default (Settings → Shift Rules)"
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Color</Label>
              <div className="flex flex-wrap gap-2">
                {defaultColors.map(c => (
                  <button
                    key={c}
                    className="w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: form.color === c ? '#fff' : 'transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }}
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Display Order</Label>
              <Input
                type="number"
                value={form.displayOrder || 0}
                onChange={e => setForm(f => ({ ...f, displayOrder: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Available Locations</Label>
              <p className="text-[11px] text-muted-foreground mb-2">Leave unchecked to make this role available at all locations.</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {manageableLocations.length === 0 && (
                  <p className="text-xs text-muted-foreground">No active locations available.</p>
                )}
                {manageableLocations.map(l => (
                  <label key={l.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={form.assignedLocationIds?.includes(l.id)}
                      onCheckedChange={() => toggleArrayItem('assignedLocationIds', l.id)}
                    />
                    <span className="text-sm">{l.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            {editRole && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="sm:mr-auto" disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-4 h-4" /> Archive</>}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive "{editRole.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>The role will be hidden from all lists and schedules. Its history is preserved and it can be restored later.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteMutation.mutate(editRole.id)}>Archive</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (editRole ? 'Update' : 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}