/**
 * archiveOldShifts
 * Soft-archives published/cancelled shifts older than 90 days.
 * Run manually from the dashboard or via a monthly scheduled automation.
 * Archived shifts are still fully queryable for reports/history.
 * Admin-only endpoint.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BATCH_SIZE = 200;
const DAYS_TO_KEEP = 90;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
    const cutoffStr = cutoffDate.toISOString();

    // Fetch old, non-archived shifts in batches
    let totalArchived = 0;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const oldShifts = await base44.asServiceRole.entities.Shift.filter(
        {
          endDateTime: { $lt: cutoffStr },
          archived: { $ne: true },
        },
        'endDateTime',
        BATCH_SIZE,
        skip
      );

      if (oldShifts.length === 0) {
        hasMore = false;
        break;
      }

      // Archive in parallel batches of 20
      const chunks = [];
      for (let i = 0; i < oldShifts.length; i += 20) {
        chunks.push(oldShifts.slice(i, i + 20));
      }
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(shift =>
            base44.asServiceRole.entities.Shift.update(shift.id, { archived: true })
          )
        );
      }

      totalArchived += oldShifts.length;

      if (oldShifts.length < BATCH_SIZE) {
        hasMore = false;
      } else {
        skip += BATCH_SIZE;
      }
    }

    return Response.json({
      success: true,
      archived: totalArchived,
      cutoffDate: cutoffStr,
      message: `Archived ${totalArchived} shifts older than ${DAYS_TO_KEEP} days.`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});