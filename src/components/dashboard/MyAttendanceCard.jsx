import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format, parseISO, addMonths, subMonths } from 'date-fns';
import { CalendarClock, Flame, Hourglass } from 'lucide-react';

// Personal attendance standing — visible to EVERYONE, managers/admins included,
// since they're team members too. Balance comes from my_attendance_standing()
// (same math as the manager roster) so the number matches what a manager sees.
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
};

const fmtDay = (d) => (d ? format(parseISO(d), 'MMM d, yyyy') : '');

export default function MyAttendanceCard() {
  const { member } = useCurrentMember();

  const { data: standingRows = [], isLoading: loadingStanding } = useQuery({
    queryKey: ['my-attendance-standing', member?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_attendance_standing');
      if (error) throw error;
      return data || [];
    },
    enabled: !!member?.id,
  });
  const standing = standingRows[0];

  const { data: infractions = [] } = useQuery({
    queryKey: ['my-infractions-list', member?.id],
    queryFn: () => base44.entities.AttendanceInfraction.filter({ teamMemberId: member.id }),
    enabled: !!member?.id,
    placeholderData: [],
  });

  const { data: types = [] } = useQuery({
    queryKey: ['attendance-types'],
    queryFn: () => base44.entities.AttendanceInfractionType.list('display_order'),
    placeholderData: [],
  });
  const typeLabel = (id) => types.find(t => t.id === id)?.label || 'Infraction';

  const { data: settingsRows = [] } = useQuery({
    queryKey: ['attendance-policy-settings'],
    queryFn: () => base44.entities.AttendancePolicySettings.list(),
    enabled: !!member?.id,
    placeholderData: [],
  });
  const rollingMonths = Number(settingsRows[0]?.rollingWindowMonths) || 12;

  // Next point to drop off: the OLDEST still-counting issued infraction expires
  // rollingMonths after it occurred; everything on that same day expires together.
  const nextExpiry = useMemo(() => {
    const cutoff = subMonths(new Date(), rollingMonths);
    const counting = infractions.filter(i => i.status === 'issued' && parseISO(i.occurredOn) >= cutoff);
    if (!counting.length) return null;
    const oldest = counting.reduce((a, b) => (a.occurredOn <= b.occurredOn ? a : b));
    const pts = counting
      .filter(i => i.occurredOn === oldest.occurredOn)
      .reduce((sum, i) => sum + Number(i.points), 0);
    return { date: addMonths(parseISO(oldest.occurredOn), rollingMonths), pts };
  }, [infractions, rollingMonths]);

  const recent = useMemo(
    () => [...infractions]
      .filter(i => i.status === 'issued' || i.status === 'excused')
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
      .slice(0, 4),
    [infractions]
  );

  if (!member || loadingStanding || !standing) return null;

  const balance = Number(standing.balance) || 0;
  const cap = Number(standing.point_cap) || 0;
  const pct = cap > 0 ? Math.min(100, (balance / cap) * 100) : 0;
  const disc = disciplineBadges[standing.discipline_level] || disciplineBadges.none;
  const barColor = pct >= 80 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="w-4 h-4" /> My Attendance
          </CardTitle>
          <Badge className={`text-[10px] border-0 ${disc.cls}`}>{disc.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-3xl leading-none">
              {balance}<span className="text-base text-muted-foreground">/{cap}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              points in the current window
              {standing.is_new_hire && ' · new-hire cap'}
            </p>
          </div>
          <div className="flex-1 max-w-[160px]">
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        {nextExpiry && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hourglass className="w-3.5 h-3.5 shrink-0" />
            <span>
              Next {nextExpiry.pts} point{nextExpiry.pts === 1 ? '' : 's'} expire{nextExpiry.pts === 1 ? 's' : ''} on{' '}
              <span className="font-medium text-foreground">{format(nextExpiry.date, 'MMM d, yyyy')}</span>
            </span>
          </div>
        )}

        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No attendance points in the current window. Nice work.</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map(inf => (
              <div key={inf.id} className="flex items-center justify-between gap-2 text-sm rounded-lg bg-muted/50 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {typeLabel(inf.infractionTypeId)}
                    {inf.highVolume && (
                      <span className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] text-orange-600 dark:text-orange-400 align-middle">
                        <Flame className="w-3 h-3" /> doubled
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{fmtDay(inf.occurredOn)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-display text-base leading-none ${inf.status === 'issued' ? '' : 'line-through text-muted-foreground'}`}>
                    {Number(inf.points)}
                  </span>
                  <Badge className={`text-[10px] border-0 ${statusBadges[inf.status] || ''}`}>{inf.status}</Badge>
                </div>
              </div>
            ))}
            {infractions.filter(i => i.status === 'issued' || i.status === 'excused').length > recent.length && (
              <p className="text-[11px] text-muted-foreground pt-0.5">
                Showing your {recent.length} most recent. Appeal recent points from "Needs Your Attention" above.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
