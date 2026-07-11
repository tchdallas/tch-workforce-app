-- =============================================================================
-- Performance documentation: journal entries (notes to file) + progressive
-- discipline documents, digitizing the TCH "Performance Documentation" form.
--
-- Two layers:
--   journal_entries      — quick manager notes on a team member: positive or
--                          negative, whether the member was informed, and a
--                          per-note choice to share it with the member.
--   discipline_documents — the formal form, field-for-field: entry-type ladder
--                          (Informational → DC → WW → FWW → SPI → Separation),
--                          nature checkboxes, the WHEN/WHERE-WHAT-WHY-HOW
--                          narrative, consequence language, and a typed-name
--                          digital signature flow (issuer → member → witness).
--
-- Controls:
--   * manager+ writes, scoped to members they manage (same as everywhere else)
--   * SPI and Separation require location_admin+ — enforced in RLS AND in the
--     issue RPC, so a manager cannot draft-then-issue around the gate
--   * documents are edited only as drafts; every transition (issue, sign,
--     refuse, witness, void) is an RPC so the state machine can't be skipped
--   * members see issued documents, never drafts; refusing to sign is recorded
--     and does not void the action (mirrors the paper form's language)
--
-- Replaces the unused attendance_discipline_actions table from the attendance
-- foundation migration — attendance-driven discipline is now just a
-- discipline_document with nature = 'attendance'.
-- =============================================================================

drop table if exists public.attendance_discipline_actions;

create type public.journal_sentiment as enum ('positive', 'negative', 'neutral');

create type public.discipline_entry_type as enum (
  'informational',
  'documented_coaching',
  'written_warning',
  'final_written_warning',
  'suspension_pending_investigation',
  'separation'
);

create type public.discipline_nature as enum (
  'attendance',
  'policy_performance',
  'ethics_conduct'
);

create type public.discipline_doc_status as enum (
  'draft',        -- being written; invisible to the member
  'issued',       -- signed by the issuer; awaiting the member
  'acknowledged', -- member signed (recognition of the discussion, not agreement)
  'refused',      -- member declined to sign; action still stands
  'voided'        -- struck by an admin (wrong member, duplicate, etc.)
);

-- -----------------------------------------------------------------------------
-- journal_entries
-- -----------------------------------------------------------------------------

create table public.journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  team_member_id     uuid not null references public.team_members (id),
  author_id          uuid not null references public.team_members (id),
  location_id        uuid references public.locations (id), -- defaults to member's home (trigger)
  entry_date         date not null default current_date,
  sentiment          public.journal_sentiment not null default 'neutral',
  note               text not null,
  informed           boolean not null default false, -- was the member told verbally?
  shared_with_member boolean not null default false, -- can the member read it in-app?
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index journal_entries_member_idx on public.journal_entries (team_member_id, entry_date);
create index journal_entries_location_idx on public.journal_entries (location_id);

-- -----------------------------------------------------------------------------
-- discipline_documents
-- -----------------------------------------------------------------------------

create table public.discipline_documents (
  id                  uuid primary key default gen_random_uuid(),
  team_member_id      uuid not null references public.team_members (id),
  location_id         uuid references public.locations (id), -- defaults to member's home (trigger)
  entry_type          public.discipline_entry_type not null,
  suspension_days     integer check (suspension_days is null or suspension_days > 0),
  natures             public.discipline_nature[] not null default '{}',
  prior_documentation text,
  incident_when_where text, -- WHEN and WHERE the incident occurred
  observed_behavior   text, -- WHAT was observed (versus the expectation)
  why_important       text, -- WHY it matters / policy violated
  correction_plan     text, -- HOW to correct going forward
  consequence         text not null default 'Continuing like behavior, or failure to comply with company policies may result in additional discipline up to and including termination.',
  employee_comments   text,
  status              public.discipline_doc_status not null default 'draft',
  created_by          uuid references public.team_members (id),
  issued_by           uuid references public.team_members (id),
  issued_at           timestamptz,
  issuer_signed_name  text,
  member_signed_name  text,
  member_signed_at    timestamptz,
  member_refused_at   timestamptz,
  witness_id          uuid references public.team_members (id),
  witness_signed_name text,
  witness_signed_at   timestamptz,
  voided_by           uuid references public.team_members (id),
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (entry_type <> 'suspension_pending_investigation' or suspension_days is not null)
);

create index discipline_documents_member_idx on public.discipline_documents (team_member_id, created_at);
create index discipline_documents_status_idx on public.discipline_documents (status);
create index discipline_documents_location_idx on public.discipline_documents (location_id);

-- -----------------------------------------------------------------------------
-- Triggers: default location, updated_at, audit
-- -----------------------------------------------------------------------------

create or replace function private.default_member_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_id is null then
    select home_location_id into new.location_id
    from public.team_members where id = new.team_member_id;
  end if;
  return new;
end;
$$;

create trigger default_location before insert on public.journal_entries
  for each row execute function private.default_member_location();
create trigger default_location before insert on public.discipline_documents
  for each row execute function private.default_member_location();

create trigger set_updated_at before update on public.journal_entries
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.discipline_documents
  for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.journal_entries
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.discipline_documents
  for each row execute function private.write_audit_log();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.journal_entries enable row level security;
alter table public.discipline_documents enable row level security;

-- the SPI/Separation gate, reused in RLS and the issue RPC
create or replace function private.can_issue_discipline(t public.discipline_entry_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t in ('suspension_pending_investigation', 'separation')
      then private.is_at_least('location_admin')
    else private.is_at_least('manager')
  end;
$$;

-- journal: managers see entries for their members; the member sees a note only
-- when it was explicitly shared with them
create policy "journal_select" on public.journal_entries
  for select to authenticated
  using (
    private.can_manage_member(team_member_id)
    or (team_member_id = private.current_team_member_id() and shared_with_member)
  );
create policy "journal_insert" on public.journal_entries
  for insert to authenticated
  with check (
    (select private.is_at_least('manager'))
    and private.can_manage_member(team_member_id)
    and author_id = private.current_team_member_id()
  );
create policy "journal_update" on public.journal_entries
  for update to authenticated
  using ((select private.is_at_least('manager')) and private.can_manage_member(team_member_id))
  with check ((select private.is_at_least('manager')) and private.can_manage_member(team_member_id));
-- no delete: notes to file are permanent record

-- discipline documents: managers see their members' docs; the member sees
-- everything except drafts and voided docs
create policy "discipline_select" on public.discipline_documents
  for select to authenticated
  using (
    private.can_manage_member(team_member_id)
    or (team_member_id = private.current_team_member_id()
        and status in ('issued', 'acknowledged', 'refused'))
  );
create policy "discipline_insert" on public.discipline_documents
  for insert to authenticated
  with check (
    private.can_manage_member(team_member_id)
    and private.can_issue_discipline(entry_type)
    and status = 'draft'
    and created_by = private.current_team_member_id()
  );
-- direct updates only while draft; every status transition goes through an RPC
create policy "discipline_update" on public.discipline_documents
  for update to authenticated
  using (
    status = 'draft'
    and private.can_manage_member(team_member_id)
    and (select private.is_at_least('manager'))
  )
  with check (
    status = 'draft'
    and private.can_manage_member(team_member_id)
    and private.can_issue_discipline(entry_type)
  );
-- no delete: void instead

-- -----------------------------------------------------------------------------
-- State-machine RPCs
-- -----------------------------------------------------------------------------

create or replace function public.issue_discipline_document(p_id uuid, p_signed_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not (private.can_manage_member(d.team_member_id) and private.can_issue_discipline(d.entry_type)) then
    raise exception 'Not authorized to issue this document';
  end if;
  if d.status <> 'draft' then raise exception 'Only drafts can be issued'; end if;
  if p_signed_name is null or trim(p_signed_name) = '' then
    raise exception 'Type your name to sign as the issuing manager';
  end if;

  update public.discipline_documents
    set status = 'issued', issued_by = actor, issued_at = now(),
        issuer_signed_name = trim(p_signed_name)
  where id = p_id;
end;
$$;

create or replace function public.sign_discipline_document(
  p_id uuid, p_signed_name text, p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.team_member_id <> private.current_team_member_id() then
    raise exception 'Only the team member named on the document can sign it';
  end if;
  if d.status <> 'issued' then raise exception 'This document is not awaiting your signature'; end if;
  if p_signed_name is null or trim(p_signed_name) = '' then
    raise exception 'Type your full name to sign';
  end if;

  update public.discipline_documents
    set status = 'acknowledged',
        member_signed_name = trim(p_signed_name),
        member_signed_at = now(),
        employee_comments = coalesce(nullif(trim(p_comments), ''), employee_comments)
  where id = p_id;
end;
$$;

create or replace function public.refuse_discipline_document(p_id uuid, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.team_member_id <> private.current_team_member_id() then
    raise exception 'Only the team member named on the document can respond to it';
  end if;
  if d.status <> 'issued' then raise exception 'This document is not awaiting your signature'; end if;

  update public.discipline_documents
    set status = 'refused',
        member_refused_at = now(),
        employee_comments = coalesce(nullif(trim(p_comments), ''), employee_comments)
  where id = p_id;
end;
$$;

create or replace function public.witness_discipline_document(p_id uuid, p_signed_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not ((select private.is_at_least('manager')) and private.can_manage_member(d.team_member_id)) then
    raise exception 'Only a manager can witness a document';
  end if;
  if actor = d.team_member_id then
    raise exception 'The subject of a document cannot witness it';
  end if;
  if d.status not in ('issued', 'acknowledged', 'refused') then
    raise exception 'Only issued documents can be witnessed';
  end if;
  if p_signed_name is null or trim(p_signed_name) = '' then
    raise exception 'Type your name to sign as witness';
  end if;

  update public.discipline_documents
    set witness_id = actor,
        witness_signed_name = trim(p_signed_name),
        witness_signed_at = now()
  where id = p_id;
end;
$$;

create or replace function public.void_discipline_document(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not ((select private.is_at_least('location_admin')) and private.can_manage_member(d.team_member_id)) then
    raise exception 'Only admins can void a document';
  end if;
  if d.status = 'voided' then raise exception 'Already voided'; end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to void a document';
  end if;

  update public.discipline_documents
    set status = 'voided', voided_by = private.current_team_member_id(),
        voided_at = now(), void_reason = trim(p_reason)
  where id = p_id;
end;
$$;

grant execute on function public.issue_discipline_document(uuid, text) to authenticated;
grant execute on function public.sign_discipline_document(uuid, text, text) to authenticated;
grant execute on function public.refuse_discipline_document(uuid, text) to authenticated;
grant execute on function public.witness_discipline_document(uuid, text) to authenticated;
grant execute on function public.void_discipline_document(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

create or replace function private.notify_discipline_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_label text := replace(initcap(replace(new.entry_type::text, '_', ' ')), 'Spi', 'SPI');
begin
  if new.status = 'issued' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.notify(
      new.team_member_id, 'discipline_issued', 'Document Requires Your Signature',
      format('A %s has been issued to you. Review and sign it under My Profile → Documents.', entry_label),
      'discipline_document', new.id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'acknowledged' and old.status is distinct from new.status then
    perform private.notify(
      new.issued_by, 'discipline_signed', 'Document Signed',
      format('%s signed the %s dated %s.',
             (select coalesce(tm.preferred_name, tm.first_name) || ' ' || tm.last_name
              from public.team_members tm where tm.id = new.team_member_id),
             entry_label, to_char(new.issued_at, 'Mon DD')),
      'discipline_document', new.id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'refused' and old.status is distinct from new.status then
    perform private.notify(
      new.issued_by, 'discipline_refused', 'Signature Refused',
      format('%s declined to sign the %s dated %s. The action still stands; the refusal is on record.',
             (select coalesce(tm.preferred_name, tm.first_name) || ' ' || tm.last_name
              from public.team_members tm where tm.id = new.team_member_id),
             entry_label, to_char(new.issued_at, 'Mon DD')),
      'discipline_document', new.id);
  end if;

  return null;
end;
$$;

create trigger notify_discipline after insert or update on public.discipline_documents
  for each row execute function private.notify_discipline_document();

-- journal notes: tell the member when a note is shared with them
create or replace function private.notify_journal_shared()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shared_with_member
     and (tg_op = 'INSERT' or old.shared_with_member is distinct from new.shared_with_member) then
    perform private.notify(
      new.team_member_id, 'journal_note_shared', 'Note Added to Your File',
      'A manager shared a note on your file. You can read it under My Profile → Documents.',
      'journal_entry', new.id);
  end if;
  return null;
end;
$$;

create trigger notify_journal after insert or update on public.journal_entries
  for each row execute function private.notify_journal_shared();
