import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const statusColors = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  denied: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function TimeOffForm({ memberId }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ startDateTime: '', endDateTime: '', reason: '', note: '' });

  const { data: requests = [] } = useQuery({
    queryKey: ['my-timeoff', memberId],
    queryFn: () => base44.entities.TimeOffRequest.filter({ teamMemberId: memberId }, '-created_date'),
    enabled: !!memberId,
    placeholderData: [],
  });

  const submitMutation = useMutation({
    mutationFn: (data) => base44.entities.TimeOffRequest.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-timeoff', memberId] });
      toast.success('Time off request submitted');
      setShowForm(false);
      setForm({ startDateTime: '', endDateTime: '', reason: '', note: '' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.TimeOffRequest.update(id, { status: 'cancelled' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-timeoff', memberId] }),
  });

  const handleSubmit = () => {
    if (!form.startDateTime || !form.endDateTime) return toast.error('Please select dates');
    submitMutation.mutate({
      teamMemberId: memberId,
      startDateTime: new Date(form.startDateTime).toISOString(),
      endDateTime: new Date(form.endDateTime).toISOString(),
      isFullDay: true,
      reason: form.reason,
      note: form.note,
      status: 'pending',
    });
  };

  return (
    <div className="space-y-3">
      {!showForm && (
        <Button size="sm" className="w-full gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> New Time Off Request
        </Button>
      )}

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">New Time Off Request</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={form.startDateTime} onChange={e => setForm(f => ({ ...f, startDateTime: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={form.endDateTime} onChange={e => setForm(f => ({ ...f, endDateTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Vacation, personal, etc." />
            </div>
            <div>
              <Label className="text-xs">Additional Note</Label>
              <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Optional details" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {requests.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No time off requests yet</p>
        )}
        {requests.map(req => (
          <Card key={req.id}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {format(new Date(req.startDateTime), 'MMM d')} – {format(new Date(req.endDateTime), 'MMM d, yyyy')}
                </p>
                {req.reason && <p className="text-xs text-muted-foreground truncate">{req.reason}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={cn("text-[10px] border-0", statusColors[req.status])}>{req.status}</Badge>
                {req.status === 'pending' && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => cancelMutation.mutate(req.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}