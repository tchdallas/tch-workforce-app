import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { payPeriodFor, payPeriodLabel, isoDate } from '@/lib/downs';
import { format } from 'date-fns';
import { Trophy } from 'lucide-react';

async function fetchMemberDowns(memberId) {
  const { data, error } = await supabase
    .from('downs')
    .select('id, duration_minutes, down_cards(card_date, table_number, location_id, tournaments(name))')
    .eq('team_member_id', memberId);
  if (error) throw error;
  return (data || [])
    .map(d => ({
      id: d.id,
      durationMinutes: d.duration_minutes,
      cardDate: d.down_cards?.card_date,
      tableNumber: d.down_cards?.table_number,
      locationId: d.down_cards?.location_id,
      tournamentName: d.down_cards?.tournaments?.name || 'Tournament',
    }))
    .sort((a, b) => (b.cardDate || '').localeCompare(a.cardDate || ''));
}

export default function MemberDownsView({ memberId }) {
  const { data: downs = [], isLoading } = useQuery({
    queryKey: ['member-downs', memberId],
    enabled: !!memberId,
    queryFn: () => fetchMemberDowns(memberId),
  });
  const { data: settlements = [] } = useQuery({
    queryKey: ['down-pay-periods'],
    queryFn: () => base44.entities.DownPayPeriod.list('-period_start'),
    placeholderData: [],
  });

  // the settled rate for a down (a closed period covering its date + location)
  const rateForDown = (d) => {
    const s = settlements.find(x =>
      d.cardDate >= x.periodStart && d.cardDate <= x.periodEnd &&
      (x.locationIds || []).includes(d.locationId));
    return s ? Number(s.rate) : 0;
  };
  const lifetimeEarned = useMemo(
    () => downs.reduce((a, d) => a + rateForDown(d), 0),
    [downs, settlements]
  );

  const period = payPeriodFor(new Date());
  const currentCount = useMemo(
    () => downs.filter(d => d.cardDate >= isoDate(period.start) && d.cardDate <= isoDate(period.end)).length,
    [downs, period.start, period.end]
  );

  // group downs by pay period for the list
  const groups = useMemo(() => {
    const m = new Map();
    for (const d of downs) {
      if (!d.cardDate) continue;
      const key = isoDate(payPeriodFor(d.cardDate).start);
      if (!m.has(key)) m.set(key, { label: payPeriodLabel(d.cardDate, true), start: key, items: [] });
      m.get(key).items.push(d);
    }
    return [...m.values()].sort((a, b) => b.start.localeCompare(a.start));
  }, [downs]);

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${lifetimeEarned > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">This pay period</p>
          <p className="text-2xl font-bold text-primary mt-1">{currentCount}</p>
          <p className="text-[10px] text-muted-foreground">{payPeriodLabel(new Date(), true)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Lifetime downs</p>
          <p className="text-2xl font-bold mt-1">{downs.length}</p>
        </Card>
        {lifetimeEarned > 0 && (
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Earned (settled)</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">${lifetimeEarned.toFixed(2)}</p>
          </Card>
        )}
      </div>

      {downs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No tournament downs recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const earned = g.items.reduce((a, d) => a + rateForDown(d), 0);
            return (
            <div key={g.start}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{g.label}</p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{g.items.length} down{g.items.length !== 1 ? 's' : ''}</Badge>
                  {earned > 0 && <Badge className="text-[10px] bg-emerald-600">${earned.toFixed(2)}</Badge>}
                </div>
              </div>
              <Card>
                <CardContent className="p-0 divide-y divide-border/50">
                  {g.items.map(d => (
                    <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{d.tournamentName}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {d.cardDate ? format(new Date(d.cardDate + 'T00:00:00'), 'MMM d') : ''}
                        {d.tableNumber ? ` · T${d.tableNumber}` : ''}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{d.durationMinutes}m</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
