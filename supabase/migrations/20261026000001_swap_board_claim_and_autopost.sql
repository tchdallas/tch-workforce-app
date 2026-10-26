-- Swap Board, friction removal:
--  1) swap_post_claim — a viewer takes a giveaway with ONE TAP (no reply
--     required), or proposes a trade directly by picking one of their own
--     shifts. Chat stays available but optional. The poster's old flow
--     (offer to a specific replier) still works for choosing between people.
--  2) Give-aways started from My Schedule that are offered to "anyone
--     qualified" now auto-create an open board post, so the board is the one
--     place everyone sees shifts up for grabs. The existing sync triggers
--     keep the tile's status in step with the request from then on.

-- ------------------------------------------------------------------ 1) claim

create or replace function public.swap_post_claim(
  p_post uuid,
  p_shift uuid default null,            -- trade: the claimer's own shift to give
  p_require_approval boolean default true
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me     uuid := private.current_team_member_id();
  post   public.swap_posts%rowtype;
  s      public.shifts%rowtype;
  mine   public.shifts%rowtype;
  req_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into post from public.swap_posts where id = p_post for update;
  if not found then raise exception 'Post not found'; end if;
  if post.status <> 'open' then raise exception 'This post is no longer open'; end if;
  if private.is_messaging_muted() then raise exception 'Your messaging is muted'; end if;
  if me = post.author_id then raise exception 'This is your own post'; end if;
  if post.intent = 'pickup' then raise exception 'Use "Offer one of my shifts" on a pick-up post'; end if;

  -- the shift on offer must still be the poster's, published, and in the future
  select * into s from public.shifts where id = post.shift_id;
  if not found or s.team_member_id is distinct from post.author_id
     or s.status <> 'published' then
    raise exception 'That shift is no longer available';
  end if;
  if s.start_at <= now() then raise exception 'That shift has already started'; end if;
  -- qualified_for_shift also excludes people blocked from receiving swaps
  if not exists (select 1 from public.qualified_for_shift(post.shift_id) q where q.id = me) then
    raise exception 'You are not qualified to work this shift';
  end if;

  perform set_config('tch.swap_internal', 'on', true);
  perform set_config('tch.swap_actor', me::text, true);

  if post.intent = 'giveaway' then
    if (select no_shift_swap_give from public.team_members where id = post.author_id) then
      raise exception 'The poster is not allowed to give away shifts';
    end if;

    if post.giveaway_request_id is not null then
      -- auto-posted from My Schedule: accept THAT broadcast request directly
      update public.shift_giveaway_requests
        set accepting_team_member_id = me,
            status = case when p_require_approval then 'pending_manager' else 'accepted' end,
            reviewed_at = now()
      where id = post.giveaway_request_id and status = 'open';
      if not found then raise exception 'This shift was just taken by someone else'; end if;
      req_id := post.giveaway_request_id;
    else
      -- board-native post: create the request and accept it in one motion
      insert into public.shift_giveaway_requests (original_team_member_id, shift_id, offer_type, status)
      values (post.author_id, post.shift_id, 'specific', 'open') returning id into req_id;
      insert into public.shift_giveaway_targets (giveaway_id, team_member_id) values (req_id, me);
      update public.swap_posts
        set status = 'pending', counterpart_id = me, giveaway_request_id = req_id
      where id = p_post;
      update public.shift_giveaway_requests
        set accepting_team_member_id = me,
            status = case when p_require_approval then 'pending_manager' else 'accepted' end,
            reviewed_at = now()
      where id = req_id;
    end if;

    perform private.swap_system_reply(p_post,
      private.member_display_name(me) || ' picked up this shift' ||
      case when p_require_approval then ' — pending manager approval.' else '.' end);
    perform private.notify(post.author_id, 'swap_offer',
      private.member_display_name(me) || ' picked up your shift',
      'From the Swap Board: ' || private.shift_when(s) ||
      case when p_require_approval then '. A manager still has to approve.' else '. The schedule is updated.' end,
      'swap_post', p_post);

  else -- trade: the claimer proposes their own shift; the poster accepts
    if p_shift is null then raise exception 'Pick which of your shifts to offer'; end if;
    select * into mine from public.shifts where id = p_shift;
    if not found or mine.team_member_id is distinct from me or mine.status <> 'published' then
      raise exception 'That shift is not yours to trade';
    end if;
    if mine.start_at <= now() then raise exception 'Your shift has already started'; end if;
    if (select no_shift_swap_give from public.team_members where id = me) then
      raise exception 'You are not allowed to give away shifts';
    end if;
    if not exists (select 1 from public.qualified_for_shift(p_shift) q where q.id = post.author_id) then
      raise exception 'They are not qualified to work your shift';
    end if;

    insert into public.shift_trade_requests
      (requesting_team_member_id, target_team_member_id, original_shift_id, requested_shift_id, status)
    values (me, post.author_id, p_shift, post.shift_id, 'pending_team_member')
    returning id into req_id;
    update public.swap_posts
      set status = 'pending', counterpart_id = me, deal_shift_id = p_shift, trade_request_id = req_id
    where id = p_post;

    perform private.swap_system_reply(p_post,
      private.member_display_name(me) || ' proposed trading their ' || private.shift_when(mine) ||
      ' for this shift — waiting for ' || private.member_display_name(post.author_id) || ' to accept.');
    perform private.notify(post.author_id, 'swap_offer',
      private.member_display_name(me) || ' wants to trade for your shift',
      'From the Swap Board: they offer their ' || private.shift_when(mine) || '. Accept or decline in the thread.',
      'swap_post', p_post);
  end if;
end;
$$;

grant execute on function public.swap_post_claim(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------- 2) My Schedule giveaway -> post

-- A broadcast give-away ("anyone qualified") created OUTSIDE the board gets an
-- open board tile on the shift's (location, role) board. Specific-person
-- offers stay private. Board-originated requests set tch.swap_internal, so
-- this never doubles up a tile for them.
create or replace function private.autopost_giveaway_to_board()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shifts%rowtype;
begin
  if private.swap_internal() then return null; end if;
  if new.status <> 'open' then return null; end if;
  if new.offer_type not in ('qualified_location', 'qualified_all') then return null; end if;
  select * into s from public.shifts where id = new.shift_id;
  if not found or s.role_id is null or s.location_id is null then return null; end if;
  if s.start_at <= now() then return null; end if;
  if exists (select 1 from public.swap_posts where giveaway_request_id = new.id) then return null; end if;

  perform set_config('tch.swap_internal', 'on', true);
  insert into public.swap_posts (location_id, role_id, author_id, intent, shift_id, status, giveaway_request_id, note)
  values (s.location_id, s.role_id, new.original_team_member_id, 'giveaway', new.shift_id, 'open', new.id,
          'Posted automatically from My Schedule.');
  perform set_config('tch.swap_internal', '', true);
  return null;
end;
$$;

create trigger autopost_to_board after insert on public.shift_giveaway_requests
  for each row execute function private.autopost_giveaway_to_board();
