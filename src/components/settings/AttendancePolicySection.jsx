import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLocations } from '@/lib/useAppData';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Flame, Trash2, Plus, FileText } from 'lucide-react';

// Every change here rewrites the live rulebook: dashboards, caps, and appeal
// windows update immediately. Points already issued keep their original values.
const POLICY_FIELDS = [
  { key: 'newHirePeriodDays', label: 'New-hire period (days)', hint: 'Stricter point cap applies during this many days from start date' },
  { key: 'newHirePointCap', label: 'New-hire point cap', hint: 'Termination at this many points during the new-hire period' },
  { key: 'standardPointCap', label: 'Standard point cap', hint: 'Termination at this many points in the rolling window' },
  { key: 'rollingWindowMonths', label: 'Rolling window (months)', hint: 'Points expire this many months after the infraction' },
  { key: 'appealWindowDays', label: 'Appeal window (days)', hint: 'Team members can appeal within this many days of an infraction' },
  { key: 'highVolumeMultiplier', label: 'High-volume multiplier', hint: 'Points are multiplied by this on high-volume days' },
  { key: 'coachingThreshold', label: 'Documented coaching at', hint: 'Points that trigger a documented coaching' },
  { key: 'writtenWarningThreshold', label: 'Written warning at', hint: '' },
  { key: 'finalWarningThreshold', label: 'Final written warning at', hint: '' },
  { key: 'terminationThreshold', label: 'Termination review at', hint: '' },
];

