/**
 * terminateTeamMember
 * Triggered automatically when a TeamMember is set to 'inactive' or 'archived'.
 * - Removes the member from all FUTURE shifts (published + draft) by converting
 *   those shifts to open (unassigned) so the slots remain for re-staffing.
 *   Past shifts are preserved for history/payroll.
 * - Writes an audit log entry.
 * Idempotent: re-running on an already-terminated member cancels 0 shifts.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const PAGE = 200;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try {
      payload = await req.json();
    } catch (_) {
      payload = {};
    }

    const teamMemberId =
      payload.teamMemberId ||
      payload.entity_id ||
      payload.event?.entity_id ||
      payload.data?.id;

    if (!teamMemberId) {
      return Response.json({ error: 'teamMemberId required' }, { status: 400 });
    }

    const tm = await base44.asServiceRole.entities.TeamMember
      .get(teamMemberId)
      .catch(() => null);

    if (!tm) {
      return Response.json({ success: true, cancelled: 0, message: 'Team member not found.' });
    }

    // Guard: only act when the member is actually termed
    if (tm.status !== 'inactive' && tm.status !== 'archived') {
      return Response.json({
        success: true,
        cancelled: 0,
        message: `Status is '${tm.status}'; no termination action taken.`,
      });
    }

    const nowIso = new Date().toISOString();

    // Gather all future, non-cancelled, non-archived shifts assigned to this member
    let all = [];
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Shift.filter(
        {
          teamMemberId,
          startDateTime: { $gte: nowIso },
          status: { $ne: 'cancelled' },
          archived: { $ne: true },
        },
        'startDateTime',
        PAGE,
        skip
      );
      all = all.concat(batch);
      if (batch.length < PAGE) break;
      skip += PAGE;
    }

    let count = 0;
    for (const s of all) {
      await base44.asServiceRole.entities.Shift.update(s.id, {
        teamMemberId: null,
        shiftType: 'open',
        coverageStatus: 'open',
        status: 'draft',
        recentChangeFlag: true,
      });
      count++;
    }

    await base44.asServiceRole.entities.AuditLog.create({
      actorId: 'system',
      actorName: 'System',
      action: 'team_member_terminated',
      entityType: 'TeamMember',
      entityId: teamMemberId,
      details: `Terminated ${tm.firstName} ${tm.lastName} (status: ${tm.status}). Removed from ${count} future shift(s).`,
    }).catch(() => {});

    return Response.json({
      success: true,
      cancelled: count,
      teamMemberId,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});