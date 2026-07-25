import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { payPeriodLabel, payPeriodFor, isoDate } from '@/lib/downs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { Plus, X, Loader2, ImagePlus, Clock, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { scanDownCard, matchEntry } from '@/lib/downOcr';

// live count of downs already recorded for a tournament (excludes this new card)
async function countTournamentDowns(tournamentId) {
  if (!tournamentId || tournamentId === 'new') return 0;
  const { count } = await supabase
    .from('downs')
    .select('id, down_cards!inner(tournament_id)', { count: 'exact', head: true })
    .eq('down_cards.tournament_id', tournamentId);
  return count || 0;
}

// live count of downs in a location's current pay period (excludes this card)
async function countPeriodDowns(locationId, cardDate) {
  if (!locationId || !cardDate) return 0;
  const { start, end } = payPeriodFor(cardDate);
  const { count } = await supabase
    .from('downs')
    .select('id, down_cards!inner(location_id, card_date)', { count: 'exact', head: true })
    .eq('down_cards.location_id', locationId)
    .gte('down_cards.card_date', isoDate(start))
    .lte('down_cards.card_date', isoDate(end));
  return count || 0;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let tmpId = 0;

export default function NewDownCardModal({ open, onClose, onSaved, locations = [], tournaments = [], series = [] }) {
  const qc = useQueryClient();
  const { data: teamMembers = [] } = useTeamMembers();
  const { scopeLocations } = useCurrentMember();

  const [cardDate, setCardDate] = useState(todayIso());
  const [tournamentId, setTournamentId] = useState('');
  const [newTournamentName, setNewTournamentName] = useState('');
  const [newTournamentLoc, setNewTournamentLoc] = useState('');
  const [seriesId, setSeriesId] = useState('');            // '', 'new', or an id
  const [newSeriesName, setNewSeriesName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [photos, setPhotos] = useState([]);                // [{ file_url }]
  const [rows, setRows] = useState([]);                    // [{ tmpId, teamMemberId, durationMinutes }]
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(null);   // [{ e, m }]

  useEffect(() => {
    if (open) {
      setCardDate(todayIso()); setTournamentId(''); setNewTournamentName(''); setNewTournamentLoc('');
      setSeriesId(''); setNewSeriesName(''); setTableNumber(''); setPhotos([]); setRows([]); setScan(null);
    }
  }, [open]);

  const isNewTournament = tournamentId === 'new';
  const selectedTournament = tournaments.find(t => t.id === tournamentId);
  const effectiveLocationId = isNewTournament ? newTournamentLoc : selectedTournament?.locationId;

  const { data: tournamentSoFar = 0 } = useQuery({
    queryKey: ['down-count-tournament', tournamentId],
    queryFn: () => countTournamentDowns(tournamentId),
    enabled: open && !!tournamentId && tournamentId !== 'new',
  });
  const { data: periodSoFar = 0 } = useQuery({
    queryKey: ['down-count-period', effectiveLocationId, cardDate],
    queryFn: () => countPeriodDowns(effectiveLocationId, cardDate),
    enabled: open && !!effectiveLocationId && !!cardDate,
  });

  const cardTotal = rows.length;

  const memberName = (id) => {
    const m = teamMembers.find(t => t.id === id);
    return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown';
  };

  const addDown = (teamMemberId) => {
    if (!teamMemberId) return;
    setRows(r => [...r, { tmpId: ++tmpId, teamMemberId, durationMinutes: 30 }]);
  };
  const removeRow = (id) => setRows(r => r.filter(x => x.tmpId !== id));
  const setDuration = (id, mins) => setRows(r => r.map(x => x.tmpId === id ? { ...x, durationMinutes: mins } : x));

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setPhotos(p => [...p, { file_url }]);
      }
    } catch (e) {
      toast.error(e.message || 'Photo upload failed');
    } finally { setUploading(false); }
  };

  const runScan = async () => {
    if (!photos.length) return;
    setScanning(true);
    try {
      const entries = await scanDownCard(photos.map(p => p.file_url));
      setScan(entries.map(e => ({ e, m: matchEntry(e, teamMembers) })));
    } catch (err) {
      toast.error(err.message || 'Could not read the photo');
    } finally { setScanning(false); }
  };

  const addAllMatched = () => {
    (scan || []).forEach(({ m }) => { if (m) addDown(m.id); });
    toast.success('Added matched dealers — review and adjust');
  };

  const valid =
    cardDate &&
    (isNewTournament ? (newTournamentName.trim() && newTournamentLoc) : !!tournamentId) &&
    rows.length > 0;

  const submit = async () => {
    setSaving(true);
    try {
      // resolve series
      let resolvedSeriesId = null;
      if (isNewTournament) {
        if (seriesId === 'new' && newSeriesName.trim()) {
          const s = await base44.entities.TournamentSeries.create({ name: newSeriesName.trim(), locationId: newTournamentLoc || null });
          resolvedSeriesId = s.id;
        } else if (seriesId && seriesId !== 'new') {
          resolvedSeriesId = seriesId;
        }
      }
      // resolve tournament
      let resolvedTournamentId = tournamentId;
      let locationId = effectiveLocationId;
      if (isNewTournament) {
        const t = await base44.entities.Tournament.create({
          name: newTournamentName.trim(), locationId: newTournamentLoc, seriesId: resolvedSeriesId,
        });
        resolvedTournamentId = t.id;
        locationId = newTournamentLoc;
      }
      // create the card
      const card = await base44.entities.DownCard.create({
        tournamentId: resolvedTournamentId,
        locationId,
        tableNumber: tableNumber.trim() || null,
        cardDate,
      });
      // downs (one row each)
      await base44.entities.Down.bulkCreate(
        rows.map((r, i) => ({
          downCardId: card.id,
          teamMemberId: r.teamMemberId,
          slotNumber: i + 1,
          durationMinutes: r.durationMinutes,
        }))
      );
      // photos
      for (const p of photos) {
        await base44.entities.DownCardPhoto.create({ downCardId: card.id, fileUrl: p.file_url });
      }
      toast.success(`Down card saved — ${rows.length} down${rows.length !== 1 ? 's' : ''}`);
      qc.invalidateQueries({ queryKey: ['down-cards'] });
      qc.invalidateQueries({ queryKey: ['tournaments'] });
      onSaved?.();
    } catch (e) {
      toast.error(e.message || 'Could not save down card');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>New Down Card</DialogTitle></DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={cardDate} onChange={e => setCardDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Table #</Label>
              <Input value={tableNumber} onChange={e => setTableNumber(e.target.value)} placeholder="e.g. 22" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Tournament</Label>
            <Select value={tournamentId} onValueChange={setTournamentId}>
              <SelectTrigger><SelectValue placeholder="Choose a tournament" /></SelectTrigger>
              <SelectContent>
                {tournaments.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                <SelectItem value="new">+ Create new tournament</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isNewTournament && (
            <div className="rounded-md border border-border p-3 space-y-3 bg-muted/30">
              <div>
                <Label className="text-xs">Tournament name</Label>
                <Input value={newTournamentName} onChange={e => setNewTournamentName(e.target.value)} placeholder="e.g. $200 NLH" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Location</Label>
                  <Select value={newTournamentLoc} onValueChange={setNewTournamentLoc}>
                    <SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger>
                    <SelectContent>
                      {scopeLocations(locations.filter(l => l.status === 'active')).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Series (optional)</Label>
                  <Select value={seriesId} onValueChange={setSeriesId}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      {series.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      <SelectItem value="new">+ New series</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {seriesId === 'new' && (
                <div>
                  <Label className="text-xs">New series name</Label>
                  <Input value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)} placeholder="e.g. Summer Series 2026" />
                </div>
              )}
            </div>
          )}

          {/* photos */}
          <div>
            <Label className="text-xs">Down card photo(s)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {photos.map((p, i) => (
                <div key={i} className="relative w-16 h-16 rounded border border-border overflow-hidden">
                  <img src={p.file_url} alt="" className="w-full h-full object-cover" />
                  <button className="absolute top-0 right-0 bg-destructive/80 text-white rounded-bl px-1" onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <label className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-accent/10">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
                <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => handleFiles(e.target.files)} />
              </label>
            </div>
            {photos.length > 0 && (
              <Button size="sm" variant="outline" className="mt-2 h-7 gap-1.5 text-xs" onClick={runScan} disabled={scanning}>
                {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanLine className="w-3 h-3" />}
                Read photo (cross-check)
              </Button>
            )}
          </div>

          {/* OCR cross-check */}
          {scan && (
            <div className="rounded-md border border-border p-2.5 bg-muted/20 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Photo found {scan.length} down{scan.length !== 1 ? 's' : ''} · {scan.filter(s => s.m).length} matched</span>
                {scan.some(s => s.m) && (
                  <button className="text-primary hover:underline" onClick={addAllMatched}>Add all matched</button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Assistive only — the photo reading can be wrong. Compare with your entries below.</p>
              <div className="flex flex-wrap gap-1">
                {scan.map((s, i) => (
                  <span key={i} className={cn('px-1.5 py-0.5 rounded text-[10px] border',
                    s.m ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700')}>
                    {s.m ? `${s.m.preferredName || s.m.firstName} ${s.m.lastName}` : (s.e.name || s.e.badge || '?') + ' (no match)'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* downs */}
          <div>
            <Label className="text-xs">Add downs (search a dealer to add one)</Label>
            <TeamMemberCombobox value="" onChange={addDown} eligibleTeamMembers={teamMembers} placeholder="Search dealer by name or badge #…" />
            <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={r.tmpId} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2 py-1.5">
                  <span className="text-[10px] text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{memberName(r.teamMemberId)}</span>
                  <button
                    className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0 flex items-center gap-0.5',
                      r.durationMinutes === 40 ? 'border-primary text-primary' : 'border-border text-muted-foreground')}
                    onClick={() => setDuration(r.tmpId, r.durationMinutes === 30 ? 40 : 30)}
                    title="Toggle 30 / 40 min"
                  >
                    <Clock className="w-3 h-3" />{r.durationMinutes}m
                  </button>
                  <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeRow(r.tmpId)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No downs added yet</p>}
            </div>
          </div>
        </div>

        {/* live summary */}
        <div className="mt-2 rounded-md bg-primary/5 border border-primary/20 p-2 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-lg font-bold text-primary">{cardTotal}</p><p className="text-[10px] text-muted-foreground">This card</p></div>
          <div><p className="text-lg font-bold">{tournamentSoFar + cardTotal}</p><p className="text-[10px] text-muted-foreground">Tournament</p></div>
          <div><p className="text-lg font-bold">{periodSoFar + cardTotal}</p><p className="text-[10px] text-muted-foreground">Pay period</p></div>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">Pay period: {payPeriodLabel(cardDate, true)}</p>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save down card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
