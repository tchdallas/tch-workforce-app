import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useLocations, useRoles } from '@/lib/useAppData';
import { format, startOfWeek, addDays } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, ChevronDown, ChevronRight, Copy, Edit2 } from 'lucide-react';
import LocationSelector from '@/components/common/LocationSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ShiftSlot({ shift, role, onEdit, onRemove, selected, onSelect }) {
  const bg = role?.color ? `${role.color}22` : '#6366f122';
  const border = role?.color || '#6366f1';
  return (
    <div
      className={cn(
        "relative group rounded px-1.5 py-1 text-[10px] leading-tight cursor-pointer mb-1 select-none",
        selected && "ring-2 ring-primary ring-offset-1"
      )}
      style={{ backgroundColor: bg, borderLeft: `3px solid ${border}` }}
      onClick={(e) => { e.stopPropagation(); onSelect(e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
    >
      <div className="font-semibold truncate">{role?.name || 'Unknown'}</div>
      <div className="text-muted-foreground">{shift.startTime} – {shift.endTime}</div>
      <button
        className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 p-0.5 rounded bg-destructive/80 hover:bg-destructive text-white flex items-center justify-center"
        style={{ width: 16, height: 16, fontSize: 11, lineHeight: 1 }}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Delete"
      >×</button>
    </div>
  );
}

function ShiftSlotModal({ open, onClose, onSave, roles, initial }) {
  const isEditing = !!initial?.roleId; // editing existing if it already has a role
  const [roleId, setRoleId] = useState(initial?.roleId || '');
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 0);
  const [startTime, setStartTime] = useState(initial?.startTime || '09:00');
  const [endTime, setEndTime] = useState(initial?.endTime || '17:00');
  const [breakMinutes, setBreakMinutes] = useState(initial?.breakMinutes ?? 0);
  const [quantity, setQuantity] = useState(1);

  React.useEffect(() => {
    if (open) {
      setRoleId(initial?.roleId || '');
      setDayOfWeek(initial?.dayOfWeek ?? 0);
      setStartTime(initial?.startTime || '09:00');
      setEndTime(initial?.endTime || '17:00');
      setBreakMinutes(initial?.breakMinutes ?? 0);
      setQuantity(1);
    }
  }, [open, initial]);

  const addHoursToTime = (time, hours) => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + hours * 60;
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  };

  const handleStartTimeChange = (val) => {
    setStartTime(val);
    setEndTime(addHoursToTime(val, 8));
  };

  const handleSave = () => {
    if (!roleId) { toast.error('Please select a role'); return; }
    const count = isEditing ? 1 : Math.max(1, Math.min(50, quantity));
    const slots = Array.from({ length: count }, () => ({ roleId, dayOfWeek, startTime, endTime, breakMinutes }));
    onSave(slots);
    onClose();
  };

  const role = roles.find(r => r.id === roleId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit Shift' : 'Add Shifts to Template'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select role">
                  {role && (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color || '#6366f1' }} />
                      <span>{role.name}</span>
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.filter(r => r.status === 'active').map(r => (
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
          <div>
            <Label className="text-xs">Day of Week</Label>
            <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Start Time</Label>
              <Input type="time" value={startTime} onChange={e => handleStartTimeChange(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">End Time</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Break (minutes)</Label>
              <Input type="number" min={0} value={breakMinutes} onChange={e => setBreakMinutes(Number(e.target.value))} className="mt-1" />
            </div>
            {!isEditing && (
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, Number(e.target.value)))}
                  className="mt-1"
                />
              </div>
            )}
          </div>
          {!isEditing && quantity > 1 && (
            <p className="text-xs text-muted-foreground">
              Will add <span className="font-semibold text-foreground">{quantity}</span> open {role?.name || 'role'} shifts on {DAYS[dayOfWeek]} at {startTime}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>{isEditing ? 'Save Shift' : `Add ${quantity > 1 ? quantity + ' ' : ''}Shift${quantity !== 1 ? 's' : ''}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateGrid({ template, roles, onUpdate }) {
  const [slotModal, setSlotModal] = useState({ open: false, editing: null, editIndex: null });
  // Multi-select: Set of indices
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  // clipboard: { shifts: [...], mode: 'copy'|'cut', srcIndices: Set }
  const [clipboard, setClipboard] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const shiftsRef = React.useRef(template.shifts || []);
  const shifts = template.shifts || [];
  useEffect(() => { shiftsRef.current = shifts; }, [shifts]);

  const openAdd = (dayOfWeek) => {
    setSlotModal({ open: true, editing: { dayOfWeek }, editIndex: null });
  };

  const openEdit = (shift, idx) => {
    setSlotModal({ open: true, editing: shift, editIndex: idx });
  };

  const applyShifts = (newShifts, undoEntry) => {
    if (undoEntry) setUndoStack(prev => [...prev.slice(-29), undoEntry]);
    onUpdate({ ...template, shifts: newShifts });
  };

  const handleSave = (newSlots) => {
    const current = shiftsRef.current;
    if (slotModal.editIndex !== null) {
      const prev = current[slotModal.editIndex];
      applyShifts(
        current.map((s, i) => i === slotModal.editIndex ? newSlots[0] : s),
        { type: 'update', idx: slotModal.editIndex, prev }
      );
    } else {
      applyShifts(
        [...current, ...newSlots],
        { type: 'create', count: newSlots.length }
      );
    }
  };

  // Select logic: Ctrl/Cmd+click toggles, Shift+click adds, plain click = single
  const handleSelect = (idx, e) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedIndices(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    } else if (e.shiftKey && selectedIndices.size > 0) {
      const lastSelected = Math.max(...selectedIndices);
      const [lo, hi] = [Math.min(lastSelected, idx), Math.max(lastSelected, idx)];
      setSelectedIndices(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(i);
        return next;
      });
    } else {
      setSelectedIndices(new Set([idx]));
    }
  };

  const clearSelection = () => setSelectedIndices(new Set());

  const handleRemove = (idx) => {
    const current = shiftsRef.current;
    const toDelete = selectedIndices.has(idx) && selectedIndices.size > 1
      ? selectedIndices
      : new Set([idx]);
    const deleted = [...toDelete].map(i => ({ i, s: current[i] })).sort((a, b) => a.i - b.i);
    applyShifts(
      current.filter((_, i) => !toDelete.has(i)),
      { type: 'delete_multi', deleted }
    );
    clearSelection();
  };

  const handleRemoveSelected = () => {
    if (selectedIndices.size === 0) return;
    const current = shiftsRef.current;
    const deleted = [...selectedIndices].map(i => ({ i, s: current[i] })).sort((a, b) => a.i - b.i);
    applyShifts(current.filter((_, i) => !selectedIndices.has(i)), { type: 'delete_multi', deleted });
    clearSelection();
  };

  const handleCopy = () => {
    if (selectedIndices.size === 0) return;
    const copied = [...selectedIndices].map(i => shifts[i]);
    setClipboard({ shifts: copied, mode: 'copy', srcIndices: new Set(selectedIndices) });
    toast.success(`${copied.length} shift${copied.length > 1 ? 's' : ''} copied`);
  };

  const handleCut = () => {
    if (selectedIndices.size === 0) return;
    const cut = [...selectedIndices].map(i => shifts[i]);
    setClipboard({ shifts: cut, mode: 'cut', srcIndices: new Set(selectedIndices) });
    toast.success(`${cut.length} shift${cut.length > 1 ? 's' : ''} cut — click a day column to paste`);
  };

  const handlePaste = (dayOfWeek) => {
    if (!clipboard) return;
    const { shifts: cbShifts, mode, srcIndices } = clipboard;
    const pasted = cbShifts.map(s => ({ ...s, dayOfWeek }));
    let newShifts;
    if (mode === 'cut') {
      newShifts = [...shifts.filter((_, i) => !srcIndices.has(i)), ...pasted];
      setClipboard(null);
      clearSelection();
    } else {
      newShifts = [...shifts, ...pasted];
    }
    applyShifts(newShifts, { type: 'create', count: pasted.length });
    toast.success(mode === 'cut' ? `${pasted.length} shift${pasted.length > 1 ? 's' : ''} moved` : `${pasted.length} shift${pasted.length > 1 ? 's' : ''} pasted`);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) { toast.info('Nothing to undo'); return; }
    const entry = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    const current = shiftsRef.current;
    if (entry.type === 'create') {
      onUpdate({ ...template, shifts: current.slice(0, current.length - entry.count) });
    } else if (entry.type === 'delete_multi') {
      const restored = [...current];
      // Re-insert in original order
      entry.deleted.forEach(({ i, s }) => restored.splice(i, 0, s));
      onUpdate({ ...template, shifts: restored });
    } else if (entry.type === 'update') {
      onUpdate({ ...template, shifts: current.map((s, i) => i === entry.idx ? entry.prev : s) });
    }
    toast.success('Undo');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (document.activeElement?.closest('[role="dialog"]')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault(); handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedIndices.size > 0) {
        e.preventDefault(); handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedIndices.size > 0) {
        e.preventDefault(); handleCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard) {
        e.preventDefault();
        // paste to the day of the first shift in clipboard
        handlePaste(clipboard.shifts[0].dayOfWeek);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndices.size > 0) {
        e.preventDefault(); handleRemoveSelected();
      } else if (e.key === 'Escape') {
        clearSelection(); setClipboard(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIndices(new Set(shifts.map((_, i) => i)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIndices, clipboard, shifts, undoStack]); // eslint-disable-line

  const selCount = selectedIndices.size;

  return (
    <>
      {/* Selection toolbar */}
      {selCount > 0 && (
        <div className="mx-3 mt-2 mb-0 px-3 py-1.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{selCount} shift{selCount > 1 ? 's' : ''} selected</span>
          <button className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30" onClick={handleCopy}>Copy</button>
          <button className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30" onClick={handleCut}>Cut</button>
          <button className="px-2 py-0.5 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive" onClick={handleRemoveSelected}>Delete</button>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={clearSelection}>✕</button>
        </div>
      )}
      {/* Clipboard banner */}
      {clipboard && selCount === 0 && (
        <div className="mx-3 mt-2 mb-0 px-3 py-1.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary flex items-center gap-2">
          <span>{clipboard.mode === 'cut' ? 'Cut' : 'Copied'}: <strong>{clipboard.shifts.length}</strong> shift{clipboard.shifts.length > 1 ? 's' : ''} — click a day column to paste</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setClipboard(null)}>✕</button>
        </div>
      )}
      <div
        className="overflow-x-auto"
        onClick={() => { clearSelection(); }}
      >
        <div className="grid" style={{ gridTemplateColumns: `100px repeat(7, minmax(90px, 1fr))`, minWidth: '750px' }}>
          {/* Header */}
          <div className="p-2 text-xs font-semibold text-muted-foreground">Role</div>
          {DAYS.map((d, i) => (
            <div key={i} className="p-2 text-center text-xs font-semibold text-muted-foreground border-l border-border">{d}</div>
          ))}
          <div className="col-span-8 border-t border-border" />
          <div className="p-2 text-xs text-muted-foreground">Shifts</div>
          {Array.from({ length: 7 }, (_, dayIdx) => (
            <div
              key={dayIdx}
              className={cn("p-1 border-l border-border min-h-[80px] relative", clipboard && "hover:bg-primary/5 cursor-pointer")}
              onClick={(e) => {
                e.stopPropagation();
                if (clipboard) handlePaste(dayIdx);
                else clearSelection();
              }}
            >
              {shifts.map((s, i) => s.dayOfWeek === dayIdx ? (
                <ShiftSlot
                  key={i}
                  shift={s}
                  role={roles.find(r => r.id === s.roleId)}
                  selected={selectedIndices.has(i)}
                  onSelect={(e) => handleSelect(i, e)}
                  onEdit={() => openEdit(s, i)}
                  onRemove={() => handleRemove(i)}
                />
              ) : null)}
              <button
                className="mt-1 flex items-center justify-center w-full"
                onClick={(e) => { e.stopPropagation(); openAdd(dayIdx); }}
              >
                <div className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center hover:bg-primary/10">
                  <Plus className="w-3 h-3 text-muted-foreground" />
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>
      <ShiftSlotModal
        open={slotModal.open}
        onClose={() => setSlotModal({ open: false, editing: null, editIndex: null })}
        onSave={handleSave}
        roles={roles}
        initial={slotModal.editing}
      />
    </>
  );
}

function TemplateCard({ template, roles, onSave, onDelete, onDuplicate }) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(template.name);

  const shiftCount = (template.shifts || []).length;

  const handleNameSave = () => {
    if (name.trim()) onSave({ ...template, name: name.trim() });
    setEditingName(false);
  };

  // Immediately persist shift changes — no separate "save" step needed
  const handleShiftsUpdate = (updatedTemplate) => {
    onSave(updatedTemplate);
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        {editingName ? (
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            onClick={e => e.stopPropagation()}
            onBlur={handleNameSave}
            onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') { setName(template.name); setEditingName(false); } }}
            className="h-7 text-sm max-w-[200px]"
            autoFocus
          />
        ) : (
          <span className="font-semibold text-sm flex-1">{template.name}</span>
        )}
        <Badge variant="outline" className="text-xs">{shiftCount} shifts</Badge>
        <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingName(true); setExpanded(true); }}>
            <Edit2 className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onDuplicate(template)}>
            <Copy className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(template.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border">
          <TemplateGrid
            template={template}
            roles={roles}
            onUpdate={handleShiftsUpdate}
          />
        </div>
      )}
    </div>
  );
}

function NewTemplateModal({ open, onClose, onCreate, locations }) {
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');

  const handleCreate = () => {
    if (!name.trim()) { toast.error('Template name is required'); return; }
    onCreate({ name: name.trim(), locationId, status: 'active', shifts: [] });
    setName('');
    setLocationId('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Schedule Template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Template Name</Label>
            <Input placeholder="e.g. Standard Week" value={name} onChange={e => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Location (optional)</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="All locations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All locations</SelectItem>
                {locations.filter(l => l.status === 'active').map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate}>Create Template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScheduleTemplates() {
  const queryClient = useQueryClient();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const [filterLocation, setFilterLocation] = useState('all');
  const [newModal, setNewModal] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['schedule-templates'],
    queryFn: () => base44.entities.ScheduleTemplate.filter({ status: 'active' }),
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ScheduleTemplate.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule-templates'] }); toast.success('Template created'); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ScheduleTemplate.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule-templates'] }); toast.success('Template saved'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduleTemplate.update(id, { status: 'archived' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule-templates'] }); toast.success('Template archived'); },
  });

  const filtered = filterLocation === 'all'
    ? templates
    : templates.filter(t => !t.locationId || t.locationId === filterLocation);

  const handleSave = (template) => {
    const { id, created_date, updated_date, ...data } = template;
    updateMutation.mutate({ id, data });
  };

  const handleDuplicate = (template) => {
    const { id, created_date, updated_date, ...data } = template;
    createMutation.mutate({ ...data, name: `${data.name} (Copy)` });
  };

  return (
    <div className="max-w-full">
      <PageHeader title="Schedule Templates" subtitle="Build reusable weekly shift patterns without assigning team members">
        <Button size="sm" onClick={() => setNewModal(true)}>
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </PageHeader>

      <div className="flex items-center gap-3 mb-4">
        <LocationSelector value={filterLocation} onChange={setFilterLocation} className="w-[200px]" />
        <Badge variant="outline" className="text-xs">{filtered.length} template{filtered.length !== 1 ? 's' : ''}</Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading templates…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-muted-foreground text-sm">No templates yet. Create one to get started.</p>
          <Button size="sm" onClick={() => setNewModal(true)}><Plus className="w-4 h-4" /> New Template</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              roles={roles}
              onSave={handleSave}
              onDelete={(id) => deleteMutation.mutate(id)}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}

      <NewTemplateModal
        open={newModal}
        onClose={() => setNewModal(false)}
        onCreate={(data) => createMutation.mutate(data)}
        locations={locations}
      />
    </div>
  );
}