import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, differenceInMinutes } from 'date-fns';
import { Clock, AlertTriangle, ArrowRightLeft, MessageSquare, FileText } from 'lucide-react';

const statusConfig = {
  on_shift: { label: 'On Shift', color: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-400' },
  coming_soon: { label: 'Coming In', color: 'bg-blue-500', textColor: 'text-blue-700 dark:text-blue-400' },
  leaving_soon: { label: 'Leaving Soon', color: 'bg-amber-500', textColor: 'text-amber-700 dark:text-amber-400' },
  callout: { label: 'Called Out', color: 'bg-red-500', textColor: 'text-red-700 dark:text-red-400' },
  coverage_needed: { label: 'Coverage Needed', color: 'bg-red-400', textColor: 'text-red-600 dark:text-red-400' },
  open: { label: 'Open Shift', color: 'bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400' },
  swapped: { label: 'Recent Change', color: 'bg-yellow-500', textColor: 'text-yellow-700 dark:text-yellow-400' },
};

function NotePreview({ teamFacingNotes, internalNotes }) {
  const hasNotes = teamFacingNotes || internalNotes;
  if (!hasNotes) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded hover:bg-muted/60 transition-colors shrink-0"
          onClick={e => e.stopPropagation()}
          title="View notes"
        >
          <FileText className="w-3.5 h-3.5 text-violet-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-3 space-y-2 text-xs" onClick={e => e.stopPropagation()}>
        {teamFacingNotes && (
          <div>
            <p className="font-semibold text-muted-foreground mb-0.5 uppercase tracking-wide text-[10px]">Team Note</p>
            <p className="text-foreground leading-relaxed">{teamFacingNotes}</p>
          </div>
        )}
        {internalNotes && (
          <div>
            <p className="font-semibold text-muted-foreground mb-0.5 uppercase tracking-wide text-[10px]">Internal Note</p>
            <p className="text-foreground leading-relaxed">{internalNotes}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function RoadmapCard({ shift, teamMember, role, location, status, onClick }) {
  const now = new Date();
  const start = new Date(shift.startDateTime);
  const end = new Date(shift.endDateTime);
  const config = statusConfig[status] || statusConfig.on_shift;

  // A shift with an assignee whose name we couldn't resolve (RLS hid the row and
  // it wasn't in the directory) still reads as filled — never mislabel it "Open Shift".
  const displayName = teamMember
    ? (teamMember.preferredName || teamMember.firstName) + ' ' + teamMember.lastName
    : shift.teamMemberId ? 'Scheduled' : 'Open Shift';

  const timeInfo = () => {
    if (status === 'coming_soon') {
      const mins = differenceInMinutes(start, now);
      if (mins < 60) return `In ${mins}m`;
      return `In ${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    if (status === 'leaving_soon') {
      const mins = differenceInMinutes(end, now);
      if (mins < 60) return `${mins}m left`;
      return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
    }
    return null;
  };

  const roleColor = role?.color || '#6366f1';
  const hasNotes = shift.teamFacingNotes || shift.internalNotes;

  return (
    <Card
      className={cn(
        "p-3 cursor-pointer hover:shadow-md transition-all border-l-[3px]",
        status === 'callout' && "bg-red-50/50 dark:bg-red-950/10",
        status === 'coverage_needed' && "bg-amber-50/50 dark:bg-amber-950/10",
      )}
      style={{ borderLeftColor: roleColor }}
      onClick={() => onClick?.(shift)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{displayName}</p>
            {shift.recentChangeFlag && <ArrowRightLeft className="w-3 h-3 text-amber-500 shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{role?.name || 'Unknown Role'}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1">
            {hasNotes && (
              <NotePreview
                teamFacingNotes={shift.teamFacingNotes}
                internalNotes={shift.internalNotes}
              />
            )}
            <Badge className={cn("text-[10px] px-1.5 py-0.5", config.color, "text-white border-0")}>
              {config.label}
            </Badge>
          </div>
          {timeInfo() && (
            <span className={cn("text-[10px] font-medium", config.textColor)}>{timeInfo()}</span>
          )}
        </div>
      </div>
      {status === 'callout' && (
        <div className="mt-2 flex items-center gap-1.5 p-1.5 rounded bg-red-100 dark:bg-red-950/30">
          <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
          <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">Coverage needed for this shift</p>
        </div>
      )}
    </Card>
  );
}