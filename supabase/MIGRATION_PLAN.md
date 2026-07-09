# TCH Workforce — Supabase Migration Plan (Phase 1: Schema + RLS)

Follows `TCH-Workforce-Data-Model.md` (the Phase 1 blueprint): all 18 base44 entities
plus the new notification-preference and messaging tables — 21 tables across 6 domains,
one migration per domain, each reviewed before the next.

## Permission model (used by all domains)

Hierarchy (from `TeamMember.permissionLevel`), highest first:

| Level | Rank | Access (per the data model doc) |
|---|---|---|
| `super_admin` | 6 | Everything, incl. system settings and audit log |
| `corporate_admin` | 5 | All locations |
| `location_admin` | 4 | Full control of assigned locations, incl. pay rates and settings |
| `manager` | 3 | + approve/deny requests, manage staff at their locations |
| `scheduler` | 2 | + create/edit shifts and templates at their locations |
| `team_member` | 1 | Own record/shifts/requests/notifications/conversations; published schedules at their locations; can create requests and send messages |

RLS helpers live in a `private` schema (SECURITY DEFINER, not exposed via the API):
`current_team_member_id()`, `current_permission_rank()`, `is_at_least(level)`,
`has_location_access(location_id)`, `can_view_member(id)`, `can_manage_member(id)`.
Built first (Domain 1), then policies are written table by table — as the doc specifies.

Auth linking: `team_members.user_id → auth.users.id`, auto-linked by email in both
directions (signup trigger on `auth.users`, insert trigger on `team_members`). The
base44 `User` entity (admin/user) is superseded by `permission_level` and is not migrated.

## Domain 1 — Organization ✅ approved

`20260702000001_foundation_identity.sql`

- Enums: `permission_level`, `member_status`, `record_status`, `theme_preference`
- `locations`, `roles` + `role_locations` junction
- `team_members` + `team_member_locations`, `team_member_roles` junctions
- `team_member_pay_rates` (per person, per location, per role)
- `team_member_directory` view — safe columns (names, photo, home location) readable by
  all authenticated users so schedules render coworker names without exposing PII
- Anti-escalation trigger on `team_members`: self-service edits limited to personal
  fields; nobody can grant a permission level above their own or edit a peer/superior

Locked decisions (Victor, 2026-07-02): team members see their own pay rate; manager+
see all pay rates; roles manageable by location_admin+; directory keeps
`permission_level`; junction tables readable by all signed-in users.

## Domain 2 — Scheduling ✅ approved (with amendments)

`20260702000002_scheduling.sql`

- Enums: `shift_status`, `shift_type`, `coverage_status`, `availability_type`,
  `blackout_rule_type`, `request_status` (shared with Domain 3)
