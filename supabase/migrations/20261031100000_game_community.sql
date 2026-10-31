create table if not exists public.community_games (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  description text not null check (char_length(trim(description)) between 1 and 300),
  genre text not null check (genre in ('arcade', 'puzzle', 'platformer', 'strategy', 'other')),
  html text not null check (char_length(trim(html)) between 1 and 60000),
  created_at timestamptz not null default now()
);

create index if not exists community_games_created_at_idx
  on public.community_games (created_at desc);
create index if not exists community_games_author_created_idx
  on public.community_games (author_id, created_at desc);

alter table public.community_games enable row level security;

drop policy if exists "Signed-in members can read community games" on public.community_games;
create policy "Signed-in members can read community games"
on public.community_games for select to authenticated
using (auth.uid() is not null);

drop policy if exists "Members can publish their own games" on public.community_games;
create policy "Members can publish their own games"
on public.community_games for insert to authenticated
with check (author_id = auth.uid());

drop policy if exists "Members can edit their own games" on public.community_games;
create policy "Members can edit their own games"
on public.community_games for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "Members can remove their own games" on public.community_games;
create policy "Members can remove their own games"
on public.community_games for delete to authenticated
using (author_id = auth.uid());

grant select, insert, update, delete on public.community_games to authenticated;

create table if not exists public.game_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  activity_type text not null check (activity_type in ('created', 'played')),
  created_at timestamptz not null default now(),
  primary key (user_id, activity_date, activity_type)
);

alter table public.game_activity enable row level security;

drop policy if exists "Members can read their own game streak activity" on public.game_activity;
create policy "Members can read their own game streak activity"
on public.game_activity for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Members can record their own game streak activity" on public.game_activity;
create policy "Members can record their own game streak activity"
on public.game_activity for insert to authenticated
with check (user_id = auth.uid());

grant select, insert on public.game_activity to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_games'
    ) then
    alter publication supabase_realtime add table public.community_games;
  end if;
end;
$$;
