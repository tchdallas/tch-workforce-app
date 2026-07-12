import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useLocations, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { toast } from 'sonner';
import { Flag } from 'lucide-react';
import { payPeriodFor, payPeriodLabel, isoDate } from '@/lib/downs';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Image as ImageIcon, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import NewDownCardModal from '@/components/downs/NewDownCardModal';
import DownCardDetailModal from '@/components/downs/DownCardDetailModal';
import ClosePayPeriodModal from '@/components/downs/ClosePayPeriodModal';
import { DollarSign } from 'lucide-react';

// down cards with tournament name + downs/photo counts, most recent first
async function fetchCards() {
  const { data, error } = await supabase
    .from('down_cards')
    .select('id, card_date, table_number, location_id, tournament_id, tournaments(name), downs(count), down_card_photos(count)')
    .order('card_date', { ascending: false })
    .limit(150);
  if (error) throw error;
  return (data || []).map(c => ({
    id: c.id,
    cardDate: c.card_date,
    tableNumber: c.table_number,
    locationId: c.location_id,
    tournamentName: c.tournaments?.name || 'Tournament',
    downs: c.downs?.[0]?.count || 0,
    photos: c.down_card_photos?.[0]?.count || 0,
  }));
}

export default function Downs() {
  const [modalOpen, setModalOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [detailCardId, setDetailCardId] = useState(null);
  const { data: locations = [] } = useLocations();

  const { member } = useCurrentMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const qc = useQueryClient();

  const { data: settlements = [] } = useQuery({
    queryKey: ['down-pay-periods'],
    queryFn: () => base44.entities.DownPayPeriod.list('-period_start'),
    placeholderData: [],
  });
  const { data: openDisputes = [] } = useQuery({
    queryKey: ['open-disputes'],
    queryFn: () => base44.entities.DownDispute.filter({ status: 'open' }, '-created_date'),
    placeholderData: [],
  });

  const memberName = (id) => {
    const m = teamMembers.find(t => t.id === id);
    return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'A team member';
  };
  const resolveDispute = async (id) => {
    try {
      await base44.entities.DownDispute.update(id, { status: 'resolved', resolvedBy: member?.id, resolvedAt: new Date().toISOString() });
      toast.success('Dispute resolved');
      qc.invalidateQueries({ queryKey: ['open-disputes'] });
    } catch (e) { toast.error(e.message || 'Could not resolve'); }
  };

  const { data: tournaments = [] } = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => base44.entities.Tournament.filter({ status: 'active' }, '-created_date'),
    placeholderData: [],
  });
  const { data: series = [] } = useQuery({
    queryKey: ['tournament-series'],
    queryFn: () => base44.entities.TournamentSeries.filter({ status: 'active' }),
    placeholderData: [],
  });
  const { data: cards = [] } = useQuery({ queryKey: ['down-cards'], queryFn: fetchCards, placeholderData: [] });

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';

  // current pay-period rollup
  const period = payPeriodFor(new Date());
  const periodCards = useMemo(() => cards.filter(c => {
    const d = c.cardDate;
    return d >= isoDate(period.start) && d <= isoDate(period.end);
  }), [cards, period.start, period.end]);

  const periodTotal = periodCards.reduce((a, c) => a + c.downs, 0);
  const periodByLocation = useMemo(() => {
    const m = new Map();
    periodCards.forEach(c => m.set(c.locationId, (m.get(c.locationId) || 0) + c.downs));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [periodCards]);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Tournament Downs" subtitle="Log down cards and track dealer downs">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCloseOpen(true)}>
          <DollarSign className="w-4 h-4" /> Close pay period
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4" /> New Down Card
        </Button>
      </PageHeader>

      {/* current pay period */}
      <Card className="mb-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>This pay period</span>
            <span className="text-xs font-normal text-muted-foreground">{payPeriodLabel(new Date())}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-primary">{periodTotal}</span>
            <span className="text-sm text-muted-foreground">downs so far</span>
          </div>
          {periodByLocation.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {periodByLocation.map(([loc, n]) => (
                <Badge key={loc} variant="outline" className="text-[11px]">{locName(loc)}: {n}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* open disputes */}
      {openDisputes.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Flag className="w-4 h-4 text-amber-600" /> Open disputes
            <Badge variant="secondary">{openDisputes.length}</Badge>
          </h2>
          <div className="space-y-2">
            {openDisputes.map(d => (
              <Card key={d.id} className="p-3 border-amber-300/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{memberName(d.teamMemberId)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{d.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{d.created_date ? format(new Date(d.created_date), 'MMM d, h:mm a') : ''}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => resolveDispute(d.id)}>Resolve</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* closed pay periods */}
      {settlements.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold mb-2">Closed pay periods</h2>
          <div className="space-y-2">
            {settlements.map(s => (
              <Card key={s.id} className="p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {format(new Date(s.periodStart + 'T00:00:00'), 'MMM d')} – {format(new Date(s.periodEnd + 'T00:00:00'), 'MMM d, yyyy')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {(s.locationIds || []).map(locName).join(', ')} · {s.totalDowns} downs · pool ${Number(s.poolAmount).toLocaleString()}
                  </p>
                </div>
                <Badge className="shrink-0 bg-emerald-600">${Number(s.rate).toFixed(2)}/down</Badge>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* recent down cards */}
      <h2 className="text-sm font-semibold mb-2">Recent down cards</h2>
      {cards.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No down cards yet. Log one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map(c => (
            <Card key={c.id} className="p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/40" onClick={() => setDetailCardId(c.id)}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{c.tournamentName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {format(new Date(c.cardDate + 'T00:00:00'), 'EEE, MMM d, yyyy')}
                  {c.tableNumber ? ` · Table ${c.tableNumber}` : ''} · {locName(c.locationId)}
                </p>
              </div>
              {c.photos > 0 && (
                <span className="text-muted-foreground flex items-center gap-0.5 text-[11px]"><ImageIcon className="w-3.5 h-3.5" />{c.photos}</span>
              )}
              <Badge className="shrink-0">{c.downs} down{c.downs !== 1 ? 's' : ''}</Badge>
            </Card>
          ))}
        </div>
      )}

      <NewDownCardModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => setModalOpen(false)}
        locations={locations}
        tournaments={tournaments}
        series={series}
      />

      <DownCardDetailModal
        cardId={detailCardId}
        open={!!detailCardId}
        onClose={() => setDetailCardId(null)}
        onChanged={() => setDetailCardId(null)}
        locationName={locName(cards.find(c => c.id === detailCardId)?.locationId)}
      />

      <ClosePayPeriodModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onSaved={() => setCloseOpen(false)}
        locations={locations}
      />
    </div>
  );
}
