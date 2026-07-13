import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, HandHelping } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { useTeamMembers, useRoles, useLocations } from '@/lib/useAppData';
import { format } from 'date-fns';
import { toast } from 'sonner';

const statusColors = {
  submitted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  coverage_needed: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  converted_to_open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  covered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function Callouts() {
  const queryClient = useQueryClient();
  const { data: callouts = [] } = useQuery({
    queryKey: ['all-callouts'],
    queryFn: () => base44.entities.Callout.list('-created_date'),
    placeholderData: [],
  });
  const { data: teamMembers } = useTeamMembers();
  const { data: roles } = useRoles();
  const { data: locations } = useLocations();

  const getName = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Unknown';
  };
  const getRoleName = (id) => roles.find(r => r.id === id)?.name || '';
  const getLocName = (id) => locations.find(l => l.id === id)?.name || '';

  const convertToOpen = useMutation({
    mutationFn: (id) => base44.entities.Callout.update(id, { status: 'converted_to_open' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-callouts'] }); toast.success('Converted to open shift'); },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Callouts" subtitle={`${callouts.filter(c => c.status !== 'covered' && c.status !== 'cancelled').length} active`} />

      <div className="space-y-2">
        {callouts.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No callouts</p>}
        {callouts.map(callout => (
          <Card key={callout.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">{getName(callout.teamMemberId)}</p>
                    <p className="text-xs text-muted-foreground">
                      {getRoleName(callout.roleId)} · {getLocName(callout.locationId)}
                    </p>
                    {callout.reason && <p className="text-xs mt-1">{callout.reason}</p>}
                    {callout.submittedAt && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Submitted {format(new Date(callout.submittedAt), 'MMM d, h:mm a')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[10px] border-0 ${statusColors[callout.status]}`}>
                    {callout.status?.replace(/_/g, ' ')}
                  </Badge>
                  {(callout.status === 'submitted' || callout.status === 'coverage_needed') && (
                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => convertToOpen.mutate(callout.id)}>
                      <HandHelping className="w-3 h-3" /> Open Shift
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}