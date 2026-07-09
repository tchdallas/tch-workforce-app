import React, { useMemo } from 'react';
import { formatEndTime } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Gift, Megaphone } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useRoles, useLocations, useTeamMembers, swapApprovalRequired } from '@/lib/useAppData';

export default function IncomingShiftOffers({ currentMemberId }) {
  const queryClient = useQueryClient();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: teamMembers = [] } = useTeamMembers();

  // Personal (specific) offers directed at me (RLS already scopes visibility;
  // the targets list says who the offer is for)
  const { data: offersRaw = [] } = useQuery({
    queryKey: ['incoming-giveaway-offers', currentMemberId],
    queryFn: () => base44.entities.ShiftGiveawayRequest.filter({
      offerType: 'specific',
      status: 'open',
    }),
    enabled: !!currentMemberId,
    placeholderData: [],
  });
  const offers = useMemo(
    () => offersRaw.filter(o =>
      o.originalTeamMemberId !== currentMemberId
      && (o.targetTeamMemberIds || []).includes(currentMemberId)
    ),
    [offersRaw, currentMemberId]
  );

  const shiftIds = offers.map(o => o.shiftId).filter(Boolean);
  const { data: offerShifts = [] } = useQuery({
    queryKey: ['offer-shifts', shiftIds.join(',')],
    queryFn: () => base44.entities.Shift.filter({ id: { $in: shiftIds } }),
    enabled: shiftIds.length > 0,
    placeholderData: [],
  });

  // Broadcast offers open to anyone qualified (not yet claimed)
  const { data: broadcastRaw = [] } = useQuery({
    queryKey: ['broadcast-giveaway-offers', currentMemberId],
    queryFn: () => base44.entities.ShiftGiveawayRequest.filter({
      offerType: 'qualified_location',
      status: 'open',
    }),
    enabled: !!currentMemberId,
    placeholderData: [],
  });
  const broadcastShiftIds = broadcastRaw.map(o => o.shiftId).filter(Boolean);
  const { data: broadcastShifts = [] } = useQuery({
    queryKey: ['broadcast-shifts', broadcastShiftIds.join(',')],
    queryFn: () => base44.entities.Shift.filter({ id: { $in: broadcastShiftIds } }),
    enabled: broadcastShiftIds.length > 0,
    placeholderData: [],
  });

  // Trade proposals where I'm the target
  const { data: trades = [] } = useQuery({
    queryKey: ['incoming-trades', currentMemberId],
    queryFn: () => base44.entities.ShiftTradeRequest.filter({
      targetTeamMemberId: currentMemberId,
      status: 'pending_team_member',
    }),
    enabled: !!currentMemberId,
    placeholderData: [],
  });
  const tradeShiftIds = trades.flatMap(t => [t.originalShiftId, t.requestedShiftId]).filter(Boolean);
  const { data: tradeShifts = [] } = useQuery({
    queryKey: ['incoming-trade-shifts', tradeShiftIds.join(',')],
    queryFn: () => base44.entities.Shift.filter({ id: { $in: tradeShiftIds } }),
    enabled: tradeShiftIds.length > 0,
    placeholderData: [],
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  // approval is per shift location (mirrors the database's routing trigger)
  const requireApprovalFor = (shiftId) => swapApprovalRequired(
    settings,
    [...offerShifts, ...broadcastShifts, ...tradeShifts].find(s => s.id === shiftId)?.locationId
  );

  const respondTrade = useMutation({
    mutationFn: async ({ trade, accept }) => {
      if (accept) {
        // 'approved' completes the swap (the database moves both shifts); the
        // routing trigger downgrades to pending_manager when approval is required
        const result = await base44.entities.ShiftTradeRequest.update(trade.id, {
          status: 'approved',
          reviewedAt: new Date().toISOString(),
        });
        const routed = result?.status === 'pending_manager';
        await base44.entities.Notification.create({
          recipientTeamMemberId: trade.requestingTeamMemberId,
          title: routed ? 'Trade Accepted — Pending Manager' : 'Trade Completed',
          message: routed
            ? 'Your trade was accepted and is awaiting manager approval.'
            : 'Your shift trade was accepted. Both schedules have been updated.',
          type: 'shift_trade',
          channel: 'in_app',
          relatedEntityType: 'ShiftTradeRequest',
          relatedEntityId: trade.id,
        });
        toast.success(routed ? 'Accepted — sent to manager for approval' : 'Trade completed — schedules updated!');
      } else {
        await base44.entities.ShiftTradeRequest.update(trade.id, {
          status: 'denied',
          reviewedAt: new Date().toISOString(),
        });
        await base44.entities.Notification.create({
          recipientTeamMemberId: trade.requestingTeamMemberId,
          title: 'Trade Declined',
          message: 'Your shift trade proposal was declined.',
          type: 'shift_trade',
          channel: 'in_app',
          relatedEntityType: 'ShiftTradeRequest',
          relatedEntityId: trade.id,
        });
        toast.info('Trade declined');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incoming-trades'] });
      queryClient.invalidateQueries({ queryKey: ['my-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['all-trades'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
  });

  const me = teamMembers.find(t => t.id === currentMemberId);

  // Only show broadcasts I qualify for (role + location), excluding my own & swap-flagged
  const broadcastOffers = useMemo(() => {
    if (!me) return [];
    return broadcastRaw.filter(o => {
      if (o.originalTeamMemberId === currentMemberId) return false;
      if (me.status !== 'active' || me.noShiftSwapReceive) return false;
      const shift = broadcastShifts.find(s => s.id === o.shiftId);
      if (!shift) return false;
      if (!me.assignedRoleIds?.includes(shift.roleId)) return false;
      if (!(me.assignedLocationIds?.includes(shift.locationId) || me.homeLocationId === shift.locationId)) return false;
      return true;
    });
  }, [broadcastRaw, broadcastShifts, me, currentMemberId]);

  const respondMutation = useMutation({
    mutationFn: async ({ offerId, accept, shiftId, originalMemberId }) => {
      if (accept) {
        if (requireApprovalFor(shiftId)) {
          await base44.entities.ShiftGiveawayRequest.update(offerId, {
            acceptingTeamMemberId: currentMemberId,
            status: 'pending_manager',
            reviewedAt: new Date().toISOString(),
          });
          toast.success('Accepted — sent to manager for final approval');
        } else {
          // the database transfers the shift when the giveaway turns accepted
          await base44.entities.ShiftGiveawayRequest.update(offerId, {
            acceptingTeamMemberId: currentMemberId,
            status: 'accepted',
            reviewedAt: new Date().toISOString(),
          });
          await base44.entities.Notification.create({
            recipientTeamMemberId: originalMemberId,
            title: 'Shift Offer Accepted',
            message: 'Your shift offer was accepted. The shift has been transferred.',
            type: 'shift_giveaway',
            channel: 'in_app',
            relatedEntityType: 'ShiftGiveawayRequest',
            relatedEntityId: offerId,
          });
          toast.success('Shift accepted and transferred to your schedule!');
        }
      } else {
        await base44.entities.ShiftGiveawayRequest.update(offerId, {
          status: 'denied',
          reviewedAt: new Date().toISOString(),
        });
        await base44.entities.Notification.create({
          recipientTeamMemberId: originalMemberId,
          title: 'Shift Offer Declined',
          message: 'Your shift offer was declined by the team member.',
          type: 'shift_giveaway',
          channel: 'in_app',
          relatedEntityType: 'ShiftGiveawayRequest',
          relatedEntityId: offerId,
        });
        toast.info('Offer declined');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incoming-giveaway-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] });
    },
  });

  const claimBroadcast = useMutation({
    mutationFn: async ({ offerId, shiftId, originalMemberId }) => {
      if (requireApprovalFor(shiftId)) {
        await base44.entities.ShiftGiveawayRequest.update(offerId, {
          acceptingTeamMemberId: currentMemberId,
          status: 'pending_manager',
          reviewedAt: new Date().toISOString(),
        });
        toast.success('Claimed — sent to manager for approval');
      } else {
        // the database transfers the shift when the giveaway turns accepted
        await base44.entities.ShiftGiveawayRequest.update(offerId, {
          acceptingTeamMemberId: currentMemberId,
          status: 'accepted',
          reviewedAt: new Date().toISOString(),
        });
        await base44.entities.Notification.create({
          recipientTeamMemberId: originalMemberId,
          title: 'Shift Offer Accepted',
          message: 'Your open shift offer was accepted. The shift has been transferred.',
          type: 'shift_giveaway',
          channel: 'in_app',
          relatedEntityType: 'ShiftGiveawayRequest',
          relatedEntityId: offerId,
        });
        toast.success('Shift claimed and added to your schedule!');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcast-giveaway-offers'] });
      queryClient.invalidateQueries({ queryKey: ['incoming-giveaway-offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] });
    },
  });

  if (offers.length === 0 && broadcastOffers.length === 0 && trades.length === 0) return null;

  const getShift = (id) => offerShifts.find(s => s.id === id);
  const getRole = (id) => roles.find(r => r.id === id);
  const getLocation = (id) => locations.find(l => l.id === id);
  const getMemberName = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : 'Someone';
  };

  const fmtShift = (s) => s
    ? `${format(new Date(s.startDateTime), 'EEE, MMM d · h:mm a')} – ${formatEndTime(s.startDateTime, s.endDateTime)}`
    : 'their shift';

  return (
    <div className="mb-6 space-y-4">
      {/* Trade proposals directed at me */}
      {trades.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Trade Proposals ({trades.length})</span>
          </div>
          <div className="space-y-2">
            {trades.map(trade => {
              const theirShift = tradeShifts.find(s => s.id === trade.originalShiftId);
              const myShift = tradeShifts.find(s => s.id === trade.requestedShiftId);
              return (
                <Card key={trade.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{getMemberName(trade.requestingTeamMemberId)} wants to trade</p>
                      <p className="text-xs text-muted-foreground mt-0.5">You give: {fmtShift(myShift)}</p>
                      <p className="text-xs text-muted-foreground">You get: {fmtShift(theirShift)}</p>
                      {theirShift && requireApprovalFor(theirShift.id) && (
                        <Badge className="mt-1 text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 border-0">Manager approval required after you accept</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        className="h-8 w-8"
                        disabled={respondTrade.isPending}
                        onClick={() => respondTrade.mutate({ trade, accept: true })}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        disabled={respondTrade.isPending}
                        onClick={() => respondTrade.mutate({ trade, accept: false })}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Personal offers directed at me */}
      {offers.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Shift Offers ({offers.length})</span>
          </div>
          <div className="space-y-2">
            {offers.map(offer => {
              const shift = getShift(offer.shiftId);
              if (!shift) return null;
              const role = getRole(shift.roleId);
              const loc = getLocation(shift.locationId);
              return (
                <Card key={offer.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {getMemberName(offer.originalTeamMemberId)} is offering you a shift
                      </p>
                      <p className="text-sm font-semibold" style={{ color: role?.color || '#6366f1' }}>
                        {role?.name || 'Shift'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
                      </p>
                      {loc && <p className="text-xs text-muted-foreground">{loc.name}</p>}
                      {shift && requireApprovalFor(shift.id) && (
                        <Badge className="mt-1 text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 border-0">Manager approval required after you accept</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                        disabled={respondMutation.isPending}
                        onClick={() => respondMutation.mutate({
                          offerId: offer.id, accept: true, shiftId: offer.shiftId, originalMemberId: offer.originalTeamMemberId,
                        })}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        disabled={respondMutation.isPending}
                        onClick={() => respondMutation.mutate({
                          offerId: offer.id, accept: false, shiftId: offer.shiftId, originalMemberId: offer.originalTeamMemberId,
                        })}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Broadcast offers open to anyone qualified */}
      {broadcastOffers.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Open Shift Offers ({broadcastOffers.length})</span>
          </div>
          <div className="space-y-2">
            {broadcastOffers.map(offer => {
              const shift = broadcastShifts.find(s => s.id === offer.shiftId);
              if (!shift) return null;
              const role = getRole(shift.roleId);
              const loc = getLocation(shift.locationId);
              return (
                <Card key={offer.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {getMemberName(offer.originalTeamMemberId)} is offering a shift to qualified members
                      </p>
                      <p className="text-sm font-semibold" style={{ color: role?.color || '#6366f1' }}>
                        {role?.name || 'Shift'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
                      </p>
                      {loc && <p className="text-xs text-muted-foreground">{loc.name}</p>}
                      {shift && requireApprovalFor(shift.id) && (
                        <Badge className="mt-1 text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 border-0">Manager approval required after you claim</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={claimBroadcast.isPending}
                        onClick={() => claimBroadcast.mutate({
                          offerId: offer.id, shiftId: offer.shiftId, originalMemberId: offer.originalTeamMemberId,
                        })}
                      >
                        Claim
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}