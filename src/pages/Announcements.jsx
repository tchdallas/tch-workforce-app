import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import {
  useMyAnnouncements, useSentAnnouncements, useAckStatus,
  createAnnouncement, acknowledgeAnnouncement,
} from '@/lib/announcements';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Megaphone, Plus, Check, ChevronDown, CheckCircle2, Circle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const CORP = new Set(['super_admin', 'corporate_admin']);

export default function Announcements() {
  const qc = useQueryClient();
  const { member, isManager, scopeLocations } = useCurrentMember();
  const myId = member?.id;
  const isCorp = CORP.has(member?.permissionLevel);

  const { data: inbox = [] } = useMyAnnouncements(myId);
  const { data: sent = [] } = useSentAnnouncements(myId);
  const [composeOpen, setComposeOpen] = useState(false);

  const unackCount = inbox.filter(a => a.requires_acknowledgment && !a.acknowledgedAt).length;

  const handleAck = async (id) => {
    try {
      await acknowledgeAnnouncement(id, myId);
      qc.invalidateQueries({ queryKey: ['my-announcements', myId] });
    } catch (e) { toast.error(e.message || 'Could not confirm'); }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Announcements" subtitle="Broadcasts to your team, with read confirmation">
        {isManager && (
          <Button size="sm" className="gap-1.5" onClick={() => setComposeOpen(true)}>
            <Plus className="w-4 h-4" /> New announcement
          </Button>
        )}
      </PageHeader>

      {isManager ? (
        <Tabs defaultValue="inbox" className="mt-2">
          <TabsList>
            <TabsTrigger value="inbox">
              Inbox{unackCount > 0 && <Badge variant="secondary" className="ml-1.5">{unackCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
          </TabsList>
          <TabsContent value="inbox"><Inbox items={inbox} onAck={handleAck} /></TabsContent>
          <TabsContent value="sent"><Sent items={sent} /></TabsContent>
        </Tabs>
      ) : (
        <div className="mt-2"><Inbox items={inbox} onAck={handleAck} /></div>
      )}

      <ComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} isCorp={isCorp}
        onPosted={() => {
          qc.invalidateQueries({ queryKey: ['sent-announcements', myId] });
          qc.invalidateQueries({ queryKey: ['my-announcements', myId] }); // poster may be a recipient too
          setComposeOpen(false);
        }} />
    </div>
  );
}

function Inbox({ items, onAck }) {
  if (!items.length) return <Empty label="No announcements yet." />;
  return (
    <div className="space-y-3">
      {items.map(a => {
        const needsAck = a.requires_acknowledgment && !a.acknowledgedAt;
        return (
          <Card key={a.id} className={cn('p-4', needsAck && 'border-primary/60 ring-1 ring-primary/20')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm">{a.title}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {a.published_at ? format(new Date(a.published_at), 'MMM d, yyyy · h:mm a') : ''}
                </p>
              </div>
              {a.requires_acknowledgment && (
                a.acknowledgedAt
                  ? <Badge variant="outline" className="gap-1 shrink-0 text-emerald-600 border-emerald-200"><Check className="w-3 h-3" /> Confirmed</Badge>
                  : <Badge className="shrink-0">Action needed</Badge>
              )}
            </div>
            <p className="text-sm mt-2 whitespace-pre-wrap break-words">{a.body}</p>
            {needsAck && (
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => onAck(a.id)}>
                <Check className="w-4 h-4" /> Confirm you've read this
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Sent({ items }) {
  if (!items.length) return <Empty label="You haven't posted any announcements." />;
  return (
    <div className="space-y-3">
      {items.map(a => <SentRow key={a.id} a={a} />)}
    </div>
  );
}

function SentRow({ a }) {
  const [open, setOpen] = useState(false);
  const { data: stats } = useAckStatus(a.requires_acknowledgment && open ? a.id : null);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{a.title}</h3>
          <p className="text-[11px] text-muted-foreground">
            {a.published_at ? format(new Date(a.published_at), 'MMM d, yyyy · h:mm a') : 'Draft'}
            {' · '}{audienceLabel(a)}
          </p>
        </div>
        {a.requires_acknowledgment && <Badge variant="secondary" className="shrink-0">Needs confirmation</Badge>}
      </div>
      <p className="text-sm mt-2 whitespace-pre-wrap break-words line-clamp-3">{a.body}</p>

      {a.requires_acknowledgment && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
            {stats ? `${stats.acknowledged} of ${stats.total} acknowledged` : 'View acknowledgments'}
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
                        <span className="text-[10px] text-muted-foreground ml-auto">{format(new Date(r.acknowledged_at), 'MMM d, h:mm a')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function ComposeDialog({ open, onClose, isCorp, onPosted }) {
  const { data: locations = [] } = useLocations();
  const { data: roles = [] } = useRoles();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState(isCorp ? 'all' : 'location');
  const [locationId, setLocationId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [posting, setPosting] = useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(''); setBody(''); setAudience(isCorp ? 'all' : 'location');
      setLocationId(''); setRoleId(''); setRequiresAck(false);
    }
  }, [open, isCorp]);

  const valid = title.trim() && body.trim() &&
    (audience !== 'location' || locationId) && (audience !== 'role' || roleId);

  const post = async () => {
    setPosting(true);
    try {
      await createAnnouncement({ title, body, audienceType: audience, locationId, roleId, requiresAcknowledgment: requiresAck });
      toast.success('Announcement posted');
      onPosted();
    } catch (e) {
      toast.error(e.message?.includes('allowed') || e.message?.includes('corporate')
        ? "You don't have permission to post to that audience" : (e.message || 'Could not post'));
    } finally { setPosting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base flex items-center gap-2"><Megaphone className="w-4 h-4" /> New announcement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short headline" /></div>
          <div><Label className="text-xs">Message</Label><Textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="What do you want the team to know?" /></div>
          <div>
            <Label className="text-xs">Audience</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {isCorp && <SelectItem value="all">Everyone</SelectItem>}
                <SelectItem value="location">A location</SelectItem>
                <SelectItem value="role">A role</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {audience === 'location' && (
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger>
                <SelectContent>{scopeLocations(locations.filter(l => l.status === 'active')).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {audience === 'role' && (
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger><SelectValue placeholder="Choose role" /></SelectTrigger>
                <SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Require acknowledgment</p>
              <p className="text-[11px] text-muted-foreground">Recipients confirm they've read it; you see who has.</p>
            </div>
            <Switch checked={requiresAck} onCheckedChange={setRequiresAck} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || posting} onClick={post}>{posting ? 'Posting…' : 'Post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function audienceLabel(a) {
  if (a.audience_type === 'all') return 'Everyone';
  if (a.audience_type === 'location') return 'A location';
  return 'A role';
}

function Empty({ label }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
