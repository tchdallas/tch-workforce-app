import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import PageHeader from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bug, ChevronDown, Copy, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUSES = {
  new: { label: 'New', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  investigating: { label: 'Investigating', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  not_a_bug: { label: 'Not a bug', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};
const SEV = {
  high: { label: 'Blocking', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  medium: { label: 'Normal', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  low: { label: 'Minor', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function BugCard({ bug, name, memberId }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(bug.adminNotes || '');
  const [shotUrl, setShotUrl] = useState(null);

  const expand = async () => {
    const next = !open;
    setOpen(next);
    if (next && bug.screenshotPath && !shotUrl) {
      const { data } = await supabase.storage.from('bug-screenshots').createSignedUrl(bug.screenshotPath, 3600);
      if (data?.signedUrl) setShotUrl(data.signedUrl);
    }
  };

  const update = useMutation({
    mutationFn: (patch) => base44.entities.BugReport.update(bug.id, patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bug-reports'] }); toast.success('Updated'); },
    onError: (e) => toast.error(e?.message || 'Could not update'),
  });

  const setStatus = (status) => {
    const patch = { status };
    if (status === 'resolved' || status === 'not_a_bug') {
      patch.resolvedBy = memberId;
      patch.resolvedAt = new Date().toISOString();
    }
    update.mutate(patch);
  };

  const copyForDev = () => {
    const errs = (bug.consoleLog || []).map((e) => `  [${e.level}] ${e.msg}`).join('\n') || '  (none)';
    const text =
`BUG REPORT — ${bug.id}
Reported by: ${name} (${bug.reporterId || 'unknown'})
When: ${bug.created_date ? format(new Date(bug.created_date), 'PPpp') : ''}
Page: ${bug.route}
Severity: ${bug.severity}
App version: ${bug.appVersion}
Device: ${bug.viewport} · ${bug.userAgent}

What went wrong:
${bug.description}

What they were doing:
${bug.steps || '(not provided)'}

Expected:
${bug.expected || '(not provided)'}

Recent console errors:
${errs}`;
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied — paste it to your developer'),
      () => toast.error('Could not copy')
    );
  };

  const st = STATUSES[bug.status] || STATUSES.new;
  const sev = SEV[bug.severity] || SEV.medium;

  return (
    <Card>
      <CardContent className="p-0">
        <button type="button" onClick={expand} className="w-full text-left p-4 flex items-start gap-3">
          <Bug className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn('text-[10px] border-0', sev.cls)}>{sev.label}</Badge>
              <Badge className={cn('text-[10px] border-0', st.cls)}>{st.label}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{bug.route}</span>
            </div>
            <p className="text-sm font-medium mt-1 truncate">{bug.description}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {name} · {bug.created_date ? format(new Date(bug.created_date), 'MMM d, h:mm a') : ''}
              {bug.screenshotPath && <> · <ImageIcon className="w-3 h-3 inline -mt-0.5" /> screenshot</>}
            </p>
          </div>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Detail label="What went wrong">{bug.description}</Detail>
              <Detail label="What they were doing">{bug.steps || '—'}</Detail>
              <Detail label="Expected">{bug.expected || '—'}</Detail>
              <Detail label="Device">{bug.viewport} · <span className="break-all text-xs">{bug.userAgent}</span></Detail>
            </div>

            {bug.screenshotPath && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Screenshot</p>
                {shotUrl ? (
                  <a href={shotUrl} target="_blank" rel="noreferrer" className="block">
                    <img src={shotUrl} alt="Bug screenshot" className="rounded-lg border border-border max-h-72 object-contain bg-muted/30" />
                  </a>
                ) : <p className="text-xs text-muted-foreground">Loading…</p>}
              </div>
            )}

            {(bug.consoleLog || []).length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Recent console errors ({bug.consoleLog.length})</p>
                <div className="rounded-md bg-muted/40 border border-border p-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-1">
                  {bug.consoleLog.map((e, i) => (
                    <div key={i} className={e.level === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>
                      <span className="opacity-60">[{e.level}]</span> {e.msg}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end pt-1">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Triage notes</p>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  placeholder="Notes for the team…" />
              </div>
              <div className="flex flex-col gap-2 sm:w-[160px]">
                <Select value={bug.status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUSES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => update.mutate({ adminNotes: notes })}>Save notes</Button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={copyForDev}>
                <Copy className="w-3.5 h-3.5" /> Copy details for developer
              </Button>
              <a href={bug.route} className="inline-flex">
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
                  <ExternalLink className="w-3.5 h-3.5" /> Go to page
                </Button>
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}

export default function BugReports() {
  const { data: teamMembers = [] } = useTeamMembers();
  const { member } = useCurrentMember();
  const [filter, setFilter] = useState('open');

  const { data: bugs = [], isLoading } = useQuery({
    queryKey: ['bug-reports'],
    queryFn: () => base44.entities.BugReport.list('-created_date'),
    placeholderData: [],
  });

  const nameFor = (id) => {
    const tm = teamMembers.find((t) => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Unknown';
  };

  const shown = bugs.filter((b) => {
    if (filter === 'all') return true;
    if (filter === 'open') return b.status === 'new' || b.status === 'investigating';
    return b.status === filter;
  });
  const openCount = bugs.filter((b) => b.status === 'new' || b.status === 'investigating').length;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Bug Reports" subtitle={`${openCount} open · ${bugs.length} total`} />

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['open', 'Open'], ['new', 'New'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['not_a_bug', 'Not a bug'], ['all', 'All']].map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? 'default' : 'outline'} onClick={() => setFilter(v)} className="text-xs h-8">
            {l}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">No reports here. 🎉</p>
      ) : (
        <div className="space-y-2">
          {shown.map((b) => <BugCard key={b.id} bug={b} name={nameFor(b.reporterId)} memberId={member?.id} />)}
        </div>
      )}
    </div>
  );
}
