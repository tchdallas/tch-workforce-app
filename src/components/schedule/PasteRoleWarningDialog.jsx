import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function PasteRoleWarningDialog({ open, onClose, missingRoles, targetName, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Role Mismatch
          </DialogTitle>
          <DialogDescription>
            <strong>{targetName}</strong> is not assigned to the following role(s) required by the copied shift(s):
          </DialogDescription>
        </DialogHeader>
        <ul className="ml-4 list-disc text-sm text-foreground space-y-1">
          {missingRoles.map(r => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">Do you want to paste anyway?</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Paste Anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}