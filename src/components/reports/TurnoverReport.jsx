import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { subDays, format } from 'date-fns';
import { categoryLabel } from '@/lib/termination';

const PERIODS = [
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || 'Unspecified';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone || ''}`}>{value}</p>
    </Card>
  );
}

function Breakdown({ title, rows, total }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No data</p>
        ) : (
          <div className="space-y-2">
            {rows.map(([label, count]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-sm w-40 shrink-0 truncate">{label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TurnoverReport({ locations = [], activeHeadcount = 0 }) {
  const [period, setPeriod] = useState('365');

  const { data: archived = [], isLoading } = useQuery({
    queryKey: ['turnover-archived'],
    queryFn: () => base44.entities.TeamMember.filter({ status: 'archived' }, '-terminatedAt'),
    placeholderData: [],
  });

  const locName = (id) => locations.find(l => l.id === id)?.name || 'No location';

  const terms = useMemo(() => {
    const since = period === 'all' ? null : subDays(new Date(), Number(period));
    return archived.filter(m => m.terminatedAt && (!since || new Date(m.terminatedAt) >= since));
  }, [archived, period]);

  const voluntary = terms.filter(m => m.terminationCategory === 'voluntary').length;
  const involuntary = terms.filter(m => m.terminationCategory === 'involuntary').length;
  const rehire = terms.filter(m => m.rehireEligible === true).length;
  const byReason = countBy(terms, m => m.terminationReason);
  const byLocation = countBy(terms, m => locName(m.homeLocationId));
  const byCategory = countBy(terms, m => categoryLabel(m.terminationCategory));

  // rough turnover rate: departures over the window vs. current active headcount
  const rate = activeHeadcount > 0 ? Math.round((terms.length / (activeHeadcount + terms.length)) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Terminations are recorded when a member is archived with a reason.
        </p>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Terminations" value={terms.length} />
            <Stat label="Voluntary" value={voluntary} tone="text-amber-600" />
            <Stat label="Involuntary" value={involuntary} tone="text-red-600" />
            <Stat label="Rehire-eligible" value={rehire} tone="text-emerald-600" />
          </div>
          {rate !== null && (
            <p className="text-xs text-muted-foreground">
              ≈ <span className="font-medium text-foreground">{rate}%</span> turnover over this window
              (relative to {activeHeadcount} active members).
            </p>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            <Breakdown title="By reason" rows={byReason} total={terms.length} />
            <Breakdown title="By location" rows={byLocation} total={terms.length} />
          </div>

          {terms.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Recent departures</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {terms.slice(0, 30).map(m => (
                    <div key={m.id} className="flex items-center gap-2 text-sm border-b border-border/50 pb-1.5 last:border-0">
                      <span className="font-medium min-w-0 truncate">{m.preferredName || m.firstName} {m.lastName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{categoryLabel(m.terminationCategory)}</Badge>
                      {m.terminationReason && <span className="text-xs text-muted-foreground truncate">{m.terminationReason}</span>}
                      {m.rehireEligible === true && <span className="text-[10px] text-emerald-600 shrink-0">rehire ✓</span>}
                      <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{m.terminatedAt ? format(new Date(m.terminatedAt), 'MMM d, yyyy') : ''}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
