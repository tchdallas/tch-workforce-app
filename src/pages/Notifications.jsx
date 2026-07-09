import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Check, CheckCheck } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['all-notifications'],
    queryFn: () => base44.entities.Notification.list('-created_date', 100),
    placeholderData: [],
  });

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { readStatus: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.readStatus);
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { readStatus: true })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-notifications'] }); toast.success('All marked as read'); },
  });

  const unreadCount = notifications.filter(n => !n.readStatus).length;

  const typeColors = {
    alert: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Notifications" subtitle={`${unreadCount} unread`}>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => markAllRead.mutate()}>
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </Button>
        )}
      </PageHeader>

      <div className="space-y-2">
        {notifications.length === 0 && (
          <div className="text-center py-16">
            <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
          </div>
        )}
        {notifications.map(n => (
          <Card key={n.id} className={cn('transition-colors', !n.readStatus && 'bg-primary/5 border-primary/20')}>
            <CardContent className="p-4 flex items-start gap-3">
              {!n.readStatus && <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
              {n.readStatus && <div className="w-2 h-2 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {n.type && (
                      <Badge className={`text-[9px] border-0 ${typeColors[n.type] || typeColors.info}`}>{n.type}</Badge>
                    )}
                    {!n.readStatus && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => markRead.mutate(n.id)}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                {n.created_date && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {format(new Date(n.created_date), 'MMM d, h:mm a')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}