import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateNavBadges } from '@/hooks/useNavBadges';
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

  // This page reads ['all-notifications'] (everything, read or not) while the
  // bell and hamburger count ['notifications', memberId] (unread only) — two
  // different fetches, so they must be separate keys. Marking read here used to
  // invalidate only this page's key, which is why the page could say "0 unread"
  // while the badges still showed 3 until a full reload.
  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { readStatus: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-notifications'] });
      invalidateNavBadges(queryClient);
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.readStatus);
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { readStatus: true })));
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['all-notifications'] });
      invalidateNavBadges(queryClient);
      // the auto-mark on arrival passes silent — a toast for something the user
      // didn't ask for is just noise
      if (!variables?.silent) toast.success('All marked as read');
    },
  });

  // Opening this page IS attending to them, so the bubble clears on arrival
  // rather than making you tap each one. The ids that were unread when you
  // opened are remembered for this visit, so you can still see what's new
  // after they've been marked read underneath.
  const [unreadOnArrival, setUnreadOnArrival] = useState(() => new Set());
  const autoMarked = useRef(false);
  useEffect(() => {
    if (autoMarked.current) return;
    const unread = notifications.filter(n => !n.readStatus);
    if (!unread.length) return;
    autoMarked.current = true;
    setUnreadOnArrival(new Set(unread.map(n => n.id)));
    markAllRead.mutate({ silent: true });
  }, [notifications]); // eslint-disable-line react-hooks/exhaustive-deps

  const isNew = (n) => !n.readStatus || unreadOnArrival.has(n.id);
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
          <Card key={n.id} className={cn('transition-colors', isNew(n) && 'bg-primary/5 border-primary/20')}>
            <CardContent className="p-4 flex items-start gap-3">
              {isNew(n) ? <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" /> : <div className="w-2 h-2 shrink-0" />}
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