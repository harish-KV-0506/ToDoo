alter table public.profiles
  add column if not exists headline text check (headline is null or char_length(headline) <= 120),
  add column if not exists bio text check (bio is null or char_length(bio) <= 1000),
  add column if not exists location text check (location is null or char_length(location) <= 120),
  add column if not exists portfolio_url text
    check (portfolio_url is null or (char_length(portfolio_url) <= 2048 and portfolio_url ~* '^https?://'));

drop policy if exists "Profiles are visible to you and your board teammates" on public.profiles;
create policy "Signed-in members can discover professional profiles"
on public.profiles for select to authenticated
using (auth.uid() is not null);

grant update (display_name, headline, bio, location, portfolio_url) on public.profiles to authenticated;

create table if not exists public.work_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  project_url text check (
    project_url is null
    or (char_length(project_url) <= 2048 and project_url ~* '^https?://')
  ),
  created_at timestamptz not null default now()
);

create index if not exists work_posts_created_at_idx
  on public.work_posts (created_at desc);
create index if not exists work_posts_author_created_idx
  on public.work_posts (author_id, created_at desc);

alter table public.work_posts enable row level security;

drop policy if exists "Signed-in members can read work posts" on public.work_posts;
create policy "Signed-in members can read work posts"
on public.work_posts for select to authenticated
using (auth.uid() is not null);

drop policy if exists "Members can publish their own work" on public.work_posts;
create policy "Members can publish their own work"
on public.work_posts for insert to authenticated
with check (author_id = auth.uid());

drop policy if exists "Members can edit their own work" on public.work_posts;
create policy "Members can edit their own work"
on public.work_posts for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "Members can remove their own work" on public.work_posts;
create policy "Members can remove their own work"
on public.work_posts for delete to authenticated
using (author_id = auth.uid());

grant select, insert, update, delete on public.work_posts to authenticated;

create table if not exists public.professional_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists professional_connections_pair_idx
  on public.professional_connections (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );
create index if not exists professional_connections_addressee_idx
  on public.professional_connections (addressee_id, status);

alter table public.professional_connections enable row level security;

drop policy if exists "Members can view their professional connections" on public.professional_connections;
create policy "Members can view their professional connections"
on public.professional_connections for select to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "Members can request professional connections" on public.professional_connections;
create policy "Members can request professional connections"
on public.professional_connections for insert to authenticated
with check (requester_id = auth.uid() and requester_id <> addressee_id and status = 'pending');

drop policy if exists "Recipients can accept connection requests" on public.professional_connections;
create policy "Recipients can accept connection requests"
on public.professional_connections for update to authenticated
using (addressee_id = auth.uid() and status = 'pending')
with check (addressee_id = auth.uid() and status = 'accepted');

drop policy if exists "Participants can remove pending connection requests" on public.professional_connections;
create policy "Participants can remove pending connection requests"
on public.professional_connections for delete to authenticated
using (
  status = 'pending'
  and (auth.uid() = requester_id or auth.uid() = addressee_id)
);

grant select, insert, delete on public.professional_connections to authenticated;
grant update (status) on public.professional_connections to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'work_posts'
    ) then
      alter publication supabase_realtime add table public.work_posts;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'professional_connections'
    ) then
      alter publication supabase_realtime add table public.professional_connections;
    end if;
  end if;
end;
$$;
