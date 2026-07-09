import React, { useState, useMemo } from 'react';
import { formatEndTime } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTeamMembers, swapApprovalRequired } from '@/lib/useAppData';
import { Users, User } from 'lucide-react';

export default function GiveShiftModal({ open, onClose, shift, role, location, currentMemberId }) {
  const [mode, setMode] = useState('broadcast'); // 'broadcast' | 'specific'
  const [selectedId, setSelectedId] = useState(null);
  const [wantMode, setWantMode] = useState('nothing'); // 'nothing' (giveaway) | 'trade'
  const [wantShiftId, setWantShiftId] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const queryClient = useQueryClient();
  const { data: teamMembers = [] } = useTeamMembers();

  const { data: allShifts = [] } = useQuery({
    queryKey: ['all-published-shifts-for-giveaway'],
    queryFn: () => base44.entities.Shift.filter({ status: 'published' }),
    enabled: open && !!shift,
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });

  const { data: recentCallouts = [] } = useQuery({
    queryKey: ['recent-callouts-for-giveaway'],
    queryFn: () => base44.entities.Callout.list(),
    enabled: open && !!shift,
  });

  const { data: timeOffRequests = [] } = useQuery({
    queryKey: ['approved-timeoff-for-giveaway'],
    queryFn: () => base44.entities.TimeOffRequest.filter({ status: 'approved' }),
    enabled: open && !!shift,
  });

  const getSetting = (key) => settings.find(s => s.key === key)?.value || '';
  const requireManagerApproval = swapApprovalRequired(settings, shift?.locationId);
  const maxHoursPerDay = parseFloat(getSetting('giveaway_max_hours_per_day')) || null;
  const maxHoursPerWeek = parseFloat(getSetting('giveaway_max_hours_per_week')) || null;
  const blockIfRecentCallout = getSetting('giveaway_block_if_recent_callout') === 'true';
  const blockIfOnLeave = getSetting('giveaway_block_if_on_leave') === 'true';

  // Who qualifies for this shift (role + location, not receive-blocked)?
  // Answered by the database — team members can't read coworkers' assignments,
  // so computing this client-side showed "0 qualified" for non-managers.
  const { data: qualifiedRaw = [] } = useQuery({
    queryKey: ['qualified-for-shift', shift?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('qualified_for_shift', { p_shift_id: shift.id });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!shift?.id,
    placeholderData: [],
  });
  const qualified = useMemo(
    () => qualifiedRaw.filter(q => q.id !== currentMemberId),
    [qualifiedRaw, currentMemberId]
  );
  const qualifiedCount = qualified.length;

  // "Specific person" list: qualified members minus soft conflicts we can see
  // (overlaps from published shifts; callout/leave/hour checks apply where the
  // viewer has visibility — managers see everything, members see less)
  const eligibleMembers = useMemo(() => {
    if (!shift) return [];
    const shiftStart = new Date(shift.startDateTime).getTime();
    const shiftEnd = new Date(shift.endDateTime).getTime();
    const shiftDurationHrs = (shiftEnd - shiftStart) / 3600000;
    const shiftDay = format(new Date(shift.startDateTime), 'yyyy-MM-dd');

    return qualified.filter(q => {
      const memberShifts = allShifts.filter(s => s.teamMemberId === q.id);
      const hasOverlap = memberShifts.some(s => {
        const sStart = new Date(s.startDateTime).getTime();
        const sEnd = new Date(s.endDateTime).getTime();
        return sStart < shiftEnd && sEnd > shiftStart;
      });
      if (hasOverlap) return false;

      if (blockIfRecentCallout) {
        const cutoff = Date.now() - 24 * 3600 * 1000;
        const hadRecentCallout = recentCallouts.some(c =>
          c.teamMemberId === q.id && new Date(c.submittedAt || c.created_date).getTime() >= cutoff
        );
        if (hadRecentCallout) return false;
      }

      if (blockIfOnLeave) {
        const hasLeaveConflict = timeOffRequests.some(t => {
          if (t.teamMemberId !== q.id) return false;
          const leaveStart = new Date(t.startDateTime).getTime();
          const leaveEnd = new Date(t.endDateTime).getTime();
          return leaveStart < shiftEnd && leaveEnd > shiftStart;
        });
        if (hasLeaveConflict) return false;
      }

      if (maxHoursPerDay) {
        const dayHrs = memberShifts
          .filter(s => s.startDateTime?.startsWith(shiftDay))
          .reduce((acc, s) => acc + (new Date(s.endDateTime) - new Date(s.startDateTime)) / 3600000, 0);
        if (dayHrs + shiftDurationHrs > maxHoursPerDay) return false;
      }

      if (maxHoursPerWeek) {
        const shiftDate = new Date(shift.startDateTime);
        const day = shiftDate.getDay();
        const weekStart = new Date(shiftDate);
        weekStart.setDate(shiftDate.getDate() - day);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);

        const weekHrs = memberShifts
          .filter(s => {
            const t = new Date(s.startDateTime).getTime();
            return t >= weekStart.getTime() && t < weekEnd.getTime();
          })
          .reduce((acc, s) => acc + (new Date(s.endDateTime) - new Date(s.startDateTime)) / 3600000, 0);
        if (weekHrs + shiftDurationHrs > maxHoursPerWeek) return false;
      }

      return true;
    });
  }, [qualified, shift, allShifts, maxHoursPerDay, maxHoursPerWeek,
      blockIfRecentCallout, blockIfOnLeave, recentCallouts, timeOffRequests]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'broadcast') {
        await base44.entities.ShiftGiveawayRequest.create({
          originalTeamMemberId: currentMemberId,
          shiftId: shift.id,
          offerType: 'qualified_location',
          status: 'open',
        });
        return;
      }
      const offerer = teamMembers.find(t => t.id === currentMemberId);
      const offererName = offerer ? `${offerer.preferredName || offerer.firstName} ${offerer.lastName}` : 'A team member';
      const shiftTime = `${format(new Date(shift.startDateTime), 'EEE MMM d, h:mm a')} – ${formatEndTime(shift.startDateTime, shift.endDateTime)}`;

      // Trade: I give my shift and want one of theirs back
      if (wantMode === 'trade' && wantShiftId) {
        const request = await base44.entities.ShiftTradeRequest.create({
          requestingTeamMemberId: currentMemberId,
          targetTeamMemberId: selectedId,
          originalShiftId: shift.id,
          requestedShiftId: wantShiftId,
          status: 'pending_team_member',
        });
        await base44.entities.Notification.create({
          recipientTeamMemberId: selectedId,
          title: 'Shift Trade Proposed',
          message: `${offererName} wants to trade their shift on ${shiftTime} for one of yours. Open "My Schedule" to respond.`,
          type: 'shift_trade',
          channel: 'in_app',
          relatedEntityType: 'ShiftTradeRequest',
          relatedEntityId: request.id,
        });
        return;
      }

      // Giveaway: the offer starts open and targeted; the recipient sets
      // themselves as accepting (manager approval is applied at accept time
      // when the setting requires it)
      const request = await base44.entities.ShiftGiveawayRequest.create({
        originalTeamMemberId: currentMemberId,
        shiftId: shift.id,
        offerType: 'specific',
        targetTeamMemberIds: [selectedId],
        status: 'open',
      });

      await base44.entities.Notification.create({
        recipientTeamMemberId: selectedId,
        title: 'Shift Offer',
        message: requireManagerApproval
          ? `${offererName} is offering you their shift on ${shiftTime}. A manager will review this request.`
          : `${offererName} is offering you their shift on ${shiftTime}. Open "My Schedule" to accept or decline.`,
        type: 'shift_giveaway',
        channel: 'in_app',
        relatedEntityType: 'ShiftGiveawayRequest',
        relatedEntityId: request.id,
      });
    },
    onSuccess: () => {
      const msg = mode === 'broadcast'
        ? `Offer posted — visible to ${qualifiedCount} qualified team member${qualifiedCount === 1 ? '' : 's'}`
        : wantMode === 'trade'
          ? 'Trade proposed — waiting for them to respond'
          : requireManagerApproval
            ? 'Request submitted — awaiting manager approval'
            : 'Offer sent — waiting for the team member to accept';
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ['all-giveaways'] });
      queryClient.invalidateQueries({ queryKey: ['all-trades'] });
      queryClient.invalidateQueries({ queryKey: ['broadcast-giveaway-offers'] });
      queryClient.invalidateQueries({ queryKey: ['incoming-trades'] });
      handleClose();
    },
  });

  const handleClose = () => {
    setSelectedId(null);
    setMode('broadcast');
    setWantMode('nothing');
    setWantShiftId(null);
    setMemberSearch('');
    onClose();
  };

  // Trading: the selected person's upcoming shifts that *I* am qualified to
  // work (my role + my locations) — the database enforces the same rule
  const me = teamMembers.find(t => t.id === currentMemberId);
  const tradeCandidates = useMemo(() => {
    if (!selectedId || !me) return [];
    const now = Date.now();
    return allShifts
      .filter(s =>
        s.teamMemberId === selectedId &&
        s.status === 'published' &&
        new Date(s.startDateTime).getTime() > now &&
        me.assignedRoleIds?.includes(s.roleId) &&
        (me.assignedLocationIds?.includes(s.locationId) || me.homeLocationId === s.locationId)
      )
      .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  }, [allShifts, selectedId, me]);

  if (!shift) return null;

  const getName = (tm) => tm.display_name || `${tm.preferredName || tm.firstName} ${tm.lastName}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Trade or Give Away Shift</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
          <p className="font-medium">{role?.name || 'Unknown Role'}</p>
          <p className="text-muted-foreground text-xs">
            {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
          </p>
          {location && <p className="text-xs text-muted-foreground">{location.name}</p>}
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('broadcast')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors text-left ${
              mode === 'broadcast' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
            }`}
          >
            <Users className="w-4 h-4" /> <span className="font-medium">All qualified</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('specific')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors text-left ${
              mode === 'specific' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
            }`}
          >
            <User className="w-4 h-4" /> <span className="font-medium">Specific person</span>
          </button>
        </div>

        {mode === 'broadcast' ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              This offer will be visible to <span className="font-medium text-foreground">{qualifiedCount}</span> active team member{qualifiedCount === 1 ? '' : 's'} with the {role?.name} role at {location?.name}. The first to accept gets the shift{requireManagerApproval ? ' (then a manager approves)' : ''}.
            </p>
            {qualifiedCount === 0 && (
              <p className="text-xs text-amber-600">No qualified team members found for this role and location.</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Select a qualified team member</p>
            {eligibleMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6 italic">
                No eligible team members found (same role, location, no conflicts, within hour limits).
              </p>
            ) : (
              <>
                {eligibleMembers.length > 5 && (
                  <input
                    className="w-full mb-2 px-3 py-2 text-sm bg-transparent border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Search team members…"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                  />
                )}
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {eligibleMembers
                    .filter(tm => !memberSearch.trim() || getName(tm).toLowerCase().includes(memberSearch.toLowerCase()))
                    .map(tm => (
                      <button
                        key={tm.id}
                        type="button"
                        onClick={() => setSelectedId(tm.id)}
                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors text-left ${
                          selectedId === tm.id
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <span className="font-medium">{getName(tm)}</span>
                        {selectedId === tm.id && <Badge className="text-[10px] px-1.5 py-0">Selected</Badge>}
                      </button>
                    ))}
                </div>
              </>
            )}
            {selectedId && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">What do you want in return?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setWantMode('nothing'); setWantShiftId(null); }}
                    className={`rounded-lg border px-3 py-2 text-sm text-left ${
                      wantMode === 'nothing' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-medium">Nothing</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Give the shift away</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWantMode('trade')}
                    className={`rounded-lg border px-3 py-2 text-sm text-left ${
                      wantMode === 'trade' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-medium">One of their shifts</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Trade shifts</p>
                  </button>
                </div>
                {wantMode === 'trade' && (
                  tradeCandidates.length === 0 ? (
                    <p className="text-xs text-amber-600 mt-2">
                      They have no upcoming shifts you're qualified to work — you can still give your shift away.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto mt-2">
                      {tradeCandidates.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setWantShiftId(s.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-xs text-left ${
                            wantShiftId === s.id ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
                          }`}
                        >
                          {format(new Date(s.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(s.startDateTime, s.endDateTime)}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
            {!requireManagerApproval && wantMode === 'nothing' && (
              <p className="text-xs text-muted-foreground mt-2">
                The selected team member will need to accept this offer before the shift is transferred.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            disabled={
              submitMutation.isPending ||
              (mode === 'specific' && !selectedId) ||
              (mode === 'specific' && wantMode === 'trade' && !wantShiftId) ||
              (mode === 'broadcast' && qualifiedCount === 0)
            }
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending
              ? 'Sending...'
              : mode === 'broadcast'
                ? 'Offer to All Qualified'
                : wantMode === 'trade'
                  ? 'Propose Trade'
                  : requireManagerApproval
                    ? 'Submit for Approval'
                    : 'Send Offer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}