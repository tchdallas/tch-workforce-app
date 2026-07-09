import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, addDays, subDays } from 'date-fns';

export default function WeekSelector({ weekStart, setWeekStart, spanDays = 7 }) {
  const weekEnd = addDays(weekStart, spanDays - 1);

  const prev = () => setWeekStart(subDays(weekStart, spanDays));
  const next = () => setWeekStart(addDays(weekStart, spanDays));
  const today = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));

  const label = spanDays === 1
    ? format(weekStart, 'MMM d, yyyy')
    : `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={prev}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-xs font-medium min-w-[160px]"
        onClick={today}
      >
        {label}
      </Button>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={next}>
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}