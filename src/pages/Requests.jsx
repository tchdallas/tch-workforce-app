import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatEndTime, cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Check, X, Clock, ArrowRightLeft, HandHelping, CalendarOff, UserPlus } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { useTeamMembers, useRoles, useLocations } from '@/lib/useAppData';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { invalidateNavBadges } from '@/hooks/useNavBadges';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';

export default function Requests() {
  const queryClient = useQueryClient();
  const { data: teamMembers } = useTeamMembers();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const [assigningGiveaway, setAssigningGiveaway] = useState(null);
  const getName = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Unknown';
  };

  const { data: timeOff = [] } = useQuery({
    queryKey: ['all-timeoff'],
    queryFn: () => base44.entities.TimeOffRequest.list('-created_date'),
    placeholderData: [],
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['all-trades'],
    queryFn: () => base44.entities.ShiftTradeRequest.list('-created_date'),
    placeholderData: [],
  });

  const { data: giveaways = [] } = useQuery({
    queryKey: ['all-giveaways'],
    queryFn: () => base44.entities.ShiftGiveawayRequest.list('-created_date'),
    placeholderData: [],
  });

  const { data: claims = [] } = useQuery({
    queryKey: ['all-claims'],
    queryFn: () => base44.entities.OpenShiftClaim.list('-created_date'),
    placeholderData: [],
  });

  const { pullDistance, refreshing } = usePullToRefresh(async () => {
    await queryClient.invalidateQueries({ queryKey: ['all-timeoff'] }); invalidateNavBadges(queryClient);
    await queryClient.invalidateQueries({ queryKey: ['all-trades'] }); invalidateNavBadges(queryClient);
    await queryClient.invalidateQueries({ queryKey: ['all-giveaways'] }); invalidateNavBadges(queryClient);
    await queryClient.invalidateQueries({ queryKey: ['all-claims'] }); invalidateNavBadges(queryClient);
  });

  const approveTimeOff = useMutation({
    mutationFn: ({ id, status }) => base44.entities.TimeOffRequest.update(id, { status, reviewedAt: new Date().toISOString() }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-timeoff'] }); invalidateNavBadges(queryClient); toast.success('Updated'); },
  });

  const setTimeOffPayType = useMutation({
    mutationFn: ({ id, payType }) => base44.entities.TimeOffRequest.update(id, { payType }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-timeoff'] }); invalidateNavBadges(queryClient); },
  });

  const approveTrade = useMutation({
    mutationFn: ({ id, status }) => base44.entities.ShiftTradeRequest.update(id, { status, reviewedAt: new Date().toISOString() }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['all-trades'] }); invalidateNavBadges(queryClient); toast.success('Updated'); },
  });

  const approveGiveaway = useMutation({
    mutationFn: async ({ id, status }) => {
      await base44.entities.ShiftGiveawayRequest.update(id, { status, reviewedAt: new Date().toISOString() });
      if (status === 'approved') {
        // Transfer the shift to the accepting member
        const req = giveaways.find(g => g.id === id);
        if (req?.shiftId && req?.acceptingTeamMemberId) {
          const fromTm = teamMembers.find(t => t.id === req.originalTeamMemberId);
          const toTm = teamMembers.find(t => t.id === req.acceptingTeamMemberId);
          const fromName = fromTm ? `${fromTm.preferredName || fromTm.firstName} ${fromTm.lastName}` : req.originalTeamMemberId;
          const toName = toTm ? `${toTm.preferredName || toTm.firstName} ${toTm.lastName}` : req.acceptingTeamMemberId;
          await base44.entities.Shift.update(req.shiftId, { teamMemberId: req.acceptingTeamMemberId, recentChangeFlag: true });

          const auditPromise = base44.entities.AuditLog.create({
            actorId: 'manager',
            actorName: 'Manager (Requests)',
            action: 'shift_transferred',
            entityType: 'Shift',
            entityId: req.shiftId,
            details: `Shift giveaway approved — transferred from ${fromName} → ${toName}`,
            beforeValue: JSON.stringify({ teamMember: fromName }),
            afterValue: JSON.stringify({ teamMember: toName }),
          });

          // Notify both parties
          const notif1 = base44.entities.Notification.create({
            recipientTeamMemberId: req.acceptingTeamMemberId,
            title: 'Shift Offer Accepted',
            message: `${fromName} offered you their shift. A manager has approved it — it's now on your schedule.`,
            type: 'shift_giveaway',
            channel: 'in_app',
            relatedEntityType: 'ShiftGiveawayRequest',
            relatedEntityId: id,
          });
          const notif2 = base44.entities.Notification.create({
            recipientTeamMemberId: req.originalTeamMemberId,
            title: 'Shift Offer Accepted',
            message: `${toName} accepted your shift offer. A manager approved it.`,
            type: 'shift_giveaway',
            channel: 'in_app',
            relatedEntityType: 'ShiftGiveawayRequest',
            relatedEntityId: id,
          });

          await Promise.all([auditPromise, notif1, notif2]);
        }
      }
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] }); invalidateNavBadges(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Updated'); 
    },
  });

  // Manager cancels a giveaway that's still waiting (open / pending)
  const cancelGiveaway = useMutation({
    mutationFn: async (req) => {
      await base44.entities.ShiftGiveawayRequest.update(req.id, { status: 'cancelled', reviewedAt: new Date().toISOString() });
      await base44.entities.Notification.create({
        recipientTeamMemberId: req.originalTeamMemberId,
        title: 'Shift Offer Cancelled',
        message: 'A manager cancelled your shift offer — the shift is still yours.',
        type: 'shift_giveaway',
        channel: 'in_app',
        relatedEntityType: 'ShiftGiveawayRequest',
        relatedEntityId: req.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] }); invalidateNavBadges(queryClient);
      toast.success('Giveaway cancelled');
    },
    onError: (e) => toast.error(e.message || 'Could not cancel'),
  });

  // Manager hands the offered shift directly to a chosen member — the database
  // trigger performs the actual shift transfer when the request is approved
  const assignGiveaway = useMutation({
    mutationFn: async ({ req, toMemberId }) => {
      await base44.entities.ShiftGiveawayRequest.update(req.id, {
        acceptingTeamMemberId: toMemberId,
        status: 'approved',
        reviewedAt: new Date().toISOString(),
      });
      const fromName = getName(req.originalTeamMemberId);
      const toName = getName(toMemberId);
      await Promise.all([
        base44.entities.AuditLog.create({
          actorId: 'manager',
          actorName: 'Manager (Requests)',
          action: 'shift_transferred',
          entityType: 'Shift',
          entityId: req.shiftId,
          details: `Shift giveaway manually assigned by manager — ${fromName} → ${toName}`,
          beforeValue: JSON.stringify({ teamMember: fromName }),
          afterValue: JSON.stringify({ teamMember: toName }),
        }),
        base44.entities.Notification.create({
          recipientTeamMemberId: toMemberId,
          title: 'Shift Assigned to You',
          message: `A manager assigned you ${fromName}'s offered shift — it's now on your schedule.`,
          type: 'shift_giveaway',
          channel: 'in_app',
          relatedEntityType: 'ShiftGiveawayRequest',
          relatedEntityId: req.id,
        }),
        base44.entities.Notification.create({
          recipientTeamMemberId: req.originalTeamMemberId,
          title: 'Shift Offer Completed',
          message: `A manager gave your offered shift to ${toName}.`,
          type: 'shift_giveaway',
          channel: 'in_app',
          relatedEntityType: 'ShiftGiveawayRequest',
          relatedEntityId: req.id,
        }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] }); invalidateNavBadges(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setAssigningGiveaway(null);
      toast.success('Shift assigned');
    },
    onError: (e) => toast.error(e.message || 'Could not assign'),
  });

  const approveClaim = useMutation({
    mutationFn: async ({ id, status }) => {
      await base44.entities.OpenShiftClaim.update(id, { status, reviewedAt: new Date().toISOString() });
      if (status === 'approved') {
        const claim = claims.find(c => c.id === id);
        if (claim?.shiftId && claim?.teamMemberId) {
          await base44.entities.Shift.update(claim.shiftId, {
            teamMemberId: claim.teamMemberId,
            shiftType: 'assigned',
            coverageStatus: 'covered',
            recentChangeFlag: true,
          });
          await base44.entities.Notification.create({
            recipientTeamMemberId: claim.teamMemberId,
            title: 'Open Shift Claim Approved',
            message: 'Your claim was approved — the shift is now on your schedule.',
            type: 'open_shift_claim',
            channel: 'in_app',
            relatedEntityType: 'OpenShiftClaim',
            relatedEntityId: id,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-claims'] }); invalidateNavBadges(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['open-shifts'] });
      toast.success('Updated');
    },
  });

  const statusBadge = (status) => {
    const colors = {
      pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      pending_manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      pending_team_member: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      denied: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
      cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    };
    return <Badge className={`text-[10px] border-0 ${colors[status] || colors.pending}`}>{status?.replace(/_/g, ' ')}</Badge>;
  };

  const pendingTimeOff = timeOff.filter(t => t.status === 'pending');
  const pendingTrades = trades.filter(t => t.status === 'pending_manager');
  const pendingGiveaways = giveaways.filter(g => g.status === 'pending_manager' || g.status === 'pending_team_member');
  const pendingClaims = claims.filter(c => c.status === 'pending');

  return (
    <div className="max-w-5xl mx-auto">
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <PageHeader title="Requests" subtitle={`${pendingTimeOff.length + pendingTrades.length + pendingGiveaways.length + pendingClaims.length} pending`} />

      <Tabs defaultValue="timeoff">
        <TabsList className="mb-4">
          <TabsTrigger value="timeoff" className="text-xs gap-1">
            <CalendarOff className="w-3 h-3" /> Time Off {pendingTimeOff.length > 0 && <Badge className="text-[9px] px-1 py-0 ml-1 bg-primary text-primary-foreground">{pendingTimeOff.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-xs gap-1">
            <ArrowRightLeft className="w-3 h-3" /> Trades {pendingTrades.length > 0 && <Badge className="text-[9px] px-1 py-0 ml-1 bg-primary text-primary-foreground">{pendingTrades.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="giveaways" className="text-xs gap-1">
            <HandHelping className="w-3 h-3" /> Giveaways {pendingGiveaways.length > 0 && <Badge className="text-[9px] px-1 py-0 ml-1 bg-primary text-primary-foreground">{pendingGiveaways.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="claims" className="text-xs gap-1">
            <Clock className="w-3 h-3" /> Claims {pendingClaims.length > 0 && <Badge className="text-[9px] px-1 py-0 ml-1 bg-primary text-primary-foreground">{pendingClaims.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeoff">
          <div className="space-y-2">
            {timeOff.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No time-off requests</p>}
            {timeOff.map(req => (
              <Card key={req.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{getName(req.teamMemberId)}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.recurrence === 'weekly'
                        ? <>Every {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][req.weekday]}{req.endDateTime ? ` · until ${format(new Date(req.endDateTime), 'MMM d, yyyy')}` : ' · ongoing'}</>
                        : <>{req.startDateTime && format(new Date(req.startDateTime), 'MMM d')} – {req.endDateTime && format(new Date(req.endDateTime), 'MMM d, yyyy')}{req.isFullDay ? ' (Full day)' : ''}</>}
                    </p>
                    {req.reason && <p className="text-xs text-muted-foreground mt-0.5">{req.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === 'pending' ? (
                      <button
                        type="button"
                        title="Click to toggle paid / unpaid"
                        onClick={() => setTimeOffPayType.mutate({ id: req.id, payType: req.payType === 'paid' ? 'unpaid' : 'paid' })}
                        className={cn(
                          'text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors',
                          req.payType === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground border-border'
                        )}
                      >
                        {req.payType === 'paid' ? 'PTO' : 'Unpaid'}
                      </button>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{req.payType === 'paid' ? 'PTO' : 'Unpaid'}</Badge>
                    )}
                    {statusBadge(req.status)}
                    {req.status === 'pending' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => approveTimeOff.mutate({ id: req.id, status: 'approved' })}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => approveTimeOff.mutate({ id: req.id, status: 'denied' })}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    {req.status === 'approved' && req.recurrence === 'weekly' && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs text-red-500" title="End this recurring time off" onClick={() => approveTimeOff.mutate({ id: req.id, status: 'cancelled' })}>
                        Stop
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trades">
          <div className="space-y-2">
            {trades.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No trade requests</p>}
            {trades.map(req => (
              <Card key={req.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{getName(req.requestingTeamMemberId)} ↔ {getName(req.targetTeamMemberId)}</p>
                    <p className="text-xs text-muted-foreground">Shift Trade Request</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(req.status)}
                    {req.status === 'pending_manager' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => approveTrade.mutate({ id: req.id, status: 'approved' })}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => approveTrade.mutate({ id: req.id, status: 'denied' })}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="giveaways">
          <div className="space-y-2">
            {giveaways.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No giveaway requests</p>}
            {giveaways.map(req => (
              <Card key={req.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      {getName(req.originalTeamMemberId)}
                      {req.acceptingTeamMemberId && (
                        <span className="text-muted-foreground font-normal"> → {getName(req.acceptingTeamMemberId)}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {req.status === 'pending_team_member'
                        ? 'Waiting for recipient to accept'
                        : req.status === 'pending_manager'
                        ? 'Awaiting manager approval'
                        : 'Shift Giveaway'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(req.status)}
                    {req.status === 'pending_manager' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" title="Approve" onClick={() => approveGiveaway.mutate({ id: req.id, status: 'approved' })}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" title="Deny" onClick={() => approveGiveaway.mutate({ id: req.id, status: 'denied' })}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    {(req.status === 'open' || req.status === 'pending_team_member') && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" title="Assign to a team member" onClick={() => setAssigningGiveaway(req)}>
                          <UserPlus className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" title="Cancel this giveaway" onClick={() => cancelGiveaway.mutate(req)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="claims">
          <div className="space-y-2">
            {claims.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No open shift claims</p>}
            {claims.map(req => (
              <Card key={req.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{getName(req.teamMemberId)}</p>
                    <p className="text-xs text-muted-foreground">Open Shift Claim</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(req.status)}
                    {req.status === 'pending' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => approveClaim.mutate({ id: req.id, status: 'approved' })}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => approveClaim.mutate({ id: req.id, status: 'denied' })}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AssignGiveawayDialog
        request={assigningGiveaway}
        onClose={() => setAssigningGiveaway(null)}
        teamMembers={teamMembers}
        roles={roles}
        locations={locations}
        getName={getName}
        onAssign={(toMemberId) => assignGiveaway.mutate({ req: assigningGiveaway, toMemberId })}
        assigning={assignGiveaway.isPending}
      />
    </div>
  );
}

// Manager picks who receives an offered shift (e.g. the person can't log in
// to accept it themselves). Eligibility mirrors the giveaway rules: active,
// has the shift's role, works at the shift's location.
function AssignGiveawayDialog({ request, onClose, teamMembers, roles, locations, getName, onAssign, assigning }) {
  const [selectedId, setSelectedId] = useState('');

  const { data: shiftRows = [] } = useQuery({
    queryKey: ['giveaway-shift', request?.shiftId],
    queryFn: () => base44.entities.Shift.filter({ id: request.shiftId }),
    enabled: !!request?.shiftId,
    placeholderData: [],
  });
  const shift = shiftRows[0];

  const eligible = shift
    ? teamMembers.filter(tm =>
        tm.status === 'active' &&
        tm.id !== request?.originalTeamMemberId &&
        tm.assignedRoleIds?.includes(shift.roleId) &&
        (tm.homeLocationId === shift.locationId || tm.assignedLocationIds?.includes(shift.locationId))
      )
    : [];

  const handleClose = () => {
    setSelectedId('');
    onClose();
  };

  const role = roles.find(r => r.id === shift?.roleId);
  const location = locations.find(l => l.id === shift?.locationId);

  return (
    <Dialog open={!!request} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Assign Offered Shift</DialogTitle>
        </DialogHeader>

        {request && (
          <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
            <p><span className="text-muted-foreground">From:</span> <span className="font-medium">{getName(request.originalTeamMemberId)}</span></p>
            {shift ? (
              <>
                <p><span className="text-muted-foreground">Shift:</span> {role?.name || '—'} · {location?.name || '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Loading shift…</p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Assign to</Label>
          <TeamMemberCombobox
            value={selectedId}
            onChange={setSelectedId}
            eligibleTeamMembers={eligible}
            placeholder="Search team member…"
          />
          {shift && eligible.length === 0 && (
            <p className="text-xs text-muted-foreground">No active members match this shift's role and location.</p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
          <Button className="flex-1" disabled={!selectedId || assigning} onClick={() => onAssign(selectedId)}>
            {assigning ? 'Assigning…' : 'Assign Shift'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}