import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, HandHelping, UserPlus, Check } from 'lucide-react';

// Warns that a paste/duplicate would double-book a team member, and offers ways
// out: make it an open shift, assign someone else, or override on purpose.
export default function PasteConflictDialog({ open, onClose, info = [], single, onCreateOpen, onAssignOther, onScheduleAnyway }) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-500" /> Scheduling conflict
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {single
              ? 'This would double-book the same person for an overlapping time:'
              : 'This would double-book some team members for overlapping times:'}
          </p>
          <div className="space-y-2">
            {info.map((c, i) => (
              <div key={i} className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 p-3">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Already scheduled {c.when}{c.roleName ? ` · ${c.roleName}` : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">How do you want to handle it?</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch sm:space-x-0">
          <Button onClick={onCreateOpen} className="w-full justify-start gap-2">
            <HandHelping className="w-4 h-4" /> Create an open shift instead
          </Button>
          {single && (
            <Button variant="outline" onClick={onAssignOther} className="w-full justify-start gap-2">
              <UserPlus className="w-4 h-4" /> Assign someone else…
            </Button>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button variant="ghost" onClick={onScheduleAnyway} className="flex-1 text-amber-600 hover:text-amber-700 dark:text-amber-400">
              <Check className="w-4 h-4 mr-1" /> Schedule anyway
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
