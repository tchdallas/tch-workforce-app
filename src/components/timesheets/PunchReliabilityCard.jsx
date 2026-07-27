import React from 'react';
import { usePunchReliability } from '@/lib/timesheets';
import { Progress } from '@/components/ui/progress';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// How often the clock captured both punches without a manager stepping in.
// Deliberately framed as a habit to improve, not a mark against someone —
// it feeds no discipline, and the copy says so.
export default function PunchReliabilityCard({ memberId, self = false, days = 90, className }) {
  const { data } = usePunchReliability(memberId, days);
  if (!data) return null;

  const { score, shifts, misses } = data;
  // under 5 shifts there isn't enough to say anything honest
  const tooNew = shifts < 5;
  const tone = tooNew ? 'muted' : score >= 95 ? 'good' : score >= 85 ? 'ok' : 'poor';

  return (
    <div className={cn('rounded-lg border border-border p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Clock-in reliability</span>
        </div>
        <span className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-600',
          tone === 'ok' && 'text-amber-600',
          tone === 'poor' && 'text-red-600',
          tone === 'muted' && 'text-muted-foreground'
        )}>
          {tooNew ? '—' : `${score}%`}
        </span>
      </div>

      {!tooNew && <Progress value={score} className="h-1.5 mt-2" />}

      <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
        {tooNew ? (
          `Not enough shifts yet — ${shifts} in the last ${days} days.`
        ) : misses === 0 ? (
          `Every one of your last ${shifts} shifts was punched in and out cleanly.`
        ) : (
          <>
            {self ? 'You missed ' : 'Missed '}
            <span className="text-foreground font-medium">{misses}</span>
            {` punch${misses === 1 ? '' : 'es'} across ${shifts} shifts in the last ${days} days`}
            {self && ' — a manager had to fill those in for you.'}
            {!self && '.'}
          </>
        )}
      </p>

      {!tooNew && score < 85 && (
        <p className="text-[11px] text-muted-foreground mt-1.5 italic">
          {self
            ? 'Punching in and out yourself gets you paid faster — a missed punch waits on a manager.'
            : 'Worth a coaching conversation. This affects nothing on its own.'}
        </p>
      )}
    </div>
  );
}