- `shifts` (team_member nullable = open shift)
- `schedule_templates` + `schedule_template_shifts` (base44's embedded array → child table)
- `availability`, `blackout_days`
- RLS: raw `shifts` table is scheduler+-only at their locations (it holds pay + internal
  notes); team members read published schedules via the `schedule_shifts` view, which
  strips pay columns, internal notes, and warnings
- Blackout days: readable by everyone; location_admin+ manages

Locked decisions (Victor, 2026-07-02): schedulers may see shift-level labor costs;
drafts visible to anyone who can edit the schedule (scheduler+), never to team members;
**availability is submit → approve/deny** (members submit as pending; scheduler+ or
manager reviews); **no hard deletes anywhere** — only draft shifts are deletable
(schedule editing), everything else archives/cancels, and every action must be
auditable (see Domain 4).

## Domain 3 — Requests & coverage ✅ approved (with amendments)

`20260702000003_requests_coverage.sql`

- Enums: `trade_status`, `giveaway_status`, `giveaway_offer_type`, `callout_status`
- `time_off_requests`, `shift_trade_requests`, `shift_giveaway_requests`
  + `shift_giveaway_targets` junction, `open_shift_claims`, `callouts`
- Shared RLS shape: members create requests about themselves (initial status forced,
  no self-approval), can cancel while undecided; time off / claims / callouts reviewed
  by manager+ at their locations; scheduler+ can read time-off at their locations.
  **No DELETE policies** — requests are cancelled/denied, never removed.

Locked decisions (Victor, 2026-07-02): **trades/giveaways complete directly on
acceptance by default** — the only gate is having the shift's role + location
assigned, enforced in RLS (`is_qualified_for_shift`); the `shift_swap_approval`
setting can require manager approval globally or for specific roles (routing
trigger in Domain 4); managers can always override. `no_shift_swap` split into
two flags: `no_shift_swap_give` (can't initiate) and `no_shift_swap_receive`
(can't accept) — toggle both, one, or none.

## Domain 4 — Operations & admin ✅ approved (with amendments)

`20260702000004_operations_admin.sql`

- Enums: `setting_scope`, `roadmap_note_type`, `roadmap_visibility`
- `app_settings` — key + **jsonb value**, company/location/user scope (one row per
  key per scope target, enforced). Documented key: `shift_swap_approval` →
  `{"mode": "none"|"all"|"roles", "role_ids": [...]}`, location overrides company,
  absent = no approval required
- `audit_logs` — append-only (no update/delete policies). Only super_admin sees all
  locations; manager+ reads shift-related history **at their assigned locations only**
  (the audit trigger stamps each entry with a derived `location_id`)
- `live_roadmap_notes` — visibility ladder (team-facing / managers / role-specific
  managers / admins) within the note's location; manager+ writes
- **Everything-audit trigger** on all 20 business tables: before/after jsonb images
  for every insert/update/delete, written as definer (can't be bypassed)
- **Approval-routing triggers** on trades/giveaways implementing the
  `shift_swap_approval` setting

## Domain 5 — Notifications ✅ approved

`20260702000005_notifications.sql`

- `notifications` (existing entity; channel enum: push / email / in_app — base44's
  `sms_placeholder` dropped per the data model doc) + Realtime enabled. Recipients
  see/update only their own; no delete (read_status is the dismiss). Client-side
  insert allowed as a Phase 2 interim until Phase 4 triggers take over creation.
- `notification_preferences` (NEW): one row per (team_member, event_type);
  `enabled`, `channels[]`, `settings jsonb` (lead times, shift-offer filters).
  Personal — own rows only.
- No audit trigger (per Victor); schema only in Phase 1 — triggers and the reminder
  Edge Function are Phase 4

## Domain 6 — Messaging (NEW, Discord-style) ✅ approved

`20260702000006_messaging.sql`

- `conversations` (type: **direct / group / role_group**), `conversation_participants`
  (`last_read_at` drives unread badges), `messages`, `member_blocks` + Realtime on
  messages
- Per Victor (2026-07-02): DMs limited to **own locations**; location_admin+ can
  **see and edit** all conversations touching their locations; **custom groups**
  created/managed by manager+; **role groups** auto-sync membership from role +
  location assignments (triggers on team_member_roles / team_member_locations /
  home_location changes); **blocking** — any member can block another except
  location_admin+ and except manager+ sharing one of the blocker's locations
  (can't block your own manager), a block kills DMs both ways; only manager+
  adds people to groups, role groups take no manual adds; any conversation can
  be **muted** (participants.muted), but role groups cannot be left
- Messages: senders edit their own; delete is **soft** (`deleted_at`) — no hard
  deletes; threads are never deleted
- No audit trigger (per Victor); UI and notification trigger are Phase 5

## Phase 2 additions

- `20260702000007_storage.sql` — profile-photos bucket (public read, signed-in upload)
- `20260703000001_swap_execution.sql` — definer triggers that execute completed
  giveaways (assign shift to acceptor) and approved trades (swap both shifts);
  members never write to `shifts` directly. Also: targeted members may decline
  a giveaway (`denied`).

## Deferred (per roadmap, not in Phase 1)

- Notification triggers + reminder Edge Function (Phase 4)
- Edge Function ports: `archiveOldShifts`, `terminateTeamMember` (Phase 7)
- Time-clock / `time_entries` — explicitly out of scope until decided

## Open decisions flagged in the roadmap that touch the schema

- **Timezones:** per-location `timezone` column exists (default America/Chicago);
  shift times stored as `timestamptz` — handles multi-timezone either way
- **Scale check:** headcount/location count — current design is fine for any
  plausible size; only affects Supabase pricing tier

## Conventions

- snake_case columns; `id uuid primary key default gen_random_uuid()`
- `created_at` / `updated_at timestamptz` with a shared `set_updated_at()` trigger
- Real foreign keys everywhere; **no hard deletes** — archive/cancel via status (the
  only exception is draft shifts during schedule editing); every write is captured by
  the Domain 4 audit trigger
- All tables have RLS **enabled**; policies grant to `authenticated` only, so `anon` sees nothing
- Enum-typed status columns instead of free text
- **Phase 3 (revised 2026-07-03):** there is no base44 production data — Victor only
  tested there. Real data arrives via the Team Members CSV import fed by a Paylocity
  export (the importer recognizes Paylocity column names as-exported). Launch order:
  create real locations → create real roles → import the Paylocity CSV → staff
  self-onboard via "First time here? Set up your password" (zero emails). Wipe the
  ZZTEST test data before going live.
