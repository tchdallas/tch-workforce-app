# TCH Workforce — project briefing

Staff scheduling + operations app for **Texas Card House**, a 24/7 poker room with ~1,000 team members across several locations. Migrated off a base44 prototype onto **Supabase + Vercel**. Owner-builder is Victor (victor@texascardhouse.com), non-engineer — explain changes in plain language and verify before asserting things work.

## Stack
- **React + Vite + Tailwind + shadcn/ui** (JavaScript, not TypeScript in app code)
- **Supabase**: Postgres + Auth + Storage + Realtime, secured by **Row-Level Security**. SQL lives in `supabase/migrations/` (timestamped, applied in order).
- **Data layer**: `src/api/dataClient.js` — a base44-SDK-compatible adapter over Supabase (camelCase↔snake_case, junction-table sync, pagination past the 1,000-row cap). Screens call `base44.entities.X.list/filter/create/update/delete`.
- **State**: TanStack Query (react-query).

## Run & deploy
- Install: `npm install`  ·  Dev server: `npm run dev` (http://localhost:5173)
- Build check: `npm run build`
- **Deploy (production):** `npx vercel deploy --prod --yes` → https://tch-workforce.vercel.app. Deploys go through the **Vercel CLI, not GitHub** — pushing to GitHub does NOT deploy.
- **Apply a DB migration:** `npx supabase db push -p <DB_PASSWORD>` (password is not in the repo — ask Victor).

## Secrets & environment
- **`.env.local`** (gitignored, required to run) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It does NOT travel via git — it must be present locally or the app white-screens.
- Never commit secrets. The Supabase DB password and service keys stay out of the repo.

## Critical conventions (violating these causes real bugs)
- **Never hard-delete** team members or records — set `status = 'archived'`. Every action is audited (`audit_logs`). Deletes in `dataClient` throw if 0 rows changed.
- **RLS is the source of truth.** Team-member-level users can't read coworkers' rows, so any client-side eligibility math over `team_members` breaks for them — use definer RPCs (e.g. `qualified_for_shift`, `roadmap_clocked_in`).
- **Realtime**: call `supabase.realtime.setAuth(token)` BEFORE subscribing, or RLS silently filters every event.
- **Shared react-query keys must use identical fetches.** Two `useQuery`s under the same key with different `queryFn`s overwrite each other's cache (this caused the archived-members-leaking-into-search bug).
- **24/7 time model**: business day boundary is `business_day_start_hour` (default 4 AM). Overnight shifts are normal; `formatEndTime()` adds "(+1)", `businessDayOf()` groups by gaming day.
- **`user_id`** on team_members is the auth-account link, managed only by DB triggers — never write it from the client (it's in `dataClient` readOnly).

## Time clock
Kiosk (badge #) + mobile punch via `punch_clock` RPC. Clock-in requires choosing a gaming-day shift or an unscheduled role. Forgotten punches auto-close via pg_cron. Callouts auto-clock-out. Export to Paylocity Universal Time Import (24-col headerless CSV, sanitized).

## Notifications
DB triggers call `private.notify()` (honors `notification_preferences`). In-app toasts via `useRealtimeNotifications`. Stale browser tabs self-update via `useVersionCheck`; kiosks auto-reload on deploy.

## Brand (Brand Book 2024)
Signature Gold `#d2ad74`, black, Cool Gray `#f2f4f8`, Deep Gold `#86764e`, Navy `#0c2340`. Bebas Neue headlines (`font-display`), Figtree body. Chip mark at `public/tch-mark-gold.png`.

## Attendance points & progressive discipline (built July 2026, in prod DB, NOT yet deployed to Vercel)
Digitizes the 2026 Attendance Policy + the paper Performance Documentation form. Key decisions:
- **Attendance** (`/attendance`, manager+): per-location roster with search, one **company-wide** point balance per member (location filter only scopes the list). Points issued via `issue_attendance_infraction` RPC (snapshots catalog value, doubles on high-volume days). Managers issue; **location_admin+ excuses/decides appeals** (separation of duties). Rolling 12-month window; 5-pt cap first 90 days, then 10; ladder 4/6/8/10. Every policy number lives in `attendance_policy_settings` + `attendance_infraction_types` — **super_admin-editable** in Settings → Attendance Policy; functions read live.
- **Discipline** (TeamMemberModal "File" tab): journal notes-to-file (per-note share-with-member choice) + Performance Documentation ladder Info→DC→WW→FWW→SPI→Separation (SPI/Separation = location_admin+, enforced in RLS and RPC). Typed-name digital signatures; member signs/refuses from My Profile → Documents; drafts invisible to member; transitions only via RPCs (issue/sign/refuse/witness/void).
- **Dashboard "Needs Your Attention"** (`src/components/dashboard/ActionItems.jsx`): task inbox on both dashboard variants — docs awaiting signature, attendance points in appeal window (inline appeal). Future sources (announcements w/ acknowledgment, policy updates, training) plug in here.
- Next up: auto-suggestion engine (draft infractions from `time_entries`/`callouts` for manager confirmation), member-facing full attendance detail (points history, next-to-expire), auto-draft DC/WW docs at attendance thresholds.

## Backlog (from Phase 4 + HR/GM brainstorm)
Par levels (coverage vs. schedule), communication tools (Discord-style channels/DMs — schema exists, UI deferred), announcements with read-confirmation, PTO vs. unpaid type, upcoming-shift reminders, email channel + invite flow, tournament downs, turnover reporting (needs term reason on archive), surveys/training tasks, super-admin view-as. Detailed history is in the git log and `supabase/migrations/`.
