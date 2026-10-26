-- Blocking should make the conversation disappear for BOTH people. The
-- blocker can compute that from their own member_blocks rows, but RLS keeps
-- those rows invisible to the person who was blocked — so the client needs a
-- definer function that answers "who do I have a block with, either way?"
-- without revealing anything else. It also returns the display name, because
-- the messaging directory already hides blocked people (so the blocker's
-- "Blocked" list couldn't name them otherwise).

create or replace function public.blocked_with()
returns table (member_id uuid, display_name text, i_blocked boolean)
language sql stable security definer set search_path = ''
as $$
  select
    case when b.blocker_team_member_id = private.current_team_member_id()
         then b.blocked_team_member_id else b.blocker_team_member_id end,
    private.member_display_name(
      case when b.blocker_team_member_id = private.current_team_member_id()
           then b.blocked_team_member_id else b.blocker_team_member_id end),
    b.blocker_team_member_id = private.current_team_member_id()
  from public.member_blocks b
  where private.current_team_member_id()
        in (b.blocker_team_member_id, b.blocked_team_member_id);
$$;

grant execute on function public.blocked_with() to authenticated;