export default function AttendancePolicySection() {
  const queryClient = useQueryClient();
  const { data: locations = [] } = useLocations();

  const { data: settingsRows = [] } = useQuery({
    queryKey: ['attendance-policy-settings'],
    queryFn: () => base44.entities.AttendancePolicySettings.list(),
    placeholderData: [],
  });
  const settings = settingsRows[0];

  const { data: types = [] } = useQuery({
    queryKey: ['attendance-types'],
    queryFn: () => base44.entities.AttendanceInfractionType.list('display_order'),
    placeholderData: [],
  });

  const { data: highVolumeDays = [] } = useQuery({
    queryKey: ['high-volume-days'],
    queryFn: () => base44.entities.HighVolumeDay.list(),
    placeholderData: [],
  });

  const upcomingDays = useMemo(
    () => [...highVolumeDays].sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1)),
    [highVolumeDays]
  );

  // ---- policy settings drafts ----
  const [drafts, setDrafts] = useState({});
  const draftVal = (key) => (drafts[key] !== undefined ? drafts[key] : settings?.[key] ?? '');
  const dirty = Object.keys(drafts).some(k => String(drafts[k]) !== String(settings?.[k] ?? ''));

  const saveSettings = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const [k, v] of Object.entries(drafts)) {
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`${k} must be a number`);
        payload[k] = n;
      }
      return base44.entities.AttendancePolicySettings.update(settings.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-policy-settings'] });
      setDrafts({});
      toast.success('Policy updated — changes apply immediately');
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- point catalog drafts ----
  const [pointDrafts, setPointDrafts] = useState({});
  const savePoints = useMutation({
    mutationFn: async () => {
      for (const [id, val] of Object.entries(pointDrafts)) {
        const n = Number(val);
        if (Number.isNaN(n) || n < 0) throw new Error('Point values must be numbers ≥ 0');
        await base44.entities.AttendanceInfractionType.update(id, { points: n });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-types'] });
      setPointDrafts({});
      toast.success('Point values updated');
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- high-volume days ----
  const [newDay, setNewDay] = useState({ date: '', label: '', locationId: '' });
  const addDay = useMutation({
    mutationFn: () => base44.entities.HighVolumeDay.create({
      eventDate: newDay.date,
      label: newDay.label.trim(),
      locationId: newDay.locationId || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['high-volume-days'] });
      setNewDay({ date: '', label: '', locationId: '' });
      toast.success('High-volume day added');
    },
    onError: (e) => toast.error(e.message),
  });
  const removeDay = useMutation({
    mutationFn: (id) => base44.entities.HighVolumeDay.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['high-volume-days'] });
      toast.success('Removed');
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- policy document link ----
  const [docDraft, setDocDraft] = useState(undefined);
  const saveDoc = useMutation({
    mutationFn: () => base44.entities.AttendancePolicySettings.update(settings.id, {
      policyDocumentPath: (docDraft || '').trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-policy-settings'] });
      setDocDraft(undefined);
      toast.success('Policy document link saved');
    },
    onError: (e) => toast.error(e.message),
  });

  if (!settings) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Attendance policy settings not found — has the attendance migration been applied?</p>;
  }

  const locName = (id) => locations.find(l => l.id === id)?.name || 'Unknown location';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">Policy Rules</h3>
            <Badge variant="outline" className="text-[10px]">Super admin only</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            These drive every balance, warning level, and window in the app. Changes apply immediately but never
            change points already on someone's record. Every edit is logged in the audit trail.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            {POLICY_FIELDS.map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type="number" step="0.5" min="0"
                  value={draftVal(f.key)}
                  onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))}
                />
                {f.hint && <p className="text-[11px] text-muted-foreground mt-1">{f.hint}</p>}
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm" disabled={!dirty || saveSettings.isPending} onClick={() => saveSettings.mutate()}>
              Save Policy Rules
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-1">Infraction Point Values</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Points assigned per infraction type. Applies to new infractions only.
          </p>
          <div className="space-y-2">
            {types.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{t.label}</span>
                <Input
                  type="number" step="0.5" min="0" className="w-24 text-right"
                  value={pointDrafts[t.id] !== undefined ? pointDrafts[t.id] : Number(t.points)}
                  onChange={e => setPointDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button size="sm" disabled={Object.keys(pointDrafts).length === 0 || savePoints.isPending}
                    onClick={() => savePoints.mutate()}>
              Save Point Values
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-500" /> High-Volume Days
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Attendance points are multiplied by {Number(settings.highVolumeMultiplier)}× on these days.
            Add the weekend nearest each holiday and posted special events (posted at least a week ahead, per policy).
          </p>
          <div className="space-y-1.5 mb-4">
            {upcomingDays.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm border rounded-lg px-3 py-2">
                <span>
                  {format(parseISO(d.eventDate), 'EEE, MMM d, yyyy')} — {d.label}
                  {d.locationId && (
                    <Badge variant="outline" className="ml-2 text-[10px]">{locName(d.locationId)}</Badge>
                  )}
                </span>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDay.mutate(d.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {upcomingDays.length === 0 && (
              <p className="text-xs text-muted-foreground">No high-volume days configured.</p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={newDay.date}
                     onChange={e => setNewDay(v => ({ ...v, date: e.target.value }))} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">Label</Label>
              <Input placeholder="e.g. Citywide event" value={newDay.label}
                     onChange={e => setNewDay(v => ({ ...v, label: e.target.value }))} />
            </div>
            <div className="min-w-[140px]">
              <Label className="text-xs">Location (blank = all)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={newDay.locationId}
                onChange={e => setNewDay(v => ({ ...v, locationId: e.target.value }))}
              >
                <option value="">All locations</option>
                {locations.filter(l => l.status === 'active').map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <Button size="sm" className="gap-1" disabled={!newDay.date || !newDay.label.trim() || addDay.isPending}
                    onClick={() => addDay.mutate()}>
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Policy Document
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Link to the current signed policy (PDF). Team members get quick access to it from their dashboard.
          </p>
          <div className="flex gap-2">
            <Input placeholder="https://… link to the policy PDF"
                   value={docDraft !== undefined ? docDraft : (settings.policyDocumentPath || '')}
                   onChange={e => setDocDraft(e.target.value)} />
            <Button size="sm" disabled={docDraft === undefined || saveDoc.isPending} onClick={() => saveDoc.mutate()}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
