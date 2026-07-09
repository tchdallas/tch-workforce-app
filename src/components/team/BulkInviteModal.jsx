import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Mail, CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function BulkInviteModal({ open, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [inviting, setInviting] = useState(false);
  const [results, setResults] = useState(null);

  // same key as the roster REQUIRES the same fetch (filtered, no archived) —
  // a different queryFn under a shared key silently overwrites the cache
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.filter(
      { status: { $in: ['active', 'invited', 'inactive'] } }, 'firstName'
    ),
    placeholderData: [],
  });

  // Members who haven't accepted or were never sent an invite
  const uninvited = teamMembers.filter(tm =>
    tm.status === 'active' || tm.status === 'inactive' || tm.status === 'invited'
  ).filter(tm => tm.email);

  const toggleAll = () => {
    if (selected.size === uninvited.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(uninvited.map(tm => tm.id)));
    }
  };

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleInvite = async () => {
    const toInvite = uninvited.filter(tm => selected.has(tm.id));
    if (!toInvite.length) return;
    setInviting(true);
    const succeeded = [];
    const failed = [];

    for (const tm of toInvite) {
      try {
        await base44.users.inviteUser(tm.email, 'user');
        succeeded.push(tm);
      } catch (err) {
        failed.push({ tm, reason: err.message || 'Unknown error' });
      }
    }

    setResults({ succeeded, failed });
    setInviting(false);
    if (succeeded.length > 0) {
      toast.success(`Sent ${succeeded.length} invite${succeeded.length > 1 ? 's' : ''}`);
    }
  };

  const handleClose = () => {
    setSelected(new Set());
    setResults(null);
    onClose();
  };

  const statusColor = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    invited: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Members</DialogTitle>
        </DialogHeader>

        {!results ? (
          <>
            <p className="text-sm text-muted-foreground">
              Select team members to send (or resend) an app invite to.
            </p>

            {uninvited.length === 0 ? (
              <p className="text-sm text-center text-muted-foreground py-6 italic">
                All team members have been invited.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-primary underline underline-offset-2 flex items-center gap-1"
                  >
                    <CheckCheck className="w-3 h-3" />
                    {selected.size === uninvited.length ? 'Deselect all' : 'Select all'}
                  </button>
                  <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1 border rounded-lg divide-y">
                  {uninvited.map(tm => (
                    <label
                      key={tm.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <Checkbox
                        checked={selected.has(tm.id)}
                        onCheckedChange={() => toggle(tm.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tm.preferredName || tm.firstName} {tm.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{tm.email}</p>
                      </div>
                      <Badge className={`text-[9px] border-0 shrink-0 ${statusColor[tm.status] || ''}`}>
                        {tm.status}
                      </Badge>
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <Mail className="w-4 h-4" />
              <span>{results.succeeded.length} invite{results.succeeded.length !== 1 ? 's' : ''} sent successfully</span>
            </div>
            {results.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-red-500">{results.failed.length} failed:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {results.failed.map((f, i) => (
                    <div key={i} className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded px-2 py-1">
                      <span className="font-medium">{f.tm.preferredName || f.tm.firstName} {f.tm.lastName}</span>: {f.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {results ? 'Close' : 'Cancel'}
          </Button>
          {!results && uninvited.length > 0 && (
            <Button
              onClick={handleInvite}
              disabled={selected.size === 0 || inviting}
            >
              {inviting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : (
                <><Mail className="w-4 h-4" /> Send {selected.size > 0 ? `${selected.size} ` : ''}Invite{selected.size !== 1 ? 's' : ''}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}