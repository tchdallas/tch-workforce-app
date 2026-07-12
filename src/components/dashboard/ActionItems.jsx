import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { format, parseISO, addDays, isBefore, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { PenLine, Scale, CheckCircle2, ArrowRight } from 'lucide-react';
import { entryTypeLabel } from '@/components/discipline/disciplineShared';

// "Needs Your Attention" — the team member's task inbox on the Dashboard.
// Every actionable thing lands here. Current sources:
//   * discipline documents awaiting the member's signature
//   * attendance points still inside the appeal window (appeal right here)
// Future sources plug in as more list items: announcements requiring
// acknowledgment, policy-update confirmations, training tasks, surveys.
export default function ActionItems({ showEmpty = false }) {
  const { member } = useCurrentMember();
  const queryClient = useQueryClient();

  const { data: pendingDocs = [] } = useQuery({
    queryKey: ['my-discipline-docs', member?.id, 'pending'],
    queryFn: () => base44.entities.DisciplineDocument.filter({ teamMemberId: member.id, status: 'issued' }),
    enabled: !!member?.id,
    placeholderData: [],
  });

  const { data: settingsRows = [] } = useQuery({
    queryKey: ['attendance-policy-settings'],
    queryFn: () => base44.entities.AttendancePolicySettings.list(),
    enabled: !!member?.id,
    placeholderData: [],
  });
  const appealWindow = Number(settingsRows[0]?.appealWindowDays ?? 3);

  const { data: myInfractions = [] } = useQuery({
    queryKey: ['my-infractions', member?.id],
    queryFn: () => base44.entities.AttendanceInfraction.filter({
      teamMemberId: member.id, status: 'issued', appealStatus: 'none',
    }),
    enabled: !!member?.id,
    placeholderData: [],
  });

  const { data: types = [] } = useQuery({
    queryKey: ['attendance-types'],
    queryFn: () => base44.entities.AttendanceInfractionType.list('display_order'),
    enabled: myInfractions.length > 0,
    placeholderData: [],
  });

  // points still inside the appeal window
  const appealable = useMemo(() => {
    const today = startOfDay(new Date());
    return myInfractions.filter(inf => {
      const deadline = addDays(parseISO(inf.occurredOn), appealWindow);
      return !isBefore(deadline, today);
    });
  }, [myInfractions, appealWindow]);

  const [appealing, setAppealing] = useState(null); // infraction object
  const [appealNote, setAppealNote] = useState('');

  const appealMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('attendance_file_appeal', {
        p_infraction_id: appealing.id, p_note: appealNote.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-infractions'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-appeals'] });
      setAppealing(null); setAppealNote('');
      toast.success('Appeal filed — an admin will review it');
    },
    onError: (e) => toast.error(e.message),
  });

  const typeLabel = (id) => types.find(t => t.id === id)?.label || 'Attendance infraction';
  const itemCount = pendingDocs.length + appealable.length;

  if (!member || (itemCount === 0 && !showEmpty)) return null;

  return (
    <Card className={itemCount > 0 ? 'border-primary/40 mb-4' : 'mb-4'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Needs Your Attention</CardTitle>
          {itemCount > 0 && (
            <Badge className="bg-primary text-primary-foreground">{itemCount}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {itemCount === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> You're all caught up.
          </p>
        ) : (
          <div className="space-y-2">
            {pendingDocs.map(d => (
              <Link key={d.id} to="/my-profile?tab=documents"
                    className="flex items-center gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700 hover:bg-accent/40 transition-colors">
                <PenLine className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Document requires your signature</p>
                  <p className="text-xs text-muted-foreground">
                    {entryTypeLabel(d.entryType)} · issued {d.issuedAt ? format(new Date(d.issuedAt), 'MMM d') : ''}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </Link>
            ))}

            {appealable.map(inf => {
              const deadline = addDays(parseISO(inf.occurredOn), appealWindow);
              return (
                <div key={inf.id}
                     className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/40 transition-colors">
                  <Scale className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {Number(inf.points)} attendance point{Number(inf.points) === 1 ? '' : 's'} issued
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {typeLabel(inf.infractionTypeId)} · {format(parseISO(inf.occurredOn), 'MMM d')} —
                      you may appeal until {format(deadline, 'MMM d')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="text-xs shrink-0"
                          onClick={() => { setAppealing(inf); setAppealNote(''); }}>
                    Appeal…
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {appealing && (
        <Dialog open onOpenChange={(o) => { if (!o) setAppealing(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl tracking-wide">Appeal Attendance Points</DialogTitle>
              <DialogDescription>
                {typeLabel(appealing.infractionTypeId)} · {format(parseISO(appealing.occurredOn), 'MMM d, yyyy')} ·{' '}
                {Number(appealing.points)} point{Number(appealing.points) === 1 ? '' : 's'}. An admin will review your
                appeal; documentation for excused absences (doctor's note, court date, etc.) must be provided within{' '}
                {appealWindow} days.
              </DialogDescription>
            </DialogHeader>
            <Textarea rows={3} placeholder="Why should these points be removed?"
                      value={appealNote} onChange={e => setAppealNote(e.target.value)} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAppealing(null)}>Cancel</Button>
              <Button disabled={!appealNote.trim() || appealMutation.isPending}
                      onClick={() => appealMutation.mutate()}>
                File Appeal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
