import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import {
  usePolicy, usePolicyDocuments, usePolicyUpdates, useMyPolicyAcks,
  usePolicyAckStatus, usePolicyUpdateAckStatus,
  acknowledgePolicy, acknowledgePolicyUpdate, policyDocumentUrl, archivePolicy,
  usePolicyCategories,
} from '@/lib/policies';
import PageHeader from '@/components/common/PageHeader';
import PolicyThread from '@/components/policies/PolicyThread';
import PolicyEditorDialog from '@/components/policies/PolicyEditorDialog';
import PolicyUpdateDialog, { UPDATE_KINDS } from '@/components/policies/PolicyUpdateDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ScrollText, FileText, Check, Pencil, Megaphone, ChevronDown,
  CheckCircle2, Circle, Archive, ArrowLeft,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function PolicyDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { member, isManager, isAdmin } = useCurrentMember();
  const { data: policy, isFetched } = usePolicy(id);
  const { data: docs = [] } = usePolicyDocuments(id);
  const { data: updates = [] } = usePolicyUpdates(id);
  const { data: acks } = useMyPolicyAcks(id, member?.id);
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = usePolicyCategories();
  const [editorOpen, setEditorOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const roleName = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r.name])), [roles]);
  const locationName = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l.name])), [locations]);

  if (isFetched && !policy) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 text-muted-foreground">
        <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">This policy isn't available to you.</p>
        <Link to="/policies" className="text-sm text-primary underline mt-3 inline-block">Back to policies</Link>
      </div>
    );
  }
  if (!policy) return null;

  // strict: useCurrentMember's isManager is optimistically true while the member
  // row loads, which would flash Edit/Post-update at a dealer before it resolves
  const canManage = !!member && isManager;
  const needsPolicyAck = acks?.policyRequired && !acks?.policyAcknowledgedAt;

  const ackPolicy = async () => {
    try {
      await acknowledgePolicy(id, member.id);
      qc.invalidateQueries({ queryKey: ['policy-my-acks', id, member.id] });
      qc.invalidateQueries({ queryKey: ['policy-acks-outstanding', member.id] });
      toast.success('Confirmed');
    } catch (e) { toast.error(e.message || 'Could not confirm'); }
  };

  const openDoc = async (doc) => {
    try {
      const url = await policyDocumentUrl(doc.storage_path);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error(e.message || 'Could not open that file'); }
  };

  const archive = async () => {
    try {
      await archivePolicy(id);
      qc.invalidateQueries({ queryKey: ['policies'] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
      toast.success('Policy archived');
    } catch (e) { toast.error(e.message || 'Could not archive'); }
  };

  const unackedUpdates = updates.filter(
    u => u.published_at && u.requires_acknowledgment && acks?.updates?.[u.id] === null
  ).length;

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/policies" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Policies
      </Link>

      <PageHeader
        title={policy.title}
        subtitle={[
          (policy.categoryIds || [])
            .map(id => categories.find(c => c.id === id)?.name)
            .filter(Boolean).join(', '),
          audienceLine(policy, roleName, locationName),
        ].filter(Boolean).join(' · ')}
      >
        {canManage && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditorOpen(true)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
            {policy.status === 'published' && (
              <Button size="sm" className="gap-1.5" onClick={() => setUpdateOpen(true)}>
                <Megaphone className="w-3.5 h-3.5" /> Post update
              </Button>
            )}
          </div>
        )}
      </PageHeader>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {policy.status === 'draft' && <Badge variant="secondary">Draft — not visible to the team yet</Badge>}
        {policy.status === 'archived' && <Badge variant="outline">Archived</Badge>}
        {policy.published_at && (
          <span className="text-[11px] text-muted-foreground">
            Published {format(new Date(policy.published_at), 'MMM d, yyyy')}
          </span>
        )}
      </div>

      {needsPolicyAck && (
        <Card className="p-3 mb-3 border-primary/60 ring-1 ring-primary/20">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-medium">You haven't confirmed you've read this policy.</p>
            <Button size="sm" className="gap-1.5" onClick={ackPolicy}>
              <Check className="w-4 h-4" /> Confirm
            </Button>
          </div>
        </Card>
      )}
      {acks?.policyAcknowledgedAt && (
        <p className="text-[11px] text-emerald-600 mb-3 flex items-center gap-1">
          <Check className="w-3 h-3" /> You confirmed this on {format(new Date(acks.policyAcknowledgedAt), 'MMM d, yyyy')}
        </p>
      )}

      <Tabs defaultValue="policy">
        <TabsList>
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="updates">
            Updates
            {unackedUpdates > 0 && <Badge className="ml-1.5 text-[10px]">{unackedUpdates}</Badge>}
            {unackedUpdates === 0 && updates.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{updates.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="discussion">Discussion</TabsTrigger>
        </TabsList>

        <TabsContent value="policy" className="mt-3 space-y-3">
          {policy.body ? (
            <Card className="p-4">
              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{policy.body}</p>
            </Card>
          ) : (
            !docs.length && <p className="text-sm text-muted-foreground py-6 text-center">Nothing written here yet.</p>
          )}

          {docs.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">Documents</h3>
              {docs.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => openDoc(d)}
                  className="w-full flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                >
                  <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{d.file_name}</span>
                  {d.file_size != null && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{prettySize(d.file_size)}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {canManage && policy.requires_acknowledgment && <PolicyAckPanel policyId={id} />}

          {isAdmin && policy.status !== 'archived' && (
            <div className="pt-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-muted-foreground" onClick={archive}>
                <Archive className="w-3.5 h-3.5" /> Archive this policy
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="updates" className="mt-3 space-y-3">
          {updates.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Megaphone className="w-7 h-7 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No updates yet. The policy stands as written.</p>
            </div>
          )}
          {updates.map(u => (
            <UpdateCard
              key={u.id}
              u={u}
              policyId={id}
              memberId={member?.id}
              myAckAt={acks?.updates?.[u.id]}
              isRecipient={acks?.updates ? Object.prototype.hasOwnProperty.call(acks.updates, u.id) : false}
              isManager={canManage}
            />
          ))}
        </TabsContent>

        <TabsContent value="discussion" className="mt-3">
          <PolicyThread policyId={id} canModerate={canManage} />
        </TabsContent>
      </Tabs>

      <PolicyEditorDialog open={editorOpen} onClose={() => setEditorOpen(false)} policy={policy} />
      <PolicyUpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} policyId={id} />
    </div>
  );
}

function UpdateCard({ u, policyId, memberId, myAckAt, isRecipient, isManager }) {
  const qc = useQueryClient();
  const kind = UPDATE_KINDS.find(k => k.value === u.kind);
  const needsAck = isRecipient && u.requires_acknowledgment && !myAckAt;

  const ack = async () => {
    try {
      await acknowledgePolicyUpdate(u.id, memberId);
      qc.invalidateQueries({ queryKey: ['policy-my-acks', policyId, memberId] });
      qc.invalidateQueries({ queryKey: ['policy-acks-outstanding', memberId] });
      toast.success('Confirmed');
    } catch (e) { toast.error(e.message || 'Could not confirm'); }
  };

  return (
    <Card className={cn('p-4', needsAck && 'border-primary/60 ring-1 ring-primary/20')}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{kind?.label || u.kind}</Badge>
            <h3 className="font-semibold text-sm">{u.title}</h3>
            {!u.published_at && <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {u.author_name || 'A manager'}
            {u.published_at && ` · ${formatDistanceToNow(new Date(u.published_at), { addSuffix: true })}`}
          </p>
        </div>
        {u.requires_acknowledgment && (
          myAckAt
            ? <Badge variant="outline" className="gap-1 shrink-0 text-emerald-600 border-emerald-200"><Check className="w-3 h-3" /> Confirmed</Badge>
            : isRecipient ? <Badge className="shrink-0">Action needed</Badge> : null
        )}
      </div>

      <p className="text-sm mt-2 whitespace-pre-wrap break-words leading-relaxed">{u.body}</p>

      {needsAck && (
        <Button size="sm" className="mt-3 gap-1.5" onClick={ack}>
          <Check className="w-4 h-4" /> Confirm you've read this
        </Button>
      )}

      {isManager && u.requires_acknowledgment && <UpdateAckPanel updateId={u.id} />}
    </Card>
  );
}

function PolicyAckPanel({ policyId }) {
  const [open, setOpen] = useState(false);
  const { data: stats } = usePolicyAckStatus(open ? policyId : null);
  return <AckRoster open={open} setOpen={setOpen} stats={stats} label="policy" />;
}

function UpdateAckPanel({ updateId }) {
  const [open, setOpen] = useState(false);
  const { data: stats } = usePolicyUpdateAckStatus(open ? updateId : null);
  return <AckRoster open={open} setOpen={setOpen} stats={stats} label="update" />;
}

function AckRoster({ open, setOpen, stats, label }) {
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        {stats ? `${stats.acknowledged} of ${stats.total} acknowledged` : `Who's read this ${label}`}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {stats && (
          <>
            <Progress value={stats.total ? (stats.acknowledged / stats.total) * 100 : 0} className="h-1.5 mb-3" />
            <div className="max-h-56 overflow-y-auto space-y-1">
              {stats.rows.map(r => (
                <div key={r.team_member_id} className="flex items-center gap-2 text-sm">
                  {r.acknowledged_at
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    : <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
                  <span className={cn(!r.acknowledged_at && 'text-muted-foreground')}>{r.name}</span>
                  {r.acknowledged_at && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {format(new Date(r.acknowledged_at), 'MMM d, h:mm a')}
                    </span>
                  )}
                </div>
              ))}
              {stats.rows.length === 0 && (
                <p className="text-xs text-muted-foreground">Nobody was required to acknowledge this.</p>
              )}
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function audienceLine(p, roleName, locationName) {
  const names = (ids, lookup) => {
    const list = (ids || []).map(id => lookup[id]).filter(Boolean);
    if (!list.length) return null;
    if (list.length <= 3) return list.join(', ');
    return `${list.slice(0, 3).join(', ')} +${list.length - 3}`;
  };
  const r = names(p.roleIds, roleName);
  const l = names(p.locationIds, locationName);
  return [r, l].filter(Boolean).join(' · ');
}

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
