-- =============================================================================
-- Swap Board (messaging phase 2)
--
-- A per-role, per-club board where team members post short tiles:
--   pickup   — "I'm looking to pick up shifts"
--   giveaway — "I'm giving away my <shift>"
--   trade    — "I want to trade my <shift>"
-- Each tile has a lightweight reply thread ("chatter"). When the poster picks
-- someone (or, on a pickup tile, when someone offers them a shift), the board
-- creates the REAL shift_giveaway_request / shift_trade_request, so the
-- existing accept + manager-approval flow applies unchanged. The tile's status
-- then mirrors that request automatically:
--   open -> pending (deal in progress) -> completed, or back to open if the
--   deal is declined, denied or withdrawn.
--
-- Access: a board for (club, role) is visible to active members who hold that
-- role at that club, plus manager+ at that club. Posting requires the role.
-- Messaging-muted members can read but not post or reply. Board alerts can be
-- muted per board (swap_board_mutes).
-- =============================================================================

create type public.swap_intent      as enum ('pickup', 'giveaway', 'trade');
create type public.swap_post_status as enum ('open', 'pending', 'completed', 'cancelled');

create table public.swap_posts (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid not null references public.locations (id),
  role_id             uuid not null references public.roles (id),
  author_id           uuid not null references public.team_members (id),
  intent              public.swap_intent not null,
  shift_id            uuid references public.shifts (id),        -- giveaway/trade: the poster's shift on offer
  note                text,
  status              public.swap_post_status not null default 'open',
  counterpart_id      uuid references public.team_members (id),  -- who the current deal is with
  deal_shift_id       uuid references public.shifts (id),        -- trade: their shift; pickup: the shift offered
  giveaway_request_id uuid references public.shift_giveaway_requests (id),
  trade_request_id    uuid references public.shift_trade_requests (id),
  completed_at        timestamptz,
  cancelled_by        uuid references public.team_members (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((intent = 'pickup' and shift_id is null) or (intent <> 'pickup' and shift_id is not null))
);
create index swap_posts_board_idx    on public.swap_posts (location_id, role_id, status, created_at desc);
create index swap_posts_author_idx   on public.swap_posts (author_id);
create index swap_posts_giveaway_idx on public.swap_posts (giveaway_request_id) where giveaway_request_id is not null;
create index swap_posts_trade_idx    on public.swap_posts (trade_request_id)    where trade_request_id is not null;

create table public.swap_replies (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.swap_posts (id) on delete cascade,
  author_id  uuid references public.team_members (id),  -- null = system entry
  kind       text not null default 'reply' check (kind in ('reply', 'system')),
  body       text not null,
  deleted_at timestamptz,
  deleted_by uuid references public.team_members (id),
  created_at timestamptz not null default now()
);
create index swap_replies_post_idx on public.swap_replies (post_id, created_at);

-- per-board alert mute (one row = "don't notify me about new posts on this board")
create table public.swap_board_mutes (
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  location_id    uuid not null references public.locations (id) on delete cascade,
  role_id        uuid not null references public.roles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (team_member_id, location_id, role_id)
);

alter table public.swap_posts       enable row level security;
alter table public.swap_replies     enable row level security;
alter table public.swap_board_mutes enable row level security;

create trigger set_updated_at before update on public.swap_posts
  for each row execute function private.set_updated_at();
create trigger audit after insert or update on public.swap_posts
  for each row execute function private.write_audit_log();

-- ------------------------------------------------------------------ helpers

create or replace function private.shift_role_id(shift uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select role_id from public.shifts where id = shift;
$$;

create or replace function private.member_has_role(member uuid, role uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_member_roles r
    where r.team_member_id = member and r.role_id = role
  );
$$;

-- members of a board: active, hold the role, work at the club
create or replace function private.swap_board_member_ids(loc uuid, role uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tm.id
  from public.team_members tm
  where tm.status = 'active'
    and private.member_has_role(tm.id, role)
    and exists (select 1 from private.member_location_ids(tm.id) l where l.location_id = loc);
$$;

create or replace function private.can_view_swap_board(loc uuid, role uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (private.is_at_least('manager') and private.has_location_access(loc))
    or (
      private.member_has_role(private.current_team_member_id(), role)
      and exists (
        select 1 from private.member_location_ids(private.current_team_member_id()) l
        where l.location_id = loc
      )
    );
$$;

create or replace function private.can_moderate_swap_board(loc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_at_least('manager') and private.has_location_access(loc);
$$;

create or replace function private.swap_post_viewable(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_swap_board(p.location_id, p.role_id)
  from public.swap_posts p where p.id = post;
$$;

create or replace function private.swap_post_moderatable(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_moderate_swap_board(p.location_id)
  from public.swap_posts p where p.id = post;
$$;

create or replace function private.member_display_name(member uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(preferred_name, first_name) || ' ' || last_name
  from public.team_members where id = member;
$$;

-- "internal" flag: set inside the RPCs and sync triggers so the guard trigger
-- lets them change fields a user may not touch directly
create or replace function private.swap_internal()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(current_setting('tch.swap_internal', true), '') = 'on';
$$;

create or replace function private.swap_system_reply(p_post uuid, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.swap_replies (post_id, author_id, kind, body)
  values (p_post, null, 'system', p_body);
$$;

-- ---------------------------------------------------------------------- RLS

create policy "swap_posts_select" on public.swap_posts
  for select to authenticated
  using (private.can_view_swap_board(location_id, role_id));

-- posting: the poster must hold the role at that club (managers included);
-- giveaway/trade must be the poster's own shift on that board; pickups need
-- the poster to be allowed to receive swaps. No deal fields may be preset.
create policy "swap_posts_insert" on public.swap_posts
  for insert to authenticated
  with check (
    author_id = private.current_team_member_id()
    and status = 'open'
    and counterpart_id is null and deal_shift_id is null
    and giveaway_request_id is null and trade_request_id is null
    and private.can_view_swap_board(location_id, role_id)
    and private.member_has_role(author_id, role_id)
    and not private.is_messaging_muted()
    and (
      (intent = 'pickup' and not private.swap_receive_blocked())
      or (
        intent in ('giveaway', 'trade')
        and private.owns_shift(shift_id)
        and not private.swap_give_blocked()
        and private.shift_location_id(shift_id) = location_id
        and private.shift_role_id(shift_id) = role_id
      )
    )
  );

-- direct updates: the poster or a manager at the club (what they may change is
-- limited by guard_swap_post_update; the RPCs and sync triggers bypass it)
create policy "swap_posts_update" on public.swap_posts
  for update to authenticated
  using (author_id = private.current_team_member_id() or private.can_moderate_swap_board(location_id))
  with check (author_id = private.current_team_member_id() or private.can_moderate_swap_board(location_id));

create or replace function private.guard_swap_post_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.swap_internal() then
    return new;
  end if;
  -- a person may only edit the note, or cancel an open post
  if new.location_id <> old.location_id or new.role_id <> old.role_id or new.author_id <> old.author_id
     or new.intent <> old.intent or new.shift_id is distinct from old.shift_id
     or new.counterpart_id is distinct from old.counterpart_id
     or new.deal_shift_id is distinct from old.deal_shift_id
     or new.giveaway_request_id is distinct from old.giveaway_request_id
     or new.trade_request_id is distinct from old.trade_request_id
     or new.completed_at is distinct from old.completed_at then
    raise exception 'That part of a post cannot be changed directly';
  end if;
  if new.status <> old.status then
    if not (old.status = 'open' and new.status = 'cancelled') then
      raise exception 'Only an open post can be cancelled; deals change through the swap itself';
    end if;
    new.cancelled_by := private.current_team_member_id();
  end if;
  return new;
end;
$$;
create trigger guard_swap_post_update before update on public.swap_posts
  for each row execute function private.guard_swap_post_update();

create policy "swap_replies_select" on public.swap_replies
  for select to authenticated
  using (private.swap_post_viewable(post_id));

create policy "swap_replies_insert" on public.swap_replies
  for insert to authenticated
  with check (
    author_id = private.current_team_member_id()
    and kind = 'reply'
    and deleted_at is null
    and private.swap_post_viewable(post_id)
    and not private.is_messaging_muted()
    and exists (select 1 from public.swap_posts p where p.id = post_id and p.status <> 'cancelled')
  );

-- soft delete: your own reply, or any reply as a manager at the club
create policy "swap_replies_update" on public.swap_replies
  for update to authenticated
  using (author_id = private.current_team_member_id() or private.swap_post_moderatable(post_id))
  with check (author_id = private.current_team_member_id() or private.swap_post_moderatable(post_id));

create policy "swap_board_mutes_select" on public.swap_board_mutes
  for select to authenticated using (team_member_id = private.current_team_member_id());
create policy "swap_board_mutes_insert" on public.swap_board_mutes
  for insert to authenticated with check (team_member_id = private.current_team_member_id());
create policy "swap_board_mutes_delete" on public.swap_board_mutes
  for delete to authenticated using (team_member_id = private.current_team_member_id());

-- ------------------------------------------------------- starting a deal
-- giveaway tile: the poster gives their shift to p_counterpart
-- trade tile:    the poster trades their shift for p_counterpart's p_shift
-- pickup tile:   the CALLER offers their own p_shift to the poster
create or replace function public.swap_post_initiate(p_post uuid, p_counterpart uuid default null, p_shift uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me       uuid := private.current_team_member_id();
  post     public.swap_posts%rowtype;
  s        public.shifts%rowtype;
  other    uuid;
  req_id   uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into post from public.swap_posts where id = p_post for update;
  if not found then raise exception 'Post not found'; end if;
  if post.status <> 'open' then raise exception 'This post is no longer open'; end if;
  if private.is_messaging_muted() then raise exception 'Your messaging is muted'; end if;

  perform set_config('tch.swap_internal', 'on', true);

  if post.intent in ('giveaway', 'trade') then
    if me <> post.author_id then raise exception 'Only the poster can start this swap'; end if;
    if p_counterpart is null or p_counterpart = me then raise exception 'Pick who you are swapping with'; end if;
    if (select no_shift_swap_give from public.team_members where id = me) then
      raise exception 'You are not allowed to give away shifts';
    end if;
    if not private.owns_shift(post.shift_id) then raise exception 'That shift is no longer yours'; end if;
    if not exists (select 1 from public.qualified_for_shift(post.shift_id) q where q.id = p_counterpart) then
      raise exception '% is not qualified to work this shift', private.member_display_name(p_counterpart);
    end if;
    other := p_counterpart;

    if post.intent = 'giveaway' then
      insert into public.shift_giveaway_requests (original_team_member_id, shift_id, offer_type, status)
      values (me, post.shift_id, 'specific', 'open') returning id into req_id;
      insert into public.shift_giveaway_targets (giveaway_id, team_member_id) values (req_id, other);
      update public.swap_posts set status = 'pending', counterpart_id = other, giveaway_request_id = req_id where id = p_post;
      perform private.swap_system_reply(p_post,
        private.member_display_name(me) || ' offered this shift to ' || private.member_display_name(other) || ' — waiting for them to accept.');
      select * into s from public.shifts where id = post.shift_id;
      perform private.notify(other, 'swap_offer', private.member_display_name(me) || ' is giving you a shift',
        'From the Swap Board: ' || private.shift_when(s) || '. Accept or decline in the thread.',
        'swap_post', p_post);
    else
      if p_shift is null then raise exception 'Pick which of their shifts you want'; end if;
      select * into s from public.shifts where id = p_shift;
      if not found or s.team_member_id is distinct from other or s.status <> 'published' or s.archived then
        raise exception 'That shift is not theirs to trade';
      end if;
      if s.start_at <= now() then raise exception 'That shift has already started'; end if;
      if not exists (select 1 from public.qualified_for_shift(p_shift) q where q.id = me) then
        raise exception 'You are not qualified to work their shift';
      end if;
      insert into public.shift_trade_requests (requesting_team_member_id, target_team_member_id, original_shift_id, requested_shift_id, status)
      values (me, other, post.shift_id, p_shift, 'pending_team_member') returning id into req_id;
      update public.swap_posts set status = 'pending', counterpart_id = other, deal_shift_id = p_shift, trade_request_id = req_id where id = p_post;
      perform private.swap_system_reply(p_post,
        private.member_display_name(me) || ' proposed trading this shift for ' || private.member_display_name(other)
        || '’s ' || private.shift_when(s) || ' — waiting for them to accept.');
      perform private.notify(other, 'swap_offer', private.member_display_name(me) || ' wants to trade shifts with you',
        'From the Swap Board: they take your ' || private.shift_when(s) || '. Accept or decline in the thread.',
        'swap_post', p_post);
    end if;

  else -- pickup: I offer my shift to the poster
    if me = post.author_id then raise exception 'You cannot offer a shift to yourself'; end if;
    if p_shift is null then raise exception 'Pick which of your shifts to offer'; end if;
    select * into s from public.shifts where id = p_shift;
    if not found or s.team_member_id is distinct from me or s.status <> 'published' or s.archived then
      raise exception 'That shift is not yours to offer';
    end if;
    if s.start_at <= now() then raise exception 'That shift has already started'; end if;
    if s.location_id <> post.location_id or s.role_id <> post.role_id then
      raise exception 'Offer a % shift at this club', (select name from public.roles where id = post.role_id);
    end if;
    if (select no_shift_swap_give from public.team_members where id = me) then
      raise exception 'You are not allowed to give away shifts';
    end if;
    if not exists (select 1 from public.qualified_for_shift(p_shift) q where q.id = post.author_id) then
      raise exception '% cannot take this shift', private.member_display_name(post.author_id);
    end if;
    other := post.author_id;
    insert into public.shift_giveaway_requests (original_team_member_id, shift_id, offer_type, status)
    values (me, p_shift, 'specific', 'open') returning id into req_id;
    insert into public.shift_giveaway_targets (giveaway_id, team_member_id) values (req_id, other);
    update public.swap_posts set status = 'pending', counterpart_id = me, deal_shift_id = p_shift, giveaway_request_id = req_id where id = p_post;
    perform private.swap_system_reply(p_post,
      private.member_display_name(me) || ' offered their ' || private.shift_when(s) || ' shift — waiting for '
      || private.member_display_name(other) || ' to accept.');
    perform private.notify(other, 'swap_offer', private.member_display_name(me) || ' offered you a shift',
      'From your Swap Board post: ' || private.shift_when(s) || '. Accept or decline in the thread.',
      'swap_post', p_post);
  end if;
end;
$$;
grant execute on function public.swap_post_initiate(uuid, uuid, uuid) to authenticated;

-- withdraw a pending deal (either party, or a manager at the club); the sync
-- trigger below reopens the tile
create or replace function public.swap_post_withdraw(p_post uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me   uuid := private.current_team_member_id();
  post public.swap_posts%rowtype;
begin
  select * into post from public.swap_posts where id = p_post for update;
  if not found then raise exception 'Post not found'; end if;
  if post.status <> 'pending' then raise exception 'There is no deal in progress on this post'; end if;
  if me is distinct from post.author_id and me is distinct from post.counterpart_id
     and not private.can_moderate_swap_board(post.location_id) then
    raise exception 'Only the two people in this swap (or a manager) can withdraw it';
  end if;
  perform set_config('tch.swap_internal', 'on', true);
  perform set_config('tch.swap_actor', me::text, true);
  if post.giveaway_request_id is not null then
    update public.shift_giveaway_requests set status = 'cancelled', reviewed_at = now()
    where id = post.giveaway_request_id and status in ('open', 'pending_manager');
  elsif post.trade_request_id is not null then
    update public.shift_trade_requests set status = 'cancelled', reviewed_at = now()
    where id = post.trade_request_id and status in ('pending_team_member', 'pending_manager');
  end if;
end;
$$;
grant execute on function public.swap_post_withdraw(uuid) to authenticated;

-- ------------------------------------------ mirror the real request's status
create or replace function private.swap_apply_request_status(
  p_post uuid, p_new text, p_old text, p_taker uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  post public.swap_posts%rowtype;
  who  text;
begin
  select * into post from public.swap_posts where id = p_post;
  if not found then return; end if;
  perform set_config('tch.swap_internal', 'on', true);

  if p_new in ('accepted', 'approved') then
    update public.swap_posts set status = 'completed', completed_at = now() where id = p_post;
    perform private.swap_system_reply(p_post, 'Done — ' || private.member_display_name(p_taker) || ' now has the shift. Schedules are updated.');
    perform private.notify(post.author_id, 'swap_completed', 'Swap completed',
      'Your Swap Board post is done: ' || private.member_display_name(p_taker) || ' now has the shift.', 'swap_post', p_post);
    if post.counterpart_id is not null and post.counterpart_id <> post.author_id then
      perform private.notify(post.counterpart_id, 'swap_completed', 'Swap completed',
        'The swap from the board is done and schedules are updated.', 'swap_post', p_post);
    end if;

  elsif p_new = 'pending_manager' and p_old is distinct from 'pending_manager' then
    perform private.swap_system_reply(p_post, private.member_display_name(p_taker) || ' accepted — waiting for a manager to approve.');
    perform private.notify(post.author_id, 'swap_pending', 'Swap accepted — pending manager',
      private.member_display_name(p_taker) || ' accepted. A manager will review it.', 'swap_post', p_post);

  elsif p_new in ('denied', 'cancelled') then
    who := case
      when p_new = 'cancelled' then coalesce(private.member_display_name(p_actor), 'Someone') || ' withdrew the offer.'
      when p_old = 'pending_manager' then 'A manager denied this swap.'
      else private.member_display_name(p_taker) || ' declined.'
    end;
    update public.swap_posts
      set status = 'open', counterpart_id = null, deal_shift_id = null,
          giveaway_request_id = null, trade_request_id = null
      where id = p_post;
    perform private.swap_system_reply(p_post, who || ' The post is open again.');
    perform private.notify(post.author_id, 'swap_reopened', 'Swap fell through', who || ' Your post is open again.', 'swap_post', p_post);
    if post.counterpart_id is not null and post.counterpart_id <> post.author_id and p_actor is distinct from post.counterpart_id then
      perform private.notify(post.counterpart_id, 'swap_reopened', 'Swap fell through', who, 'swap_post', p_post);
    end if;
  end if;
end;
$$;

create or replace function private.sync_swap_post_from_giveaway()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  pid uuid;
begin
  if new.status is not distinct from old.status then return null; end if;
  select id into pid from public.swap_posts where giveaway_request_id = new.id;
  if pid is null then return null; end if;
  perform private.swap_apply_request_status(pid, new.status::text, old.status::text,
    coalesce(new.accepting_team_member_id, (select team_member_id from public.shift_giveaway_targets where giveaway_id = new.id limit 1)),
    nullif(current_setting('tch.swap_actor', true), '')::uuid);
  return null;
end;
$$;
create trigger zz_sync_swap_post after update on public.shift_giveaway_requests
  for each row execute function private.sync_swap_post_from_giveaway();

create or replace function private.sync_swap_post_from_trade()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  pid uuid;
begin
  if new.status is not distinct from old.status then return null; end if;
  select id into pid from public.swap_posts where trade_request_id = new.id;
  if pid is null then return null; end if;
  perform private.swap_apply_request_status(pid, new.status::text, old.status::text,
    new.target_team_member_id, nullif(current_setting('tch.swap_actor', true), '')::uuid);
  return null;
end;
$$;
create trigger zz_sync_swap_post after update on public.shift_trade_requests
  for each row execute function private.sync_swap_post_from_trade();

-- ----------------------------------------------------------- notifications
-- new post -> everyone on that board (except the poster and anyone who muted it)
create or replace function private.notify_swap_post()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s       public.shifts%rowtype;
  v_title text;
  v_msg   text;
  m       uuid;
  who     text := private.member_display_name(new.author_id);
begin
  if new.shift_id is not null then select * into s from public.shifts where id = new.shift_id; end if;
  v_title := case new.intent
    when 'pickup'   then who || ' is looking to pick up shifts'
    when 'giveaway' then who || ' is giving away a shift'
    else                 who || ' wants to trade a shift' end;
  v_msg := coalesce(
    case when new.shift_id is not null then private.shift_when(s) || case when new.note is not null then ' · ' || left(new.note, 100) else '' end
         else left(new.note, 140) end,
    (select name from public.roles where id = new.role_id) || ' swap board');
  for m in select * from private.swap_board_member_ids(new.location_id, new.role_id) loop
    if m <> new.author_id and not exists (
      select 1 from public.swap_board_mutes b
      where b.team_member_id = m and b.location_id = new.location_id and b.role_id = new.role_id
    ) then
      perform private.notify(m, 'swap_post', v_title, v_msg, 'swap_post', new.id);
    end if;
  end loop;
  return null;
end;
$$;
create trigger notify_swap_post after insert on public.swap_posts
  for each row execute function private.notify_swap_post();

-- new reply -> the poster; if the poster replied, -> everyone else in the thread
create or replace function private.notify_swap_reply()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.swap_posts%rowtype;
  m    uuid;
  who  text;
begin
  if new.kind <> 'reply' or new.author_id is null then return null; end if;
  select * into post from public.swap_posts where id = new.post_id;
  who := private.member_display_name(new.author_id);
  if new.author_id <> post.author_id then
    perform private.notify(post.author_id, 'swap_reply', who || ' replied to your swap post', left(new.body, 120), 'swap_post', post.id);
  else
    for m in
      select distinct r.author_id from public.swap_replies r
      where r.post_id = post.id and r.author_id is not null and r.author_id <> post.author_id
      union select post.counterpart_id where post.counterpart_id is not null
    loop
      perform private.notify(m, 'swap_reply', who || ' replied on the swap board', left(new.body, 120), 'swap_post', post.id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger notify_swap_reply after insert on public.swap_replies
  for each row execute function private.notify_swap_reply();

-- live threads
alter publication supabase_realtime add table public.swap_posts;
alter publication supabase_realtime add table public.swap_replies;
