-- =============================================================================
-- Policy approval flow
--
-- Managers no longer publish policies directly — they SUBMIT for approval, and a
-- location_admin+ approves (publishes) or sends it back. location_admin+ still
-- publish their own policies directly. (Deleting stays as archive, which
-- moderators can already do via the update policy — no change needed there.)
--
--   draft --submit--> pending_approval --approve(publish)--> published
--                            \--reject--> draft
-- =============================================================================

-- New status. Safe in a single migration: nothing here EXECUTES a query using
-- the value, so the "unsafe use of new enum value" restriction doesn't apply.
alter type public.policy_status add value if not exists 'pending_approval' before 'published';

-- -----------------------------------------------------------------------------
-- publish_policy — now location_admin+ only. (Body otherwise identical to
-- 20260725000002; the manager-author path is removed so managers must submit.)
-- -----------------------------------------------------------------------------
create or replace function public.publish_policy(pid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.policies;
begin
  select * into p from public.policies where id = pid;
  if not found then
    raise exception 'policy not found';
  end if;
  if not (select private.is_at_least('location_admin')) then
    raise exception 'only location admins and above may publish — managers submit for approval';
  end if;
  if not exists (select 1 from public.policy_roles where policy_id = pid) then
    raise exception 'choose at least one role this policy applies to';
  end if;
  if not exists (select 1 from public.policy_locations where policy_id = pid) then
    raise exception 'choose at least one club this policy applies at';
  end if;
  if not private.covers_only_my_locations(pid) then
    raise exception 'not allowed to publish to a club you do not manage';
  end if;

  update public.policies
  set status = 'published', published_at = coalesce(published_at, now())
  where id = pid;

  if p.requires_acknowledgment then
    insert into public.policy_recipients (policy_id, team_member_id)
    select pid, tm.id
    from public.team_members tm
    where tm.status = 'active'
      and private.in_policy_audience(pid, tm.id)
    on conflict do nothing;

    perform private.notify(
      r.team_member_id, 'policy_published', 'New policy to review',
      p.title, 'Policy', pid
    )
    from public.policy_recipients r
    where r.policy_id = pid and r.acknowledged_at is null;
  end if;
end;
$$;

grant execute on function public.publish_policy(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- submit_policy — a manager (author or a moderator) sends a draft up for review.
-- Same audience/scope validation as publishing, so approval is a yes/no, not a
-- fix-it. Notifies the location_admin+ who can approve at the policy's clubs.
-- -----------------------------------------------------------------------------
create or replace function public.submit_policy(pid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.policies;
begin
  select * into p from public.policies where id = pid;
  if not found then
    raise exception 'policy not found';
  end if;
  if not (select private.is_at_least('manager')) then
    raise exception 'only managers and above may submit policies';
  end if;
  if p.created_by <> private.current_team_member_id() and not private.can_moderate_policy(pid) then
    raise exception 'not allowed to submit this policy';
  end if;
  if p.status <> 'draft' then
    raise exception 'only drafts can be submitted for approval';
  end if;
  if not exists (select 1 from public.policy_roles where policy_id = pid) then
    raise exception 'choose at least one role this policy applies to';
  end if;
  if not exists (select 1 from public.policy_locations where policy_id = pid) then
    raise exception 'choose at least one club this policy applies at';
  end if;
  if not private.covers_only_my_locations(pid) then
    raise exception 'not allowed to submit to a club you do not manage';
  end if;

  update public.policies set status = 'pending_approval' where id = pid;

  perform private.notify(
    tm.id, 'policy_pending_approval', 'Policy awaiting approval',
    p.title, 'Policy', pid
  )
  from public.team_members tm
  where tm.status = 'active'
    and private.permission_rank(tm.permission_level) >= private.permission_rank('location_admin')
    and (
      private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
      or exists (
        select 1 from public.policy_locations pl
        join private.member_location_ids(tm.id) ml on ml.location_id = pl.location_id
        where pl.policy_id = pid
      )
    );
end;
$$;

grant execute on function public.submit_policy(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- reject_policy — a location_admin+ sends a submission back to draft with an
-- optional note, and the author is told why.
-- -----------------------------------------------------------------------------
create or replace function public.reject_policy(pid uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.policies;
begin
  select * into p from public.policies where id = pid;
  if not found then
    raise exception 'policy not found';
  end if;
  if not ((select private.is_at_least('location_admin')) and private.covers_only_my_locations(pid)) then
    raise exception 'only location admins and above may review submissions for their clubs';
  end if;
  if p.status <> 'pending_approval' then
    raise exception 'only submitted policies can be sent back';
  end if;

  update public.policies set status = 'draft' where id = pid;

  perform private.notify(
    p.created_by, 'policy_rejected', 'Policy sent back for changes',
    p.title || coalesce(' — ' || nullif(trim(p_note), ''), ''), 'Policy', pid
  );
end;
$$;

grant execute on function public.reject_policy(uuid, text) to authenticated;
