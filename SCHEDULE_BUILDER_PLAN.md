# Schedule Builder Overhaul — Plan

Victor's requirement (2026-07-03): the scheduler must be best-in-class for a 24/7,
multi-location, 1,000+ person operation. This is the blueprint; built in stages so
each lands testable.

## What exists today (base44 inherited)

`src/pages/Schedule.jsx` + `src/components/schedule/*`: week grid by role/member,
shift modal, context menu (single-shift copy/paste exists), template import,
Paylocity CSV import, publish flow, draft badges. No drag & drop, no undo, no
multi-select, no keyboard shortcuts, no suggestions.

## Stage 1 — Editing mechanics ✅ shipped 2026-07-03

What base44 already had: selection (click / Ctrl / Shift-range / Ctrl+A), copy/cut/
paste with role warnings, native drag & drop, single-level undo, Delete, Escape.
What this stage added: a real undo/redo engine (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y,
50 deep, batch entries) covering every operation including drags, pastes, and bulk
deletes; Alt+drag to copy; Ctrl+V pastes into the cell under the mouse; paste and
bulk delete run batched (fast at scale); a "?" shortcut cheat sheet; and a data-layer
guard so RLS-protected no-op deletes surface as errors instead of corrupting history.
Deferred to a later pass: drag-lasso selection, dragging a multi-selection as a group.

- **Drag & drop**: move a shift to another day/member (`@hello-pangea/dnd` is
  already a dependency — used nowhere yet). Drag = reassign + reschedule; hold
  Alt while dropping = copy instead of move.
- **Multi-select**: click + Ctrl-click + Shift-click ranges + drag-lasso over
  cells. Selection is the unit for every operation below.
- **Clipboard**: Ctrl+C / Ctrl+X / Ctrl+V for the selection; paste targets the
  hovered cell (member × day), preserving times and offsets between shifts.
  (PasteRoleWarningDialog already handles role-mismatch warnings — keep it.)
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z. Implementation: an in-memory command
  stack in the Schedule page — every mutation (create/update/delete) records its
  inverse; undo replays the inverse through the data layer. Depth ~50. Works for
  drag moves, paste, delete, publish is excluded (has its own confirmation).
- **Delete / Escape / arrow-key nudge** on selection.
- A visible shortcut cheat-sheet (? key).

## Stage 2 — 24/7 clarity ✅ shipped 2026-07-03

- ✅ `formatEndTime`: end times crossing midnight show "(+1)" everywhere.
- ✅ Overnight shift cards show a moon icon (ShiftCard).
- ✅ **Business-day boundary**: Settings → Shift Rules → "Business Day Starts At"
  (12 AM–6 AM, company-wide or per-location; stored as
  `business_day_start_hour`, currently set to 4 AM). Grouping helper is
  `businessDayOf()` in lib/utils; applied in ScheduleGrid, DayViewSummary,
  MySchedule, and ViewSchedule, and every week query window shifts by the
  boundary (verified live: a 1 AM Saturday shift renders under Friday).
- ✅ DayViewSummary end times use the (+1) marker.
- Live Roadmap already computes "on the floor now" span-based — unchanged.

## Stage 3 — Views ✅ core shipped 2026-07-03

- ✅ **Day Timeline** (`DayTimeline.jsx`, in the view dropdown): hour-axis view —
  columns are the 24 hours starting at the business-day boundary, rows are
  roles, shifts are positioned bars with lane-stacking for overlaps, draft
  styling, open-shift highlight, overnight moon + "runs past" marker, and a
  "now" line. Available in the builder and the read-only team schedule.
- ✅ **"Only scheduled" row filter**: hides members without shifts in the
  window; auto-on above 50 members (toggle in the builder toolbar); always on
  for the team-facing schedule. This is the pragmatic 1,000-member answer —
  full row virtualization (react-window) deferred until real data proves it's
  still needed.
- Deferred: month/coverage heatmap (revisit with real staffing data).

## Stage 4 — Suggestions

- **"Copy last week"** (exists as template import; make it one click).
- **Pattern suggestions**: for an empty cell, offer the member's most common
  shift for that weekday (computed from the last 8 weeks of their shifts).
- **Holiday awareness**: a `holidays` reference table (or blackout_days reuse);
  the builder banners upcoming holidays and suggests staffing based on the same
  holiday last year.
- **Conflict warnings while building** (some exist): overlap, over-hours,
  time-off collisions, availability mismatches — surface as you place, not
  after.

## Non-goals for now

Auto-scheduling/optimization (generate a full schedule from demand curves) —
revisit after real usage data accumulates in Postgres.

## Suggested order

Stage 1 first (it changes the data flow everything else builds on), then 2's
remaining items, 3, 4. Each stage is roughly one working session.
