import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Activity } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { format } from 'date-fns';

export default function AuditLog() {
  const [search, setSearch] = useState('');

  const { data: logs = [] } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => base44.entities.AuditLog.list('-created_date', 200),
    placeholderData: [],
  });

  const actionColors = {
    create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    delete: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    approve: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    deny: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    publish: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  };

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.actorName?.toLowerCase().includes(q) ||
      l.action?.toLowerCase().includes(q) ||
      l.entityType?.toLowerCase().includes(q) ||
      l.details?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Audit Log" subtitle={`${logs.length} events`} />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by actor, action, or entity…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">No audit events found</p>
          </div>
        )}
        {filtered.map(log => (
          <Card key={log.id}>
            <CardContent className="p-3 flex items-start gap-3">
              <Badge className={`text-[10px] border-0 mt-0.5 shrink-0 ${actionColors[log.action?.toLowerCase()] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                {log.action}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{log.actorName || log.actorId}</span>
                  {' · '}
                  <span className="text-muted-foreground">{log.entityType}</span>
                  {log.entityId && <span className="text-muted-foreground"> #{log.entityId.slice(0, 8)}</span>}
                </p>
                {log.details && <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p>}
              </div>
              {log.created_date && (
                <p className="text-[10px] text-muted-foreground shrink-0">
                  {format(new Date(log.created_date), 'MMM d, h:mm a')}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}