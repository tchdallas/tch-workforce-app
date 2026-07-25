import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import PageHeader from '@/components/common/PageHeader';
import { useLocations, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Scale, Flame, Search, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const disciplineBadges = {
  none:                  { label: 'Good standing', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  documented_coaching:   { label: 'Documented coaching', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  written_warning:       { label: 'Written warning', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  final_written_warning: { label: 'Final written warning', cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  termination_review:    { label: 'Termination review', cls: 'bg-red-600 text-white dark:bg-red-700' },
};

const statusBadges = {
  issued:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  excused:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  dismissed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  suggested: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// date-only strings ('2026-07-09') must parse as local time, not UTC midnight
const fmtDay = (d) => (d ? format(parseISO(d), 'MMM d, yyyy') : '');

export default function Attendance() {
  const queryClient = useQueryClient();
  const { member, isAdmin, assignedLocationIds, outranks } = useCurrentMember();
  const { data: locations = [] } = useLocations();
  const { data: teamMembers = [] } = useTeamMembers();

  const activeLocations = useMemo(
    () => locations.filter(l => l.status === 'active' &&
      (assignedLocationIds.length === 0 || assignedLocationIds.includes(l.id))),
    [locations, assignedLocationIds]
  );

  // null = not yet initialized; [] = user deselected everything
  const [selectedIds, setSelectedIds] = useState(null);
  useEffect(() => {
    if (selectedIds === null && activeLocations.length > 0) {
      setSelectedIds(activeLocations.map(l => l.id));
    }
  }, [activeLocations, selectedIds]);
  const locationIds = selectedIds || [];

  const toggleLocation = (id) =>
    setSelectedIds(prev => (prev || []).includes(id)
      ? (prev || []).filter(x => x !== id)
      : [...(prev || []), id]);

  // one roster call per selected location, merged below — a member assigned to
  // several locations appears once, with their single company-wide balance
  const rosterQueries = useQueries({
    queries: locationIds.map(id => ({
      queryKey: ['attendance-roster', id],
      queryFn: async () => {
        const { data, error } = await supabase.rpc('attendance_balances', { p_location_id: id });
        if (error) throw error;
        return { locationId: id, rows: data || [] };
      },
    })),
  });
  const isLoading = rosterQueries.some(q => q.isLoading);

  const roster = useMemo(() => {
    const byMember = new Map();
    for (const q of rosterQueries) {
      if (!q.data) continue;
      for (const row of q.data.rows) {
        const existing = byMember.get(row.team_member_id);
        if (existing) existing.locationIds.push(q.data.locationId);
        else byMember.set(row.team_member_id, { ...row, locationIds: [q.data.locationId] });
      }
    }
    return [...byMember.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterQueries.map(q => q.dataUpdatedAt).join(','), locationIds.join(',')]);

  const [search, setSearch] = useState('');
  const filteredRoster = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return roster;
    return roster.filter(r => r.display_name.toLowerCase().includes(s));
  }, [roster, search]);

  const { data: types = [] } = useQuery({
    queryKey: ['attendance-types'],
    queryFn: () => base44.entities.AttendanceInfractionType.list('display_order'),
    placeholderData: [],
  });

  const { data: pendingAppeals = [] } = useQuery({
    queryKey: ['attendance-appeals'],
    queryFn: () => base44.entities.AttendanceInfraction.filter({ appealStatus: 'pending' }),
    enabled: isAdmin,
    placeholderData: [],
  });

  const [detailMember, setDetailMember] = useState(null);
  const [issueOpen, setIssueOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['attendance-roster'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-appeals'] });
  };

  const getMemberName = (id) => {
    const fromRoster = roster.find(r => r.team_member_id === id);
    if (fromRoster) return fromRoster.display_name;
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Unknown';
  };

  // Hierarchy: you can only issue/manage points for members BELOW your rank.
  // The DB enforces this too — this just keeps the UI honest (no dead buttons).
  const canDiscipline = (id) => outranks(teamMembers.find(t => t.id === id)?.permissionLevel);
  const disciplinableRoster = roster.filter(r => canDiscipline(r.team_member_id));

  const locAbbrev = (id) => {
    const l = locations.find(x => x.id === id);
    return l?.abbreviation || l?.name || '';
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Attendance"
        subtitle="One company-wide point balance per team member — infractions at any location count toward the same total"
      >
        <Button className="gap-1.5" onClick={() => setIssueOpen(true)}>
          <Plus className="w-4 h-4" /> Issue Points
        </Button>
      </PageHeader>

      {/* location filter chips + name search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {activeLocations.map(l => {
            const on = locationIds.includes(l.id);
            return (
              <button
                key={l.id}
                onClick={() => toggleLocation(l.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  on
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                )}
              >
                {l.abbreviation || l.name}
              </button>
            );
          })}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search team members…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster" className="text-xs">
            Roster{filteredRoster.length > 0 && ` (${filteredRoster.length})`}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="appeals" className="text-xs gap-1.5">
              <Scale className="w-3.5 h-3.5" /> Appeals
              {pendingAppeals.length > 0 && (
                <Badge className="text-[10px] border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {pendingAppeals.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="roster" className="mt-4 space-y-2">
          {locationIds.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Select at least one location above</p>
          )}
          {locationIds.length > 0 && isLoading && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          )}
          {locationIds.length > 0 && !isLoading && filteredRoster.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? `No team members matching "${search}"` : 'No active team members at the selected locations'}
            </p>
          )}
          {filteredRoster.map(r => {
            const disc = disciplineBadges[r.discipline_level] || disciplineBadges.none;
            const pct = Math.min(100, (Number(r.balance) / Number(r.point_cap)) * 100);
            return (
              <Card key={r.team_member_id} className="cursor-pointer hover:bg-accent/40 transition-colors"
                    onClick={() => setDetailMember(r)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">
                        {r.display_name}
                        {locationIds.length > 1 && r.locationIds.map(id => (
                          <Badge key={id} variant="outline" className="ml-1.5 text-[10px]">{locAbbrev(id)}</Badge>
                        ))}
                        {r.is_new_hire && (
                          <Badge className="ml-1.5 text-[10px] border-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            New hire · {Number(r.point_cap)}-pt system
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.infraction_count > 0
                          ? `${r.infraction_count} infraction${r.infraction_count === 1 ? '' : 's'} · last ${fmtDay(r.last_infraction_on)}`
                          : 'No infractions in the current window'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="font-display text-xl leading-none">
                          {Number(r.balance)}<span className="text-sm text-muted-foreground">/{Number(r.point_cap)}</span>
                        </p>
                        <div className="w-24 h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <Badge className={`text-[10px] border-0 ${disc.cls}`}>{disc.label}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="appeals" className="mt-4 space-y-2">
            {pendingAppeals.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No pending appeals</p>
            )}
            {pendingAppeals.map(inf => (
              <AppealCard key={inf.id} infraction={inf} types={types}
                          memberName={getMemberName(inf.teamMemberId)} onDone={invalidate} />
            ))}
          </TabsContent>
        )}
      </Tabs>

      {detailMember && (
        <MemberDetailDialog
          rosterRow={detailMember}
          types={types}
          isAdmin={isAdmin}
          canManage={canDiscipline(detailMember.team_member_id)}
          onClose={() => setDetailMember(null)}
          onChanged={invalidate}
        />
      )}

      {issueOpen && (
        <IssueDialog
          roster={disciplinableRoster}
          types={types}
          teamMembers={teamMembers}
          onClose={() => setIssueOpen(false)}
          onIssued={invalidate}
        />
      )}
    </div>
  );
}

function MemberDetailDialog({ rosterRow, types, isAdmin, canManage = true, onClose, onChanged }) {
  const { data: history = [] } = useQuery({
    queryKey: ['attendance-history', rosterRow.team_member_id],
    queryFn: () => base44.entities.AttendanceInfraction.filter({ teamMemberId: rosterRow.team_member_id }),
    placeholderData: [],
  });

  const sorted = useMemo(
    () => [...history].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)),
    [history]
  );
  const typeLabel = (id) => types.find(t => t.id === id)?.label || 'Infraction';
  const disc = disciplineBadges[rosterRow.discipline_level] || disciplineBadges.none;

  const [excusing, setExcusing] = useState(null);
  const [excuseNote, setExcuseNote] = useState('');

  const excuseMutation = useMutation({
    mutationFn: async ({ id, note }) => {
      const { error } = await supabase.rpc('review_attendance_infraction', {
        p_id: id, p_action: 'excuse', p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Points excused');
      setExcusing(null); setExcuseNote('');
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">{rosterRow.display_name}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {Number(rosterRow.balance)} / {Number(rosterRow.point_cap)} points
            </span>
            <Badge className={`text-[10px] border-0 ${disc.cls}`}>{disc.label}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No infractions on record</p>
          )}
          {sorted.map(inf => (
            <div key={inf.id} className="border rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {typeLabel(inf.infractionTypeId)}
                    {inf.highVolume && (
                      <span className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] text-orange-600 dark:text-orange-400">
                        <Flame className="w-3 h-3" /> doubled
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDay(inf.occurredOn)}</p>
                  {inf.note && <p className="text-xs mt-1">{inf.note}</p>}
                  {inf.status === 'excused' && inf.excuseReason && (
                    <p className="text-xs mt-1 text-emerald-700 dark:text-emerald-400">Excused: {inf.excuseReason}</p>
                  )}
                  {inf.appealStatus === 'pending' && (
                    <p className="text-xs mt-1 text-blue-700 dark:text-blue-400">Appeal pending review</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-display text-lg leading-none ${inf.status === 'issued' ? '' : 'line-through text-muted-foreground'}`}>
                    {Number(inf.points)}
                  </p>
                  <Badge className={`text-[10px] border-0 mt-1 ${statusBadges[inf.status] || ''}`}>{inf.status}</Badge>
                </div>
              </div>

              {isAdmin && canManage && inf.status === 'issued' && (
                excusing === inf.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea placeholder="Reason for excusing (required — e.g. verified doctor's note)"
                              value={excuseNote} onChange={e => setExcuseNote(e.target.value)} rows={2} />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => { setExcusing(null); setExcuseNote(''); }}>Cancel</Button>
                      <Button size="sm" disabled={!excuseNote.trim() || excuseMutation.isPending}
                              onClick={() => excuseMutation.mutate({ id: inf.id, note: excuseNote.trim() })}>
                        Excuse points
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="outline" className="text-xs"
                            onClick={() => { setExcusing(inf.id); setExcuseNote(''); }}>
                      Excuse…
                    </Button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ roster, types, teamMembers, onClose, onIssued }) {
  const [memberId, setMemberId] = useState('');
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [occurredOn, setOccurredOn] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [note, setNote] = useState('');

  const { data: highVolumeDays = [] } = useQuery({
    queryKey: ['high-volume-days'],
    queryFn: () => base44.entities.HighVolumeDay.list(),
    placeholderData: [],
  });

  const activeTypes = types.filter(t => t.status === 'active');
  const selectedType = activeTypes.find(t => t.id === typeId);
  const selectedRosterRow = roster.find(r => r.team_member_id === memberId);

  // mirror the server: high-volume is judged at the member's home location
  // (the server result is authoritative; this is just the preview)
  const homeLocationId = teamMembers.find(t => t.id === memberId)?.homeLocationId || null;
  const isHighVolume = highVolumeDays.some(d =>
    d.eventDate === occurredOn && (!d.locationId || d.locationId === homeLocationId));
  const previewPoints = selectedType
    ? (isHighVolume ? Number(selectedType.points) * 2 : Number(selectedType.points))
    : null;

  const issueMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('issue_attendance_infraction', {
        p_member_id: memberId,
        p_type_id: typeId,
        p_occurred_on: occurredOn,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Issued ${data.points} point${Number(data.points) === 1 ? '' : 's'}${data.high_volume ? ' (high-volume day, doubled)' : ''}`);
      onIssued();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">Issue Attendance Points</DialogTitle>
          <DialogDescription>
            Points post to the team member's record immediately and they are notified. They may appeal from their dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Team member</Label>
            <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {selectedRosterRow
                    ? `${selectedRosterRow.display_name} (${Number(selectedRosterRow.balance)}/${Number(selectedRosterRow.point_cap)})`
                    : 'Search team members…'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Type a name…" />
                  <CommandList>
                    <CommandEmpty>No team member found.</CommandEmpty>
                    <CommandGroup>
                      {roster.map(r => (
                        <CommandItem
                          key={r.team_member_id}
                          value={r.display_name}
                          onSelect={() => { setMemberId(r.team_member_id); setMemberPickerOpen(false); }}
                        >
                          <Check className={cn('mr-2 h-4 w-4',
                            memberId === r.team_member_id ? 'opacity-100' : 'opacity-0')} />
                          {r.display_name}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {Number(r.balance)}/{Number(r.point_cap)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs">Infraction</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger><SelectValue placeholder="Select infraction type" /></SelectTrigger>
              <SelectContent>
                {activeTypes.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label} — {Number(t.points)} pt{Number(t.points) === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Date of infraction</Label>
            <Input type="date" value={occurredOn} max={format(new Date(), 'yyyy-MM-dd')}
                   onChange={e => setOccurredOn(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} placeholder="Context for the record — e.g. arrived 40 minutes late"
                      value={note} onChange={e => setNote(e.target.value)} />
          </div>

          {previewPoints !== null && (
            <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${isHighVolume
              ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
              : 'bg-muted'}`}>
              {isHighVolume && <Flame className="w-4 h-4 shrink-0" />}
              <span>
                {isHighVolume ? 'High-volume day — points are doubled: ' : 'Points to issue: '}
                <strong>{previewPoints}</strong>
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!memberId || !typeId || !occurredOn || issueMutation.isPending}
                  onClick={() => issueMutation.mutate()}>
            <AlertTriangle className="w-4 h-4 mr-1.5" /> Issue Points
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppealCard({ infraction, types, memberName, onDone }) {
  const [note, setNote] = useState('');
  const typeLabel = types.find(t => t.id === infraction.infractionTypeId)?.label || 'Infraction';

  const decideMutation = useMutation({
    mutationFn: async (decision) => {
      const { error } = await supabase.rpc('decide_attendance_appeal', {
        p_id: infraction.id, p_decision: decision, p_note: note.trim() || null,
      });
      if (error) throw error;
      return decision;
    },
    onSuccess: (decision) => {
      toast.success(decision === 'overturned' ? 'Appeal overturned — points removed' : 'Appeal upheld — points stand');
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">{memberName}</p>
            <p className="text-xs text-muted-foreground">
              {typeLabel} · {fmtDay(infraction.occurredOn)} · {Number(infraction.points)} pts
            </p>
            {infraction.appealNote && (
              <p className="text-xs mt-2 bg-muted rounded p-2">"{infraction.appealNote}"</p>
            )}
            {infraction.appealFiledAt && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Filed {format(new Date(infraction.appealFiledAt), 'MMM d, h:mm a')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <Textarea rows={2} placeholder="Decision note (kept on the record)"
                    value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate('upheld')}>
              Uphold points
            </Button>
            <Button size="sm" disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate('overturned')}>
              Overturn — remove points
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
