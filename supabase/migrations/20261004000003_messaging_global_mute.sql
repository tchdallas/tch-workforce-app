-- =============================================================================
-- Messaging mute is per PERSON, not per channel
--
-- An admin mute now stops the member posting anywhere in Messages (DMs,
-- groups, role channels) until an admin lifts it. One row per muted member
-- in messaging_mutes records who muted them, when and why, so there is one
-- place to review and undo every mute.
--
-- Rules (enforced in set_messaging_mute, the only way to write the table):
--   * location_admin+ only
--   * never yourself
--   * only someone ranked strictly below you (same hierarchy as discipline)
--   * only people at your clubs (corporate+ anywhere)
-- The muted member is told they were muted / unmuted.
--
-- The per-conversation silenced_at/silenced_by columns from 20261004000001
-- are no longer consulted. They are left in place (unused) so the currently
-- deployed client keeps working until the release; drop them in a later
-- cleanup migration.
-- =============================================================================

create table public.messaging_mutes (
  team_member_id uuid primary key references public.team_members (id) on delete cascade,
  muted_by       uuid not null references public.team_members (id),
  muted_at       timestamptz not null default now(),
  reason         text
);

alter table public.messaging_mutes enable row level security;

-- you can see your own mute (the app shows a banner); admins see every mute
-- they could manage. No insert/update/delete policies: writes go through the RPC.
create policy "messaging_mutes_select" on public.messaging_mutes
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('location_admin'))
      and private.shares_location_with(team_member_id)
    )
  );

-- moderation actions are audited (unlike chat itself)
create trigger audit after insert or delete on public.messaging_mutes
  for each row execute function private.write_audit_log();

create or replace function private.is_messaging_muted()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.messaging_mutes
    where team_member_id = private.current_team_member_id()
  );
$$;

create or replace function public.set_messaging_mute(p_member uuid, p_muted boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me     uuid := private.current_team_member_id();
  v_name text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not private.is_at_least('location_admin') then
    raise exception 'Only admins can mute team members in Messages';
  end if;
  if p_member = me then
    raise exception 'You cannot mute or unmute yourself';
  end if;
  if private.member_rank(me) <= private.member_rank(p_member) then
    raise exception 'You can only mute team members ranked below you';
  end if;
  if not private.shares_location_with(p_member) then
    raise exception 'You can only mute team members at your clubs';
  end if;

  if p_muted then
    insert into public.messaging_mutes (team_member_id, muted_by, reason)
    values (p_member, me, nullif(trim(p_reason), ''))
    on conflict (team_member_id) do update
      set muted_by = excluded.muted_by, muted_at = now(),
          reason = coalesce(excluded.reason, public.messaging_mutes.reason);
    perform private.notify(
      p_member, 'messaging_muted', 'Your messaging has been muted',
      'An admin has turned off your ability to post in Messages. You can still read your conversations.'
        || case when nullif(trim(p_reason), '') is not null then ' Reason: ' || trim(p_reason) else '' end,
      'team_member', p_member);
  else
    delete from public.messaging_mutes where team_member_id = p_member;
    if found then
      perform private.notify(
        p_member, 'messaging_unmuted', 'Your messaging has been restored',
        'An admin has turned your ability to post in Messages back on.',
        'team_member', p_member);
    end if;
  end if;
end;
$$;

grant execute on function public.set_messaging_mute(uuid, boolean, text) to authenticated;

-- posting is refused while muted (anywhere)
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (
    sender_team_member_id = private.current_team_member_id()
    and private.is_conversation_participant(conversation_id)
    and not private.dm_blocked(conversation_id)
    and not private.is_messaging_muted()
    and private.mentions_permitted(mentions)
  );

-- the per-channel guard is obsolete (and the old columns are no longer written)
drop trigger if exists guard_silence_change on public.conversation_participants;
drop function if exists private.guard_silence_change();
drop function if exists private.is_silenced(uuid);

-- carry over any channel mutes that are still active
insert into public.messaging_mutes (team_member_id, muted_by, muted_at)
select distinct on (team_member_id) team_member_id, silenced_by, silenced_at
from public.conversation_participants
where silenced_at is not null and silenced_by is not null and silenced_by <> team_member_id
order by team_member_id, silenced_at desc
on conflict (team_member_id) do nothing;
