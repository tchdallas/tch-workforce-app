import React, { useRef } from 'react';
import { cn, formatEndTime, isOvernight } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, MessageSquare, EyeOff, Edit2, Moon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import ShiftContextMenu from './ShiftContextMenu';

export default function ShiftCard({
  shift, role, teamMember, location, onClick, compact = false,
  selected, onCopy, onCut, onPaste, onDelete, onPublish, canPaste, readOnly,
}) {
  const roleColor = role?.color || '#6366f1';
  const isOpen = shift.shiftType === 'open';
  const isDraft = shift.status === 'draft';
  const hasCallout = shift.coverageStatus === 'callout';
  const hasCoverageNeeded = shift.coverageStatus === 'coverage_needed';
  const hasWarnings = shift.warnings?.length > 0;
  const hasNotes = shift.teamFacingNotes || shift.internalNotes;
  const isRecentChange = shift.recentChangeFlag;
  const displayName = teamMember
    ? (teamMember.preferredName || teamMember.firstName) + ' ' + (teamMember.lastName?.[0] || '') + '.'
    : 'Open Shift';

  // Track drag so we don't fire onClick after a drag
  const dragStarted = useRef(false);

  const handleDragStart = (e) => {
    dragStarted.current = true;
    e.dataTransfer.setData('shiftId', shift.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setTimeout(() => { dragStarted.current = false; }, 100);
  };

  const handleClick = (e) => {
    if (dragStarted.current) return;
    e.stopPropagation();
    onClick?.(shift, e);
  };

  const card = (
    <div
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : handleDragStart}
      onDragEnd={readOnly ? undefined : handleDragEnd}
      tabIndex={0}
      className={cn(
        "relative rounded-md border transition-all text-left w-full focus:outline-none select-none",
        !readOnly && "cursor-pointer hover:shadow-md",
        isDraft && "border-dashed opacity-80",
        hasCallout && "ring-1 ring-red-400",
        hasCoverageNeeded && "ring-1 ring-amber-400",
        selected && "ring-2 ring-primary shadow-md",
        compact ? "p-1.5" : "p-2"
      )}
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: roleColor,
        backgroundColor: selected ? `${roleColor}22` : `${roleColor}08`,
      }}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(shift); }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium truncate", compact ? "text-[10px]" : "text-xs")}>
            {displayName}
          </p>
          <p className={cn("text-muted-foreground", compact ? "text-[9px]" : "text-[11px]")}>
            {format(new Date(shift.startDateTime), 'h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isOvernight(shift.startDateTime, shift.endDateTime) && (
            <span title="Overnight shift — ends the next day">
              <Moon className="w-3 h-3 text-indigo-400" />
            </span>
          )}
          {isDraft && <EyeOff className="w-3 h-3 text-muted-foreground" />}
          {hasWarnings && <AlertTriangle className="w-3 h-3 text-amber-500" />}
          {hasCallout && <Badge className="text-[8px] px-1 py-0 bg-red-500 text-white">CALLOUT</Badge>}
          {isRecentChange && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Edit2 className="w-3 h-3 text-amber-500 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Modified since published</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {hasNotes && <MessageSquare className="w-3 h-3 text-muted-foreground" />}
        </div>
      </div>
      {isOpen && !compact && (
        <Badge className="mt-1 text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
          OPEN
        </Badge>
      )}
    </div>
  );

  if (!readOnly && onCopy && onCut && onDelete) {
    return (
      <ShiftContextMenu
        shift={shift}
        onEdit={onClick}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDelete={onDelete}
        onPublish={onPublish}
        canPaste={canPaste}
      >
        {card}
      </ShiftContextMenu>
    );
  }

  return card;
}