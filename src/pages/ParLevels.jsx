import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useLocations, useRoles, usePars, businessDayStartHour } from '@/lib/useAppData';
import { isRoleAvailableAtLocation } from '@/lib/roleLocations';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Save, Wand2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const gd = (t, sh) => ((toMin(t) - sh * 60) + 1440) % 1440; // minutes into the gaming day
const fmt = (t) => {
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
};
const key = (day, t) => `${day}|${t}`;

export default function ParLevels() {
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();
  const { data: pars = [] } = usePars();
  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'], queryFn: () => base44.entities.AppSetting.list(), placeholderData: [],
  });

  const activeLocations = useMemo(() => locations.filter(l => l.status === 'active'), [locations]);
  const [locationId, setLocationId] = useState('');
  const availableRoles = useMemo(
    () => roles.filter(r => r.status === 'active' && (!locationId || isRoleAvailableAtLocation(r, locationId))),
    [roles, locationId]
  );
  const [roleId, setRoleId] = useState('');
  useEffect(() => { if (!locationId && activeLocations.length) setLocationId(activeLocations[0].id); }, [activeLocations, locationId]);
  useEffect(() => { if (availableRoles.length && !availableRoles.some(r => r.id === roleId)) setRoleId(availableRoles[0].id); }, [availableRoles, roleId]);

  const startHour = businessDayStartHour(settings, locationId);
  const gamingDayEnd = `${pad(startHour)}:00`;

  const parsForSel = useMemo(() => pars.filter(p => p.locationId === locationId && p.roleId === roleId), [pars, locationId, roleId]);

  const defaultRows = useMemo(() => Array.from({ length: 24 }, (_, i) => `${pad((startHour + i) % 24)}:00`), [startHour]);
  const [customTimes, setCustomTimes] = useState([]); // extra 'HH:MM' rows this session

  const rowTimes = useMemo(() => {
    const set = new Set(defaultRows);
    parsForSel.forEach(p => set.add(p.startTime.slice(0, 5))); // stored boundaries become rows
    customTimes.forEach(t => set.add(t));
    return [...set].sort((a, b) => gd(a, startHour) - gd(b, startHour));
  }, [defaultRows, parsForSel, customTimes, startHour]);

  const [grid, setGrid] = useState({}); // key(day,time) -> count (number)
  const [dirty, setDirty] = useState(false);

  // (re)load the grid from stored windows whenever the selection or stored data changes
  useEffect(() => {
    const axis = new Set(defaultRows);
    parsForSel.forEach(p => axis.add(p.startTime.slice(0, 5)));
    const g = {};
    parsForSel.forEach(p => {
      const s = gd(p.startTime.slice(0, 5), startHour);
      let e = gd(p.endTime.slice(0, 5), startHour); if (e === 0) e = 1440;
      [...axis].forEach(rt => { const r = gd(rt, startHour); if (r >= s && r < e) g[key(p.dayOfWeek, rt)] = p.requiredCount; });
    });
    setGrid(g);
    setCustomTimes([]);
    setDirty(false);
  }, [locationId, roleId, startHour, parsForSel, defaultRows]);

  const setCell = (day, t, raw) => {
    setGrid(prev => {
      const next = { ...prev };
      const v = raw === '' ? undefined : Math.max(0, parseInt(raw, 10));
      if (v === undefined || Number.isNaN(v)) delete next[key(day, t)];
      else next[key(day, t)] = v;
      return next;
    });
    setDirty(true);
  };

  // coalesce consecutive equal cells (per day) into windows for storage
  const buildWindows = () => {
    const out = [];
    for (let day = 0; day < 7; day++) {
      let i = 0;
      while (i < rowTimes.length) {
        const v = grid[key(day, rowTimes[i])];
        if (v == null) { i++; continue; }
        let j = i;
        while (j + 1 < rowTimes.length && grid[key(day, rowTimes[j + 1])] === v) j++;
        out.push({
          locationId, roleId, dayOfWeek: day,
          startTime: rowTimes[i],
          endTime: j + 1 < rowTimes.length ? rowTimes[j + 1] : gamingDayEnd,
          requiredCount: v, status: 'active',
        });
        i = j + 1;
      }
    }
    return out;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const p of parsForSel) await base44.entities.ParLevel.delete(p.id);
      const windows = buildWindows();
      if (windows.length) await base44.entities.ParLevel.bulkCreate(windows);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['par-levels'] }); setDirty(false); toast.success('Par levels saved'); },
    onError: (e) => toast.error(e.message || 'Could not save'),
  });

  // quick fill
  const [fill, setFill] = useState({ days: 'all', from: '18:00', to: '02:00', count: '' });
  const applyFill = () => {
    const count = parseInt(fill.count, 10);
    if (!Number.isFinite(count) || count < 0) { toast.error('Enter a headcount to fill'); return; }
    const targetDays = fill.days === 'all' ? [0, 1, 2, 3, 4, 5, 6]
      : fill.days === 'weekdays' ? [1, 2, 3, 4, 5]
      : fill.days === 'weekends' ? [0, 6]
      : [Number(fill.days)];
    // make sure the from/to boundaries exist as rows
    const extra = [fill.from, fill.to].filter(t => t && !rowTimes.includes(t));
    if (extra.length) setCustomTimes(c => [...new Set([...c, ...extra])]);
    const axis = [...new Set([...rowTimes, ...extra])].sort((a, b) => gd(a, startHour) - gd(b, startHour));
    const s = gd(fill.from, startHour);
    let e = gd(fill.to, startHour); if (e === 0 || e === s) e = 1440; // to == from → whole gaming day
    setGrid(prev => {
      const next = { ...prev };
      targetDays.forEach(day => axis.forEach(rt => {
        const r = gd(rt, startHour);
        const inRange = e > s ? (r >= s && r < e) : (r >= s || r < e);
        if (inRange) next[key(day, rt)] = count;
      }));
      return next;
    });
    setDirty(true);
    toast.success(`Filled ${fmt(fill.from)}–${fmt(fill.to)} = ${count}`);
  };

  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [newTime, setNewTime] = useState('18:30');
  const addCustomTime = () => {
    if (!newTime) return;
    if (rowTimes.includes(newTime)) { toast.info('That time is already a row'); setAddTimeOpen(false); return; }
    setCustomTimes(c => [...new Set([...c, newTime])]);
    setAddTimeOpen(false);
  };

  const roleColor = roles.find(r => r.id === roleId)?.color || '#6366f1';

  return (
    <div className="max-w-full">
      <PageHeader title="Par Levels" subtitle="Target headcount per location & role, across the week">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending} className="gap-1.5">
          <Save className="w-4 h-4" /> {saveMutation.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </PageHeader>

      {/* selectors */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label className="text-xs">Location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>{activeLocations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Role</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              {availableRoles.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color || '#6366f1' }} />{r.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {dirty && <Badge variant="secondary" className="mb-1.5 text-xs">Unsaved changes</Badge>}
      </div>

      {/* quick fill bar */}
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg border border-border bg-muted/40">
        <Wand2 className="w-4 h-4 text-muted-foreground mb-2" />
        <div>
          <Label className="text-[11px]">Days</Label>
          <Select value={fill.days} onValueChange={v => setFill(f => ({ ...f, days: v }))}>
            <SelectTrigger className="w-[150px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every day</SelectItem>
              <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
              <SelectItem value="weekends">Weekends (Sat–Sun)</SelectItem>
              {DAY_FULL.map((d, i) => <SelectItem key={d} value={String(i)}>{d} only</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">From</Label>
          <Input type="time" value={fill.from} onChange={e => setFill(f => ({ ...f, from: e.target.value }))} className="w-[120px] h-8" />
        </div>
        <div>
          <Label className="text-[11px]">To</Label>
          <Input type="time" value={fill.to} onChange={e => setFill(f => ({ ...f, to: e.target.value }))} className="w-[120px] h-8" />
        </div>
        <div>
          <Label className="text-[11px]">Need</Label>
          <Input type="number" min="0" placeholder="#" value={fill.count} onChange={e => setFill(f => ({ ...f, count: e.target.value }))} className="w-[70px] h-8" />
        </div>
        <Button size="sm" variant="secondary" className="h-8" onClick={applyFill}>Fill</Button>
        <p className="text-[11px] text-muted-foreground mb-2 ml-1">Sets a block of cells at once — then fine-tune individual cells below.</p>
      </div>

      {!locationId || !roleId ? (
        <p className="text-sm text-muted-foreground">Pick a location and role.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted">
                <th className="sticky left-0 z-20 bg-muted text-left font-medium px-3 py-2 w-[110px] border-b border-r border-border">
                  <div className="flex items-center gap-1">
                    Time
                    <button className="ml-auto text-muted-foreground hover:text-primary" title="Add a custom time row" onClick={() => setAddTimeOpen(true)}>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </th>
                {DAY_LABELS.map((d, i) => (
                  <th key={d} className="font-medium px-2 py-2 border-b border-border text-center min-w-[64px]"
                    style={i === 5 || i === 6 ? { background: 'rgba(210,173,116,0.10)' } : undefined}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowTimes.map(rt => {
                const isCustom = !defaultRows.includes(rt);
                return (
                  <tr key={rt} className="odd:bg-background even:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-1 border-r border-border whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                      {fmt(rt)}{isCustom && <span className="ml-1 text-[9px] text-primary">•</span>}
                    </td>
                    {DAY_LABELS.map((_, day) => {
                      const val = grid[key(day, rt)];
                      return (
                        <td key={day} className="p-0 border-b border-border/50 text-center">
                          <input
                            type="number" min="0"
                            value={val ?? ''}
                            onChange={e => setCell(day, rt, e.target.value)}
                            className={`w-full h-8 text-center bg-transparent outline-none focus:bg-primary/10 tabular-nums ${val != null ? 'font-medium' : 'text-muted-foreground'}`}
                            style={val != null ? { color: roleColor } : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-2">
        Each number is how many <span className="font-medium">{roles.find(r => r.id === roleId)?.name || 'people'}</span> you want on the floor from that time until the next filled row. Blank = no requirement. Times run in gaming-day order (starts {fmt(gamingDayEnd)}), so evening rows continue past midnight.
      </p>

      {/* add custom time */}
      <Dialog open={addTimeOpen} onOpenChange={setAddTimeOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-base">Add a time row</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Time</Label>
            <Input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">Adds a row at this time (e.g. 6:30 PM) and sorts it into place.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTimeOpen(false)}>Cancel</Button>
            <Button onClick={addCustomTime}>Add row</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
