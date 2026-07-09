-- =============================================================================
-- Swap execution: the database, not the client, transfers shifts when a
-- giveaway or trade completes. Members can't write to shifts directly (RLS),
-- so these definer triggers perform the reassignment the moment a request
-- reaches its final accepted/approved state — no matter who moved it there.
-- Also: targeted members may decline a giveaway aimed at them.
-- =============================================================================

-- giveaway completed -> hand the shift to the accepting member
create or replace function private.execute_giveaway_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('accepted', 'approved')
     and old.status is distinct from new.status
     and new.accepting_team_member_id is not null then
    update public.shifts
    set team_member_id = new.accepting_team_member_id,
        shift_type = 'assigned',
        coverage_status = 'covered',
        recent_change_flag = true
    where id = new.shift_id;
  end if;
  return null;
end;
$$;

create trigger zz_execute_transfer after update on public.shift_giveaway_requests
  for each row execute function private.execute_giveaway_transfer();

-- trade approved -> swap the two shifts' members
create or replace function private.execute_trade_swap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    update public.shifts
    set team_member_id = new.target_team_member_id,
        recent_change_flag = true
    where id = new.original_shift_id;
    update public.shifts
    set team_member_id = new.requesting_team_member_id,
        recent_change_flag = true
    where id = new.requested_shift_id;
  end if;
  return null;
end;
$$;

create trigger zz_execute_swap after update on public.shift_trade_requests
  for each row execute function private.execute_trade_swap();

-- amend giveaway update policy: a targeted member may decline (-> denied)
drop policy "shift_giveaway_requests_update" on public.shift_giveaway_requests;
create policy "shift_giveaway_requests_update" on public.shift_giveaway_requests
  for update to authenticated
  using (
    (
      original_team_member_id = private.current_team_member_id()
      and status in ('open', 'pending_manager')
    )
    or private.giveaway_open_to_me(id)
    or private.can_manage_member(original_team_member_id)
    or private.can_review_shift(shift_id)
  )
  with check (
    (
      original_team_member_id = private.current_team_member_id()
      and status = 'cancelled'
    )
    or (
      accepting_team_member_id = private.current_team_member_id()
      and status in ('accepted', 'pending_manager')
      and not private.swap_receive_blocked()
      and private.is_qualified_for_shift(shift_id)
    )
    or (
      private.giveaway_targets_me(id)
      and status = 'denied'
    )
    or private.can_manage_member(original_team_member_id)
    or private.can_review_shift(shift_id)
  );
