import React, { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useLocations, useRoles, usePars } from '@/lib/useAppData';
import { isRoleAvailableAtLocation } from '@/lib/roleLocations';
import PageHeader from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, Copy, Clock, Users } from 'lucide-react';
import { toast } from 'sonner';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'HH:MM[:SS]' -> 'h:mm AM'
const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};
const toInputTime = (t) => (t ? t.slice(0, 5) : '');
const crossesMidnight = (start, end) => !!start && !!end && end <= start;

export default function ParLevels() {
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();
  const { data: pars = [] } = usePars();

  const activeLocations = useMemo(() => locations.filter(l => l.status === 'active'), [locations]);
  const [locationId, setLocationId] = useState('');
  const [roleId, setRoleId] = useState('');

  // roles available at the selected location (empty role_locations = everywhere)
  const availableRoles = useMemo(
    () => roles.filter(r => r.status === 'active' && (!locationId || isRoleAvailableAtLocation(r, locationId))),
    [roles, locationId]
  );

  // default the selectors once data arrives
  useEffect(() => {
    if (!locationId && activeLocations.length) setLocationId(activeLocations[0].id);
  }, [activeLocations, locationId]);
  useEffect(() => {
    if (availableRoles.length && !availableRoles.some(r => r.id === roleId)) {
      setRoleId(availableRoles[0].id);
    }
  }, [availableRoles, roleId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['par-levels'] });

  const saveMutation = useMutation({
    mutationFn: ({ id, data }) => id
      ? base44.entities.ParLevel.update(id, data)
      : base44.entities.ParLevel.create(data),
    onSuccess: () => { invalidate(); toast.success('Par saved'); },
    onError: (e) => toast.error(e.message || 'Could not save'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ParLevel.delete(id),
    onSuccess: () => { invalidate(); toast.success('Par removed'); },
    onError: (e) => toast.error(e.message || 'Could not remove'),
  });
  const copyMutation = useMutation({
    mutationFn: (rows) => base44.entities.ParLevel.bulkCreate(rows),
    onSuccess: (_, rows) => { invalidate(); toast.success(`Copied to ${new Set(rows.map(r => r.dayOfWeek)).size} day(s)`); },
    onError: (e) => toast.error(e.message || 'Could not copy'),
  });

  // pars for the current location + role, grouped by day
  const parsForSelection = useMemo(
    () => pars.filter(p => p.locationId === locationId && p.roleId === roleId),
    [pars, locationId, roleId]
  );
  const byDay = useMemo(() => {
    const m = Array.from({ length: 7 }, () => []);
    parsForSelection.forEach(p => { if (m[p.dayOfWeek]) m[p.dayOfWeek].push(p); });
    m.forEach(list => list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
    return m;
  }, [parsForSelection]);

  const [editing, setEditing] = useState(null); // { id?, dayOfWeek, startTime, endTime, requiredCount, note }
  const [copySource, setCopySource] = useState(null); // dayOfWeek being copied

  const openAdd = (dayOfWeek) => setEditing({ dayOfWeek, startTime: '18:00', endTime: '02:00', requiredCount: 1, note: '' });
  const openEdit = (p) => setEditing({
    id: p.id, dayOfWeek: p.dayOfWeek,
    startTime: toInputTime(p.startTime), endTime: toInputTime(p.endTime),
    requiredCount: p.requiredCount, note: p.note || '',
  });

  const saveEditing = () => {
    if (!editing.startTime || !editing.endTime) { toast.error('Enter a start and end time'); return; }
    const count = parseInt(editing.requiredCount, 10);
    if (!Number.isFinite(count) || count < 0) { toast.error('Enter a valid headcount'); return; }
    saveMutation.mutate({
      id: editing.id,
      data: {
        locationId, roleId,
        dayOfWeek: editing.dayOfWeek,
        startTime: editing.startTime, endTime: editing.endTime,
        requiredCount: count,
        note: editing.note?.trim() || null,
        status: 'active',
      },
    });
    setEditing(null);
  };

  const totalWindows = parsForSelection.length;
  const roleName = roles.find(r => r.id === roleId)?.name || '';

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Par Levels" subtitle="Target headcount per location, role, day, and time window" />

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <Label className="text-xs">Location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select location" /></SelectTrigger>
            <SelectContent>
              {activeLocations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Role</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {availableRoles.map(r => (
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
        {totalWindows > 0 && (
          <Badge variant="secondary" className="text-xs mb-1.5">{totalWindows} window{totalWindows !== 1 ? 's' : ''} set</Badge>
        )}
      </div>

      {!locationId || !roleId ? (
        <p className="text-sm text-muted-foreground">Pick a location and role to set par levels.</p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {DAYS.map((day, idx) => (
            <Card key={day}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{day}</h3>
                  <div className="flex items-center gap-1">
                    {byDay[idx].length > 0 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Copy this day to other days" onClick={() => setCopySource(idx)}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Add a window" onClick={() => openAdd(idx)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {byDay[idx].length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">No target set — treated as no requirement.</p>
                ) : (
                  <div className="space-y-1.5">
                    {byDay[idx].map(p => (
                      <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="tabular-nums">
                          {fmtTime(p.startTime)}–{fmtTime(p.endTime)}{crossesMidnight(p.startTime, p.endTime) ? ' (+1)' : ''}
                        </span>
                        <Badge className="ml-auto shrink-0 gap-1 bg-primary/10 text-primary border-0 text-[11px]">
                          <Users className="w-3 h-3" />{p.requiredCount}
                        </Badge>
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => openEdit(p)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" onClick={() => deleteMutation.mutate(p.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / edit window */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editing?.id ? 'Edit' : 'Add'} par window — {editing != null ? DAYS[editing.dayOfWeek] : ''}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {roleName} at {activeLocations.find(l => l.id === locationId)?.name}. Times are in gaming-day terms — an end time earlier than the start (e.g. 6 PM–2 AM) runs past midnight.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input type="time" value={editing.startTime} onChange={e => setEditing(s => ({ ...s, startTime: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">End</Label>
                  <Input type="time" value={editing.endTime} onChange={e => setEditing(s => ({ ...s, endTime: e.target.value }))} />
                </div>
              </div>
              {crossesMidnight(editing.startTime, editing.endTime) && (
                <p className="text-[11px] text-amber-600">This window runs past midnight into the same gaming day.</p>
              )}
              <div>
                <Label className="text-xs">Required team members</Label>
                <Input type="number" min="0" value={editing.requiredCount}
                  onChange={e => setEditing(s => ({ ...s, requiredCount: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Note (optional)</Label>
                <Input value={editing.note} placeholder="e.g. tournament night"
                  onChange={e => setEditing(s => ({ ...s, note: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEditing} disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy a day's windows to other days */}
      <CopyDayDialog
        open={copySource !== null}
        sourceDay={copySource}
        existingDays={byDay}
        onClose={() => setCopySource(null)}
        onCopy={(targetDays) => {
          const src = byDay[copySource] || [];
          const rows = [];
          targetDays.forEach(d => src.forEach(p => rows.push({
            locationId, roleId, dayOfWeek: d,
            startTime: p.startTime, endTime: p.endTime,
            requiredCount: p.requiredCount, note: p.note || null, status: 'active',
          })));
          if (rows.length) copyMutation.mutate(rows);
          setCopySource(null);
        }}
      />
    </div>
  );
}

function CopyDayDialog({ open, sourceDay, existingDays, onClose, onCopy }) {
  const [targets, setTargets] = useState([]);
  useEffect(() => { if (open) setTargets([]); }, [open, sourceDay]);
  if (sourceDay === null) return null;
  const toggle = (d) => setTargets(t => t.includes(d) ? t.filter(x => x !== d) : [...t, d]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Copy {DAYS[sourceDay]}'s windows to…</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Adds copies of {DAYS[sourceDay]}'s par windows to the days you pick (existing windows on those days are kept).</p>
        <div className="grid grid-cols-2 gap-2 py-1">
          {DAYS.map((day, idx) => idx === sourceDay ? null : (
            <label key={day} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={targets.includes(idx)} onCheckedChange={() => toggle(idx)} />
              {day}{existingDays[idx]?.length ? <span className="text-[10px] text-muted-foreground">({existingDays[idx].length})</span> : null}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={targets.length === 0} onClick={() => onCopy(targets)}>Copy to {targets.length || ''} day{targets.length !== 1 ? 's' : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
