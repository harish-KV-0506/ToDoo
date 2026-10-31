alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists profiles_avatar_path_owner_check,
  add constraint profiles_avatar_path_owner_check
    check (avatar_path is null or avatar_path like user_id::text || '/avatars/%');

grant update (display_name, headline, bio, location, portfolio_url, avatar_path)
  on public.profiles to authenticated;

alter table public.work_posts
  add column if not exists image_path text,
  add column if not exists project_title text check (project_title is null or char_length(project_title) <= 200),
  add column if not exists project_description text check (project_description is null or char_length(project_description) <= 500),
  add column if not exists project_image_url text check (
    project_image_url is null
    or (char_length(project_image_url) <= 2048 and project_image_url ~* '^https://')
  );

alter table public.work_posts
  drop constraint if exists work_posts_image_path_owner_check,
  add constraint work_posts_image_path_owner_check
    check (image_path is null or image_path like author_id::text || '/posts/%');

create table if not exists public.work_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.work_posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists work_post_comments_post_created_idx
  on public.work_post_comments (post_id, created_at);

alter table public.work_post_comments enable row level security;

drop policy if exists "Signed-in members can read post comments" on public.work_post_comments;
create policy "Signed-in members can read post comments"
on public.work_post_comments for select to authenticated
using (auth.uid() is not null);

drop policy if exists "Members can comment on work posts" on public.work_post_comments;
create policy "Members can comment on work posts"
on public.work_post_comments for insert to authenticated
with check (author_id = auth.uid());

drop policy if exists "Authors can remove their comments or comments on their posts" on public.work_post_comments;
create policy "Authors can remove their comments or comments on their posts"
on public.work_post_comments for delete to authenticated
using (
  author_id = auth.uid()
  or exists (
    select 1 from public.work_posts
    where work_posts.id = work_post_comments.post_id
      and work_posts.author_id = auth.uid()
  )
);

grant select, insert, delete on public.work_post_comments to authenticated;

create table if not exists public.work_post_useful_marks (
  post_id uuid not null references public.work_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.work_post_useful_marks enable row level security;

drop policy if exists "Members can read their own useful marks" on public.work_post_useful_marks;
create policy "Members can read their own useful marks"
on public.work_post_useful_marks for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Members can mark posts useful" on public.work_post_useful_marks;
create policy "Members can mark posts useful"
on public.work_post_useful_marks for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Members can remove their useful marks" on public.work_post_useful_marks;
create policy "Members can remove their useful marks"
on public.work_post_useful_marks for delete to authenticated
using (user_id = auth.uid());

grant select, insert, delete on public.work_post_useful_marks to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'network-media',
  'network-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signed-in members can read network media" on storage.objects;
create policy "Signed-in members can read network media"
on storage.objects for select to authenticated
using (bucket_id = 'network-media');

drop policy if exists "Members can upload their own network media" on storage.objects;
create policy "Members can upload their own network media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'network-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Members can update their own network media" on storage.objects;
create policy "Members can update their own network media"
on storage.objects for update to authenticated
using (
  bucket_id = 'network-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'network-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Members can delete their own network media" on storage.objects;
create policy "Members can delete their own network media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'network-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'work_post_comments'
    ) then
      alter publication supabase_realtime add table public.work_post_comments;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'work_post_useful_marks'
    ) then
      alter publication supabase_realtime add table public.work_post_useful_marks;
    end if;
  end if;
end;
$$;
