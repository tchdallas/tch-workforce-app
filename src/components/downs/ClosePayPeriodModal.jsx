import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { recentPayPeriods } from '@/lib/downs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

async function fetchPeriodDowns(startIso, endIso, locationIds) {
  if (!locationIds.length || !startIso) return [];
  const { data, error } = await supabase
    .from('downs')
    .select('team_member_id, down_cards!inner(location_id, card_date)')
    .in('down_cards.location_id', locationIds)
    .gte('down_cards.card_date', startIso)
    .lte('down_cards.card_date', endIso);
  if (error) throw error;
  return data || [];
}

export default function ClosePayPeriodModal({ open, onClose, onSaved, locations = [] }) {
  const qc = useQueryClient();
  const { member, scopeLocations } = useCurrentMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const periods = useMemo(() => recentPayPeriods(6), []);

  const [periodStart, setPeriodStart] = useState('');
  const [locIds, setLocIds] = useState([]);
  const [pool, setPool] = useState('');

  useEffect(() => {
    if (open) { setPeriodStart(periods[0]?.startIso || ''); setLocIds([]); setPool(''); }
  }, [open, periods]);

  const period = periods.find(p => p.startIso === periodStart);

  const { data: downRows = [], isFetching } = useQuery({
    queryKey: ['close-period-downs', periodStart, period?.endIso, locIds.slice().sort().join(',')],
    enabled: open && !!periodStart && locIds.length > 0,
    queryFn: () => fetchPeriodDowns(period.startIso, period.endIso, locIds),
  });

  const totalDowns = downRows.length;
  const poolNum = parseFloat(pool) || 0;
  const rate = totalDowns > 0 ? poolNum / totalDowns : 0;

  const byMember = useMemo(() => {
    const m = new Map();
    downRows.forEach(r => m.set(r.team_member_id, (m.get(r.team_member_id) || 0) + 1));
    const name = (id) => { const t = teamMembers.find(x => x.id === id); return t ? `${t.preferredName || t.firstName} ${t.lastName}` : 'Unknown'; };
    return [...m.entries()].map(([id, n]) => ({ id, name: name(id), downs: n, pay: n * rate })).sort((a, b) => b.downs - a.downs);
  }, [downRows, teamMembers, rate]);

  const toggleLoc = (id) => setLocIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const valid = periodStart && locIds.length > 0 && totalDowns > 0 && poolNum > 0;

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.DownPayPeriod.create({
        periodStart: period.startIso,
        periodEnd: period.endIso,
        locationIds: locIds,
        poolAmount: poolNum,
        totalDowns,
        rate: Math.round(rate * 10000) / 10000,
        closedBy: member?.id,
      });
      toast.success(`Pay period closed — $${rate.toFixed(2)}/down`);
      qc.invalidateQueries({ queryKey: ['down-pay-periods'] });
      onSaved?.();
    } catch (e) { toast.error(e.message || 'Could not close period'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Close a pay period</DialogTitle></DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          <div>
            <Label className="text-xs">Pay period</Label>
            <Select value={periodStart} onValueChange={setPeriodStart}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {periods.map(p => <SelectItem key={p.startIso} value={p.startIso}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Location(s)</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {scopeLocations(locations.filter(l => l.status === 'active')).map(l => (
                <button key={l.id} type="button" onClick={() => toggleLoc(l.id)}
                  className={cn('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                    locIds.includes(l.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent/10')}>
                  {l.name}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Pick one, or several to combine their pool.</p>
          </div>

          <div>
            <Label className="text-xs">Pool amount ($)</Label>
            <Input type="number" min={0} step="0.01" value={pool} onChange={e => setPool(e.target.value)} placeholder="e.g. 5000" />
          </div>

          {/* rate summary */}
          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-lg font-bold">{isFetching ? '…' : totalDowns}</p><p className="text-[10px] text-muted-foreground">Total downs</p></div>
            <div><p className="text-lg font-bold">${poolNum.toFixed(0)}</p><p className="text-[10px] text-muted-foreground">Pool</p></div>
            <div><p className="text-lg font-bold text-primary">${rate.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">Per down</p></div>
          </div>

          {byMember.length > 0 && (
            <div>
              <Label className="text-xs">Preview ({byMember.length} dealers)</Label>
              <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
                {byMember.map(d => (
                  <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{d.downs} down{d.downs !== 1 ? 's' : ''}</span>
                    <span className="text-sm font-medium w-16 text-right shrink-0">${d.pay.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />} Close period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
