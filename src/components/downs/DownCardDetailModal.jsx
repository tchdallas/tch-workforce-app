import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useTeamMembers } from '@/lib/useAppData';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { X, Loader2, ImagePlus, Trash2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

async function fetchCardDetail(cardId) {
  const { data, error } = await supabase
    .from('down_cards')
    .select('id, card_date, table_number, location_id, tournament_id, tournaments(name), downs(id, team_member_id, slot_number, duration_minutes), down_card_photos(id, file_url)')
    .eq('id', cardId)
    .single();
  if (error) throw error;
  return data;
}

let tmpId = 0;

export default function DownCardDetailModal({ cardId, open, onClose, onChanged, locationName }) {
  const qc = useQueryClient();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: card, isLoading } = useQuery({
    queryKey: ['down-card', cardId],
    enabled: open && !!cardId,
    queryFn: () => fetchCardDetail(cardId),
  });

  const [rows, setRows] = useState([]);      // { id?, tmpId?, teamMemberId, durationMinutes }
  const [photos, setPhotos] = useState([]);  // { id?, file_url }
  const [removedPhotoIds, setRemovedPhotoIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (card) {
      setRows((card.downs || [])
        .sort((a, b) => (a.slot_number || 0) - (b.slot_number || 0))
        .map(d => ({ id: d.id, teamMemberId: d.team_member_id, durationMinutes: d.duration_minutes })));
      setPhotos((card.down_card_photos || []).map(p => ({ id: p.id, file_url: p.file_url })));
      setRemovedPhotoIds([]);
    }
  }, [card]);

  const memberName = (id) => {
    const m = teamMembers.find(t => t.id === id);
    return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown';
  };

  const addDown = (id) => { if (id) setRows(r => [...r, { tmpId: ++tmpId, teamMemberId: id, durationMinutes: 30 }]); };
  const removeRow = (row) => setRows(r => r.filter(x => (x.id || x.tmpId) !== (row.id || row.tmpId)));
  const setDuration = (row, mins) => setRows(r => r.map(x => (x.id || x.tmpId) === (row.id || row.tmpId) ? { ...x, durationMinutes: mins } : x));

  const removePhoto = (p) => {
    if (p.id) setRemovedPhotoIds(ids => [...ids, p.id]);
    setPhotos(ps => ps.filter(x => x !== p));
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setPhotos(p => [...p, { file_url }]);
      }
    } catch (e) { toast.error(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const originalIds = new Set((card.downs || []).map(d => d.id));
      const keptIds = new Set(rows.filter(r => r.id).map(r => r.id));
      const toDelete = [...originalIds].filter(id => !keptIds.has(id));
      const toInsert = rows.filter(r => !r.id);

      for (const id of toDelete) await base44.entities.Down.delete(id);
      if (toInsert.length) {
        await base44.entities.Down.bulkCreate(toInsert.map((r, i) => ({
          downCardId: cardId, teamMemberId: r.teamMemberId, durationMinutes: r.durationMinutes,
          slotNumber: rows.length - toInsert.length + i + 1,
        })));
      }
      // re-number slots is optional; skip for now
      for (const pid of removedPhotoIds) await base44.entities.DownCardPhoto.delete(pid);
      for (const p of photos.filter(x => !x.id)) await base44.entities.DownCardPhoto.create({ downCardId: cardId, fileUrl: p.file_url });

      toast.success('Down card updated');
      qc.invalidateQueries({ queryKey: ['down-cards'] });
      qc.invalidateQueries({ queryKey: ['down-card', cardId] });
      onChanged?.();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const deleteCard = async () => {
    try {
      await base44.entities.DownCard.delete(cardId);
      toast.success('Down card deleted');
      qc.invalidateQueries({ queryKey: ['down-cards'] });
      onChanged?.();
    } catch (e) { toast.error(e.message || 'Could not delete'); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{card?.tournaments?.name || 'Down Card'}</DialogTitle>
          {card && (
            <p className="text-xs text-muted-foreground">
              {format(new Date(card.card_date + 'T00:00:00'), 'EEE, MMM d, yyyy')}
              {card.table_number ? ` · Table ${card.table_number}` : ''}{locationName ? ` · ${locationName}` : ''}
            </p>
          )}
        </DialogHeader>

        {isLoading || !card ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto pr-1 space-y-3">
              <div>
                <Label className="text-xs">Photos</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {photos.map((p, i) => (
                    <div key={p.id || i} className="relative w-16 h-16 rounded border border-border overflow-hidden">
                      <a href={p.file_url} target="_blank" rel="noreferrer"><img src={p.file_url} alt="" className="w-full h-full object-cover" /></a>
                      <button className="absolute top-0 right-0 bg-destructive/80 text-white rounded-bl px-1" onClick={() => removePhoto(p)}>×</button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-accent/10">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
                    <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => handleFiles(e.target.files)} />
                  </label>
                </div>
              </div>

              <div>
                <Label className="text-xs">Downs ({rows.length})</Label>
                <TeamMemberCombobox value="" onChange={addDown} eligibleTeamMembers={teamMembers} placeholder="Add a dealer…" />
                <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
                  {rows.map((r, i) => (
                    <div key={r.id || r.tmpId} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{memberName(r.teamMemberId)}</span>
                      <button
                        className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0 flex items-center gap-0.5',
                          r.durationMinutes === 40 ? 'border-primary text-primary' : 'border-border text-muted-foreground')}
                        onClick={() => setDuration(r, r.durationMinutes === 30 ? 40 : 30)}
                      ><Clock className="w-3 h-3" />{r.durationMinutes}m</button>
                      <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeRow(r)}><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  {rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No downs on this card</p>}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-2 gap-2 sm:justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /> Delete card</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this down card?</AlertDialogTitle>
                    <AlertDialogDescription>This removes the card and all {rows.length} down{rows.length !== 1 ? 's' : ''} on it. This can't be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={deleteCard}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={saving}>Close</Button>
                <Button onClick={save} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
